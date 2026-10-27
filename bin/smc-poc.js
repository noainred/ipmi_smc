#!/usr/bin/env node
/**
 * CLI — 웹 화면 없이 같은 실행기를 돌린다(결과는 웹 화면과 같은 out/ 폴더 형식).
 *
 *   SMC_PASS='…' node bin/smc-poc.js --host 10.10.2.31 --user ADMIN [--role smc|dell|other] [--no-ipmi] [--no-crawl] [--strict-tls]
 *   node bin/smc-poc.js --targets targets.json      # [{ "name","host","username","passwordEnv","role" }]
 *
 * 비밀번호는 명령줄 인자로 받지 않는다(ps·셸 기록에 남는다) — 환경변수 이름으로만 받는다(--pass-env, 기본 SMC_PASS).
 */
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runServer } from '../src/run/runner.js';
import { buildCompare } from '../src/report/compare.js';
import { toMarkdown } from '../src/report/markdown.js';
import { paths } from '../src/config.js';

const HELP = `사용법:
  SMC_PASS='비밀번호' node bin/smc-poc.js --host <BMC 주소> --user <사용자> [옵션]
  node bin/smc-poc.js --targets <targets.json>

옵션:
  --host <주소>        BMC IP·호스트(https 기본, :포트 가능)
  --user <사용자>      BMC 사용자
  --pass-env <이름>    비밀번호를 담은 환경변수 이름(기본 SMC_PASS)
  --name <이름>        결과에 쓸 이름(기본 주소)
  --role <역할>        smc | dell | other (기본 smc)
  --targets <파일>     여러 대: [{"name","host","username","passwordEnv","role","port"}]
  --no-ipmi            IPMI(ipmitool) 단계를 건너뜀
  --no-crawl           전체 Redfish 탐색을 건너뜀
  --crawl-max <n>      전체 탐색 자원 상한(기본 2000)
  --strict-tls         BMC 인증서를 검증(기본은 확인 안 함 — 자체서명 BMC)
  --out <폴더>         결과 폴더(기본 ./out)
  -h, --help`;

let args;
try {
  args = parseArgs({
    options: {
      host: { type: 'string' }, user: { type: 'string' }, 'pass-env': { type: 'string', default: 'SMC_PASS' }, name: { type: 'string' },
      role: { type: 'string', default: 'smc' }, targets: { type: 'string' }, 'no-ipmi': { type: 'boolean' }, 'no-crawl': { type: 'boolean' },
      'crawl-max': { type: 'string' }, 'strict-tls': { type: 'boolean' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  }).values;
} catch (e) { console.error(String(e.message || e)); console.error(HELP); process.exit(2); }
if (args.help || (!args.host && !args.targets)) { console.log(HELP); process.exit(args.help ? 0 : 2); }

const outDir = path.resolve(args.out || paths().outDir);
const idOf = (s) => crypto.createHash('sha1').update(`${s.host}|${s.username}`).digest('hex').slice(0, 12);
let targets;
if (args.targets) {
  const list = JSON.parse(fs.readFileSync(args.targets, 'utf8'));
  targets = list.map((t) => ({ ...t, passwordEnv: t.passwordEnv || args['pass-env'] }));
} else {
  targets = [{ name: args.name || args.host, host: args.host, username: args.user, passwordEnv: args['pass-env'], role: args.role }];
}

const entries = [];
for (const t of targets) {
  const password = process.env[t.passwordEnv || 'SMC_PASS'] || '';
  if (!t.username || !password) { console.error(`✕ ${t.name || t.host}: 사용자 또는 비밀번호(환경변수 ${t.passwordEnv || 'SMC_PASS'})가 비었습니다`); continue; }
  const server = { id: idOf(t), name: t.name || t.host, role: ['smc', 'dell', 'other'].includes(t.role) ? t.role : 'smc', host: t.host, port: t.port || '', username: t.username, password, insecure: !args['strict-tls'], ipmi: { enabled: !args['no-ipmi'], sameCreds: true } };
  console.log(`\n▶ ${server.name} (${server.host})`);
  const r = await runServer(server, {
    outDir, options: { crawl: !args['no-crawl'], ipmi: !args['no-ipmi'], crawlMax: Number(args['crawl-max']) || undefined },
    onEvent: (e) => { if (e.type === 'step' && (e.state === 'done' || e.state === 'fail' || e.state === 'skip')) console.log(`  ${e.state === 'done' ? '✓' : e.state === 'fail' ? '✕' : '·'} ${e.key}${e.detail ? ` — ${e.detail}` : ''}`); },
  });
  const s = r.summary;
  console.log(`  지원 ${s.counts.ok}/${s.total} · 부분 ${s.counts.partial} · 라이선스? ${s.counts.license} · 없음 ${s.counts.absent} · 오류 ${s.counts.error} · 인증 ${s.authMode || (s.authFailed ? '실패' : '—')}`);
  console.log(`  The.DVC 가정: 깨짐 ${s.assumptions.break} · 확인 ${s.assumptions.check} · 정상 ${s.assumptions.ok} · 미확인 ${s.assumptions.unknown}`);
  entries.push({ server: { id: server.id, name: server.name, role: server.role, host: server.host }, result: r });
}
if (entries.length) {
  const md = toMarkdown(buildCompare(entries));
  const file = path.join(outDir, `report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, md);
  console.log(`\n요약: ${file}\n원본·결과: ${outDir}/<서버 id>/<실행>/`);
}
