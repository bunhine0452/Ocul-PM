// 결과 기록 — 단계 표 · 스크린샷 · 한 장짜리 목록(index.html) · 잡 요약(summary.md).
//
// 사용자는 Windows·Linux 기기가 없다. 이 폴더가 **그 OS 에서 앱이 어떻게 보이는지
// 보는 유일한 창구**라서, 파일 이름만 봐도 OS·단계·화면이 드러나게 짓는다:
//   `031-windows-ko-1440-07-terminal.png`

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ICON = { pass: "✅", fail: "❌", skip: "⏭️", running: "…" };

export class Report {
  constructor({ outDir, os, meta }) {
    this.outDir = outDir;
    this.os = os;
    this.meta = meta;
    this.steps = [];
    this.shots = [];
    this.seq = 0;
    this.aborted = null;
    this.current = null;
    mkdirSync(outDir, { recursive: true });
  }

  /**
   * 단계 하나. `critical` 이 실패하면 뒤 단계는 건너뛴다(앱이 그 상태로는 못 간다).
   * `always` 는 그래도 돈다 — 로그 수거·격리 검사처럼 실패의 증거를 모으는 단계.
   */
  async step(name, fn, { critical = false, always = false } = {}) {
    const rec = { name, status: "running", ms: 0, notes: [], error: null, critical };
    this.steps.push(rec);
    if (this.aborted && !always) {
      rec.status = "skip";
      rec.error = `앞 단계 실패로 건너뜀: ${this.aborted}`;
      console.log(`⏭️  ${name}`);
      return rec;
    }
    this.current = rec;
    const started = Date.now();
    console.log(`▶  ${name}`);
    try {
      await fn(rec);
      if (rec.status === "running") rec.status = "pass";
    } catch (e) {
      rec.status = "fail";
      rec.error = e?.message ?? String(e);
      if (critical) this.aborted = name;
    }
    rec.ms = Date.now() - started;
    this.current = null;
    console.log(`${ICON[rec.status]} ${name} (${(rec.ms / 1000).toFixed(1)}s)${rec.error ? ` — ${rec.error}` : ""}`);
    for (const n of rec.notes) console.log(`     · ${n}`);
    return rec;
  }

  /** 스크린샷 한 장. 실패해도 단계를 죽이지 않는다 — 기록만 한다. */
  async shot(wd, { phase, key, screen, caption, ok = true, state = null }) {
    const seq = String(++this.seq).padStart(3, "0");
    const file = `${seq}-${this.os}-${slug(key)}-${slug(screen)}.png`;
    const entry = { seq, file, phase, screen, caption, ok, state, step: this.current?.name ?? null, error: null };
    try {
      writeFileSync(join(this.outDir, file), await wd.screenshot());
    } catch (e) {
      entry.file = null;
      entry.error = `스크린샷 실패: ${e.message}`;
    }
    this.shots.push(entry);
    return entry;
  }

  failed() {
    return this.steps.filter((s) => s.status === "fail");
  }

  finish(extra = {}) {
    const data = { os: this.os, meta: this.meta, ...extra, steps: this.steps, shots: this.shots };
    writeFileSync(join(this.outDir, "results.json"), JSON.stringify(data, null, 2));
    writeFileSync(join(this.outDir, "index.html"), this.html(extra));
    writeFileSync(join(this.outDir, "summary.md"), this.markdown(extra));
    return this.failed().length;
  }

  markdown(extra) {
    const rows = this.steps.map(
      (s) => `| ${ICON[s.status]} | ${s.name} | ${(s.ms / 1000).toFixed(1)}s | ${(s.error ?? s.notes.join(" · ")).replace(/\|/g, "\\|").slice(0, 400)} |`,
    );
    const bad = this.shots.filter((s) => !s.ok).map((s) => `- ❌ \`${s.file ?? s.seq}\` ${s.caption}`);
    return [
      `## E2E — ${this.os}`,
      "",
      `스크린샷 ${this.shots.length}장 · 아티팩트 \`e2e-${this.os}\` 의 \`index.html\` 을 열 것.`,
      "",
      "| | 단계 | 시간 | 비고 |",
      "|---|---|---|---|",
      ...rows,
      "",
      ...(bad.length ? ["문제가 보인 화면:", "", ...bad, ""] : []),
      ...(extra.logCrashes?.length ? ["앱 로그의 크래시 줄:", "", "```", ...extra.logCrashes.slice(0, 30), "```", ""] : []),
    ].join("\n");
  }

