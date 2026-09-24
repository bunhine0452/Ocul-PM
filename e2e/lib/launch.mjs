// 앱을 WebDriver 세션에 붙이는 두 길.
//
// 1. launch — tauri-driver 에게 `tauri:options.application` 을 주면 네이티브 드라이버
//    (WebKitWebDriver · msedgedriver)가 앱을 띄우고 붙는다. 기본 경로다.
// 2. attach (Windows 전용 폴백) — msedgedriver 가 WebView2 앱을 띄운 뒤
//    `DevToolsActivePort file doesn't exist` 로 붙지 못하면, 하네스가 앱을
//    `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p>` 로 직접 띄우고
//    msedgedriver 를 그 포트에 붙인다(`ms:edgeOptions.debuggerAddress`, Microsoft 가
//    문서화한 WebView2 붙기 방식). CDP 주소가 손에 남아 IME 흉내(#w3-ime-cdp)도 쓴다.

import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IDENTIFIER, IS_WIN } from "./env.mjs";
import { sleep } from "./page.mjs";

/** wry 가 WebView2 에 기본으로 주는 인자 — 환경변수가 옵션을 대신하면 사라지므로 되싣는다. */
const WRY_DEFAULT_ARGS = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/** msedgedriver 를 자세한 로그와 함께 띄우는 .cmd 래퍼 — 붙기 실패의 원인을 남긴다. */
export function verboseDriverWrapper(nativeDriver, dir, logPath) {
  if (!IS_WIN || !nativeDriver) return nativeDriver;
  const wrapper = join(dir, "msedgedriver-verbose.cmd");
  writeFileSync(wrapper, `@"${nativeDriver}" %* --verbose --log-path="${logPath}"\r\n`);
  return wrapper;
}

/** DevToolsActivePort 가 어디 생겼는지 — 드라이버가 기대한 자리와 비교하려고. */
function findDevToolsPort() {
  const roots = [join(process.env.LOCALAPPDATA ?? "", IDENTIFIER), process.env.TEMP ?? ""].filter(Boolean);
  const hits = [];
  const walk = (dir, depth) => {
    if (depth < 0 || hits.length > 10) return;
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      if (name === "DevToolsActivePort") hits.push(`${p} (${statSync(p).mtime.toISOString()})`);
      else if (!name.includes(".")) {
        try {
          if (statSync(p).isDirectory()) walk(p, depth - 1);
        } catch {
          /* 권한 */
        }
      }
    }
  };
  for (const r of roots) walk(r, 3);
  return hits.length ? hits : ["DevToolsActivePort 파일 없음"];
}

function killApp() {
  try {
    execFileSync("taskkill", ["/F", "/T", "/IM", "ocul-pm.exe"], { stdio: "pipe" });
  } catch {
    /* 떠 있는 것이 없다 */
  }
}

async function attach({ wd, app, env, cwd, logFile, port, rec }) {
  killApp(); // 단일 인스턴스 플러그인 — 앞 시도의 앱이 살아 있으면 새 실행이 곧장 끝난다.
  await sleep(1500);
  const fd = openSync(logFile, "a");
  const child = spawn(app, [], {
    cwd,
    env: { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `${WRY_DEFAULT_ARGS} --remote-debugging-port=${port}` },
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  const address = `127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const v = await (await fetch(`http://${address}/json/version`, { signal: AbortSignal.timeout(2_000) })).json();
      rec.notes.push(`CDP 포트 열림: ${v.Browser ?? "?"}`);
      break;
    } catch (e) {
      if (child.exitCode != null) throw new Error(`앱이 곧바로 끝났다 (exit ${child.exitCode})`, { cause: e });
      if (Date.now() > deadline) throw new Error(`CDP 포트 ${port} 가 90초 안에 안 열렸다`, { cause: e });
      await sleep(500);
    }
  }
  await wd.newSession({ browserName: "webview2", "ms:edgeOptions": { debuggerAddress: address } });
  return {
    mode: "attach",
    debuggerAddress: address,
    stop: () => killApp(),
  };
}

/**
 * 세션을 연다. 돌려준 `stop()` 은 세션을 지운 뒤 부른다(attach 모드는 앱을 하네스가
 * 띄웠으므로 하네스가 끈다).
 */
export async function connectApp({ wd, app, ws, outDir, rec }) {
  try {
    await wd.newSession({ "tauri:options": { application: app } });
    rec.notes.push("세션: launch (네이티브 드라이버가 앱을 띄움)");
    return { mode: "launch", debuggerAddress: null, stop: () => {} };
  } catch (e) {
    if (!IS_WIN || !/DevToolsActivePort/.test(e.message)) throw e;
    rec.notes.push(`launch 실패: ${e.message.slice(0, 200)}`, ...findDevToolsPort().map((h) => `DevToolsActivePort: ${h}`));
  }
  const s = await attach({
    wd,
    app,
    env: ws.env,
    cwd: ws.dirs.driverCwd,
    logFile: join(outDir, "app-stdout.log"),
    port: 9222,
    rec,
  });
  rec.notes.push(`세션: attach (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 로 CDP ${s.debuggerAddress})`);
  return s;
}
