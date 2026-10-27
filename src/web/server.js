/**
 * 로컬 웹 서버 — 이 맥의 브라우저에서만 쓰는 화면과 API.
 *
 * 보안(BMC 자격증명을 다루므로):
 *  ① 127.0.0.1 에만 바인딩(같은 네트워크의 다른 PC 가 접속하지 못한다)
 *  ② 실행마다 무작위 토큰 — /api 는 X-PoC-Token 헤더가 맞아야 한다(다른 웹페이지가 이 서버로 요청을 위조하지 못하게)
 *  ③ Host 헤더가 127.0.0.1/localhost:포트 가 아니면 거부(DNS 리바인딩 차단)
 *  ④ 비밀번호는 응답에 싣지 않는다(store.publicView) · 요청 본문 64KB 상한
 *  ⑤ 원본 응답 읽기는 경로를 파일 이름으로 '계산' 해 찾는다(safeFileName — 사용자 입력을 파일 경로에 붙이지 않는다)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, DEFAULTS } from '../config.js';
import { ServerStore } from '../store/servers.js';
import { JobRunner } from '../run/jobs.js';
import { loadLatest } from '../run/runner.js';
import { buildCompare } from '../report/compare.js';
import { toMarkdown } from '../report/markdown.js';
import { buildExportHtml } from '../report/exportHtml.js';
import { BmcClient } from '../http/bmcClient.js';
import { classifyBmcVendor } from '../redfish/vendor.js';
import { findIpmitool, ipmitoolVersion } from '../ipmi/ipmitool.js';
import { safeFileName } from '../util/fsx.js';
import { TOOL, DVC_BASE_COMMIT } from '../version.js';

const BODY_MAX = 64 * 1024;
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function sendJson(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > BODY_MAX) { reject(new HttpError(413, '요청 본문이 너무 큽니다')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new HttpError(400, 'JSON 형식이 아닙니다')); }
    });
    req.on('error', reject);
  });
}

function tokenOk(given, token) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 서비스 루트만(무인증) — 자격증명을 보내지 않는 '연결 확인'. */
async function probeRoot({ host, port, insecure }) {
  const c = new BmcClient({ host, port, username: '', password: '', insecure: insecure !== false, timeoutMs: 10_000 });
  try {
    const r = await c.getNoAuth('/redfish/v1');
    const v = classifyBmcVendor({ root: r.json || {} });
    return { ok: !!r.status, status: r.status, ms: r.ms, error: r.error || '', vendor: v.vendor, vendorLabel: v.label, evidence: v.evidence, redfish: v.redfish, redfishVersion: r.json?.RedfishVersion || '', product: r.json?.Product || '', tlsNote: c.tlsNote };
  } finally { await c.close(); }
}

