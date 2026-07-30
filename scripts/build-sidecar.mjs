// PR-CI2 후속 — oculpm-mcp 사이드카를 tauri externalBin 규약대로 준비한다.
// tauri 는 `binaries/oculpm-mcp-<target-triple>` 파일을 찾아 .app 의
// Contents/MacOS/ 에 `oculpm-mcp` 로 동봉한다 (resolve_binary_path 가 메인
// 바이너리의 형제 경로에서 찾는 것과 정합).
//
// beforeBuildCommand 에서 호출된다. 명시적 --target 빌드(CI 의
// aarch64-apple-darwin)와 캐시를 공유하도록 호스트 triple 로 --target 을
// 강제한다 (macos-latest 러너는 arm64 → 호스트 == CI 타깃).
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = join(repoRoot, "src-tauri");

// A1 (#a1-schema-paths) — 플러그인 버전 스탬프. plugin.json 의 version 은
// 앱 버전(tauri.conf.json)을 따른다 — 수동 상수 금지, 동기화는
// src-tauri/tests/plugin_manifest.rs 가 강제한다.
const appVersion = JSON.parse(
  readFileSync(join(srcTauri, "tauri.conf.json"), "utf8"),
).version;
const pluginJsonPath = join(repoRoot, "plugin", "oculpm", ".claude-plugin", "plugin.json");
const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
if (pluginJson.version !== appVersion) {
  pluginJson.version = appVersion;
  writeFileSync(pluginJsonPath, `${JSON.stringify(pluginJson, null, 2)}\n`);
  console.log(`build-sidecar: plugin.json version → ${appVersion}`);
}

const rustInfo = execSync("rustc -vV").toString();
const triple = /host: (\S+)/.exec(rustInfo)?.[1];
if (!triple) {
  console.error("build-sidecar: rustc -vV 에서 host triple 을 찾지 못했습니다");
  process.exit(1);
}

console.log(`build-sidecar: cargo build --release --bin oculpm-mcp --target ${triple}`);
execSync(`cargo build --release --bin oculpm-mcp --target ${triple}`, {
  cwd: srcTauri,
  stdio: "inherit",
});

const ext = process.platform === "win32" ? ".exe" : "";
const built = join(srcTauri, "target", triple, "release", `oculpm-mcp${ext}`);
// build.rs 가 만든 0바이트 플레이스홀더가 번들로 출하되는 사고 방지 —
// 실빌드 산출물만 통과시킨다.
const size = statSync(built).size;
if (size < 1024 * 1024) {
  console.error(`build-sidecar: ${built} 가 실바이너리로 보기엔 너무 작습니다 (${size}B)`);
  process.exit(1);
}
const outDir = join(srcTauri, "binaries");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `oculpm-mcp-${triple}${ext}`);
copyFileSync(built, out);
console.log(`build-sidecar: ${out} 준비 완료 (${(size / 1e6).toFixed(1)}MB)`);
