/**
 * 비교 — 서버별 최신 결과를 점검 항목 × 서버 매트릭스로 묶는다.
 *  · 'Dell 기대' 열은 The.DVC 코드 기준 기대값(실측 아님). Dell 서버를 실행했으면 실측 열이 따로 있다.
 *  · The.DVC 영향 = Dell 이 아닌 서버들의 가정 판정 중 가장 나쁜 것(그 점검과 연결된 가정 기준).
 *  · 서비스태그 충돌은 여러 서버를 봐야 알 수 있어 여기서 판정한다(가정 #2 를 보강).
 */
import { CHECKS } from '../redfish/checks.js';
import { ASSUMPTIONS } from '../dvc/assumptions.js';
import { collisions, isPlaceholder } from '../util/placeholder.js';

const VERDICT_RANK = { break: 0, check: 1, unknown: 2, info: 3, ok: 4 };
export function worstVerdict(list) {
  const xs = (list || []).filter(Boolean);
  if (!xs.length) return null;
  return xs.slice().sort((a, b) => (VERDICT_RANK[a] ?? 9) - (VERDICT_RANK[b] ?? 9))[0];
}

/** 서버 간 서비스태그 충돌을 가정 #2 에 반영한 사본을 만든다(원본 결과는 바꾸지 않는다). */
export function withCollisions(entries) {
  const items = entries.filter((e) => e.result).map((e) => ({ id: e.server.id, value: e.result.checks?.system?.data?.dvcServiceTag || '' }));
  const coll = collisions(items.filter((x) => !isPlaceholder(x.value)));
  const byId = new Map();
  for (const [tag, ids] of coll) for (const id of ids) byId.set(id, { tag, ids });
  return {
    collisions: [...coll].map(([tag, ids]) => ({ tag, servers: ids.map((id) => entries.find((e) => e.server.id === id)?.server.name || id) })),
    entries: entries.map((e) => {
      if (!e.result || !byId.has(e.server.id)) return e;
      const c = byId.get(e.server.id);
      const names = c.ids.filter((x) => x !== e.server.id).map((id) => entries.find((x) => x.server.id === id)?.server.name || id);
      const assumptions = e.result.assumptions.map((a) => (a.id === 'serviceTag' ? { ...a, verdict: 'break', seen: `${a.seen} · 다른 서버(${names.join(', ')})와 같은 값 "${c.tag}" → The.DVC 가 한 장비로 합친다` } : a));
      return { ...e, result: { ...e.result, assumptions } };
    }),
  };
}

/**
 * @param {{server:object, result:object|null}[]} entries  등록 순서 그대로
 */
export function buildCompare(entries) {
  const { collisions: tagCollisions, entries: es } = withCollisions(entries);
  const cols = es.map(({ server, result }) => ({
    id: server.id, name: server.name, role: server.role, host: server.host,
    hasResult: !!result, runId: result?.runId || '', finishedAt: result?.finishedAt || '', summary: result?.summary || null,
    vendor: result?.vendor || '', assumptions: result?.assumptions?.map((a) => ({ no: a.no, id: a.id, verdict: a.verdict })) || [],
  }));
  // 인증 실패·접속 실패 서버는 영향 판정에서 뺀다(응답이 없어 '미확인' 만 늘린다 — 그 서버 열의 배지가 이미 실패를 말한다).
  const nonDell = es.filter((e) => e.result && e.server.role !== 'dell' && e.result.vendor !== 'dell' && !e.result.auth?.failed && !e.result.fatal);
  const rows = CHECKS.map((c) => {
    const linked = ASSUMPTIONS.filter((a) => a.checks.includes(c.id));
    const verdicts = [];
    const nos = new Set();
    for (const e of nonDell) {
      for (const a of e.result.assumptions || []) {
        if (!linked.some((l) => l.id === a.id)) continue;
        verdicts.push(a.verdict);
        if (a.verdict === 'break' || a.verdict === 'check') nos.add(a.no);
      }
    }
    const cells = {};
    for (const e of es) {
      const r = e.result?.checks?.[c.id];
      cells[e.server.id] = r ? { status: r.status, note: r.note || '', evidence: (r.evidence || []).length } : null;
    }
    return {
      id: c.id, group: c.group, feature: c.feature, fn: c.fn, path: c.path,
      dell: { status: c.dell[0], note: c.dell[1] }, cells,
      impact: linked.length ? { verdict: worstVerdict(verdicts) || 'unknown', nos: [...nos].sort((a, b) => a - b), linked: linked.map((l) => l.no) } : null,
    };
  });
  // 경로 패턴 비교(전체 탐색 기준): Dell 역할 서버 합집합 vs 그 밖의 서버 합집합
  const dellPatterns = new Set();
  const otherPatterns = new Set();
  for (const e of es) {
    for (const p of e.result?.crawl?.patterns || []) (e.server.role === 'dell' ? dellPatterns : otherPatterns).add(p);
  }
  const paths = (dellPatterns.size && otherPatterns.size) ? {
    common: [...otherPatterns].filter((p) => dellPatterns.has(p)).sort(),
    otherOnly: [...otherPatterns].filter((p) => !dellPatterns.has(p)).sort(),
    dellOnly: [...dellPatterns].filter((p) => !otherPatterns.has(p)).sort(),
  } : null;
  // 서버별 가정 판정(충돌 반영본) — 화면 '수정 지점' 탭과 마크다운이 쓴다. 전체 결과는 싣지 않는다(응답 크기).
  const perServer = es.map((e) => ({ id: e.server.id, name: e.server.name, role: e.server.role, vendor: e.result?.vendor || '', assumptions: e.result?.assumptions || null }));
  return { generatedAt: new Date().toISOString(), cols, rows, tagCollisions, paths, assumptions: ASSUMPTIONS.map(({ checks, ...a }) => a), perServer };
}
