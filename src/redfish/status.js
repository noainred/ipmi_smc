/**
 * 응답 → 판정 상태. 화면 배지와 1:1 이다(web/app.js STATUS 표와 같은 키).
 *
 *   ok        지원(읽었고 값이 있다)
 *   partial   부분(읽었지만 일부 섀시·필드가 빠졌다)
 *   empty     0건(자원은 있으나 멤버가 없다)
 *   absent    없음(404·405·501 — 이 BMC 에 그 자원이 없다)
 *   license   라이선스 추정(4xx·5xx 본문에 라이선스 문구 — Supermicro SFT-DCMS-SINGLE 등. 문구로 고른 '추정' 이다)
 *   forbidden 권한(403 — 계정 권한 부족 또는 문구 없는 라이선스 제한)
 *   auth      인증 실패(401)
 *   error     오류(연결·시한·5xx·JSON 아님)
 *   skip      건너뜀(PoC 가 일부러 실행하지 않음 / 전제 없음)
 */
import { redfishMessage } from '../http/bmcClient.js';

export const STATUSES = ['ok', 'partial', 'empty', 'absent', 'license', 'forbidden', 'auth', 'error', 'skip'];

const LICENSE_RE = /licen[cs]e|\bDCMS\b|SFT-(DCMS|OOB)|not\s+activated|activation\s+key|product\s+key/i;

/** HTTP 응답 하나 → 상태. 200 이어도 JSON 이 아니면 error(사유는 note). */
export function kindOf(res) {
  if (!res) return 'error';
  if (res.authStopped) return 'auth';
  const s = res.status;
  if (!s) return 'error';
  if (s === 401) return 'auth';
  if (s === 403) return LICENSE_RE.test(res.text || '') ? 'license' : 'forbidden';
  if (s === 404 || s === 405 || s === 501) return 'absent';
  if (s >= 400) return LICENSE_RE.test(res.text || '') ? 'license' : 'error';
  if (s >= 200 && s < 300) return res.json && typeof res.json === 'object' ? 'ok' : 'error';
  return 'error';
}

/** 응답의 짧은 설명(배지 아래 한 줄). */
export function noteOf(res) {
  if (!res) return '';
  if (res.authStopped) return '인증 실패로 중단';
  if (!res.status) return res.error || '연결 실패';
  if (res.status >= 400) {
    const m = redfishMessage(res.text);
    return `HTTP ${res.status}${m ? ` · ${m}` : ''}`;
  }
  if (res.status >= 200 && res.status < 300 && !res.json) return `HTTP ${res.status} · JSON 아님`;
  return '';
}

/** 여러 상태 중 대표(가장 '좋은' 것이 아니라 정보가 많은 순서) — 섀시 여러 개의 결과를 합칠 때. */
const RANK = { ok: 0, partial: 1, empty: 2, license: 3, forbidden: 4, absent: 5, error: 6, auth: 7, skip: 8 };
export function bestOf(kinds) {
  const ks = (kinds || []).filter(Boolean);
  if (!ks.length) return 'absent';
  return ks.slice().sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9))[0];
}

export function isLicenseText(text) { return LICENSE_RE.test(String(text || '')); }
