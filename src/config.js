import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 저장 위치 — env 로 바꿀 수 있다(테스트는 임시 폴더를 준다). */
export function paths() {
  const dataDir = process.env.SMC_POC_DATA_DIR ? path.resolve(process.env.SMC_POC_DATA_DIR) : path.join(ROOT, 'data');
  const outDir = process.env.SMC_POC_OUT_DIR ? path.resolve(process.env.SMC_POC_OUT_DIR) : path.join(ROOT, 'out');
  return { root: ROOT, dataDir, outDir, webDir: path.join(ROOT, 'web'), serversFile: path.join(dataDir, 'servers.json') };
}

/** 수집 기본값. 한 BMC 에 동시에 보내는 요청은 작게 둔다(BMC 는 약하다 — The.DVC 도 3). */
export const DEFAULTS = Object.freeze({
  requestTimeoutMs: 20_000,
  crawlMaxResources: 2000,
  crawlBudgetMs: 5 * 60_000,
  crawlConcurrency: 2,
  collectionMemberCap: 64,
  sensorMemberCap: 300,
  ipmiTimeoutMs: 60_000,
  port: 8710,
});
