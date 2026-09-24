// 실행 환경 — 데이터 격리 · 픽스처 프로젝트 · 앱 로그 수거.
//
// ── 앱은 app-data 를 어디서 잡는가 (코드에서 확인, 2026-09-24) ─────────────
//   1. Tauri `app.path().app_data_dir()` = `dirs::data_dir()/<identifier>`
//      → DB(ocul-pm.db) · PTY 소켓 · 테마 · 셸 통합 스크립트 · 임베딩 캐시.
//   2. 로그(`logs/oculpm.log.*`) · `config` CLI · MCP 의 journal_search 캐시 —
//      2026-09-24 부터 `app_dirs::app_data_dir()` 로 1 과 **같은 폴더**다
//      (#paths-projectdirs-mismatch). 그 전엔 `ProjectDirs` 라 Linux 는
//      `$XDG_DATA_HOME/ocul-pm`, Windows 는 `%APPDATA%\kimhyunbin\ocul-pm\data` 였다 —
//      `dataRoots` 가 옛 자리도 찾는 것은 옛 빌드를 돌릴 때를 위해서다.
//   3. `BaseDirs::home_dir()` → ~/.claude · ~/.codex · 전역 스킬.
//   앱 자체에는 경로를 바꾸는 환경변수가 **없다**.
//
// 그래서:
//   - Linux: `dirs`/`directories` 가 XDG 변수와 HOME 을 따른다 → 전부 임시
//     폴더로 돌리면 완전 격리. 실행 뒤 진짜 HOME 쪽에 폴더가 새로 생겼는지 검사한다.
//   - Windows: 두 크레이트가 Known Folder API(SHGetKnownFolderPath)를 쓴다 —
//     레지스트리 값이라 **환경변수로 못 돌린다.** 그래서 GitHub 러너(매 잡마다
//     새 VM)에서만 돌고, 그 밖에서는 명시적 동의 없이는 거부한다.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const IS_WIN = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";
export const OS_NAME = IS_WIN ? "windows" : IS_LINUX ? "linux" : process.platform;
export const IDENTIFIER = "com.kimhyunbin.ocul-pm";

/** 격리 작업 폴더와 앱에 넘길 환경을 만든다. */
export function prepareWorkspace() {
  if (!IS_WIN && !IS_LINUX) {
    throw new Error("tauri-driver 는 Windows·Linux 만 지원한다 (macOS 는 WKWebView 드라이버가 없다).");
  }
  if (IS_WIN && process.env.CI !== "true" && process.env.OCULPM_E2E_ALLOW_REAL_PROFILE !== "1") {
    throw new Error(
      "Windows 에서는 앱의 app-data(Known Folder)를 환경변수로 격리할 수 없다 — 이 PC 의 실제 " +
        "Ocul-PM 데이터에 쓴다. 또 attach 폴백은 HKLM WebView2 정책을 잠시 쓰고 떠 있는 " +
        "msedgewebview2 프로세스를 전부 내린다(launch.mjs). CI 러너 밖에서 돌리려면 " +
        "OCULPM_E2E_ALLOW_REAL_PROFILE=1 로 동의할 것.",
    );
  }
  const root = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "oculpm-e2e-"));
  const dirs = {
    root,
    home: join(root, "home"),
    xdgData: join(root, "xdg", "data"),
    xdgConfig: join(root, "xdg", "config"),
    xdgCache: join(root, "xdg", "cache"),
    xdgState: join(root, "xdg", "state"),
    fixture: join(root, "fixture", "e2e-fixture"),
    driverCwd: join(root, "cwd"),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  const env = { ...process.env, NO_AT_BRIDGE: "1", RUST_BACKTRACE: "1" };
  if (IS_LINUX) {
    Object.assign(env, {
      HOME: dirs.home,
      XDG_DATA_HOME: dirs.xdgData,
      XDG_CONFIG_HOME: dirs.xdgConfig,
      XDG_CACHE_HOME: dirs.xdgCache,
      XDG_STATE_HOME: dirs.xdgState,
    });
    if (!/utf-?8/i.test(env.LANG ?? "")) env.LANG = "C.UTF-8";
  }
  return { dirs, env, leakProbe: leakProbe() };
}

/** 격리 누수 탐지 — 진짜 사용자 폴더의 앱 폴더가 실행 전후로 새로 생겼는가. */
function leakProbe() {
  if (!IS_LINUX) return { paths: [], before: [] };
  const real = join(homedir(), ".local", "share");
  const paths = [join(real, IDENTIFIER), join(real, "ocul-pm")];
  return { paths, before: paths.map((p) => existsSync(p)) };
}

export function checkLeak(probe) {
  return probe.paths.filter((p, i) => !probe.before[i] && existsSync(p));
}

/** 앱 데이터 폴더 후보 (DB·로그를 찾는 곳). */
export function dataRoots(ws) {
  if (IS_LINUX) return [join(ws.dirs.xdgData, IDENTIFIER), join(ws.dirs.xdgData, "ocul-pm")];
  const appdata = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return [join(appdata, IDENTIFIER), join(appdata, "kimhyunbin", "ocul-pm", "data")];
}

/** 로그 파일(`oculpm.log.*`)을 out 폴더로 복사하고 경로 목록을 돌려준다. */
export function collectAppLogs(ws, outDir) {
  const copied = [];
  for (const root of dataRoots(ws)) {
    const logs = join(root, "logs");
    if (!existsSync(logs)) continue;
    for (const name of readdirSync(logs)) {
      if (!name.startsWith("oculpm.log")) continue;
      const dest = join(outDir, `app-${name}.txt`);
      copyFileSync(join(logs, name), dest);
      copied.push(dest);
    }
  }
  return copied;
}

/** 앱 DB 가 생긴 자리 — 격리가 실제로 먹었는지의 증거. */
export function findDb(ws) {
  for (const root of dataRoots(ws)) {
    const db = join(root, "ocul-pm.db");
    if (existsSync(db)) return { path: db, bytes: statSync(db).size };
  }
  return null;
}

const FIXTURE_FILES = {
  "README.md": "# e2e-fixture\n\nOcul-PM 끝단 테스트용 픽스처 프로젝트.\n",
  // 폴더를 건너는 import 하나 — 코드 맵(폴더 보기)이 빈 화면만 찍지 않게.
  "src/main.ts": [
    'import { slugify } from "../lib/util";',
    "",
    "export function greet(name: string): string {",
    "  return `hello, ${slugify(name)}`;",
    "}",
    "",
  ].join("\n"),
  "lib/util.ts": [
    "export function slugify(input: string): string {",
    '  return input.trim().toLowerCase().replace(/\\s+/g, "-");',
    "}",
    "",
  ].join("\n"),
  "tools/report.py": ["def summarize(rows):", "    return len(rows)", ""].join("\n"),
};

/**
 * 커밋 하나짜리 git 저장소 + 커밋 안 된 변경 하나 (변경 화면이 빈 화면만
 * 찍지 않게).
 */
export function createFixture(dir, env) {
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=ocul-pm e2e", "-c", "user.email=e2e@invalid", ...args], {
      cwd: dir,
      env,
      stdio: "pipe",
    });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "fixture: initial");
  writeFileSync(join(dir, "README.md"), `${FIXTURE_FILES["README.md"]}\n작업 중인 변경 한 줄.\n`);
  return dir;
}
