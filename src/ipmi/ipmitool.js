/**
 * IPMI over LAN 수집 — ipmitool(lanplus)을 실행한다(macOS: `brew install ipmitool`).
 *
 * 안전 규칙:
 *  ① 읽기 명령만(COMMANDS 화이트리스트). chassis power·raw·user set·sol activate 같은 명령은 코드에 없다.
 *  ② 비밀번호는 argv 에 넣지 않는다 — `-E`(환경변수 IPMI_PASSWORD)로 넘긴다(ps 로 보이지 않게).
 *  ③ 첫 명령(mc info)이 인증 거부·도달 불가로 실패하면 나머지를 보내지 않는다(계정 잠금 방지).
 *     암호 묶음(cipher suite) 불일치만 -C 3 으로 한 번 더 시도한다(인증 시도 횟수를 늘리지 않는 재협상이 아니므로 1회로 제한).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseMcInfo, parseFru, fruSerials, parseSdrElist, parseSelElist, parseDcmiPower, parseKeyValue, parseUserList, classifyIpmiError,
} from './parse.js';
import { scrub } from '../util/mask.js';

/** 실행하는 명령(읽기 전용). key 는 결과 객체 이름, slow 는 시간이 오래 걸리는 명령. */
export const COMMANDS = Object.freeze([
  { key: 'mcInfo', args: ['mc', 'info'], label: 'mc info' },
  { key: 'mcGuid', args: ['mc', 'guid'], label: 'mc guid' },
  { key: 'chassisStatus', args: ['chassis', 'status'], label: 'chassis status' },
  { key: 'restartCause', args: ['chassis', 'restart_cause'], label: 'chassis restart_cause' },
  { key: 'fru', args: ['fru', 'print'], label: 'fru print', slow: true },
  { key: 'sdrInfo', args: ['sdr', 'info'], label: 'sdr info' },
  { key: 'sdr', args: ['sdr', 'elist', 'full'], label: 'sdr elist full', slow: true },
  { key: 'selInfo', args: ['sel', 'info'], label: 'sel info' },
  { key: 'sel', args: ['sel', 'elist', 'last', '30'], label: 'sel elist last 30', slow: true },
  { key: 'dcmiPower', args: ['dcmi', 'power', 'reading'], label: 'dcmi power reading' },
  { key: 'dcmiTemp', args: ['dcmi', 'get_temp_reading'], label: 'dcmi get_temp_reading' },
  { key: 'lan', args: ['lan', 'print', '1'], label: 'lan print 1' },
  { key: 'users', args: ['user', 'list', '1'], label: 'user list 1' },
  { key: 'channel', args: ['channel', 'info', '1'], label: 'channel info 1' },
  { key: 'sol', args: ['sol', 'info', '1'], label: 'sol info 1' },
]);

const READ_ONLY_FIRST = new Set(['mc', 'chassis', 'fru', 'sdr', 'sel', 'dcmi', 'lan', 'user', 'channel', 'sol']);
// 'power' 는 여기 넣지 않는다 — `dcmi power reading` 이 읽기 명령이다. chassis power·dcmi power set_limit 은 아래 명령별 규칙이 막는다.
const FORBIDDEN = /^(set|set_limit|raw|reset|clear|activate|deactivate|delete|disable|enable|write|edit|bootdev|bootparam|identify|selftest|policy|priv|password|name|cold|warm|i2c|spd|exec|on|off|cycle|soft)$/i;

/** 명령이 읽기 전용인지(화이트리스트 밖이면 throw). */
export function assertReadOnly(args) {
  if (!READ_ONLY_FIRST.has(args[0])) throw new Error(`허용하지 않은 ipmitool 명령: ${args[0]}`);
  for (const a of args.slice(1)) if (FORBIDDEN.test(a)) throw new Error(`허용하지 않은 ipmitool 인자: ${a}`);
  if (args[0] === 'chassis' && !['status', 'restart_cause'].includes(args[1])) throw new Error('chassis 는 status·restart_cause 만');
  if (args[0] === 'user' && args[1] !== 'list') throw new Error('user 는 list 만');
  if (args[0] === 'sol' && args[1] !== 'info') throw new Error('sol 은 info 만');
  if (args[0] === 'sel' && !['info', 'elist', 'list'].includes(args[1])) throw new Error('sel 은 info·elist 만');
  if (args[0] === 'dcmi' && !['power', 'get_temp_reading', 'discover'].includes(args[1])) throw new Error('dcmi 는 읽기만');
  if (args[0] === 'dcmi' && args[1] === 'power' && args[2] !== 'reading') throw new Error('dcmi power 는 reading 만');
}

/** ipmitool 경로 찾기 — Finder 에서 연 start.command 는 PATH 에 /opt/homebrew/bin 이 없을 수 있다. */
export function findIpmitool(envPath = process.env.PATH || '') {
  // 경로를 직접 지정(다른 위치에 설치했거나 테스트용 가짜 ipmitool)
  const forced = process.env.SMC_POC_IPMITOOL;
  if (forced) { try { fs.accessSync(forced, fs.constants.X_OK); return forced; } catch { return null; } }
  const dirs = [...envPath.split(path.delimiter).filter(Boolean), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/usr/sbin', '/opt/local/bin'];
  for (const d of dirs) {
    const p = path.join(d, process.platform === 'win32' ? 'ipmitool.exe' : 'ipmitool');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* 다음 */ }
  }
  return null;
}

