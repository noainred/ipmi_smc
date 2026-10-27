#!/usr/bin/env node
/**
 * 가짜 ipmitool — 테스트·화면 데모 전용. 출력은 **합성**이다(실장비 출력 아님, ipmitool 1.8.19 형식을 흉내 냄).
 *  · 비밀번호는 환경변수 IPMI_PASSWORD 로만 받는다 — argv 에 비밀번호가 있으면 실패한다(누출 회귀 검출).
 *  · FAKE_IPMI_PASSWORD 와 다르면 인증 실패 문구로 끝난다.
 *  · FAKE_IPMI_LOG 가 있으면 호출마다 argv 를 한 줄씩 남긴다(호출 횟수 검사용).
 *  · FAKE_IPMI_NEED_CIPHER=3 이면 -C 3 이 없을 때 암호 묶음 오류를 낸다.
 */
const fs = require('node:fs');

const argv = process.argv.slice(2);
if (process.env.FAKE_IPMI_LOG) fs.appendFileSync(process.env.FAKE_IPMI_LOG, `${JSON.stringify(argv)}\n`);
if (argv[0] === '-V') { console.log('ipmitool version 1.8.19 (fake)'); process.exit(0); }
const expected = process.env.FAKE_IPMI_PASSWORD || 'ADMIN';
if (argv.includes('-P') || argv.some((a, k) => a === expected && argv[k - 1] !== '-U')) { console.error('TEST FAILURE: password on argv'); process.exit(9); }
if (!argv.includes('-E')) { console.error('Unable to read password from environment'); process.exit(1); }
if (process.env.FAKE_IPMI_NEED_CIPHER && argv[argv.indexOf('-C') + 1] !== process.env.FAKE_IPMI_NEED_CIPHER) {
  console.error('Error in open session response message : no matching cipher suite');
  console.error('Error: Unable to establish IPMI v2 / RMCP+ session');
  process.exit(1);
}
if ((process.env.IPMI_PASSWORD || '') !== expected) {
  console.error('Error: Unable to establish IPMI v2 / RMCP+ session');
  console.error('RAKP 2 HMAC is invalid');
  process.exit(1);
}
// 옵션(-I x -H x -U x -E -N x -R x -C x)을 걷어 내고 남은 것이 명령이다
const rest = [];
for (let k = 0; k < argv.length; k++) { if (['-I', '-H', '-U', '-N', '-R', '-C'].includes(argv[k])) { k++; continue; } if (argv[k] === '-E') continue; rest.push(argv[k]); }
const cmd = rest.join(' ');
const OUT = {
  'mc info': `Device ID                 : 32\nDevice Revision           : 1\nFirmware Revision         : 1.01\nIPMI Version              : 2.0\nManufacturer ID           : 10876\nManufacturer Name         : Super Micro Computer Inc.\nProduct ID                : 6929 (0x1b11)\nProduct Name              : Unknown (0x1B11)\nDevice Available          : yes\nAdditional Device Support :\n    Sensor Device\n    SEL Device\n`,
  'mc guid': 'System GUID  : 00000000-0000-0000-0000-3cecef0000a1\n',
  'chassis status': 'System Power         : on\nPower Overload       : false\nMain Power Fault     : false\nChassis Intrusion    : inactive\n',
  'chassis restart_cause': 'System restart cause: power-up via power push button\n',
  'fru print': ' FRU Device Description : Builtin FRU Device (ID 0)\n Chassis Type          : Rack Mount Chassis\n Chassis Serial        : FIX-CSE-0001\n Board Mfg             : Supermicro\n Board Product         : X13FIXTURE\n Board Serial          : FIX-BRD-0001\n Product Manufacturer  : Supermicro\n Product Name          : SYS-FIXTURE-X13\n Product Serial        : FIX-SMC-0001\n',
  'sdr info': 'SDR Version                         : 0x51\nRecord Count                        : 62\n',
  'sdr elist full': 'CPU1 Temp        | 01h | ok  |  3.1 | 48 degrees C\nCPU2 Temp        | 02h | ok  |  3.2 | 51 degrees C\nInlet Temp       | 0Bh | ok  |  7.1 | 24 degrees C\nSystem Temp      | 0Ch | ok  |  7.2 | 32 degrees C\nFAN1             | 41h | ok  | 29.1 | 4200 RPM\nFAN5             | 45h | ns  | 29.5 | No Reading\n12V              | 30h | ok  |  7.3 | 12.10 Volts\nVBAT             | 36h | ok  |  7.4 | 3.06 Volts\n',
  'sel info': 'SEL Information\nVersion          : 1.5 (v1.5, v2 compliant)\nEntries          : 3\nPercent Used     : 1%\n',
  'sel elist last 30': '   1 | 10/26/2026 | 22:14:07 | Power Supply PS2 Status | Power Supply AC lost | Asserted\n   2 | 10/25/2026 | 03:02:19 | Memory | Correctable ECC | Asserted\n   3 | 10/20/2026 | 11:40:02 | OS Boot | boot completed | Asserted\n',
  'dcmi power reading': '\n    Instantaneous power reading:                   391 Watts\n    Minimum during sampling period:                350 Watts\n    Maximum during sampling period:                420 Watts\n    Average power reading over sample period:      380 Watts\n    IPMI timestamp:                           Mon Oct 27 00:40:00 2026\n    Sampling period:                          00000001 Seconds.\n    Power reading state is:                   activated\n',
  'dcmi get_temp_reading': '\tEntity ID\t\t\tEntity Instance\t   Temp. Readings\nInlet air temp.                                 1               +24 C\n',
  'lan print 1': 'IP Address Source       : Static Address\nIP Address              : 127.0.0.1\nMAC Address             : 3c:ec:ef:00:00:ff\n',
  'user list 1': 'ID  Name\t     Callin  Link Auth\tIPMI Msg   Channel Priv Limit\n1                    true    false      false      Unknown (0x00)\n2   ADMIN            false   false      true       ADMINISTRATOR\n3   monitor          true    false      true       USER\n',
  'channel info 1': 'Channel 0x1 info:\n  Channel Medium Type   : 802.3 LAN\n  Channel Protocol Type : IPMB-1.0\n',
  'sol info 1': 'Set in progress                 : set-complete\nEnabled                         : true\n',
};
if (!(cmd in OUT)) { console.error(`fake: unknown command ${cmd}`); process.exit(1); }
process.stdout.write(OUT[cmd]);
