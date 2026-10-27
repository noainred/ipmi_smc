import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets, maskUrlCredentials, scrub, MASK } from '../src/util/mask.js';
import { isPlaceholder, collisions } from '../src/util/placeholder.js';
import { safeFileName } from '../src/util/fsx.js';
import { parseTarget } from '../src/http/bmcClient.js';

test('maskSecrets: 비밀 키 값만 가리고 null·불리언·정책 키는 그대로', () => {
  const out = maskSecrets({ UserName: 'ADMIN', Password: 'p@ss', password: null, PasswordChangeRequired: true, MinPasswordLength: 8, Nested: { CommunityString: 'public', Token: 'abc' }, Arr: [{ AuthKey: 'k' }] });
  assert.equal(out.UserName, 'ADMIN');
  assert.equal(out.Password, MASK);
  assert.equal(out.password, null);
  assert.equal(out.PasswordChangeRequired, true);
  assert.equal(out.MinPasswordLength, 8);
  assert.equal(out.Nested.CommunityString, MASK);
  assert.equal(out.Nested.Token, MASK);
  assert.equal(out.Arr[0].AuthKey, MASK);
});

test('maskSecrets: URL 속 비밀번호(user:pass@)를 가린다 — VirtualMedia Image 류', () => {
  const out = maskSecrets({ Image: 'http://user:secret@example.invalid/iso', Dest: 'https://x.example/a@b', Mail: 'admin@example.com' });
  assert.equal(out.Image, `http://user:${MASK}@example.invalid/iso`);
  assert.equal(out.Dest, 'https://x.example/a@b');
  assert.equal(out.Mail, 'admin@example.com');
  assert.equal(maskUrlCredentials('smb://dom\\u:p4ss@host/share'), `smb://dom\\u:${MASK}@host/share`);
});

test('scrub: 문구 속 비밀번호 제거(3자 이상만)', () => {
  assert.equal(scrub('login failed for pw=Secr3t!', ['Secr3t!']), `login failed for pw=${MASK}`);
  assert.equal(scrub('ab cd', ['ab']), 'ab cd');
});

test('isPlaceholder: SMBIOS 기본 문자열', () => {
  for (const v of ['To be filled by O.E.M.', 'To Be Filled By O.E.M.', 'Default string', '0123456789', '000000', '', '   ', 'N/A', 'Not Specified', 'System Serial Number']) assert.ok(isPlaceholder(v), v);
  for (const v of ['FIX-SMC-0001', 'ABC1234', 'S41xxxxx', 'CNFIX00000000001']) assert.ok(!isPlaceholder(v), v);
});

test('collisions: 같은 값(대소문자 무시)을 가진 id 묶음만', () => {
  const m = collisions([{ id: 'a', value: 'X1' }, { id: 'b', value: 'x1' }, { id: 'c', value: 'Y' }, { id: 'd', value: '' }]);
  assert.deepEqual([...m.entries()], [['X1', ['a', 'b']]]);
});

test('safeFileName: 경로 조작 문자 제거 + 해시 접미(같은 입력 → 같은 이름)', () => {
  const a = safeFileName('/redfish/v1/../../data/servers.json');
  assert.ok(!a.includes('/'));
  assert.match(a, /^[A-Za-z0-9._-]+__[0-9a-f]{8}\.json$/);
  assert.equal(a, safeFileName('/redfish/v1/../../data/servers.json'));
  assert.notEqual(safeFileName('/redfish/v1/A'), safeFileName('/redfish/v1/A?x'));
});

test('parseTarget: 주소 형식', () => {
  assert.deepEqual(parseTarget('10.0.0.5').origin, 'https://10.0.0.5');
  assert.equal(parseTarget('10.0.0.5:8443').port, 8443);
  assert.equal(parseTarget('10.0.0.5', '8443').port, 8443);
  assert.equal(parseTarget('https://bmc.local').hostname, 'bmc.local');
  assert.equal(parseTarget('[fe80::1]:443').hostname, 'fe80::1');
  assert.equal(parseTarget('http://127.0.0.1:9001').loopback, true);
  for (const bad of ['', 'a/b', 'user@host', 'h?x', '10.0.0.1:99999', 'bad host']) assert.throws(() => parseTarget(bad), bad);
});
