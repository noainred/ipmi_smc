/**
 * 서버 한 대 실행: 서비스 루트 → 인증 → 점검 항목 → 전체 탐색 → IPMI → The.DVC 가정 판정 → 저장.
 * 결과는 out/<서버 id>/<실행 id>/result.json, 원본 응답은 같은 폴더의 raw/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BmcClient } from '../http/bmcClient.js';
import { makeContext } from '../redfish/context.js';
import { kindOf, noteOf, STATUSES } from '../redfish/status.js';
import { CHECKS, discover, runChecks, oemCheck } from '../redfish/checks.js';
import { crawl } from '../redfish/crawl.js';
import { collectIpmi, COMMANDS } from '../ipmi/ipmitool.js';
import { evaluateAssumptions, verdictCounts } from '../dvc/assumptions.js';
import { classifyBmcVendor } from '../redfish/vendor.js';
import { RawStore } from './rawStore.js';
import { atomicWrite, runStamp } from '../util/fsx.js';
import { scrub } from '../util/mask.js';
import { TOOL, DVC_BASE_COMMIT } from '../version.js';
import { DEFAULTS } from '../config.js';

export const STEPS = [
  { key: 'probe', label: '서비스 루트 · 벤더 판별' },
  { key: 'auth', label: '인증(Basic → Digest → 세션)' },
  { key: 'checks', label: `The.DVC 대응 점검 ${CHECKS.length}개` },
  { key: 'crawl', label: '전체 Redfish 탐색' },
  { key: 'ipmi', label: `IPMI 명령 ${COMMANDS.length}개` },
  { key: 'analyze', label: 'The.DVC 가정 판정 · 저장' },
];

/** 비밀 없는 서버 정보(결과 파일·화면용). */
export function publicServer(s) {
  return {
    id: s.id, name: s.name, role: s.role, host: s.host, port: s.port || '', username: s.username, insecure: s.insecure !== false,
    ipmi: { enabled: !!s.ipmi?.enabled, sameCreds: s.ipmi?.sameCreds !== false, username: s.ipmi?.sameCreds === false ? (s.ipmi?.username || '') : s.username, cipher: s.ipmi?.cipher || '' },
  };
}

function summarize(result) {
  const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  for (const c of CHECKS) counts[result.checks?.[c.id]?.status || 'skip'] += 1;
  const sys = result.checks?.system?.data || {};
  const mgr = result.checks?.manager?.data || {};
  const root = result.checks?.serviceRoot?.data || {};
  return {
    counts, total: CHECKS.length, assumptions: verdictCounts(result.assumptions),
    vendor: result.vendor, vendorLabel: root.vendorLabel || '', redfishVersion: root.RedfishVersion || '',
    model: [sys.Manufacturer, sys.Model].filter(Boolean).join(' '), serial: sys.SerialNumber || '', sku: sys.SKU || '',
    bmcFirmware: mgr.FirmwareVersion || '', biosVersion: sys.BiosVersion || '', powerState: sys.PowerState || '',
    authMode: result.auth?.mode || '', authFailed: !!result.auth?.failed, tlsNote: result.auth?.tlsNote || '',
    requests: result.requests?.requests || 0, durationMs: result.durationMs || 0,
    crawlResources: result.crawl?.stats?.resources || 0,
    ipmiOk: (result.ipmi?.commands || []).filter((x) => x.ok).length, ipmiTotal: (result.ipmi?.commands || []).length,
    fatal: result.fatal || '',
  };
}

/**
 * @param {object} server  저장된 서버(비밀번호 포함 — 이 함수 밖으로 내보내지 않는다)
 * @param {object} o  { outDir, options:{crawl,ipmi,crawlMax,crawlBudgetMs,timeoutMs}, onEvent, signal }
 */
