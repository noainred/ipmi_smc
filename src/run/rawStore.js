/**
 * 원본 응답 저장 — out/<서버>/<실행>/raw/<경로>__<해시>.json. 나중에 The.DVC 테스트 픽스처로 옮길 재료다.
 * 비밀 키는 가리고(mask.js), 헤더(토큰)는 저장하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeFileName } from '../util/fsx.js';
import { maskSecrets } from '../util/mask.js';

export class RawStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.count = 0;
  }

  /** @param {{path:string,status:number,ms:number,bytes:number,json?:object,text?:string,error?:string}} r */
  save(r) {
    const file = safeFileName(r.path);
    const rec = {
      path: r.path, status: r.status, ms: r.ms, bytes: r.bytes, error: r.error || undefined, savedAt: new Date().toISOString(),
      body: r.json ? maskSecrets(r.json) : String(r.text || '').slice(0, 200_000),
    };
    try {
      fs.writeFileSync(path.join(this.dir, file), JSON.stringify(rec, null, 1));
      this.count += 1;
    } catch { return ''; }
    return file;
  }
}
