// Windows 한글 IME 흉내 (#w3-ime-cdp) — WebView2 의 DevTools 프로토콜(CDP)로
// 조합 이벤트를 만든다. 실제 입력기(MS 한국어 IME)는 러너가 못 띄우므로(D8)
// **조합 이벤트까지만** 실물과 같은 순서로 재현한다.
//
// CDP 에 닿는 길은 셋을 차례로 시도한다:
//   1. msedgedriver 의 벤더 확장 `POST /session/{id}/ms/cdp/execute`
//      (tauri-driver 는 새 세션 외의 요청을 그대로 넘긴다 — tauri-driver 2.0.6 server.rs)
//   2. Chromium 계열 이름 `goog/cdp/execute`
//   3. 알려진 CDP 주소로 웹소켓 직접 연결 — attach 모드(launch.mjs)가 연 포트,
//      세션 capabilities 의 `debuggerAddress`, `OCULPM_E2E_CDP_PORT` 순.

import { sleep } from "./page.mjs";

async function viaWebDriver(wd, vendor) {
  const call = (cmd, params = {}) => wd.req("POST", wd.s(`/${vendor}/cdp/execute`), { cmd, params });
  await call("Runtime.evaluate", { expression: "1 + 1" });
  return { via: `${vendor}/cdp/execute`, call, close() {} };
}

async function viaWebSocket(address) {
  const targets = await (await fetch(`http://${address}/json/list`, { signal: AbortSignal.timeout(5_000) })).json();
  const page = targets.find((t) => t.type === "page" && /tauri\.localhost|^tauri:/.test(t.url)) ?? targets.find((t) => t.type === "page");
  if (!page) throw new Error(`CDP 대상 페이지 없음 (${targets.length}개)`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP 웹소켓 연결 실패")), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    const p = msg.id != null ? pending.get(msg.id) : null;
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
    else p.resolve(msg.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { via: `websocket ${address} (${page.url})`, call, close: () => ws.close() };
}

/** CDP 연결 하나. 어느 길이 통했는지와 시도 기록을 함께 돌려준다. */
export async function connectCdp(wd, knownAddress = null) {
  const tried = [];
  for (const vendor of ["ms", "goog"]) {
    try {
      return { ...(await viaWebDriver(wd, vendor)), tried };
    } catch (e) {
      tried.push(`${vendor}/cdp/execute: ${e.message}`);
    }
  }
  const addresses = [
    knownAddress,
    wd.capabilities?.["ms:edgeOptions"]?.debuggerAddress,
    wd.capabilities?.["goog:chromeOptions"]?.debuggerAddress,
    process.env.OCULPM_E2E_CDP_PORT ? `127.0.0.1:${process.env.OCULPM_E2E_CDP_PORT}` : null,
  ].filter(Boolean);
  for (const address of addresses) {
    try {
      return { ...(await viaWebSocket(address)), tried };
    } catch (e) {
      tried.push(`websocket ${address}: ${e.message}`);
    }
  }
  throw new Error(`CDP 에 닿는 길이 없다 — ${tried.join(" | ")}`);
}

/**
 * MS 한국어 IME 가 Chromium 에 내는 순서 그대로 `한글` 을 조합한다.
 *
 * 실물: 조합 중 키는 전부 keydown(key="Process", keyCode=229) → 조합 갱신 →
 * keyup(실제 키). 다음 음절의 첫 자모가 오면 그 keydown 에서 앞 음절이 확정
 * (compositionend) 되고 새 조합이 시작된다. 마지막 음절은 조합 밖 키가
 * 확정한다 — 여기서는 `Input.insertText` 가 그 확정이다.
 */
export async function composeHangul(cdp, { gapMs = 40 } = {}) {
  const KEYS = { g: ["KeyG", 71], k: ["KeyK", 75], s: ["KeyS", 83], r: ["KeyR", 82], m: ["KeyM", 77], f: ["KeyF", 70] };
  const plan = [
    { key: "g", comp: "ㅎ" },
    { key: "k", comp: "하" },
    { key: "s", comp: "한" },
    { key: "r", commit: "한", comp: "ㄱ" },
    { key: "m", comp: "그" },
    { key: "f", comp: "글" },
  ];
  const trace = [];
  for (const p of plan) {
    const [code, vk] = KEYS[p.key];
    await cdp.call("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Process",
      code,
      windowsVirtualKeyCode: 229,
      nativeVirtualKeyCode: 229,
    });
    if (p.commit) {
      await cdp.call("Input.insertText", { text: p.commit });
      trace.push(`commit ${p.commit}`);
    }
    await cdp.call("Input.imeSetComposition", {
      text: p.comp,
      selectionStart: p.comp.length,
      selectionEnd: p.comp.length,
    });
    trace.push(`compose ${p.comp}`);
    await cdp.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: p.key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    });
    await sleep(gapMs);
  }
  await cdp.call("Input.insertText", { text: "글" });
  trace.push("commit 글");
  await sleep(gapMs * 3);
  return trace;
}
