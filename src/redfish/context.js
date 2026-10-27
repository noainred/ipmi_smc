/**
 * 한 서버 수집의 공유 상태 — 응답 캐시(같은 경로를 두 번 묻지 않는다: 점검 항목이 읽은 것을 전체 탐색이 재사용),
 * 원본 저장, 점검별 근거(evidence) 기록.
 */
import { kindOf, noteOf } from './status.js';

const TEXT_KEEP = 4000;

/** '/redfish/v1/Systems/1/' → '/redfish/v1/Systems/1', 조각(#…) 제거. 쿼리는 유지. */
export function normPath(p) {
  let s = String(p || '').trim();
  const hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(0, hash);
  const q = s.indexOf('?');
  let base = q === -1 ? s : s.slice(0, q);
  const query = q === -1 ? '' : s.slice(q);
  base = base.replace(/\/{2,}/g, '/');
  if (base.length > 1) base = base.replace(/\/+$/, '');
  return base + query;
}

export function membersOf(json) {
  const arr = Array.isArray(json?.Members) ? json.Members : [];
  return arr.map((m) => (m && typeof m === 'object' ? m['@odata.id'] : null))
    .filter((x) => typeof x === 'string' && x.startsWith('/redfish/')).map(normPath);
}

export function linkOf(json, key) {
  const v = json?.[key];
  const id = v && typeof v === 'object' ? v['@odata.id'] : null;
  return typeof id === 'string' && id.startsWith('/redfish/') ? normPath(id) : null;
}

export function makeContext(client, { rawStore = null, signal = null } = {}) {
  const cache = new Map();
  const ctx = {
    client,
    cache,
    signal,
    rootNoAuth: null,
    sysIds: [],
    mgrIds: [],
    chassisIds: [],
    /** 인증 GET(캐시). 반환값은 원본 응답이 아니라 판정에 필요한 것만 담은 가벼운 객체다. */
    async get(path) {
      const key = normPath(path);
      if (cache.has(key)) return cache.get(key);
      if (signal?.aborted) return { path: key, status: 0, ok: false, kind: 'error', note: '취소됨', json: null, text: '', ms: 0, bytes: 0 };
      const res = await client.get(key);
      const r = {
        path: key, status: res.status, ok: !!res.ok, json: res.json || null,
        text: res.json ? '' : String(res.text || '').slice(0, TEXT_KEEP),
        ms: res.ms || 0, bytes: res.bytes || 0, error: res.error || '', authStopped: !!res.authStopped,
      };
      r.kind = kindOf({ ...r, text: res.text });
      r.note = noteOf({ ...r, text: res.text });
      if (rawStore && !r.authStopped) r.file = rawStore.save(r);
      cache.set(key, r);
      return r;
    },
    /** 점검 하나가 쓰는 GET — 근거 목록에 경로·상태를 남긴다. */
    scope() {
      const evidence = [];
      const seen = new Set();
      return {
        evidence,
        get: async (path) => {
          const r = await ctx.get(path);
          if (!seen.has(r.path)) { seen.add(r.path); evidence.push({ path: r.path, status: r.status, kind: r.kind }); }
          return r;
        },
      };
    },
  };
  return ctx;
}
