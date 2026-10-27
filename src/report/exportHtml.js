/**
 * 단일 HTML 내보내기 — 웹 화면(같은 app.js·style.css)에 결과 데이터를 넣어 한 파일로 만든다.
 * 서버 없이 브라우저로 열어 보고, 메일·메신저로 공유할 수 있다(원본 응답 본문은 넣지 않는다 — raw 폴더 참고).
 */
import fs from 'node:fs';
import path from 'node:path';

/** <script> 안에 넣을 JSON — '</script' 와 줄 구분 문자가 문서를 깨지 않게. */
export function scriptSafeJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** 결과에서 내보내기에 필요 없는 큰 조각을 덜어 낸다. */
export function slimResult(r) {
  if (!r) return r;
  const out = { ...r };
  if (out.crawl) out.crawl = { ...out.crawl, index: (out.crawl.index || []).map(({ file, ...x }) => x) };
  if (out.ipmi?.commands) out.ipmi = { ...out.ipmi, commands: out.ipmi.commands.map((c) => ({ ...c, stdout: String(c.stdout || '').slice(0, 60_000) })) };
  return out;
}

export function buildExportHtml({ webDir, compare, results, servers }) {
  const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(webDir, 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
  const data = { exportedAt: new Date().toISOString(), compare, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, slimResult(v)])), servers };
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  return html
    .replace(/<meta name="poc-token"[^>]*>/, '')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`)
    // 인라인 스크립트는 defer 가 듣지 않는다 — 본문이 다 그려진 뒤 돌도록 </body> 앞에 둔다.
    .replace('<script src="app.js" defer></script>', '')
    .replace('</body>', () => `<script>window.__POC_EXPORT__ = ${scriptSafeJson(data)};</script>\n<script>\n${safeJs}\n</script>\n</body>`);
}
