import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BmcClient } from '../src/http/bmcClient.js';
import { startMockBmc } from '../mock/server.js';

test('Basic 인증 성공 · 방식 기록', async () => {
  const m = await startMockBmc({ profile: 'supermicro' });
  const c = new BmcClient({ host: m.url, username: 'ADMIN', password: 'ADMIN' });
  try {
    const r = await c.get('/redfish/v1/Systems');
    assert.equal(r.status, 200);
    assert.equal(c.authMode, 'basic');
  } finally { await c.close(); await m.close(); }
});

test('Basic 이 꺼진 BMC → 세션 토큰으로 수립 · close() 가 세션을 DELETE', async () => {
  const m = await startMockBmc({ profile: 'supermicro', basic: false });
  const c = new BmcClient({ host: m.url, username: 'ADMIN', password: 'ADMIN' });
  try {
    const r = await c.get('/redfish/v1/Systems');
    assert.equal(r.status, 200);
    assert.equal(c.authMode, 'session');
    await c.get('/redfish/v1/Chassis');
    assert.equal(m.stats.sessionsCreated, 1, '세션은 한 번만 만든다');
  } finally { await c.close(); }
  assert.equal(m.stats.sessionsDeleted, 1);
  await m.close();
});

test('비밀번호가 틀리면 Basic 1회 + 세션 1회 뒤 중단 — 이후 요청은 네트워크로 나가지 않는다', async () => {
  const m = await startMockBmc({ profile: 'supermicro' });
  const c = new BmcClient({ host: m.url, username: 'ADMIN', password: 'wrong' });
  try {
    const r = await c.get('/redfish/v1/Systems');
    assert.equal(r.status, 401);
    assert.equal(c.authFailed, true);
    assert.equal(m.stats.authFailures, 2);
    const before = m.stats.requests;
    const r2 = await c.get('/redfish/v1/Chassis');
    assert.equal(r2.authStopped, true);
    assert.equal(m.stats.requests, before, '인증 실패 뒤에는 요청을 보내지 않는다');
  } finally { await c.close(); await m.close(); }
});

test('메서드 화이트리스트 — PATCH·PUT·Actions POST·남의 세션 DELETE 는 보내지 않는다', async () => {
  const c = new BmcClient({ host: 'http://127.0.0.1:1', username: 'a', password: 'b' });
  for (const [m, p] of [['PATCH', '/redfish/v1/Systems/1'], ['PUT', '/redfish/v1/Systems/1'], ['POST', '/redfish/v1/Systems/1/Actions/ComputerSystem.Reset'], ['DELETE', '/redfish/v1/SessionService/Sessions/1'], ['GET', '/etc/passwd']]) {
    await assert.rejects(() => c.request(m, p), /읽기 전용/, `${m} ${p}`);
  }
  await c.close();
});

test('http:// 는 루프백에만 허용', () => {
  assert.throws(() => new BmcClient({ host: 'http://10.0.0.5', username: 'a', password: 'b' }), /루프백|127\.0\.0\.1/);
});

test('다른 출처로의 리다이렉트는 따르지 않는다(자격증명 유출 방지)', async () => {
  let hits = 0;
  const evil = http.createServer((req, res) => { hits += 1; res.end('{}'); });
  await new Promise((r) => evil.listen(0, '127.0.0.1', r));
  const redir = http.createServer((req, res) => { res.writeHead(302, { Location: `http://localhost:${evil.address().port}/redfish/v1/x` }); res.end(); });
  await new Promise((r) => redir.listen(0, '127.0.0.1', r));
  const c = new BmcClient({ host: `http://127.0.0.1:${redir.address().port}`, username: 'a', password: 'b' });
  try {
    const r = await c.get('/redfish/v1/Systems');
    assert.match(r.error || '', /다른 주소로 리다이렉트/);
    assert.equal(hits, 0);
  } finally { await c.close(); redir.close(); evil.close(); }
});
