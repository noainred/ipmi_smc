import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/web/server.js';
import { ServerStore } from '../src/store/servers.js';
import { startMockBmc } from '../mock/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let srv; let port; let base; let mock; let dir;
const TOKEN = 'a'.repeat(48);

function req(method, p, { body, token = TOKEN, host, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: host || `127.0.0.1:${port}`, ...(token ? { 'X-PoC-Token': token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, text: t, json: j, headers: res.headers }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smcweb-'));
  const app = createApp({ dataDir: dir, outDir: path.join(dir, 'out'), webDir: path.join(ROOT, 'web'), serversFile: path.join(dir, 'servers.json'), token: TOKEN, getPort: () => port });
  srv = http.createServer(app.handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  mock = await startMockBmc({ profile: 'supermicro', password: 'ADMIN-secret-1' });
});
after(async () => { srv.close(); await mock.close(); });

test('토큰·Host·Content-Type 검사', async () => {
  assert.equal((await req('GET', '/api/servers', { token: null })).status, 403);
  assert.equal((await req('GET', '/api/servers', { token: 'b'.repeat(48) })).status, 403);
  assert.equal((await req('GET', '/', { host: 'evil.example:80' })).status, 403);
  assert.equal((await req('GET', '/api/servers', { host: `attacker.example:${port}` })).status, 403);
  const r = await new Promise((resolve) => { const x = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/servers', headers: { Host: `127.0.0.1:${port}`, 'X-PoC-Token': TOKEN, 'Content-Type': 'text/plain' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); x.end('{}'); });
  assert.equal(r, 415);
  const page = await req('GET', '/', { token: null });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(TOKEN), '화면에 토큰이 들어간다');
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
});

test('서버 등록·조회 응답에 비밀번호가 없다 · 파일 권한 600', async () => {
  const c = await req('POST', '/api/servers', { body: { name: 'm', role: 'smc', host: mock.url, username: 'ADMIN', password: 'ADMIN-secret-1' } });
  assert.equal(c.status, 201, c.text);
  assert.ok(!c.text.includes('ADMIN-secret-1'));
  const l = await req('GET', '/api/servers');
  assert.ok(!l.text.includes('ADMIN-secret-1'));
  assert.equal(l.json[0].hasPassword, true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'servers.json')).mode & 0o777, 0o600);
});

test('실행 → 결과·비교·원문·내보내기', async () => {
  const id = (await req('GET', '/api/servers')).json[0].id;
  const s = await req('POST', '/api/runs', { body: { serverIds: [id], options: { ipmi: false } } });
  assert.equal(s.status, 202, s.text);
  let j;
  for (let i = 0; i < 100; i++) { j = (await req('GET', '/api/runs/current')).json; if (j.status !== 'running') break; await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(j.status, 'done');
  assert.ok(!JSON.stringify(j).includes('ADMIN-secret-1'));
  const r = await req('GET', `/api/results/${id}`);
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes('ADMIN-secret-1'));
  const raw = await req('GET', `/api/results/${id}/raw?path=${encodeURIComponent('/redfish/v1/Systems/1')}`);
  assert.equal(raw.status, 200);
  assert.equal(raw.json.body.Manufacturer, 'Supermicro');
  for (const bad of ['/redfish/../../servers.json', '../servers.json', '/etc/passwd']) {
    assert.equal((await req('GET', `/api/results/${id}/raw?path=${encodeURIComponent(bad)}`)).status, 404, bad);
  }
  const cmp = await req('GET', '/api/compare');
  assert.equal(cmp.status, 200);
  assert.ok(cmp.json.rows.length > 20);
  const html = await req('GET', '/api/export.html');
  assert.equal(html.status, 200);
  assert.equal((html.text.match(/<\/script/gi) || []).length, 2, '데이터 속 </script 는 이스케이프');
  assert.ok(html.text.indexOf('<script>') > html.text.indexOf('<main'), '인라인 스크립트는 본문 뒤(defer 가 없다)');
  assert.ok(!html.text.includes('src="app.js"'));
  assert.ok(!html.text.includes('ADMIN-secret-1'));
  const md = await req('GET', '/api/export.md');
  assert.match(md.text, /Supermicro BMC 호환성 PoC 결과/);
});

test('서버 저장소: 주소를 바꾸면 비밀번호 승계 안 함 · 같은 상대면 승계 · 깨진 파일 보존', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'servers.json');
  const st = new ServerStore(f);
  const a = st.create({ name: 'a', host: '10.0.0.5', username: 'ADMIN', password: 'p1' });
  assert.throws(() => st.update(a.id, { name: 'a', host: '10.0.0.6', username: 'ADMIN', password: '' }), /다시 입력/);
  assert.throws(() => st.update(a.id, { name: 'a', host: '10.0.0.5', username: 'other', password: '' }), /다시 입력/);
  st.update(a.id, { name: 'renamed', host: '10.0.0.5', username: 'ADMIN', password: '' });
  assert.equal(st.getSecret(a.id).password, 'p1');
  assert.throws(() => st.create({ name: 'x', host: 'http://10.0.0.7', username: 'u', password: 'p' }), /http/);
  assert.throws(() => st.create({ name: 'x', host: '10.0.0.7', username: 'u', password: 'p', ipmi: { sameCreds: false } }), /IPMI/);
  fs.writeFileSync(f, '{broken');
  assert.deepEqual(st.list(), []);
  assert.ok(fs.readdirSync(path.dirname(f)).some((n) => n.startsWith('servers.json.corrupt.')));
});
