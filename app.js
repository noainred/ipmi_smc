#!/usr/bin/env node
/**
 * SMC BMC PoC — 로컬 웹 화면 실행.
 *   node app.js            → http://127.0.0.1:8710/ (macOS 는 브라우저를 자동으로 연다)
 *   PORT=9000 node app.js  → 포트 지정 · SMC_POC_NO_OPEN=1 → 브라우저 자동 열기 끔
 */
import { spawn } from 'node:child_process';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Node.js ${process.versions.node} 은 너무 오래되었습니다 — Node 20 이상(권장 22 LTS)을 설치하세요. https://nodejs.org`);
  process.exit(1);
}

const { startServer } = await import('./src/web/server.js');
const { paths } = await import('./src/config.js');

const { server, url, app } = await startServer({ port: Number(process.env.PORT) || undefined });
const p = paths();
console.log('');
console.log('  SMC BMC PoC 가 실행 중입니다');
console.log(`  화면:      ${url}`);
console.log(`  등록 서버: ${p.serversFile}  (비밀번호 포함 — 권한 600)`);
console.log(`  결과:      ${p.outDir}`);
console.log('  종료:      이 창에서 Ctrl+C');
console.log('');
if (process.platform === 'darwin' && !process.env.SMC_POC_NO_OPEN) {
  try { spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* 주소를 직접 여세요 */ }
}

const stop = () => {
  app.jobs.cancel();
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
