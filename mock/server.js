#!/usr/bin/env node
/**
 * 로컬 목 BMC(HTTP, 127.0.0.1 전용) — **합성 응답**으로 PoC 화면·코드 경로를 장비 없이 시험한다.
 *   node mock/server.js            → Supermicro형 127.0.0.1:9001 (ADMIN/ADMIN), Dell형 127.0.0.1:9002 (root/calvin)
 * 웹 화면에서 주소를 'http://127.0.0.1:9001' 처럼 http:// 를 붙여 등록한다(http 는 루프백에만 허용된다).
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MOCK_PROFILES } from './fixtures.js';

const SESSIONS = '/redfish/v1/SessionService/Sessions';

/**
 * @param {object} o  { profile:'supermicro'|'dell', port?, basic?, expand?, username?, password? }
 * @returns {Promise<{server, port, url, stats, close}>}
 */
export function startMockBmc(o = {}) {
  const prof = MOCK_PROFILES[o.profile || 'supermicro'];
  const conf = { ...prof, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) };
  const fixture = prof.fixture();
  const tokens = new Map();   // token -> session path
  const stats = { requests: 0, byMethod: {}, authFailures: 0, sessionsCreated: 0, sessionsDeleted: 0, paths: [] };
  const send = (res, status, body, headers = {}) => {
    const text = body == null ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(text);
  };
  const unauthorized = (res) => { stats.authFailures += 1; send(res, 401, { error: { code: 'Base.1.8.NoValidSession', message: 'Unauthorized', '@Message.ExtendedInfo': [{ MessageId: 'Base.1.8.NoValidSession', Message: 'There is no valid session established with the implementation.' }] } }, conf.digest ? { 'WWW-Authenticate': 'Digest realm="mock", nonce="abc", qop="auth"' } : {}); };
  const authed = (req) => {
    const tok = req.headers['x-auth-token'];
    if (tok && tokens.has(String(tok))) return true;
    const a = String(req.headers.authorization || '');
    if (conf.basic && a.startsWith('Basic ')) {
      const [u, ...rest] = Buffer.from(a.slice(6), 'base64').toString('utf8').split(':');
      return u === conf.username && rest.join(':') === conf.password;
    }
    return false;
  };
  const server = http.createServer((req, res) => {
    stats.requests += 1;
    stats.byMethod[req.method] = (stats.byMethod[req.method] || 0) + 1;
    const url = new URL(req.url, 'http://x');
    let p = url.pathname.replace(/\/+$/, '') || '/';
    stats.paths.push(`${req.method} ${url.pathname}${url.search}`);
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      if (req.method === 'GET' && p === '/redfish/v1') return send(res, 200, fixture['/redfish/v1']);
      if (req.method === 'POST' && p === SESSIONS) {
        let j = {};
        try { j = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: { message: 'bad json' } }); }
        if (j.UserName !== conf.username || j.Password !== conf.password) return unauthorized(res);
        const tok = crypto.randomBytes(12).toString('hex');
        const loc = `${SESSIONS}/${tokens.size + 1}`;
        tokens.set(tok, loc);
        stats.sessionsCreated += 1;
        return send(res, 201, { '@odata.id': loc, Id: String(tokens.size), UserName: j.UserName }, { 'X-Auth-Token': tok, Location: loc });
      }
      if (!authed(req)) return unauthorized(res);
      if (req.method === 'DELETE' && p.startsWith(`${SESSIONS}/`)) {
        for (const [t, l] of tokens) if (l === p) tokens.delete(t);
        stats.sessionsDeleted += 1;
        return send(res, 204, null);
      }
      if (req.method !== 'GET') return send(res, 405, { error: { message: 'method not allowed (mock)' } });
      if (url.search.includes('$expand')) {
        if (!conf.expand) return send(res, 400, { error: { message: 'Query parameter $expand is not supported (mock)' } });
        const coll = fixture[p];
        if (coll && Array.isArray(coll.Members)) return send(res, 200, { ...coll, Members: coll.Members.map((m) => fixture[m['@odata.id']] || m) });
      }
      const hit = fixture[p];
      if (!hit) return send(res, 404, { error: { code: 'Base.1.8.ResourceMissingAtURI', message: `${p} not found`, '@Message.ExtendedInfo': [{ MessageId: 'Base.1.8.ResourceMissingAtURI', Message: 'The resource at the URI was not found.' }] } });
      if (hit.$status) return send(res, hit.$status, hit.$body);
      return send(res, 200, hit);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port ?? 0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}`, stats, conf, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = await startMockBmc({ profile: 'supermicro', port: Number(process.env.MOCK_SMC_PORT) || 9001 });
  const b = await startMockBmc({ profile: 'dell', port: Number(process.env.MOCK_DELL_PORT) || 9002 });
  console.log('목 BMC(합성 응답 — 실장비 아님)');
  console.log(`  Supermicro형  ${a.url}   계정 ADMIN / ADMIN`);
  console.log(`  Dell형        ${b.url}   계정 root / calvin`);
  console.log('웹 화면 서버 등록 시 주소에 http:// 를 붙여 입력하세요. 종료: Ctrl+C');
  const stop = async () => { await a.close(); await b.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
