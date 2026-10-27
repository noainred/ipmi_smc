/**
 * BMC Redfish 클라이언트(읽기 전용) — node:http(s) 만 쓴다(의존성 0).
 *
 * 인증 순서는 The.DVC `idrac/redfish.js rawGet` 과 같다: Basic → (401 + Digest 챌린지면) Digest → 세션 토큰
 * (POST SessionService/Sessions → X-Auth-Token). 어떤 방식이 통했는지 `authMode` 에 남겨 리포트에 싣는다.
 *
 * 안전 규칙(실장비에 돌리는 도구라 되돌리지 말 것):
 *  ① 메서드 화이트리스트 — GET(/redfish/ 아래) · 세션 생성 POST · **내가 만든 세션**의 DELETE 만 보낸다.
 *     PATCH·PUT·Actions POST 는 코드 경로 자체가 없다(설정 변경·전원 조작 불가).
 *  ② 자격증명 거부가 확정되면(세 방식 모두 401) 그 서버에 더 보내지 않는다 — BMC 계정 잠금 방지.
 *     인증이 된 뒤 401 이 연속 2회면 같은 이유로 멈춘다.
 *  ③ 세션 생성이 5xx·429·시한 초과로 실패하면 '자격증명 거부' 로 보지 않는다(The.DVC v2.622 와 같은 규칙).
 *  ④ 리다이렉트는 같은 출처만 따른다(자격증명을 다른 주소로 보내지 않는다).
 *  ⑤ http:// 는 루프백(로컬 목 서버)에만 허용 — 실장비에 Basic 을 평문으로 보내지 않는다.
 *  ⑥ 비밀번호·토큰은 로그·결과에 싣지 않는다(onRequest 는 메서드·경로·상태만 받는다).
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { constants as C } from 'node:crypto';
import { parseDigestChallenge, buildDigestHeader } from './digest.js';

export const SESSION_PATH = '/redfish/v1/SessionService/Sessions';
const SESSION_MEMBER_RE = /^\/redfish\/v1\/SessionService\/Sessions\/[^/?#\s]+$/;
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const IPV6_RE = /^[0-9A-Fa-f:.]{2,45}(%[A-Za-z0-9]{1,16})?$/;
const MAX_REDIRECTS = 3;

/** 입력 주소 → { protocol, hostname, port, origin, loopback }. 경로·계정 문자가 섞이면 거부. */
export function parseTarget(hostInput, portInput) {
  let s = String(hostInput ?? '').trim();
  if (!s) throw new Error('BMC 주소가 비었습니다');
  let protocol = 'https:';
  const m = /^(https?):\/\//i.exec(s);
  if (m) { protocol = `${m[1].toLowerCase()}:`; s = s.slice(m[0].length); }
  s = s.replace(/\/+$/, '');
  if (/[/@?#\s\\]/.test(s)) throw new Error('BMC 주소에는 호스트(와 포트)만 적어 주세요 — 경로·계정 문자는 넣지 않습니다');
  let hostname = s;
  let port = null;
  const v6 = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(s);
  const colons = (s.match(/:/g) || []).length;
  if (v6) { hostname = v6[1]; port = v6[2] ? Number(v6[2]) : null; }
  else if (colons === 1) { const [h, p] = s.split(':'); hostname = h; port = Number(p); }
  if (port == null && portInput != null && String(portInput).trim() !== '') port = Number(portInput);
  if (port == null) port = protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`포트가 올바르지 않습니다: ${port}`);
  const isV6 = hostname.includes(':');
  if (isV6 ? !IPV6_RE.test(hostname) : !HOSTNAME_RE.test(hostname)) throw new Error(`BMC 주소 형식이 올바르지 않습니다: ${hostname}`);
  const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  const hostPart = isV6 ? `[${hostname}]` : hostname;
  const defaultPort = protocol === 'https:' ? 443 : 80;
  return { protocol, hostname, port, loopback, origin: `${protocol}//${hostPart}${port === defaultPort ? '' : `:${port}`}` };
}

/** Redfish 오류 본문 → 메시지(진단용, 200자). */
export function redfishMessage(text) {
  let body;
  try { body = JSON.parse(String(text || '')); } catch { return ''; }
  const err = body?.error;
  const info = err?.['@Message.ExtendedInfo'];
  const msg = (Array.isArray(info) && (info[0]?.Message || info[0]?.MessageId)) || err?.message || '';
  return String(msg).replace(/\s+/g, ' ').trim().slice(0, 200);
}

const CERT_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_NOT_YET_VALID',
]);