  html(extra) {
    const meta = Object.entries({ ...this.meta, ...(extra.env ?? {}) })
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === "string" ? v : JSON.stringify(v))}</td></tr>`)
      .join("");
    const steps = this.steps
      .map(
        (s) =>
          `<tr class="${s.status}"><td>${ICON[s.status]}</td><td>${esc(s.name)}</td><td>${(s.ms / 1000).toFixed(1)}s</td>` +
          `<td>${esc(s.error ?? "")}${s.notes.length ? `<ul>${s.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</td></tr>`,
      )
      .join("");
    const phases = [...new Set(this.shots.map((s) => s.phase))];
    const sections = phases
      .map((phase) => {
        const cards = this.shots
          .filter((s) => s.phase === phase)
          .map((s) => {
            const st = s.state;
            const facts = [
              st?.inner ? `${st.inner[0]}×${st.inner[1]}` : null,
              ...(st?.crashes ?? []).map((c) => `에러 경계: ${c}`),
              ...(st?.toasts ?? []).map((t) => `토스트: ${t}`),
              ...(st?.errors ?? []).map((e) => `페이지 오류: ${e}`),
              s.error,
            ].filter(Boolean);
            const img = s.file
              ? `<a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt="${esc(s.caption)}"></a>`
              : `<div class="noimg">스크린샷 없음</div>`;
            return `<figure class="${s.ok ? "ok" : "bad"}">${img}<figcaption><b>#${s.seq} ${esc(s.caption)}</b>` +
              `<code>${esc(s.file ?? "")}</code>${facts.map((f) => `<small>${esc(f)}</small>`).join("")}</figcaption></figure>`;
          })
          .join("");
        return `<h2 id="p${phases.indexOf(phase)}">${esc(phase)}</h2><div class="grid">${cards}</div>`;
      })
      .join("");
    const badCount = (phase) => this.shots.filter((s) => s.phase === phase && !s.ok).length;
    const toc = phases
      .map((p, i) => `<a href="#p${i}">${esc(p)}${badCount(p) ? ` <b class="badn">✕${badCount(p)}</b>` : ""}</a>`)
      .join("");
    const crashes = extra.logCrashes?.length ? `<h2>앱 로그의 크래시 줄</h2><pre>${esc(extra.logCrashes.join("\n"))}</pre>` : "";
    const logs = (extra.logs ?? []).map((f) => `<li><a href="${esc(f)}">${esc(f)}</a></li>`).join("");
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ocul-PM E2E — ${esc(this.os)}</title><style>
:root{--bg:#f7f7f5;--fg:#1b1d1c;--mute:#6b706d;--card:#fff;--line:#e3e4e1;--ok:#12a06b;--bad:#d4493a}
@media (prefers-color-scheme:dark){:root{--bg:#161817;--fg:#e8e9e7;--mute:#9a9f9c;--card:#1f2221;--line:#2e3230}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif}
main{max-width:1400px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
table{border-collapse:collapse;width:100%;background:var(--card)}td,th{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
tr.fail td{color:var(--bad)}th{color:var(--mute);font-weight:500;white-space:nowrap}ul{margin:4px 0 0;padding-left:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-top:3px solid var(--ok);border-radius:6px;overflow:hidden}
figure.bad{border-top-color:var(--bad)}figure img{display:block;width:100%;height:auto;border-bottom:1px solid var(--line)}
figcaption{padding:8px 10px;display:flex;flex-direction:column;gap:3px}figcaption code{color:var(--mute);font-size:11px;overflow-wrap:anywhere}
figcaption small{color:var(--mute);overflow-wrap:anywhere}figure.bad small{color:var(--bad)}.noimg{padding:40px;text-align:center;color:var(--mute)}
pre{background:var(--card);border:1px solid var(--line);padding:10px;overflow:auto;font-size:12px}
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.toc a{padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--fg);text-decoration:none;font-size:13px}
.badn{color:var(--bad)}
</style></head><body><main>
<h1>Ocul-PM E2E — ${esc(this.os)}</h1><p style="color:var(--mute)">실기기 대신 CI 러너에서 실제 앱을 띄워 찍은 화면. 초록 테두리 = 판정 통과, 빨강 = 문제.</p>
<nav class="toc">${toc}</nav>
<h2>환경</h2><table>${meta}</table><h2>단계</h2><table>${steps}</table>${sections}${crashes}
<h2>로그</h2><ul>${logs}</ul></main></body></html>`;
  }
}
