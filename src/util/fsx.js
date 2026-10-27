import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 원자적 쓰기 — 임시 파일에 쓰고 rename. 쓰다 끊겨도 원본이 반쯤 덮이지 않는다. */
export function atomicWrite(file, data, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, mode != null ? { mode } : undefined);
  if (mode != null) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

/** JSON 읽기 — 없으면 fallback. 깨졌으면 `<file>.corrupt.<ts>` 로 보존하고 fallback(다음 저장이 원본을 지우지 않게). */
export function readJson(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
  try { return JSON.parse(text); } catch {
    try { fs.renameSync(file, `${file}.corrupt.${Date.now()}`); } catch { /* 보존 실패는 무시 */ }
    return fallback;
  }
}

/** URL 경로 → 안전한 파일 이름(경로 조작 불가 — 해시 접미). */
export function safeFileName(p, ext = '.json') {
  const base = String(p).replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'root';
  const h = crypto.createHash('sha1').update(String(p)).digest('hex').slice(0, 8);
  return `${base}__${h}${ext}`;
}

/** 실행 id(시각 기반, 파일 이름 안전). */
export function runStamp(d = new Date()) {
  const z = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