function run(bin, args, { env, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(bin, args, { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, killed: !!err?.killed, stdout: String(stdout || ''), stderr: String(stderr || '') + (err && !stderr ? String(err.message || '') : ''), ms: Date.now() - started });
    });
  });
}

export async function ipmitoolVersion(bin) {
  if (!bin) return '';
  const r = await run(bin, ['-V'], { env: process.env, timeoutMs: 5000 });
  return (r.stdout || r.stderr).trim().slice(0, 80);
}

/** 대상 주소에서 IPMI 용 호스트만(스킴·포트 제거). */
export function ipmiHostOf(host) {
  let s = String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const v6 = /^\[([^\]]+)\]/.exec(s);
  if (v6) return v6[1];
  if ((s.match(/:/g) || []).length === 1) s = s.split(':')[0];
  return s;
}

/** argv 만들기(비밀번호 없음 — 테스트가 고정한다). */
export function buildArgs({ host, username, cipher, timeoutSec = 5, retries = 2 }, cmdArgs) {
  assertReadOnly(cmdArgs);
  const a = ['-I', 'lanplus', '-H', ipmiHostOf(host), '-U', String(username), '-E', '-N', String(timeoutSec), '-R', String(retries)];
  if (cipher) a.push('-C', String(cipher));
  return [...a, ...cmdArgs];
}

/**
 * @param {object} o  { host, username, password, cipher?, timeoutMs?, bin?, onCommand?, signal? }
 * @returns {Promise<object>} { available, bin, version, commands[], parsed{}, stoppedReason, cipherUsed }
 */
export async function collectIpmi(o) {
  const bin = o.bin || findIpmitool();
  const out = { available: !!bin, bin: bin || '', version: '', commands: [], parsed: {}, stoppedReason: '', cipherUsed: o.cipher || '' };
  if (!bin) { out.stoppedReason = 'ipmitool 이 설치되어 있지 않음(macOS: brew install ipmitool)'; return out; }
  out.version = await ipmitoolVersion(bin);
  const env = { ...process.env, IPMI_PASSWORD: String(o.password ?? '') };
  const timeoutMs = o.timeoutMs || 60_000;
  let cipher = o.cipher || '';
  for (let i = 0; i < COMMANDS.length; i++) {
    const c = COMMANDS[i];
    if (o.signal?.aborted) { out.stoppedReason = '취소됨'; break; }
    o.onCommand?.(c.label, 'start');
    let r = await run(bin, buildArgs({ host: o.host, username: o.username, cipher }, c.args), { env, timeoutMs: c.slow ? timeoutMs : Math.min(timeoutMs, 30_000) });
    if (i === 0 && r.code !== 0 && classifyIpmiError(r.stderr) === 'cipher' && cipher !== '3') {
      out.commands.push({ label: c.label, ok: false, code: r.code, ms: r.ms, stderr: scrub(r.stderr, [o.password]).slice(0, 1000), stdout: '', note: '암호 묶음 불일치 → -C 3 로 재시도' });
      cipher = '3';
      out.cipherUsed = '3';
      r = await run(bin, buildArgs({ host: o.host, username: o.username, cipher }, c.args), { env, timeoutMs: Math.min(timeoutMs, 30_000) });
    }
    const rec = { label: c.label, key: c.key, ok: r.code === 0, code: r.code, ms: r.ms, killed: r.killed, stdout: scrub(r.stdout, [o.password]).slice(0, 200_000), stderr: scrub(r.stderr, [o.password]).slice(0, 2000) };
    out.commands.push(rec);
    o.onCommand?.(c.label, rec.ok ? 'ok' : 'fail');
    if (rec.ok) {
      try { out.parsed[c.key] = parseOne(c.key, r.stdout); } catch (e) { out.parsed[c.key] = { parseError: String(e?.message || e) }; }
    } else if (i === 0) {
      const why = classifyIpmiError(r.stderr);
      out.stoppedReason = why === 'auth' ? 'IPMI 인증 거부 — 나머지 명령을 보내지 않음(계정 잠금 방지)'
        : why === 'unreachable' ? 'IPMI 세션을 열지 못함(UDP 623 차단·IPMI over LAN 꺼짐·인증 거부 중 하나) — 나머지 명령 생략'
          : `첫 명령 실패(code ${r.code}) — 나머지 명령 생략`;
      out.firstError = why;
      break;
    }
  }
  return out;
}

function parseOne(key, text) {
  switch (key) {
    case 'mcInfo': return parseMcInfo(text);
    case 'fru': { const devices = parseFru(text); return { devices, serials: fruSerials(devices) }; }
    case 'sdr': return { sensors: parseSdrElist(text) };
    case 'sel': return { entries: parseSelElist(text) };
    case 'dcmiPower': return parseDcmiPower(text);
    case 'users': return { users: parseUserList(text) };
    default: return parseKeyValue(text);
  }
}