export async function runServer(server, { outDir, options = {}, onEvent = null, signal = null } = {}) {
  const opt = {
    crawl: options.crawl !== false, ipmi: options.ipmi !== false && server.ipmi?.enabled !== false,
    crawlMax: Number(options.crawlMax) > 0 ? Math.min(Number(options.crawlMax), 20000) : DEFAULTS.crawlMaxResources,
    crawlBudgetMs: Number(options.crawlBudgetMs) > 0 ? Number(options.crawlBudgetMs) : DEFAULTS.crawlBudgetMs,
    timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULTS.requestTimeoutMs,
  };
  const emit = (type, payload = {}) => { try { onEvent?.({ type, ...payload }); } catch { /* 화면 갱신 실패는 수집을 멈추지 않는다 */ } };
  const step = (key, state, detail = '', extra = {}) => emit('step', { key, state, detail, ...extra });
  const runId = runStamp();
  const base = path.join(outDir, server.id, runId);
  const raw = new RawStore(path.join(base, 'raw'));
  const started = Date.now();
  const result = {
    schema: 1, tool: TOOL, dvcBase: DVC_BASE_COMMIT, runId, startedAt: new Date(started).toISOString(),
    server: publicServer(server), env: { node: process.version, platform: process.platform, arch: process.arch }, options: opt,
    probe: null, auth: null, checks: {}, crawl: null, ipmi: null, assumptions: [], vendor: 'unknown',
  };
  const secrets = [server.password, server.ipmi?.password].filter(Boolean);
  let client;
  try {
    client = new BmcClient({
      host: server.host, port: server.port, username: server.username, password: server.password,
      insecure: server.insecure !== false, timeoutMs: opt.timeoutMs, signal,
      onRequest: (e) => emit('request', { line: `${e.method} ${e.path} → ${e.status || 'ERR'}${e.error ? ` (${e.error})` : ''} · ${e.ms}ms` }),
    });
  } catch (e) {
    result.fatal = String(e?.message || e);
    step('probe', 'fail', result.fatal);
    return finish();
  }
  const ctx = makeContext(client, { rawStore: raw, signal });

  try {
    // 1) 서비스 루트(무인증)
    step('probe', 'run');
    const root = await client.getNoAuth('/redfish/v1');
    const rootSlim = { path: '/redfish/v1', status: root.status, json: root.json, text: root.json ? '' : String(root.text || '').slice(0, 4000), ms: root.ms, bytes: root.bytes, error: root.error || '' };
    rootSlim.kind = root.status === 401 ? 'auth' : kindOf(root);
    rootSlim.note = noteOf(root);
    rootSlim.file = raw.save(rootSlim);
    ctx.rootNoAuth = rootSlim;
    const v = classifyBmcVendor({ root: root.json || {} });
    result.probe = { status: root.status, kind: rootSlim.kind, note: rootSlim.note, ms: root.ms, vendor: v.vendor, vendorLabel: v.label, evidence: v.evidence, product: v.product, redfishVersion: root.json?.RedfishVersion || '' };
    if (!root.status) {
      result.fatal = `Redfish 에 접속하지 못함: ${root.error}`;
      step('probe', 'fail', result.fatal);
      step('auth', 'skip', '접속 실패'); step('checks', 'skip'); step('crawl', 'skip');
    } else {
      step('probe', 'done', `${v.label}${root.json?.RedfishVersion ? ` · Redfish ${root.json.RedfishVersion}` : ''}${client.tlsNote ? ' · 구형 TLS' : ''}`);

      // 2) 인증 + 기본 컬렉션
      step('auth', 'run');
      await discover(ctx);
      result.auth = { mode: client.authMode || '', failed: client.authFailed, message: scrub(client.authMessage, secrets), tlsNote: client.tlsNote, insecure: client.insecure };
      if (client.authFailed) step('auth', 'fail', result.auth.message);
      else step('auth', 'done', `${client.authMode || '?'} · System ${ctx.sysIds.length} · Manager ${ctx.mgrIds.length} · Chassis ${ctx.chassisIds.length}`);

      // 3) 점검 항목
      if (client.authFailed) {
        step('checks', 'skip', '인증 실패');
      } else {
        step('checks', 'run', '', { done: 0, total: CHECKS.length });
        let n = 0;
        result.checks = await runChecks(ctx, {
          sensorMemberCap: DEFAULTS.sensorMemberCap,
          onCheck: (id, phase) => { if (phase === 'done') { n += 1; step('checks', 'run', id, { done: n, total: CHECKS.length }); } },
        });
        step('checks', 'done', `${CHECKS.length}개`, { done: CHECKS.length, total: CHECKS.length });
      }

      // 4) 전체 탐색
      if (opt.crawl && !client.authFailed && !signal?.aborted) {
        step('crawl', 'run', '', { done: 0, total: opt.crawlMax });
        let lastEmit = 0;
        result.crawl = await crawl(ctx, {
          maxResources: opt.crawlMax, budgetMs: opt.crawlBudgetMs, concurrency: DEFAULTS.crawlConcurrency, memberCap: DEFAULTS.collectionMemberCap,
          onProgress: (p) => { const now = Date.now(); if (now - lastEmit > 400) { lastEmit = now; step('crawl', 'run', `${p.done}개 읽음 · 대기 ${p.queued}`, { done: p.done, total: p.max }); } },
        });
        step('crawl', 'done', `${result.crawl.stats.resources}개 · ${result.crawl.stats.stopReason}`, { done: result.crawl.stats.resources, total: opt.crawlMax });
      } else {
        step('crawl', 'skip', opt.crawl ? '인증 실패·취소' : '옵션 꺼짐');
      }
    }
    if (!client.authFailed && root.status) result.checks.oem = oemCheck(ctx, result.crawl?.index || []);
    for (const c of CHECKS) if (!result.checks[c.id]) result.checks[c.id] = { status: client.authFailed ? 'auth' : (root.status ? 'skip' : 'error'), note: client.authFailed ? '인증 실패로 실행하지 않음' : (root.status ? '' : 'Redfish 접속 실패'), data: {}, evidence: [] };
    result.vendor = result.checks.serviceRoot?.data?.vendor || result.probe?.vendor || 'unknown';
  } finally {
    await client.close();
  }

  // 5) IPMI
  if (opt.ipmi) {
    const same = server.ipmi?.sameCreds !== false;
    if (same && client.authFailed) {
      result.ipmi = { available: null, commands: [], parsed: {}, stoppedReason: 'Redfish 인증이 거부됨 — 같은 계정으로 IPMI 를 시도하지 않음(계정 잠금 방지)' };
      step('ipmi', 'skip', result.ipmi.stoppedReason);
    } else if (signal?.aborted) {
      step('ipmi', 'skip', '취소됨');
    } else {
      step('ipmi', 'run', '', { done: 0, total: COMMANDS.length });
      let n = 0;
      try {
        result.ipmi = await collectIpmi({
          host: server.host, username: same ? server.username : (server.ipmi?.username || server.username),
          password: same ? server.password : (server.ipmi?.password || ''), cipher: server.ipmi?.cipher || '', signal,
          timeoutMs: DEFAULTS.ipmiTimeoutMs,
          onCommand: (label, phase) => { if (phase !== 'start') { n += 1; step('ipmi', 'run', label, { done: n, total: COMMANDS.length }); emit('request', { line: `ipmitool ${label} → ${phase}` }); } },
        });
      } catch (e) {
        // IPMI 코드 오류가 Redfish 결과까지 잃게 하지 않는다 — 그 단계만 실패로 남긴다.
        result.ipmi = { available: null, commands: [], parsed: {}, stoppedReason: `IPMI 실행 오류: ${scrub(String(e?.message || e), secrets).slice(0, 200)}` };
      }
      const okN = result.ipmi.commands.filter((x) => x.ok).length;
      step('ipmi', result.ipmi.available === false ? 'skip' : (okN ? 'done' : 'fail'), result.ipmi.stoppedReason || `${okN}/${result.ipmi.commands.length} 성공`, { done: COMMANDS.length, total: COMMANDS.length });
    }
  } else {
    result.ipmi = { available: null, commands: [], parsed: {}, stoppedReason: 'IPMI 옵션 꺼짐' };
    step('ipmi', 'skip', '옵션 꺼짐');
  }
  return finish();

  function finish() {
    step('analyze', 'run');
    result.assumptions = evaluateAssumptions(result);
    result.requests = client?.stats || { requests: 0, bytes: 0, byStatus: {}, errors: 0 };
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - started;
    result.rawFiles = raw.count;
    result.summary = summarize(result);
    try {
      atomicWrite(path.join(base, 'result.json'), JSON.stringify(result));
      atomicWrite(path.join(outDir, server.id, 'latest.json'), JSON.stringify({ runId, finishedAt: result.finishedAt }));
      pruneRuns(path.join(outDir, server.id), 5);
    } catch (e) {
      result.saveError = String(e?.message || e);
    }
    const rel = path.relative(process.cwd(), base);
    step('analyze', 'done', `저장: ${rel && !rel.startsWith('..') ? rel : base}`);
    return result;
  }
}

/** 서버별로 최근 N개 실행만 남긴다(원본 덤프가 쌓여 디스크를 채우지 않게). */
export function pruneRuns(serverDir, keep = 5) {
  let dirs;
  try { dirs = fs.readdirSync(serverDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{8}-\d{6}$/.test(d.name)).map((d) => d.name).sort(); } catch { return; }
  for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    try { fs.rmSync(path.join(serverDir, d), { recursive: true, force: true }); } catch { /* 다음 */ }
  }
}

/** 최신 결과 읽기(없으면 null). */
export function loadLatest(outDir, serverId) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(outDir, serverId, 'latest.json'), 'utf8'));
    if (!/^\d{8}-\d{6}$/.test(String(p.runId))) return null;
    return JSON.parse(fs.readFileSync(path.join(outDir, serverId, p.runId, 'result.json'), 'utf8'));
  } catch { return null; }
}
