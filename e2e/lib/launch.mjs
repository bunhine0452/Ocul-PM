// 앱을 WebDriver 세션에 붙이는 길.
//
// 1. launch — tauri-driver 에게 `tauri:options.application` 을 주면 네이티브 드라이버
//    (WebKitWebDriver · msedgedriver)가 앱을 띄우고 붙는다. 기본 경로다.
// 2. attach (Windows 전용 폴백) — msedgedriver 는 WebView2 에 원격 디버깅을 켜려고
//    `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=0` 을 싣는다. 그
//    인자가 WebView2 브라우저 프로세스에 닿지 않으면 `DevToolsActivePort file doesn't
//    exist` 로 끝난다. 그때 하네스가 앱을 직접 띄워 CDP 포트를 열고 msedgedriver 를
//    그 포트에 붙인다(`ms:edgeOptions.debuggerAddress`). 포트를 여는 수단을 차례로
//    시도한다 — 환경변수, 그다음 WebView2 정책 레지스트리(HKCU·HKLM, 앱 exe 이름 값).
//    각 시도마다 msedgewebview2 브라우저 프로세스의 명령줄을 증거로 남긴다.
//    CDP 주소가 손에 남아 IME 흉내(#w3-ime-cdp)도 쓴다.

import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IS_WIN } from "./env.mjs";
import { sleep } from "./page.mjs";

/** wry 가 WebView2 에 기본으로 주는 인자 — 환경변수가 옵션을 대신할 때를 위해 되싣는다. */
const WRY_DEFAULT_ARGS = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
// 사용자(HKCU)·기계(HKLM) 둘 다 — 러너는 관리자 권한으로 돈다. 권한 상승된 프로세스는
// 사용자가 쓸 수 있는 곳(환경변수·HKCU)의 재정의를 믿지 않을 수 있어서 HKLM 까지 본다.
const POLICY_KEYS = {
  "registry-hkcu": "HKCU\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments",
  "registry-hklm": "HKLM\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments",
};
const APP_EXE = "ocul-pm.exe";

/** msedgedriver 를 자세한 로그와 함께 띄우는 .cmd 래퍼 — 붙기 실패의 원인을 남긴다. */
export function verboseDriverWrapper(nativeDriver, dir, logPath) {
  if (!IS_WIN || !nativeDriver) return nativeDriver;
  const wrapper = join(dir, "msedgedriver-verbose.cmd");
  writeFileSync(wrapper, `@"${nativeDriver}" %* --verbose --log-path="${logPath}"\r\n`);
  return wrapper;
}

function ps(script) {
  try {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch (e) {
    return `powershell 실패: ${String(e.stderr ?? e.message).trim().slice(0, 200)}`;
  }
}

/**
 * 떠 있는 WebView2 **브라우저** 프로세스(--type 없는 것)의 핵심 플래그 — 원격 디버깅
 * 인자가 실제로 닿았는지, 어느 사용자 데이터 폴더를 쓰는지.
 */
function webviewProcesses() {
  const out = ps(`
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
  Where-Object { $_.CommandLine -notmatch '--type=' } |
  ForEach-Object {
    $c = $_.CommandLine -replace '^"[^"]*"\\s*', ''
    "pid $($_.ProcessId) <- $($_.ParentProcessId): " + $c.Substring(0, [Math]::Min(900, $c.Length))
  }`);
  return out ? out.split(/\r?\n/) : ["msedgewebview2 브라우저 프로세스 없음"];
}

function edgePolicies() {
  const out = ps(`
foreach ($root in 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge', 'HKCU:\\SOFTWARE\\Policies\\Microsoft\\Edge') {
  if (Test-Path $root) {
    Get-ChildItem -Path $root -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      $k = $_; ($k.GetValueNames() | ForEach-Object { "$($k.Name)\\$_ = $($k.GetValue($_))" }) -join '; '
    }
    (Get-Item $root).GetValueNames() | ForEach-Object { "$root\\$_" }
  }
}`);
  return out ? out.split(/\r?\n/).filter(Boolean).slice(0, 20) : ["Edge 정책 없음"];
}

function killAll() {
  for (const image of [APP_EXE, "msedgewebview2.exe"]) {
    try {
      execFileSync("taskkill", ["/F", "/T", "/IM", image], { stdio: "pipe" });
    } catch {
      /* 떠 있는 것이 없다 */
    }
  }
}

async function waitPort(address, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://${address}/json/version`, { signal: AbortSignal.timeout(2_000) });
      return await res.json();
    } catch {
      if (child.exitCode != null) return null;
      if (Date.now() > deadline) return null;
      await sleep(500);
    }
  }
}

/** 한 가지 수단으로 앱을 띄워 CDP 포트가 열리는지 본다. 열리면 세션까지. */
async function tryAttach({ wd, app, env, cwd, logFile, port, how, rec }) {
  killAll(); // 단일 인스턴스·브라우저 프로세스 재사용 — 앞 시도의 잔재가 있으면 새 인자가 안 먹는다.
  await sleep(1500);
  const args = `${WRY_DEFAULT_ARGS} --remote-debugging-port=${port}`;
  const childEnv = { ...env };
  if (how === "env") childEnv.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = args;
  const policyKey = POLICY_KEYS[how];
  if (policyKey) {
    execFileSync("reg", ["add", policyKey, "/v", APP_EXE, "/t", "REG_SZ", "/d", args, "/f"], { stdio: "pipe" });
  }
  const fd = openSync(logFile, "a");
  const child = spawn(app, [], { cwd, env: childEnv, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const address = `127.0.0.1:${port}`;
  const version = await waitPort(address, child, 45_000);
  rec.notes.push(`attach(${how}) 브라우저: ${webviewProcesses().join(" | ")}`);
  const unset = () => {
    if (!policyKey) return;
    try {
      execFileSync("reg", ["delete", policyKey, "/v", APP_EXE, "/f"], { stdio: "pipe" });
    } catch {
      /* 이미 없다 */
    }
  };
  if (!version) {
    rec.notes.push(`attach(${how}) — CDP 포트 ${port} 안 열림${child.exitCode != null ? ` (앱 exit ${child.exitCode})` : ""}`);
    unset();
    return null;
  }
  rec.notes.push(`attach(${how}) — CDP 포트 열림: ${version.Browser ?? "?"}`);
  await wd.newSession({ browserName: "webview2", "ms:edgeOptions": { debuggerAddress: address } });
  return {
    mode: `attach-${how}`,
    debuggerAddress: address,
    stop: () => {
      killAll();
      unset();
    },
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
    rec.notes.push(`launch 실패: ${e.message.slice(0, 160)}`);
    rec.notes.push(`launch 직후 브라우저: ${webviewProcesses().join(" | ")}`);
    rec.notes.push(`Edge 정책: ${edgePolicies().join(" | ")}`);
  }
  const common = { wd, app, env: ws.env, cwd: ws.dirs.driverCwd, logFile: join(outDir, "app-stdout.log"), port: 9222, rec };
  for (const how of ["env", "registry-hkcu", "registry-hklm"]) {
    const s = await tryAttach({ ...common, how });
    if (s) {
      rec.notes.push(`세션: ${s.mode} (CDP ${s.debuggerAddress})`);
      return s;
    }
  }
  killAll();
  throw new Error("WebView2 에 원격 디버깅을 켤 수단이 없었다 — 단계 비고의 브라우저 명령줄을 볼 것");
}
