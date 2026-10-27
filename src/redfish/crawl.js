/**
 * 전체 Redfish 탐색 — /redfish/v1 에서 @odata.id 링크를 따라 읽을 수 있는 자원을 모두 읽는다(상한 안에서).
 * "최대한 많은 정보" 요구의 본체다. 점검 항목이 이미 읽은 경로는 캐시라 다시 묻지 않는다.
 *
 * 상한(조용히 자르지 않는다 — 결과에 밝힌다):
 *  · 자원 수(기본 2,000) · 시간(기본 5분) · 동시 요청(기본 2 — BMC 는 약하다)
 *  · 컬렉션당 멤버(기본 64 — 센서·로그 항목처럼 수백 개인 컬렉션)
 *  · 건너뛰는 경로: JSON 스키마·메시지 레지스트리 본문(수 MB, 장비 정보 아님), $metadata, 세션 멤버(다른 사용자 세션),
 *    로그 항목 개별 문서(컬렉션에 이미 들어 있다), Actions(POST 전용)
 */
import { normPath } from './context.js';

const SKIP = [
  /^\/redfish\/v1\/JsonSchemas\/./i,
  /^\/redfish\/v1\/Registries\/./i,
  /\/\$metadata/i,
  /^\/redfish\/v1\/odata/i,
  /\/SessionService\/Sessions\/./i,
  /\/LogServices\/[^/]+\/Entries\/./i,
  /\/Actions(\/|$)/i,
];

export function shouldSkip(path) { return SKIP.some((re) => re.test(path)); }

/** 문서 안의 모든 @odata.id(조각 제거·정규화). Members 는 따로 돌려준다(멤버 상한·패턴 계산용). */
export function extractLinks(json) {
  const links = new Set();
  const members = [];
  if (Array.isArray(json?.Members)) {
    for (const m of json.Members) { const id = m?.['@odata.id']; if (typeof id === 'string') members.push(normPath(id)); }
  }
  const next = json?.['Members@odata.nextLink'];
  if (typeof next === 'string') links.add(normPath(next));
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 12) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === '@odata.id' && typeof v === 'string') links.add(normPath(v));
      else if (k !== 'Members' && v && typeof v === 'object') walk(v, d + 1);
    }
  };
  walk(json, 0);
  const self = normPath(json?.['@odata.id'] || '');
  links.delete(self);
  for (const m of members) links.delete(m);
  return { links: [...links].filter((l) => l.startsWith('/redfish/v1')), members: members.filter((l) => l.startsWith('/redfish/v1')) };
}

/**
 * 경로 → 패턴(멤버 id 를 {id} 로). Dell 과 Supermicro 의 경로를 맞대어 비교하는 데 쓴다.
 * 멤버로 발견된 경로만 {id} 가 된다 — '/Chassis/1/Thermal' 은 '/Chassis/{id}/Thermal'.
 */
export function makePatternFn(memberOf) {
  const memo = new Map();
  const fn = (path) => {
    const p = String(path).split('?')[0];
    if (memo.has(p)) return memo.get(p);
    let out;
    if (p === '/redfish/v1' || !p.startsWith('/redfish/v1/')) out = p;
    else if (memberOf.has(p)) out = `${fn(memberOf.get(p))}/{id}`;
    else {
      const i = p.lastIndexOf('/');
      out = `${fn(p.slice(0, i))}/${p.slice(i + 1)}`;
    }
    memo.set(p, out);
    return out;
  };
  return fn;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} ctx  makeContext 결과
 * @param {object} o
 * @returns {Promise<{index:object[], stats:object, patterns:string[]}>}
 */
export async function crawl(ctx, { maxResources = 2000, budgetMs = 300_000, concurrency = 2, memberCap = 64, onProgress = null } = {}) {
  const started = Date.now();
  const seen = new Set();
  const queue = ['/redfish/v1'];
  const index = [];
  const memberOf = new Map();
  const truncated = [];
  let skipped = 0;
  let inflight = 0;
  let stopReason = '';
  const enqueue = (p) => {
    if (seen.has(p) || queue.includes(p)) return;
    if (shouldSkip(p)) { skipped += 1; return; }
    queue.push(p);
  };
  const worker = async () => {
    for (;;) {
      if (ctx.signal?.aborted) { stopReason = stopReason || '취소됨'; return; }
      if (ctx.client.authFailed) { stopReason = stopReason || '인증 실패'; return; }
      if (index.length + inflight >= maxResources) { stopReason = stopReason || `자원 상한 ${maxResources}개`; return; }
      if (Date.now() - started > budgetMs) { stopReason = stopReason || `시간 상한 ${Math.round(budgetMs / 1000)}초`; return; }
      const p = queue.shift();
      if (!p) { if (!inflight) return; await sleep(15); continue; }
      if (seen.has(p)) continue;
      seen.add(p);
      inflight += 1;
      const r = await ctx.get(p);
      inflight -= 1;
      const entry = { path: r.path, status: r.status, kind: r.kind, ms: r.ms, bytes: r.bytes, file: r.file || '', type: '', members: null };
      if (r.json) {
        entry.type = String(r.json['@odata.type'] || '').replace(/^#/, '');
        const { links, members } = extractLinks(r.json);
        if (Array.isArray(r.json.Members)) entry.members = members.length;
        for (const m of members) if (!memberOf.has(m)) memberOf.set(m, r.path);
        const take = members.slice(0, memberCap);
        if (members.length > memberCap) truncated.push({ path: r.path, members: members.length, read: memberCap });
        for (const m of take) enqueue(m);
        for (const l of links) enqueue(l);
      }
      index.push(entry);
      onProgress?.({ done: index.length, queued: queue.length, max: maxResources });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  const patternOf = makePatternFn(memberOf);
  for (const e of index) e.pattern = patternOf(e.path);
  const byKind = {};
  for (const e of index) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const stats = {
    resources: index.length, byKind, skipped, remaining: queue.length, truncatedCollections: truncated.length,
    durationMs: Date.now() - started, stopReason: stopReason || (queue.length ? '' : '모두 읽음'),
    bytes: index.reduce((a, e) => a + (e.bytes || 0), 0),
  };
  const patterns = [...new Set(index.filter((e) => e.kind === 'ok').map((e) => e.pattern))].sort();
  return { index, stats, patterns, truncated };
}