export function createApp({ dataDir, outDir, webDir, serversFile, token, getPort }) {
  const store = new ServerStore(serversFile);
  const jobs = new JobRunner({ store, outDir });
  const entries = () => store.list().map((s) => ({ server: s, result: loadLatest(outDir, s.id) }));
  let ipmiInfo = null;

  async function api(req, res, url) {
    const m = req.method;
    const p = url.pathname;
    let mm;
    if (m === 'GET' && p === '/api/env') {
      if (!ipmiInfo) { const bin = findIpmitool(); ipmiInfo = { path: bin || '', version: bin ? await ipmitoolVersion(bin) : '' }; }
      return sendJson(res, 200, { tool: TOOL, dvcBase: DVC_BASE_COMMIT, node: process.version, platform: process.platform, arch: process.arch, ipmitool: ipmiInfo, dataDir, outDir, serversFile, defaults: DEFAULTS });
    }
    if (m === 'GET' && p === '/api/servers') {
      return sendJson(res, 200, entries().map(({ server, result }) => ({ ...server, last: result ? { runId: result.runId, finishedAt: result.finishedAt, summary: result.summary } : null })));
    }
    if (m === 'POST' && p === '/api/servers') return sendJson(res, 201, store.create(await readBody(req)));
    if (m === 'POST' && p === '/api/probe') { const b = await readBody(req); return sendJson(res, 200, await probeRoot(b)); }
    if ((mm = /^\/api\/servers\/([0-9a-f]{12})$/.exec(p))) {
      if (m === 'PUT') { const r = store.update(mm[1], await readBody(req)); if (!r) throw new HttpError(404, '없는 서버'); return sendJson(res, 200, r); }
      if (m === 'DELETE') { if (jobs.busy()) throw new HttpError(409, '실행 중에는 삭제할 수 없습니다'); if (!store.remove(mm[1])) throw new HttpError(404, '없는 서버'); return sendJson(res, 200, { ok: true }); }
    }
    if (m === 'POST' && (mm = /^\/api\/servers\/([0-9a-f]{12})\/probe$/.exec(p))) {
      const s = store.get(mm[1]);
      if (!s) throw new HttpError(404, '없는 서버');
      return sendJson(res, 200, await probeRoot(s));
    }
    if (m === 'POST' && p === '/api/runs') {
      const b = await readBody(req);
      const o = b.options || {};
      const options = { crawl: o.crawl !== false, ipmi: o.ipmi !== false, crawlMax: Math.min(Math.max(Number(o.crawlMax) || DEFAULTS.crawlMaxResources, 50), 20000) };
      return sendJson(res, 202, jobs.start(b.serverIds, options));
    }
    if (m === 'GET' && p === '/api/runs/current') return sendJson(res, 200, jobs.view());
    if (m === 'POST' && p === '/api/runs/cancel') return sendJson(res, 200, { canceled: jobs.cancel() });
    if (m === 'GET' && (mm = /^\/api\/results\/([0-9a-f]{12})$/.exec(p))) {
      const r = loadLatest(outDir, mm[1]);
      if (!r) throw new HttpError(404, '실행 결과가 없습니다');
      return sendJson(res, 200, r);
    }
    if (m === 'GET' && (mm = /^\/api\/results\/([0-9a-f]{12})\/raw$/.exec(p))) {
      const r = loadLatest(outDir, mm[1]);
      const rp = String(url.searchParams.get('path') || '');
      if (!r || !rp.startsWith('/redfish/') || rp.length > 1024) throw new HttpError(404, '원문 없음');
      const file = path.join(outDir, mm[1], r.runId, 'raw', safeFileName(rp));
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { throw new HttpError(404, '이 경로의 원문이 저장되어 있지 않습니다'); }
      res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(text);
    }
    if (m === 'GET' && p === '/api/compare') return sendJson(res, 200, buildCompare(entries()));
    if (m === 'GET' && p === '/api/export.md') {
      const md = toMarkdown(buildCompare(entries()));
      res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="smc-poc-report.md"' });
      return res.end(md);
    }
    if (m === 'GET' && p === '/api/export.html') {
      const es = entries();
      const results = Object.fromEntries(es.filter((e) => e.result).map((e) => [e.server.id, e.result]));
      const html = buildExportHtml({ webDir, compare: buildCompare(es), results, servers: es.map((e) => ({ ...e.server, last: e.result ? { runId: e.result.runId, finishedAt: e.result.finishedAt, summary: e.result.summary } : null })) });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="smc-poc-report.html"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(html);
    }
    throw new HttpError(404, '없는 API');
  }

  const handler = async (req, res) => {
    try {
      const port = getPort();
      const host = String(req.headers.host || '').toLowerCase();
      if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('허용하지 않는 Host');
      }
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (!tokenOk(req.headers['x-poc-token'], token)) throw new HttpError(403, '토큰이 맞지 않습니다(화면을 새로 고치세요)');
        if (req.method !== 'GET' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw new HttpError(415, 'Content-Type 은 application/json');
        return await api(req, res, url);
      }
      const st = req.method === 'GET' ? STATIC[url.pathname] : null;
      if (!st) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
      let body = fs.readFileSync(path.join(webDir, st[0]), 'utf8');
      if (st[0] === 'index.html') body = body.replace('__POC_TOKEN__', token);
      res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': st[1] });
      return res.end(body);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : (e?.status || 400);
      if (!res.headersSent) sendJson(res, status, { error: String(e?.message || e).slice(0, 500) });
      else try { res.end(); } catch { /* */ }
    }
  };
  return { handler, store, jobs };
}

/**
 * 서버 기동 — 8710 부터 빈 포트를 찾는다.
 * @returns {Promise<{server, port, url, token, app}>}
 */
export async function startServer({ port = DEFAULTS.port, maxTries = 20 } = {}) {
  const pth = paths();
  fs.mkdirSync(pth.dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(pth.outDir, { recursive: true });
  const token = crypto.randomBytes(24).toString('hex');
  let bound = 0;
  const app = createApp({ ...pth, token, getPort: () => bound });
  const server = http.createServer(app.handler);
  for (let i = 0; i < maxTries; i++) {
    const p = port + i;
    try {
      await new Promise((resolve, reject) => {
        const onErr = (e) => { server.off('listening', onOk); reject(e); };
        const onOk = () => { server.off('error', onErr); resolve(); };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(p, '127.0.0.1');
      });
      bound = server.address().port;
      return { server, port: bound, url: `http://127.0.0.1:${bound}/`, token, app };
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || port === 0) throw e;
    }
  }
  throw new Error(`빈 포트를 찾지 못했습니다(${port}~${port + maxTries - 1})`);
}
