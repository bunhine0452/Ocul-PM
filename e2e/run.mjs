#!/usr/bin/env node
// Ocul-PM 끝단 테스트 (크로스플랫폼 W3 · L-E2E, 플랜 `cross-platform-port` #w3-e2e · #w3-ime-cdp).
//
// 실제 앱 실행 파일을 tauri-driver(WebDriver) 로 띄워 사용자가 하는 일을 그대로
// 하고, 단계마다 스크린샷을 남긴다. 사용자는 Windows·Linux 기기가 없다 — **이
// 스크린샷이 그 OS 의 화면을 보는 유일한 창구다** (00-master-plan D1·D8).
//
//   node e2e/run.mjs [--app <실행 파일>] [--mcp <oculpm-mcp>] [--out <폴더>]
//
// 기본값은 `pnpm tauri build --debug --no-bundle` 산출물(src-tauri/target/debug).
// 설치 스모크(#w3-install-smoke)는 `--app` 에 **설치된** 실행 파일을 주면 같은
// 시나리오가 그대로 돈다 — 사이드카는 기본으로 앱 옆(`oculpm-mcp[.exe]`)에서 찾는다
// (NSIS·deb 설치 배치와 같다).
//
// 환경변수: OCULPM_E2E_APP · OCULPM_E2E_MCP · OCULPM_E2E_OUT ·
//   OCULPM_E2E_NATIVE_DRIVER (msedgedriver.exe 경로, Windows) ·
//   OCULPM_E2E_TAURI_DRIVER (기본: PATH 의 tauri-driver) ·
//   OCULPM_E2E_ALLOW_REAL_PROFILE=1 (Windows 를 CI 밖에서 — env.mjs 참고).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { IS_WIN, OS_NAME, checkLeak, collectAppLogs, createFixture, findDb, prepareWorkspace } from "./lib/env.mjs";
import { sleep } from "./lib/page.mjs";
import { Report } from "./lib/report.mjs";
import { loadDict, loadNav } from "./lib/source.mjs";
import { verboseDriverWrapper } from "./lib/launch.mjs";
import { startTauriDriver } from "./lib/webdriver.mjs";
import { runScenario } from "./scenario.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const EXE = IS_WIN ? ".exe" : "";
const { values: opts } = parseArgs({ options: { app: { type: "string" }, mcp: { type: "string" }, out: { type: "string" } } });

const app = resolve(opts.app ?? process.env.OCULPM_E2E_APP ?? join(REPO, "src-tauri", "target", "debug", `ocul-pm${EXE}`));
const mcpBin = resolve(opts.mcp ?? process.env.OCULPM_E2E_MCP ?? join(dirname(app), `oculpm-mcp${EXE}`));
const outDir = resolve(opts.out ?? process.env.OCULPM_E2E_OUT ?? join(REPO, "e2e", "out", OS_NAME));
for (const [what, path] of [["앱", app], ["사이드카", mcpBin]]) {
  if (!existsSync(path)) {
    console.error(`e2e: ${what} 실행 파일이 없다 — ${path}`);
    process.exit(2);
  }
}

/** 자세한 드라이버 로그는 스크린샷 base64 까지 싣는다 — 앞(세션 생성)과 끝만 남긴다. */
function trimLog(path) {
  if (!existsSync(path)) return;
  const buf = readFileSync(path);
  if (buf.length <= 3_000_000) return;
  const cut = Buffer.from(`\n\n… (${buf.length} 바이트 중 가운데를 잘랐다) …\n\n`);
  writeFileSync(path, Buffer.concat([buf.subarray(0, 2_000_000), cut, buf.subarray(buf.length - 500_000)]));
}

const gitSha = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "?";
  }
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const ws = prepareWorkspace();
createFixture(ws.dirs.fixture, ws.env);

const report = new Report({
  outDir,
  os: OS_NAME,
  meta: {
    OS: `${OS_NAME} (${process.env.ImageOS ?? process.platform} ${process.env.ImageVersion ?? ""})`.trim(),
    커밋: process.env.GITHUB_SHA ?? gitSha(),
    "앱 버전": JSON.parse(readFileSync(join(REPO, "src-tauri", "tauri.conf.json"), "utf8")).version,
    앱: app,
    사이드카: mcpBin,
    "WebView2 런타임": process.env.OCULPM_E2E_WEBVIEW2_VERSION ?? "-",
    "격리 작업 폴더": ws.dirs.root,
  },
});

const nav = loadNav(REPO);
const dict = { ko: loadDict(REPO, "ko"), en: loadDict(REPO, "en") };
let driver = null;
let failed;
const ctx = { report, nav, ws, os: OS_NAME, dict, app, mcpBin, session: null };
const driverLog = join(outDir, "msedgedriver.log");
try {
  driver = await startTauriDriver({
    bin: process.env.OCULPM_E2E_TAURI_DRIVER ?? "tauri-driver",
    port: 4444,
    nativePort: 4445,
    nativeDriver: verboseDriverWrapper(process.env.OCULPM_E2E_NATIVE_DRIVER || null, ws.dirs.root, driverLog),
    env: ws.env,
    cwd: ws.dirs.driverCwd,
    logFile: join(outDir, "tauri-driver.log"),
  });
  ctx.wd = driver.wd;
  await runScenario(ctx);
} catch (e) {
  await report.step(
    "하네스 예외",
    () => {
      throw e;
    },
    { always: true },
  );
} finally {
  if (driver) {
    try {
      await driver.wd.deleteSession();
    } catch {
      /* 세션이 이미 없다 */
    }
    driver.stop();
  }
  ctx.session?.stop();
  await sleep(2000); // 비차단 로그 작성기가 마저 쓰게
  trimLog(driverLog);
  const logs = collectAppLogs(ws, outDir);
  const logCrashes = logs.flatMap((f) =>
    readFileSync(f, "utf8").split(/\r?\n/).filter((l) => /화면 크래시|터미널 페인 크래시|패닉:/.test(l)),
  );
  await report.step("앱 로그 — 에러 경계·패닉 0건", (rec) => {
    rec.notes.push(`로그 파일 ${logs.length}개`);
    if (logs.length === 0) throw new Error("앱 로그(oculpm.log.*)를 못 찾았다 — 앱이 기동조차 못 했거나 로그 경로가 바뀌었다");
    if (logCrashes.length) throw new Error(`${logCrashes.length}줄: ${logCrashes.slice(0, 3).join(" | ").slice(0, 600)}`);
  }, { always: true });
  const db = findDb(ws);
  await report.step("데이터 격리 — 사용자 폴더 무접촉", (rec) => {
    rec.notes.push(`앱 DB: ${db ? `${db.path} (${db.bytes}B)` : "못 찾음"}`);
    if (IS_WIN) {
      rec.notes.push("Windows 는 Known Folder(레지스트리)라 환경변수로 못 돌린다 — 매 잡 새 VM 인 러너가 격리다");
      return;
    }
    const leaked = checkLeak(ws.leakProbe);
    if (leaked.length) throw new Error(`실행 중 진짜 HOME 에 생겼다: ${leaked.join(", ")}`);
    if (!db || !db.path.startsWith(ws.dirs.root)) throw new Error("앱 DB 가 격리 폴더 밖에 있다");
  }, { always: true });
  failed = report.finish({ logs: logs.map((f) => basename(f)), logCrashes });
  console.log(`\n결과: 실패 ${failed} · 스크린샷 ${report.shots.length}장 → ${join(outDir, "index.html")}`);
}
process.exit(failed === 0 ? 0 : 1);
