/**
 * 실행 작업 — 한 번에 하나(같은 BMC 에 동시 실행이 겹치지 않게), 서버는 순서대로.
 * 화면은 1초마다 상태를 받아 간다(폴링). 로그는 최근 300줄만 남긴다.
 */
import { runServer, STEPS } from './runner.js';

const LOG_MAX = 300;

export class JobRunner {
  constructor({ store, outDir }) {
    this.store = store;
    this.outDir = outDir;
    this.current = null;
    this.seq = 0;
  }

  busy() { return !!(this.current && this.current.status === 'running'); }

  /** @returns {object} 작업 상태(비밀 없음) */
  start(serverIds, options = {}) {
    if (this.busy()) throw Object.assign(new Error('이미 실행 중인 작업이 있습니다'), { status: 409 });
    const ids = [...new Set((serverIds || []).map(String))];
    const servers = ids.map((id) => this.store.getSecret(id)).filter(Boolean);
    if (!servers.length) throw Object.assign(new Error('실행할 서버를 고르세요'), { status: 400 });
    const ac = new AbortController();
    const job = {
      id: ++this.seq, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, options,
      servers: servers.map((s) => ({
        id: s.id, name: s.name, role: s.role, status: 'waiting', startedAt: null, finishedAt: null, summary: null,
        steps: STEPS.map((x) => ({ key: x.key, label: x.label, state: 'wait', detail: '', done: 0, total: 0 })),
      })),
      log: [],
      _ac: ac,
    };
    this.current = job;
    (async () => {
      for (let i = 0; i < servers.length; i++) {
        const s = servers[i];
        const view = job.servers[i];
        if (ac.signal.aborted) { view.status = 'canceled'; continue; }
        view.status = 'running';
        view.startedAt = new Date().toISOString();
        this._log(job, `▶ ${s.name} (${s.host}) 시작`);
        try {
          const r = await runServer(s, {
            outDir: this.outDir, options, signal: ac.signal,
            onEvent: (e) => {
              if (e.type === 'step') {
                const st = view.steps.find((x) => x.key === e.key);
                if (st) { st.state = e.state; if (e.detail) st.detail = String(e.detail).slice(0, 300); if (e.total != null) { st.done = e.done || 0; st.total = e.total; } }
                if (e.state === 'fail' || e.state === 'done') this._log(job, `  ${s.name} · ${st?.label || e.key} → ${e.state === 'done' ? '완료' : '실패'}${e.detail ? ` · ${e.detail}` : ''}`);
              } else if (e.type === 'request') {
                this._log(job, `  ${s.name} · ${e.line}`, true);
              }
            },
          });
          view.summary = r.summary;
          view.status = r.fatal ? 'failed' : (ac.signal.aborted ? 'canceled' : 'done');
          this._log(job, `■ ${s.name} ${view.status === 'done' ? '완료' : view.status} · 요청 ${r.summary.requests} · ${Math.round(r.durationMs / 1000)}초${r.fatal ? ` · ${r.fatal}` : ''}`);
        } catch (e) {
          view.status = 'failed';
          this._log(job, `✕ ${s.name} 실행 오류: ${String(e?.message || e).slice(0, 300)}`);
        }
        view.finishedAt = new Date().toISOString();
      }
      job.status = ac.signal.aborted ? 'canceled' : 'done';
      job.finishedAt = new Date().toISOString();
    })();
    return this.view();
  }

  cancel() {
    if (!this.busy()) return false;
    this.current._ac.abort();
    this._log(this.current, '취소 요청 — 진행 중인 요청이 끝나면 멈춥니다');
    return true;
  }

  _log(job, line, verbose = false) {
    job.log.push({ t: Date.now(), line: String(line).slice(0, 400), verbose });
    if (job.log.length > LOG_MAX) job.log.splice(0, job.log.length - LOG_MAX);
  }

  view() {
    if (!this.current) return null;
    const { _ac, ...rest } = this.current;
    return JSON.parse(JSON.stringify(rest));
  }
}
