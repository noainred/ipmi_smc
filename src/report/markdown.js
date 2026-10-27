/**
 * 회의·PR 첨부용 마크다운 요약. 표 셀의 '|' 는 이스케이프한다(BMC 문자열이 표를 깨지 않게).
 */
import { TOOL, DVC_BASE_COMMIT } from '../version.js';

const LABEL = { ok: '지원', partial: '부분', empty: '0건', absent: '없음', license: '라이선스?', forbidden: '권한', auth: '인증실패', error: '오류', skip: '건너뜀' };
const VLABEL = { break: '깨짐', check: '확인', ok: '정상', info: '정보', unknown: '미확인' };
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 160);
const ROLE = { smc: 'Supermicro', dell: 'Dell 기준선', other: '기타' };

export function toMarkdown(cmp) {
  const L = [];
  L.push(`# Supermicro BMC 호환성 PoC 결과`, '');
  L.push(`- 생성: ${cmp.generatedAt} · 도구 ${TOOL.name} ${TOOL.version} · The.DVC 판정 기준 커밋 ${DVC_BASE_COMMIT}`);
  L.push(`- 'Dell 기대' 열은 **The.DVC 코드 기준 기대값(실측 아님)** 이다. Dell 서버 실측은 서버 열로 따로 있다.`, '');
  L.push('## 대상 서버', '', '| 이름 | 역할 | 주소 | 모델 | BMC 펌웨어 | 인증 | 지원/전체 | 실행 |', '|---|---|---|---|---|---|---|---|');
  for (const c of cmp.cols) {
    const s = c.summary;
    L.push(`| ${cell(c.name)} | ${ROLE[c.role] || c.role} | ${cell(c.host)} | ${cell(s?.model || '—')} | ${cell(s?.bmcFirmware || '—')} | ${cell(s?.authMode || (s?.authFailed ? '실패' : '—'))} | ${s ? `${s.counts.ok}/${s.total}` : '미실행'} | ${cell(c.finishedAt || '—')} |`);
  }
  L.push('', '## 기능별 매트릭스', '');
  L.push(`| 기능 | The.DVC 함수 | Dell 기대 | ${cmp.cols.map((c) => cell(c.name)).join(' | ')} | The.DVC 영향 |`);
  L.push(`|---|---|---|${cmp.cols.map(() => '---').join('|')}|---|`);
  for (const r of cmp.rows) {
    const cs = cmp.cols.map((c) => { const x = r.cells[c.id]; return x ? `${LABEL[x.status] || x.status}${x.note ? ` — ${cell(x.note)}` : ''}` : '—'; });
    const imp = r.impact ? `${VLABEL[r.impact.verdict] || r.impact.verdict}${r.impact.nos.length ? ` (#${r.impact.nos.join(',#')})` : ''}` : '—';
    L.push(`| ${cell(r.feature)} | ${cell(r.fn)} | ${LABEL[r.dell.status]} | ${cs.join(' | ')} | ${imp} |`);
  }
  if (cmp.tagCollisions?.length) {
    L.push('', '## 서비스태그 충돌', '');
    for (const t of cmp.tagCollisions) L.push(`- "${cell(t.tag)}" — ${t.servers.map(cell).join(', ')}`);
  }
  for (const e of (cmp.perServer || []).filter((x) => x.assumptions && x.role !== 'dell')) {
    L.push('', `## The.DVC 수정 지점 — ${cell(e.name)}`, '', '| # | 항목 | 판정 | 이번 응답에서 본 것 | 위치(The.DVC) |', '|---|---|---|---|---|');
    for (const a of e.assumptions) L.push(`| ${a.no} | ${cell(a.title)} | ${VLABEL[a.verdict]} | ${cell(a.seen)} | ${cell(a.where)} |`);
  }
  L.push('', '---', '이 표의 근거 원문은 `out/<서버 id>/<실행>/raw/` 에 있다. 라이선스 판정은 응답 문구로 고른 추정이다.');
  return L.join('\n');
}
