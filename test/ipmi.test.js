import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArgs, assertReadOnly, collectIpmi, COMMANDS, ipmiHostOf } from '../src/ipmi/ipmitool.js';
import { parseMcInfo, parseSdrElist, parseSelElist, parseDcmiPower, parseFru, fruSerials, parseUserList, classifyIpmiError } from '../src/ipmi/parse.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-ipmitool.cjs');

test('buildArgs: 비밀번호는 argv 에 없고 -E(환경변수)를 쓴다', () => {
  const a = buildArgs({ host: 'https://10.0.0.5:8443', username: 'ADMIN' }, ['mc', 'info']);
  assert.deepEqual(a.slice(0, 6), ['-I', 'lanplus', '-H', '10.0.0.5', '-U', 'ADMIN']);
  assert.ok(a.includes('-E'));
  assert.ok(!a.includes('-P'));
  assert.equal(ipmiHostOf('[fe80::1]:443'), 'fe80::1');
});

test('assertReadOnly: 상태를 바꾸는 명령은 거부', () => {
  for (const c of COMMANDS) assert.doesNotThrow(() => assertReadOnly(c.args), c.label);
  for (const bad of [['chassis', 'power', 'off'], ['raw', '0x30', '0x45'], ['user', 'set', 'password', '2'], ['sel', 'clear'], ['mc', 'reset', 'cold'], ['lan', 'set', '1', 'ipaddr'], ['sol', 'activate'], ['chassis', 'bootdev', 'pxe'], ['dcmi', 'power', 'set_limit']]) {
    assert.throws(() => assertReadOnly(bad), bad.join(' '));
  }
});

test('파서: mc info · sdr · sel · dcmi · fru · user list', () => {
  const mc = parseMcInfo('IPMI Version              : 2.0\nManufacturer ID           : 10876\nManufacturer Name         : Super Micro Computer Inc.\n');
  assert.equal(mc.ipmiVersion, '2.0');
  assert.equal(mc.manufacturerId, '10876');
  const sdr = parseSdrElist('CPU1 Temp        | 01h | ok  |  3.1 | 48 degrees C\nFAN5 | 45h | ns | 29.5 | No Reading\n');
  assert.equal(sdr.length, 2);
  assert.equal(sdr[0].value, 48);
  assert.equal(sdr[0].unit, '°C');
  assert.equal(sdr[1].value, null);
  const sel = parseSelElist('   1 | 10/26/2026 | 22:14:07 | Power Supply PS2 Status | Power Supply AC lost | Asserted\n');
  assert.equal(sel[0].sensor, 'Power Supply PS2 Status');
  const p = parseDcmiPower('    Instantaneous power reading:                   391 Watts\n    Power reading state is:                   activated\n');
  assert.equal(p.instantW, 391);
  assert.equal(p.state, 'activated');
  const fru = parseFru(' FRU Device Description : Builtin FRU Device (ID 0)\n Product Serial        : S1\n Board Serial          : B1\n');
  assert.deepEqual(fruSerials(fru), { 'Product Serial': 'S1', 'Board Serial': 'B1' });
  const users = parseUserList('ID  Name\t     Callin  Link Auth\tIPMI Msg   Channel Priv Limit\n2   ADMIN            false   false      true       ADMINISTRATOR\n');
  assert.equal(users[0].name, 'ADMIN');
  assert.equal(classifyIpmiError('RAKP 2 HMAC is invalid'), 'auth');
  assert.equal(classifyIpmiError('no matching cipher suite'), 'cipher');
});

test('collectIpmi: 가짜 ipmitool — 전 명령 성공 · 파싱', async () => {
  process.env.FAKE_IPMI_PASSWORD = 'ADMIN';
  const r = await collectIpmi({ bin: FAKE, host: '127.0.0.1', username: 'ADMIN', password: 'ADMIN' });
  assert.equal(r.commands.length, COMMANDS.length);
  assert.ok(r.commands.every((c) => c.ok), JSON.stringify(r.commands.filter((c) => !c.ok)));
  assert.equal(r.parsed.mcInfo.ipmiVersion, '2.0');
  assert.equal(r.parsed.dcmiPower.instantW, 391);
  assert.equal(r.parsed.sdr.sensors.length, 8);
});

test('collectIpmi: 인증 거부면 첫 명령 뒤 중단(잠금 방지) — 호출 1회 + -V', async () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ipmi-')), 'calls.log');
  process.env.FAKE_IPMI_PASSWORD = 'right';
  process.env.FAKE_IPMI_LOG = log;
  try {
    const r = await collectIpmi({ bin: FAKE, host: '127.0.0.1', username: 'ADMIN', password: 'wrong' });
    assert.equal(r.commands.length, 1);
    assert.match(r.stoppedReason, /인증 거부/);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a[0] !== '-V');
    assert.equal(calls.length, 1);
    assert.ok(!r.commands[0].stderr.includes('wrong'));
  } finally { delete process.env.FAKE_IPMI_LOG; }
});

test('collectIpmi: 암호 묶음 불일치면 -C 3 으로 한 번만 다시', async () => {
  process.env.FAKE_IPMI_PASSWORD = 'ADMIN';
  process.env.FAKE_IPMI_NEED_CIPHER = '3';
  try {
    const r = await collectIpmi({ bin: FAKE, host: '127.0.0.1', username: 'ADMIN', password: 'ADMIN' });
    assert.equal(r.cipherUsed, '3');
    assert.ok(r.commands.filter((c) => c.ok).length === COMMANDS.length);
  } finally { delete process.env.FAKE_IPMI_NEED_CIPHER; }
});

test('collectIpmi: ipmitool 이 없으면 건너뜀(실패 아님)', async () => {
  const prev = process.env.SMC_POC_IPMITOOL;
  process.env.SMC_POC_IPMITOOL = '/nonexistent/ipmitool';
  try {
    const r = await collectIpmi({ host: '127.0.0.1', username: 'a', password: 'b' });
    assert.equal(r.available, false);
    assert.match(r.stoppedReason, /brew install ipmitool/);
  } finally { if (prev === undefined) delete process.env.SMC_POC_IPMITOOL; else process.env.SMC_POC_IPMITOOL = prev; }
});
