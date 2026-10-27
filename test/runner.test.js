import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockBmc } from '../mock/server.js';
import { runServer, loadLatest } from '../src/run/runner.js';
import { buildCompare } from '../src/report/compare.js';
import { toMarkdown } from '../src/report/markdown.js';
import { extractLinks, shouldSkip, makePatternFn } from '../src/redfish/crawl.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-ipmitool.cjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'smcpoc-'));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

async function runMock(profile, { password, id, role, ipmi = false } = {}) {
  const m = await startMockBmc({ profile });
  const out = tmp();
  const server = { id: id || 'aaaaaaaaaaaa', name: profile, role: role || (profile === 'dell' ? 'dell' : 'smc'), host: m.url, username: m.conf.username, password: password ?? m.conf.password, ipmi: { enabled: ipmi } };
  try {
    const r = await runServer(server, { outDir: out, options: { ipmi } });
    return { r, out, m, server };
  } finally { await m.close(); }
}

test('SMC형 목: 점검 판정과 The.DVC 깨짐 지점(합성 응답 기준)', async () => {
  const { r } = await runMock('supermicro');
  const st = (k) => r.checks[k].status;
  assert.equal(r.vendor, 'supermicro');
  assert.equal(st('system'), 'ok');
  assert.equal(st('bios'), 'license');
  assert.equal(st('storage'), 'license');
  assert.equal(st('telemetry'), 'absent');
  assert.equal(st('logs'), 'ok');
  assert.equal(st('racadm'), 'skip');
  const v = Object.fromEntries(r.assumptions.map((a) => [a.id, a.verdict]));
  assert.equal(v.vendorScan, 'break');
  assert.equal(v.serviceTag, 'break', 'SKU 자리표시');
  assert.equal(v.firmwareFilter, 'break', 'Installed- 없음');
  assert.equal(v.logPaths, 'break', 'Log1');
  assert.equal(v.telemetry, 'break');
  assert.equal(v.racadm, 'break');
  assert.ok(r.crawl.stats.resources > 50);
  assert.ok(!r.crawl.index.some((e) => /\/Registries\/./.test(e.path)), '레지스트리 본문은 건너뛴다');
});

test('Dell형 목: 같은 판정식이 Dell 에서는 깨짐 0(대조군)', async () => {
  const { r } = await runMock('dell');
  const verdicts = r.assumptions.map((a) => a.verdict);
  assert.equal(verdicts.filter((x) => x === 'break').length, 0, JSON.stringify(r.assumptions.filter((a) => a.verdict === 'break')));
  assert.equal(r.checks.telemetry.status, 'ok');
  assert.equal(r.checks.firmware.data.dvcInstalledMatches, 2);
});

test('비밀번호가 틀리면: 자격증명 요청 2회(Basic·세션)로 끝나고, 결과·원본에 비밀번호가 없다', async () => {
  const { r, out, m } = await runMock('supermicro', { password: 'Wr0ng-Pass!' });
  assert.equal(r.auth.failed, true);
  assert.equal(m.stats.authFailures, 2);
  assert.ok(r.requests.requests <= 3, `요청 ${r.requests.requests}`);
  assert.equal(r.ipmi?.commands?.length || 0, 0);
  for (const f of walk(out)) assert.ok(!fs.readFileSync(f, 'utf8').includes('Wr0ng-Pass!'), f);
  assert.ok(r.assumptions.filter((a) => a.verdict === 'break').every((a) => ['vendorScan', 'racadm'].includes(a.id)), '응답이 없는 항목은 깨짐이 아니라 미확인');
});

test('접속이 안 되는 서버: 깨짐을 지어내지 않고 전부 미확인', async () => {
  const out = tmp();
  const r = await runServer({ id: 'cccccccccccc', name: 'down', role: 'smc', host: 'http://127.0.0.1:1', username: 'u', password: 'p', ipmi: { enabled: false } }, { outDir: out, options: { ipmi: false } });
  assert.ok(r.fatal);
  assert.deepEqual([...new Set(r.assumptions.map((a) => a.verdict))], ['unknown']);
});

