#!/usr/bin/env node
// 앱 아이콘 변형 PNG 를 굽는다 (11-04) — `src/features/settings/appIconArt.ts` 의 색 벌로.
//
//   node scripts/build-app-icons.mjs
//
// 결과: src-tauri/icons/variants/<id>.png (512×512, 투명 여백 — 번들 icon.png 와 같은 자리). 기본(color)은
// 번들 아이콘 그대로라 굽지 않는다. 헤드리스 Chrome 으로 그린다(macOS 경로) — CI 는 돌리지 않고, 결과 PNG 를
// 커밋한다. 색을 바꿨을 때만 다시 돌린다. Node 22.6+ (TS 타입 지우기)가 필요하다.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_ICON_IDS, appIconSvg } from "../src/features/settings/appIconArt.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons", "variants");
mkdirSync(outDir, { recursive: true });

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9336;
const profile = mkdtempSync(join(tmpdir(), "ocul-icons-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 80 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    ws = list.find((x) => x.type === "page")?.webSocketDebuggerUrl;
  } catch {
    /* 아직 안 떴다 */
  }
  if (!ws) await sleep(250);
}
if (!ws) throw new Error("헤드리스 Chrome 에 붙지 못했다 — CHROME 경로를 확인할 것");

const sock = new WebSocket(ws);
await new Promise((r) => sock.addEventListener("open", r));
let seq = 0;
const pending = new Map();
sock.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    sock.send(JSON.stringify({ id, method, params }));
  });

const SIZE = 512;
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

for (const id of APP_ICON_IDS) {
  if (id === "color") continue;
  const html = `<html><body style="margin:0;background:transparent">${appIconSvg(id, id, SIZE)}</body></html>`;
  await send("Page.navigate", { url: "data:text/html;base64," + Buffer.from(html).toString("base64") });
  await sleep(700);
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: SIZE, height: SIZE, scale: 1 } });
  writeFileSync(join(outDir, `${id}.png`), Buffer.from(shot.data, "base64"));
  console.log(`✓ ${id}.png`);
}
sock.close();
chrome.kill();