/** 연결 오류 → 사람이 읽는 원인. */
export function describeNetError(e) {
  const code = e?.code || e?.name || '';
  if (CERT_CODES.has(code)) return `인증서 검증 실패(${code}) — 자체서명 BMC 면 '인증서 확인 안 함' 을 켜세요`;
  if (code === 'ECONNREFUSED') return '연결 거부(포트가 닫혀 있음)';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout/i.test(String(e?.message))) return '시한 초과';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '이름 해석 실패(DNS)';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return '호스트에 도달할 수 없음(경로·VPN 확인)';
  if (code === 'ECONNRESET') return '연결이 끊김(ECONNRESET)';
  if (code === 'AbortError' || code === 'ABORT_ERR') return '취소됨';
  return `${code ? `${code}: ` : ''}${String(e?.message || e).slice(0, 160)}`;
}

/** TLS 협상 실패(인증서 판정이 아닌) — 구형 TLS 로 한 번 더 시도할 근거. 자격증명은 아직 나가지 않은 단계다. */
export function isTlsHandshakeError(e) {
  const code = String(e?.code || '');
  if (CERT_CODES.has(code)) return false;
  if (code.startsWith('ERR_SSL_') || code === 'EPROTO') return true;
  return /ssl|tls|handshake|alert|wrong version|unsupported protocol|dh key too small|ee key too small/i.test(String(e?.message || ''));
}

export class BmcClient {
  /**
   * @param {object} o
   * @param {string} o.host  IP·호스트(선택: https://·http://(루프백만)·:포트)
   * @param {number|string} [o.port]
   * @param {string} o.username
   * @param {string} o.password
   * @param {boolean} [o.insecure=true]  BMC 인증서를 확인하지 않는다(자체서명이 흔하다)
   * @param {string} [o.caFile]  사설 CA 번들(PEM) — insecure=false 일 때
   * @param {number} [o.timeoutMs=20000]
   * @param {AbortSignal} [o.signal]
   * @param {(e:{method:string,path:string,status:number,ms:number,bytes:number,error?:string})=>void} [o.onRequest]
   */
  constructor(o = {}) {
    this.t = parseTarget(o.host, o.port);
    if (this.t.protocol === 'http:' && !this.t.loopback) {
      throw new Error('http:// 는 로컬 목 서버(127.0.0.1)에만 허용합니다 — 실장비는 https 로 접속합니다(자격증명 평문 전송 방지)');
    }
    this.username = String(o.username ?? '');
    this.password = String(o.password ?? '');
    this.insecure = o.insecure !== false;
    this.ca = o.caFile ? fs.readFileSync(o.caFile) : undefined;
    this.timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : 20_000;
    this.signal = o.signal || null;
    this.onRequest = typeof o.onRequest === 'function' ? o.onRequest : null;
    this.maxBody = Number(o.maxBody) > 0 ? Number(o.maxBody) : 8 * 1024 * 1024;
    this.legacyTls = !!o.legacyTls;
    this.tlsNote = '';
    this.authMode = null;       // 'basic' | 'digest' | 'session'
    this.authFailed = false;
    this.authMessage = '';
    this.token = null;
    this.sessionLocation = null;
    this.challenge = null;
    this.nc = 0;
    this.post401 = 0;
    this.relogged = false;
    this.stats = { requests: 0, bytes: 0, byStatus: {}, errors: 0 };
    this._agents = {};
  }

  get origin() { return this.t.origin; }