test('원본 저장: 비밀번호 필드·URL 속 비밀번호를 가린다', async () => {
  const { out } = await runMock('supermicro');
  const all = walk(out).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!all.includes('user:secret@'), 'URL 비밀번호');
  assert.ok(!all.includes('"ADMIN:ADMIN"'));
});

test('IPMI(가짜 ipmitool) 포함 실행 + 결과 저장·최신 읽기', async () => {
  process.env.SMC_POC_IPMITOOL = FAKE;
  process.env.FAKE_IPMI_PASSWORD = 'ADMIN';
  try {
    const { r, out, server } = await runMock('supermicro', { ipmi: true });
    assert.ok(r.ipmi.commands.length > 10);
    assert.equal(r.assumptions.find((a) => a.id === 'ipmiVersion').verdict, 'ok');
    const back = loadLatest(out, server.id);
    assert.equal(back.runId, r.runId);
  } finally { delete process.env.SMC_POC_IPMITOOL; }
});

test('비교: 서비스태그 충돌(자리표시 아님) · 경로 비교 · 마크다운 표 이스케이프', async () => {
  const a = await runMock('supermicro', { id: 'aaaaaaaaaaa1' });
  const b = await runMock('supermicro', { id: 'aaaaaaaaaaa2' });
  const d = await runMock('dell', { id: 'dddddddddddd' });
  // 두 SMC 의 SKU 가 자리표시가 아닌 같은 값이라고 가정(같은 모델 SKU 겹침 시나리오)
  for (const x of [a, b]) { x.r.checks.system.data.dvcServiceTag = 'SYS-SAME|SKU'; }
  const cmp = buildCompare([
    { server: { id: 'aaaaaaaaaaa1', name: 'A', role: 'smc', host: 'h1' }, result: a.r },
    { server: { id: 'aaaaaaaaaaa2', name: 'B', role: 'smc', host: 'h2' }, result: b.r },
    { server: { id: 'dddddddddddd', name: 'D', role: 'dell', host: 'h3' }, result: d.r },
  ]);
  assert.equal(cmp.tagCollisions.length, 1);
  assert.equal(cmp.perServer.find((x) => x.id === 'aaaaaaaaaaa1').assumptions.find((x) => x.id === 'serviceTag').verdict, 'break');
  assert.ok(cmp.paths.otherOnly.length > 0 && cmp.paths.dellOnly.length > 0 && cmp.paths.common.length > 0);
  assert.equal(cmp.rows.find((r) => r.id === 'firmware').impact.verdict, 'break');
  const md = toMarkdown(cmp);
  assert.ok(md.includes('SYS-SAME\\|SKU'), '표 셀의 | 는 이스케이프');
});

test('탐색 도우미: 링크 추출 · 건너뛰기 · 경로 패턴', () => {
  const { links, members } = extractLinks({ '@odata.id': '/redfish/v1/Chassis', Members: [{ '@odata.id': '/redfish/v1/Chassis/1' }], Links: { x: { '@odata.id': '/redfish/v1/Managers/1#/a' } } });
  assert.deepEqual(members, ['/redfish/v1/Chassis/1']);
  assert.deepEqual(links, ['/redfish/v1/Managers/1']);
  assert.ok(shouldSkip('/redfish/v1/JsonSchemas/Chassis'));
  assert.ok(shouldSkip('/redfish/v1/Systems/1/Actions/ComputerSystem.Reset'));
  assert.ok(!shouldSkip('/redfish/v1/JsonSchemas'));
  const pat = makePatternFn(new Map([['/redfish/v1/Chassis/1', '/redfish/v1/Chassis']]));
  assert.equal(pat('/redfish/v1/Chassis/1/Thermal'), '/redfish/v1/Chassis/{id}/Thermal');
});
