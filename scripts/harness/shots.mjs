#!/usr/bin/env node
/**
 * 화면 찍기 — `pnpm harness:shots`. 실제 앱 화면(src/main.tsx)을 IPC 목업 + 이 저장소의 실제 일지 · 계획으로
 * 그려 화면 × 밝게/어둡게 × 1280/760 × 빈 상태 · 영어 · 예외 · ⌘K 를 PNG 로 찍고, 찍은 직후 DOM 을 재서
 * (audit.js — 잘림 · 가로 넘침 · 작은 표적 · 채운 단추 · 대비) `_report.json` 에 남긴다.
 *
 * 사용: node scripts/harness/shots.mjs [--out <폴더>] [--only 05-diff,70-] [--port 1434] [--strict]
 *   --out     PNG · _report.json 을 쓸 폴더 (기본 scripts/harness/generated/shots)
 *   --only    이름 조각으로 일부만 (쉼표)
 *   --strict  예외 · 핸들러 없는 명령 · 못 찾은 단추가 하나라도 있으면 끝 코드 1
 *
 * 하는 일: ① 픽스처를 새로 뽑는다 ② dev 서버(포트 1434)가 없으면 띄운다 ③ 시스템 Chrome 하나를 headless 로 띄워
 * CDP(Node 내장 WebSocket)로 장마다 새 탭 ④ 끝나면 띄운 서버와 Chrome 을 내린다.
 * 설치본이 돌고 있어도 안전하다 — 프런트만 뜨고 앱 데이터 · 단일 인스턴스 소켓을 건드리지 않는다.
 * 앱 번들 · 송출과 무관한 개발 도구다(README 「앱에 닿지 않는다」).
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPlan } from "./plan.mjs";

const here = import.meta.dirname;
const root = path.resolve(here, "..", "..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);
const PORT = Number(arg("port", process.env.HARNESS_PORT ?? "1434"));
const outDir = path.resolve(arg("out", path.join(here, "generated", "shots")));
const only = arg("only", process.env.ONLY ?? "");
const base = `http://localhost:${PORT}/scripts/harness/harness.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    console.error("Chrome 을 못 찾았어요 — CHROME_PATH 에 실행 파일 경로를 줘요.");
    process.exit(1);
  }
  return found;
}

// ① 픽스처 — 지금의 저장소로 새로 뽑는다(커밋되는 픽스처는 없다).
execFileSync(process.execPath, [path.join(here, "fixtures.mjs")], { stdio: "inherit" });
const fx = JSON.parse(fs.readFileSync(path.join(here, "generated", "fixtures.json"), "utf8"));

// ② dev 서버 — 이미 떠 있으면(`pnpm harness`) 그대로 쓴다.
const up = async () => {
  try {
    return (await fetch(base)).ok;
  } catch {
    return false;
  }
};
let vite = null;
if (!(await up())) {
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
  vite = spawn(process.execPath, [viteBin, "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 100 && !(await up()); i++) await sleep(300);
  if (!(await up())) {
    vite.kill();
    console.error(`dev 서버(포트 ${PORT})가 안 떠요 — 포트가 쓰이고 있는지 봐요.`);
    process.exit(1);
  }
}

// ③ Chrome
const chromePort = 9333 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(process.env.CDP_TMP ?? os.tmpdir(), "cdp-prof-"));
const chrome = spawn(
  findChrome(),
  [
    "--headless=new", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${prof}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars=false", "--force-color-profile=srgb", "about:blank",
  ],
  { stdio: "ignore", env: { ...process.env, TZ: "Asia/Seoul" } },
);

async function json(u, method = "GET") {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(u, { method });
      return await r.json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error("chrome not reachable");
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    } else if (d.method) events.push(d);
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ready, send, events, close: () => ws.close() };
}

async function evaluate(c, expr) {
  const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
  return r.result?.result?.value;
}

const report = [];
let failed = false;
try {
  await json(`http://127.0.0.1:${chromePort}/json/version`);
  const plan = buildPlan({ fx, outDir, base, only });
  fs.mkdirSync(outDir, { recursive: true });
  // 방금 띄운 서버의 첫 로드는 Vite 가 의존성을 묶느라 모듈을 못 받아 첫 장이 예외로 찍힌다 — 한 번 데워 둔다.
  if (vite) {
    const warm = await json(`http://127.0.0.1:${chromePort}/json/new?about:blank`, "PUT");
    const wc = client(warm.webSocketDebuggerUrl);
    await wc.ready;
    await wc.send("Page.enable");
    await wc.send("Page.navigate", { url: base });
    await sleep(9000);
    wc.close();
    await fetch(`http://127.0.0.1:${chromePort}/json/close/${warm.id}`).catch(() => {});
  }
  for (const s of plan.shots) {
    const tab = await json(`http://127.0.0.1:${chromePort}/json/new?about:blank`, "PUT");
    const c = client(tab.webSocketDebuggerUrl);
    await c.ready;
    await c.send("Runtime.enable");
    await c.send("Page.enable");
    await c.send("Log.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: s.w ?? 1280, height: s.h ?? 800, deviceScaleFactor: 1, mobile: false });
    if (s.dark !== undefined) await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: s.dark ? "dark" : "light" }] });
    const url = `${plan.base}?${s.q ?? ""}`;
    await c.send("Page.navigate", { url });
    await sleep(s.load ?? 2500);
    const out = { name: s.name, url, steps: [] };
    for (const st of s.steps ?? []) {
      if (typeof st === "object" && st.wait) { await sleep(st.wait); continue; }
      if (typeof st === "object" && st.key) {
        for (const type of ["keyDown", "keyUp"]) {
          await c.send("Input.dispatchKeyEvent", { type, key: st.key, code: st.code ?? st.key, windowsVirtualKeyCode: st.vk ?? 0, modifiers: st.mod ?? 0 });
        }
        await sleep(250);
        continue;
      }
      out.steps.push(await evaluate(c, st));
      await sleep(500);
    }
    await sleep(s.settle ?? 700);
    if (s.dump) out.dump = await evaluate(c, s.dump);
    out.ipcMissing = await evaluate(c, "JSON.stringify(window.__ipcMissing||{})");
    out.ipcErrors = await evaluate(c, "JSON.stringify(window.__ipcErrors||[])");
    out.exceptions = c.events
      .filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => e.params.exceptionDetails.exception?.description?.slice(0, 300) ?? e.params.exceptionDetails.text);
    out.consoleErrors = c.events
      .filter((e) => e.method === "Runtime.consoleAPICalled" && e.params.type === "error")
      .map((e) => e.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300))
      .slice(0, 8);
    out.stepFailures = out.steps.filter((x) => x === "no-button" || (x && typeof x === "object" && x.error));
    const shot = await c.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, `${s.name}.png`), Buffer.from(shot.result.data, "base64"));
    report.push(out);
    c.close();
    await fetch(`http://127.0.0.1:${chromePort}/json/close/${tab.id}`).catch(() => {});
  }
  fs.writeFileSync(path.join(outDir, "_report.json"), JSON.stringify(report, null, 2));
} catch (e) {
  failed = true;
  console.error(String(e?.stack ?? e));
} finally {
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  vite?.kill();
  await sleep(500);
  try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 임시 프로필 — 못 지워도 다음 실행이 새로 만든다 */ }
}

// 한눈에 — 문제 있는 장만 적는다(예외만 보여 준다).
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
let problems = 0;
for (const r of report) {
  const missing = Object.keys(parse(r.ipcMissing) ?? {});
  const errs = parse(r.ipcErrors) ?? [];
  const bad = [
    r.exceptions.length ? `예외 ${r.exceptions.length}` : "",
    missing.length ? `핸들러 없음 ${missing.join(",")}` : "",
    errs.length ? `IPC 오류 ${errs.length}` : "",
    r.stepFailures.length ? "단추 못 찾음" : "",
  ].filter(Boolean);
  if (bad.length) { problems += 1; console.log(`  ! ${r.name}: ${bad.join(" · ")}`); }
}
console.log(`shots=${report.length} 문제 있는 장=${problems} → ${outDir}`);
if (failed || report.length === 0 || (flag("strict") && problems > 0)) process.exit(1);
