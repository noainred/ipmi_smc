/**
 * HTTP Digest 인증(RFC 2617/7616, MD5 + qop=auth).
 * 출처: The.DVC `server/src/idrac/digestAuth.js`(기준 커밋 d75a13c) — 같은 판정을 쓰려고 그대로 옮겼다.
 * 의존성 없이 node:crypto 만 쓴다.
 */
import crypto from 'node:crypto';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/** Digest 챌린지 본문 파싱 상한 — 정상 챌린지는 수백 바이트다(O(n²) 방지). */
export const DIGEST_BODY_MAX = 4096;

/** `WWW-Authenticate: Digest ...` → 파라미터 맵. Digest 가 아니거나 nonce 가 없으면 null. */
export function parseDigestChallenge(headerValue) {
  const h = String(headerValue || '');
  const idx = h.toLowerCase().indexOf('digest ');
  if (idx === -1) return null;
  const params = {};
  const body = h.slice(idx + 7, idx + 7 + DIGEST_BODY_MAX);
  const re = /(?:^|[\s,])(\w{1,32})\s*=\s*(?:"([^"]{0,1024})"|([^,\s]{1,1024}))/g;
  let m;
  while ((m = re.exec(body))) params[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return params.nonce ? params : null;
}

const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Digest Authorization 헤더. uri 는 요청 경로(예: /redfish/v1/Systems). */
export function buildDigestHeader({ username, password, method, uri, challenge, cnonce, nc = '00000001' }) {
  const realm = challenge.realm || '';
  const nonce = challenge.nonce || '';
  const opaque = challenge.opaque;
  const algorithm = (challenge.algorithm || 'MD5');
  const qopRaw = challenge.qop || '';
  const qop = qopRaw.split(',').map((s) => s.trim()).includes('auth') ? 'auth' : (qopRaw ? qopRaw.split(',')[0].trim() : '');
  const cn = cnonce || crypto.randomBytes(8).toString('hex');
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cn}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username=${quote(username)}`, `realm=${quote(realm)}`, `nonce=${quote(nonce)}`,
    `uri=${quote(uri)}`, `response="${response}"`, `algorithm=${algorithm}`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cn}"`);
  if (opaque !== undefined) parts.push(`opaque=${quote(opaque)}`);
  return 'Digest ' + parts.join(', ');
}
