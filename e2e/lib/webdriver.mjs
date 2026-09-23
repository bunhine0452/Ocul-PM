// 최소 W3C WebDriver 클라이언트 + tauri-driver 수명 관리 (의존성 0, Node 22+).
//
// 왜 WebdriverIO 가 아닌가: 이 하네스가 쓰는 명령은 열 개 남짓(세션·찾기·클릭·
// 키·스크립트·스크린샷·창 크기)이다. WebdriverIO 는 러너·리포터·프레임워크를
// 합쳐 수백 개 패키지를 lockfile 에 싣고, 그 버전 조합이 CI 에서 깨지면 그건
// 앱 결함이 아닌데도 사용자의 유일한 창구(스크린샷)가 닫힌다. W3C 프로토콜은
// JSON over HTTP 라 Node 내장 fetch 로 충분하다.

import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";

/** W3C 가 정한 웹 요소 참조 키. */
export const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

export class WebDriverError extends Error {
  constructor(code, message, status) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class WebDriver {
  constructor(baseUrl) {
    this.base = baseUrl;
    this.sid = null;
    this.capabilities = null;
  }

  async req(method, path, body, { timeoutMs = 120_000 } = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new WebDriverError("invalid response", `${res.status} ${text.slice(0, 300)}`, res.status);
    }
    const value = json?.value;
    if (!res.ok || (value && typeof value === "object" && "error" in value && value.error)) {
      throw new WebDriverError(value?.error ?? String(res.status), value?.message ?? text.slice(0, 300), res.status);
    }
    return value;
  }

  s(path) {
    return `/session/${this.sid}${path}`;
  }

  async newSession(alwaysMatch) {
    const v = await this.req("POST", "/session", { capabilities: { alwaysMatch } }, { timeoutMs: 180_000 });
    this.sid = v.sessionId;
    this.capabilities = v.capabilities ?? {};
    return v;
  }

  async deleteSession() {
    if (!this.sid) return;
    try {
      await this.req("DELETE", this.s(""), undefined, { timeoutMs: 30_000 });
    } finally {
      this.sid = null;
    }
  }

  setTimeouts(t) {
    return this.req("POST", this.s("/timeouts"), t);
  }

  execute(script, args = []) {
    return this.req("POST", this.s("/execute/sync"), { script, args });
  }

  executeAsync(script, args = []) {
    return this.req("POST", this.s("/execute/async"), { script, args });
  }

  async find(css) {
    const v = await this.req("POST", this.s("/element"), { using: "css selector", value: css });
    return v[ELEMENT_KEY];
  }

  click(elementId) {
    return this.req("POST", this.s(`/element/${elementId}/click`), {});
  }

  sendKeys(elementId, text) {
    return this.req("POST", this.s(`/element/${elementId}/value`), { text });
  }

  async screenshot() {
    return Buffer.from(await this.req("GET", this.s("/screenshot")), "base64");
  }

  getWindowRect() {
    return this.req("GET", this.s("/window/rect"));
  }

  setWindowRect(rect) {
    return this.req("POST", this.s("/window/rect"), rect);
  }
}

/** execute 가 돌려준 요소 참조에서 id 를 꺼낸다 (없으면 null). */
export function elementId(ref) {
  return ref && typeof ref === "object" ? (ref[ELEMENT_KEY] ?? null) : null;
}

/**
 * tauri-driver 를 띄우고 `/status` 가 응답할 때까지 기다린다.
 *
 * 출력은 파이프가 아니라 **파일**로 보낸다. 앱이 띄우는 PTY 호스트는 분리된
 * 손자 프로세스라, 파이프를 물려받으면 이 스크립트가 끝난 뒤에도 CI 단계의
 * 출력 스트림을 쥐고 놓지 않는다.
 */
export async function startTauriDriver({ bin, port, nativePort, nativeDriver, env, cwd, logFile }) {
  const args = ["--port", String(port), "--native-port", String(nativePort)];
  if (nativeDriver) args.push("--native-driver", nativeDriver);
  const fd = openSync(logFile, "a");
  const child = spawn(bin, args, { cwd, env, stdio: ["ignore", fd, fd], windowsHide: true });
  closeSync(fd);
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  child.on("error", (err) => {
    exited = { code: -1, signal: String(err) };
  });

  const wd = new WebDriver(`http://127.0.0.1:${port}`);
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error(`tauri-driver 가 곧바로 끝났다 (${JSON.stringify(exited)}) — ${logFile}`);
    try {
      await wd.req("GET", "/status", undefined, { timeoutMs: 3_000 });
      break;
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`tauri-driver /status 무응답 60초: ${e.message}`, { cause: e });
      await sleep(500);
    }
  }
  return {
    wd,
    child,
    stop() {
      if (exited) return;
      try {
        child.kill();
      } catch {
        /* 이미 끝났다 */
      }
    },
  };
}