  _agent() {
    const key = this.legacyTls ? 'legacy' : 'modern';
    if (this._agents[key]) return this._agents[key];
    if (this.t.protocol === 'http:') {
      this._agents[key] = new http.Agent({ keepAlive: true, maxSockets: 4 });
    } else {
      // 구형 BMC 호환: RFC5746 미지원 서버 접속 허용(The.DVC BMC_TLS 와 같은 옵션). legacy 면 보안 수준·최소 버전도 낮춘다.
      const legacy = this.legacyTls
        ? { minVersion: 'TLSv1', ciphers: 'DEFAULT:@SECLEVEL=0', secureOptions: C.SSL_OP_LEGACY_SERVER_CONNECT | C.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION }
        : { secureOptions: C.SSL_OP_LEGACY_SERVER_CONNECT };
      this._agents[key] = new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: !this.insecure, ca: this.ca, ...legacy });
    }
    return this._agents[key];
  }

  _assertAllowed(method, path) {
    const p = String(path).split('?')[0];
    if (method === 'GET' && p.startsWith('/redfish')) return;
    if (method === 'POST' && p === SESSION_PATH) return;
    if (method === 'DELETE' && this.sessionLocation && p === this.sessionLocation && SESSION_MEMBER_RE.test(p)) return;
    throw new Error(`읽기 전용 PoC — ${method} ${p} 요청은 보내지 않습니다`);
  }

  /** 한 번의 HTTP 왕복(인증 판단 없음). 오류는 throw 하지 않고 status 0 + error 로 돌려준다. */
  _once(method, path, headers = {}, body = null) {
    return new Promise((resolve) => {
      const started = Date.now();
      let settled = false;
      const done = (r) => { if (settled) return; settled = true; resolve({ method, path, ms: Date.now() - started, ...r }); };
      const lib = this.t.protocol === 'http:' ? http : https;
      let req;
      try {
        req = lib.request({
          host: this.t.hostname, port: this.t.port, method, path,
          headers: { Accept: 'application/json', 'User-Agent': 'ipmi-smc-poc/0.1', ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
          agent: this._agent(), timeout: this.timeoutMs, ...(this.signal ? { signal: this.signal } : {}),
        }, (res) => {
          const chunks = [];
          let size = 0;
          let capped = false;
          res.on('data', (c) => {
            size += c.length;
            if (size > this.maxBody) { capped = true; res.destroy(); return; }
            chunks.push(c);
          });
          const finish = () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            const t = text.trimStart();
            if (!capped && (t.startsWith('{') || t.startsWith('['))) { try { json = JSON.parse(text); } catch { json = null; } }
            done({ status: res.statusCode || 0, headers: res.headers || {}, text: capped ? '' : text, json, bytes: size, capped });
          };
          res.on('end', finish);
          res.on('close', () => { if (!settled) finish(); });
          res.on('error', (e) => done({ status: 0, error: describeNetError(e), code: e.code, headers: {}, text: '', json: null, bytes: size }));
        });
      } catch (e) {
        done({ status: 0, error: describeNetError(e), code: e.code, headers: {}, text: '', json: null, bytes: 0 });
        return;
      }
      req.on('timeout', () => { const e = new Error('timeout'); e.code = 'ETIMEDOUT'; req.destroy(e); });
      req.on('error', (e) => done({ status: 0, error: describeNetError(e), code: e.code, tlsHandshake: isTlsHandshakeError(e), headers: {}, text: '', json: null, bytes: 0 }));
      if (body) req.write(body);
      req.end();
    });
  }

  /** 화이트리스트 + 같은 출처 리다이렉트 + 구형 TLS 1회 재시도 + 통계. */
  async request(method, path, { headers = {}, body = null } = {}) {
    this._assertAllowed(method, path);
    let cur = path;
    let r;
    for (let hop = 0; ; hop++) {
      r = await this._once(method, cur, headers, body);
      if (r.status === 0 && r.tlsHandshake && !this.legacyTls && this.t.protocol === 'https:') {
        // TLS 협상 단계 실패 — 자격증명은 아직 나가지 않았다. 구형 TLS 설정으로 한 번 더(그 사실을 리포트에 남긴다).
        this.legacyTls = true;
        this.tlsNote = `최신 TLS 협상 실패(${r.error}) → 구형 TLS 호환 모드로 접속`;
        r = await this._once(method, cur, headers, body);
      }
      const loc = r.status >= 300 && r.status < 400 ? r.headers?.location : null;
      if (!loc || method !== 'GET') break;
      let next;
      try { next = new URL(loc, this.t.origin + cur); } catch { r = { ...r, error: `리다이렉트 주소를 읽지 못함(${r.status})` }; break; }
      if (next.origin !== new URL(this.t.origin).origin) { r = { ...r, error: `다른 주소로 리다이렉트(${r.status} → ${next.host}) — 따라가지 않음` }; break; }
      if (hop + 1 > MAX_REDIRECTS) { r = { ...r, error: '리다이렉트 3회 초과' }; break; }
      cur = next.pathname + next.search;
      this._assertAllowed(method, cur);
    }
    this.stats.requests += 1;
    this.stats.bytes += r.bytes || 0;
    const key = r.status ? String(r.status) : 'error';
    this.stats.byStatus[key] = (this.stats.byStatus[key] || 0) + 1;
    if (!r.status) this.stats.errors += 1;
    if (this.onRequest) {
      try { this.onRequest({ method, path, status: r.status, ms: r.ms, bytes: r.bytes || 0, error: r.error }); } catch { /* 로그 실패는 무시 */ }
    }
    return { ...r, path, ok: r.status >= 200 && r.status < 300 };
  }

  _authHeaders(method, path) {
    if (this.authMode === 'session') return { 'X-Auth-Token': this.token };
    if (this.authMode === 'digest') {
      this.nc += 1;
      return { Authorization: buildDigestHeader({ username: this.username, password: this.password, method, uri: path, challenge: this.challenge, nc: this.nc.toString(16).padStart(8, '0') }) };
    }
    return { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` };
  }

  /** 무인증 GET(서비스 루트 등). */
  getNoAuth(path) { return this.request('GET', path); }

  /** 인증 GET. 인증 방식이 아직 없으면 Basic → Digest → 세션 순으로 수립한다. */
  async get(path) {
    if (this.authFailed) return { path, method: 'GET', status: 401, ok: false, authStopped: true, error: '인증 실패로 이 서버에 더 요청하지 않음(계정 잠금 방지)', headers: {}, text: '', json: null, ms: 0, bytes: 0 };
    if (!this.authMode) return this._establish(path);
    let r = await this.request('GET', path, { headers: this._authHeaders('GET', path) });
    if (r.status !== 401) { this.post401 = 0; return r; }
    if (this.authMode === 'session' && !this.relogged) {
      // 세션 만료(유휴 시한) — 한 번만 새로 만든다.
      this.relogged = true;
      const s = await this._createSession();
      if (s.ok) {
        r = await this.request('GET', path, { headers: this._authHeaders('GET', path) });
        if (r.status !== 401) { this.post401 = 0; return r; }
      }
    }
    this.post401 += 1;
    if (this.post401 >= 2) {
      this.authFailed = true;
      this.authMessage = `인증된 뒤 401 이 연속 ${this.post401}회 — 잠금 방지를 위해 중단(${redfishMessage(r.text) || '메시지 없음'})`;
    }
    return r;
  }

  async _establish(path) {
    const r1 = await this.request('GET', path, { headers: this._authHeaders('GET', path) });   // authMode=null → Basic
    if (r1.status !== 401) {
      if (r1.status && r1.status < 500) this.authMode = 'basic';
      return r1;
    }
    this.authMessage = redfishMessage(r1.text);
    const ch = parseDigestChallenge(r1.headers?.['www-authenticate']);
    if (ch) {
      this.authMode = 'digest'; this.challenge = ch;
      const r2 = await this.request('GET', path, { headers: this._authHeaders('GET', path) });
      if (r2.status !== 401) return r2;
      this.authMode = null; this.challenge = null;
    }
    const s = await this._createSession();
    if (s.ok) {
      const r3 = await this.request('GET', path, { headers: this._authHeaders('GET', path) });
      if (r3.status !== 401) return r3;
    }
    if (s.transient) {
      return { ...r1, status: 0, ok: false, error: `세션 생성 일시 오류(${s.detail}) — 자격증명 거부로 보지 않음` };
    }
    this.authMode = null;
    this.authFailed = true;
    this.authMessage = s.message || this.authMessage || 'Basic·Digest·세션 인증이 모두 거부됨 — 사용자·비밀번호·권한·계정 잠금을 확인하세요';
    return r1;
  }

  async _createSession() {
    const body = JSON.stringify({ UserName: this.username, Password: this.password });
    const r = await this.request('POST', SESSION_PATH, { headers: { 'Content-Type': 'application/json' }, body });
    const token = r.headers?.['x-auth-token'];
    if ((r.status === 201 || r.status === 200) && token) {
      this.token = String(token);
      this.authMode = 'session';
      let loc = String(r.headers?.location || '');
      try { if (/^https?:\/\//i.test(loc)) { const u = new URL(loc); loc = u.origin === new URL(this.t.origin).origin ? u.pathname : ''; } } catch { loc = ''; }
      if (!loc && r.json?.['@odata.id']) loc = String(r.json['@odata.id']);
      this.sessionLocation = SESSION_MEMBER_RE.test(loc) ? loc : null;
      return { ok: true };
    }
    if (r.status === 0 || r.status >= 500 || r.status === 429) return { ok: false, transient: true, status: r.status, detail: r.error || `HTTP ${r.status}` };
    return { ok: false, status: r.status, message: redfishMessage(r.text) };
  }

  /** 내가 만든 세션을 닫고 연결을 정리한다(실패해도 BMC 유휴 시한으로 사라진다). */
  async close() {
    if (this.sessionLocation && this.token) {
      const prevSignal = this.signal;
      this.signal = null;
      const prevTimeout = this.timeoutMs;
      this.timeoutMs = Math.min(prevTimeout, 10_000);
      try { await this.request('DELETE', this.sessionLocation, { headers: { 'X-Auth-Token': this.token } }); } catch { /* 무시 */ }
      this.timeoutMs = prevTimeout;
      this.signal = prevSignal;
    }
    this.token = null;
    for (const a of Object.values(this._agents)) { try { a.destroy(); } catch { /* */ } }
    this._agents = {};
  }
}
