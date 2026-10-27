/**
 * 등록 서버 저장소 — data/servers.json(권한 600). 비밀번호를 담으므로:
 *  ① 원자적 쓰기 · 깨진 파일은 .corrupt.<ts> 로 보존(다음 저장이 원본을 지우지 않게)
 *  ② 화면·API 로는 비밀번호를 내보내지 않는다(hasPassword 만)
 *  ③ 주소·포트·사용자가 바뀌면 저장된 비밀번호를 승계하지 않는다 — 새 비밀번호가 필요하다
 *     (The.DVC util/secretCarry.js 와 같은 규칙: 다른 상대에게 저장 비밀번호가 나가지 않게)
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { atomicWrite, readJson } from '../util/fsx.js';
import { parseTarget } from '../http/bmcClient.js';
import { paths } from '../config.js';

export const ROLES = ['smc', 'dell', 'other'];
const MAX_SERVERS = 200;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export class ServerStore {
  constructor(file = paths().serversFile) {
    this.file = file;
  }

  _load() {
    const j = readJson(this.file, { servers: [] });
    return Array.isArray(j?.servers) ? j.servers : [];
  }

  _save(list) {
    atomicWrite(this.file, JSON.stringify({ version: 1, servers: list }, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.file, 0o600); } catch { /* */ }
  }

  /** 비밀번호 포함(실행기 전용 — API 로 내보내지 말 것). */
  getSecret(id) { return this._load().find((s) => s.id === id) || null; }

  list() { return this._load().map(publicView); }

  get(id) { const s = this.getSecret(id); return s ? publicView(s) : null; }

  /** 입력 검증 + 정규화. 비밀번호 승계 규칙은 여기서 판정한다. */
  _normalize(input, prev = null) {
    const name = str(input.name, 80) || str(input.host, 80);
    const role = ROLES.includes(input.role) ? input.role : 'smc';
    const host = str(input.host, 255);
    const port = input.port === '' || input.port == null ? '' : String(Number(input.port));
    const t = parseTarget(host, port || undefined);   // 형식 오류면 throw
    if (t.protocol === 'http:' && !t.loopback) throw new Error('http:// 는 로컬 목 서버(127.0.0.1)에만 쓸 수 있습니다 — 실장비는 https(기본)로 등록하세요');
    if (port && !(Number(port) >= 1 && Number(port) <= 65535)) throw new Error('포트는 1~65535');
    const username = str(input.username, 64);
    if (!username) throw new Error('BMC 사용자가 비었습니다');
    const ipmiIn = input.ipmi || {};
    const sameCreds = ipmiIn.sameCreds !== false;
    const ipmiUser = sameCreds ? '' : str(ipmiIn.username, 64);
    const cipher = /^\d{1,2}$/.test(String(ipmiIn.cipher ?? '')) ? String(ipmiIn.cipher) : '';
    // 비밀번호: 새 값이 오면 그것, 아니면 '같은 상대' 일 때만 이전 값을 승계
    const same = prev && prev.host === host && String(prev.port || '') === port && prev.username === username;
    let password = typeof input.password === 'string' && input.password !== '' ? input.password : (same ? prev.password : '');
    if (!password) throw new Error(prev ? '주소·포트·사용자를 바꾸면 비밀번호를 다시 입력해야 합니다' : '비밀번호가 비었습니다');
    if (password.length > 256) throw new Error('비밀번호가 너무 깁니다');
    let ipmiPassword = '';
    if (!sameCreds) {
      const ipmiSame = prev && prev.host === host && prev.ipmi?.sameCreds === false && prev.ipmi?.username === ipmiUser;
      ipmiPassword = typeof ipmiIn.password === 'string' && ipmiIn.password !== '' ? ipmiIn.password : (ipmiSame ? prev.ipmi?.password || '' : '');
      if (!ipmiUser || !ipmiPassword) throw new Error('IPMI 계정을 따로 쓰면 IPMI 사용자·비밀번호가 필요합니다');
    }
    return {
      name, role, host, port, username, password, insecure: input.insecure !== false,
      ipmi: { enabled: ipmiIn.enabled !== false, sameCreds, username: ipmiUser, password: ipmiPassword, cipher },
      note: str(input.note, 300),
    };
  }

  create(input) {
    const list = this._load();
    if (list.length >= MAX_SERVERS) throw new Error(`서버는 최대 ${MAX_SERVERS}대까지 등록합니다`);
    const rec = { id: crypto.randomBytes(6).toString('hex'), ...this._normalize(input), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    list.push(rec);
    this._save(list);
    return publicView(rec);
  }

  update(id, input) {
    const list = this._load();
    const i = list.findIndex((s) => s.id === id);
    if (i === -1) return null;
    const rec = { ...list[i], ...this._normalize(input, list[i]), updatedAt: new Date().toISOString() };
    list[i] = rec;
    this._save(list);
    return publicView(rec);
  }

  remove(id) {
    const list = this._load();
    const next = list.filter((s) => s.id !== id);
    if (next.length === list.length) return false;
    this._save(next);
    return true;
  }
}

/** API·화면용 — 비밀번호 제외. */
export function publicView(s) {
  return {
    id: s.id, name: s.name, role: s.role, host: s.host, port: s.port || '', username: s.username, hasPassword: !!s.password,
    insecure: s.insecure !== false, note: s.note || '',
    ipmi: { enabled: s.ipmi?.enabled !== false, sameCreds: s.ipmi?.sameCreds !== false, username: s.ipmi?.username || '', hasPassword: !!s.ipmi?.password, cipher: s.ipmi?.cipher || '' },
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}
