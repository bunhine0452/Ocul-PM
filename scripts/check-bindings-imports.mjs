#!/usr/bin/env node
/**
 * Lint rule (완성도 라운드 Phase 4 #error-convention): 생성된 `@/lib/bindings`
 * 의 **값**(`commands` / `events`)을 직접 import 하는 파일은 늘리지 않는다.
 * 새 코드는 `@/api/*`(`call` 래퍼 — 문자열·AppError·전송 실패를 하나로 접는다)
 * 를 지나야 오류가 한 모양으로 화면에 닿는다. 타입 import(`import type`)는
 * 자유다 — 봉투 타입은 생성 파일이 정본이다.
 *
 * `check-no-hardcoded-korean.mjs` 와 같은 역방향 allowlist: 지금 직접 쓰는
 * 파일을 전부 적어 두고 통과시킨다. 옮기면 목록에서 빼고, 새 파일은 처음부터
 * 래퍼를 쓴다. 목록이 비는 것이 끝이다.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;

/** 래퍼 자신과, 아직 옮기지 않은 직접 호출자. */
export const ALLOWLIST = new Set([
  // 래퍼 — 여기만 정본이다.
  "api/oculpm.ts",
  "api/claudeSurface.ts",
  "api/window.ts",
  "api/deeplink.ts",
  "api/session.ts",
  "api/projectFile.ts",
  // `.oculpm/index/` 사용량 + diff 정리 (journal-scale-round {#index-usage}).
  "api/indexUsage.ts",
  // git 커맨드 래퍼 (2026-09-11 편집기 IDE 라운드) — 트리·탭 git 상태 장식의 창구.
  "api/git.ts",
  "api/fileOpen.ts",
  // 설치 형식 (크로스플랫폼 L-UPD #upd-target-missing) — 업데이터의 deb 안내·대상 없음 판정.
  "api/installKind.ts",
  // 플래너 읽기 (`{#api-facades}` 첫 조각, 2026-09-18) — 트레이 스냅숏이 첫 호출자.
  "api/plan.ts",
  // `{#api-facades}` 2026-10-01 — 코드·LSP·터미널·git·diff·LLM 화면이 쓰던
  // 직접 호출 39파일(⌘K 팔레트 포함)을 여기로 옮겼다.
  "api/diff.ts",
  "api/projects.ts",
  "api/settings.ts",
  // 앱 안 터미널 세션 (4.0 터미널 복귀) — 출력 Channel 을 만드는 자리라 래퍼가 정본이다.
  "api/terminal.ts",
  // 아직 옮기지 않은 직접 호출자 (2026-08-30 기준 87개 → 2026-10-01 52개). 새로
  // 늘리지 말 것 — 옮기면 여기서 빼고, 목록이 비면 이 주석도 지운다.
  "contexts/SettingsContext.tsx",
  "contexts/WorkspaceContext.tsx",
  "features/oculpm/useJournalDays.ts",
  "features/oculpm/useOculpmLive.ts",
  // v3-release {#planner-diff-split} — 플래너 화면에서 갈라 나온 조각. 직접 호출이
  // 늘어난 것이 아니라 화면이 들고 있던 것이 따라왔다. 옮길 때는 화면과 함께.
  "features/planner/usePlanDocument.ts",
  "features/shell/ShellV2.tsx",
  "lib/externalLinks.ts",
  "lib/oculpmLog.ts",
  // 3.x 의 탭 본문(`ProjectTab`)이 이름만 바뀌었다 (4.0 창 하나 = 프로젝트 하나) —
  // 직접 호출이 는 것이 아니다. 딥링크의 `trayOpenMain` · 워처 인수가 남았다.
  "windows/ProjectWindow.tsx",
]);

const EXT = new Set([".ts", ".tsx"]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "legacy" || entry.name === "__tests__") continue;
      yield* walk(full);
    } else if (EXT.has(entry.name.slice(entry.name.lastIndexOf(".")))) yield full;
  }
}

/**
 * `import { commands } from "@/lib/bindings"` / `import { events, type X } …` 처럼
 * **값**을 가져오는 문장만 잡는다. `import type { … }` 와 `import { type X }`
 * 만으로 이뤄진 문장은 통과.
 */
export function scanSource(src) {
  const hits = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/bindings["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const values = names.filter((n) => !n.startsWith("type "));
    if (values.length === 0) continue;
    const line = src.slice(0, m.index).split("\n").length;
    hits.push({ line, names: values.join(", ") });
  }
  // 생성 파일을 건너뛰고 tauri 를 직접 부르는 것도 같은 규칙이다.
  const raw = /import\s*\{[^}]*\binvoke\b[^}]*\}\s*from\s*["']@tauri-apps\/api\/core["']/g;
  while ((m = raw.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    hits.push({ line, names: "invoke (@tauri-apps/api/core)" });
  }
  return hits;
}

async function main() {
  const offenders = [];
  const clean = [];
  for await (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).split("\\").join("/");
    if (rel === "lib/bindings.ts" || rel.startsWith("lib/transport/")) continue;
    const src = await readFile(file, "utf8");
    const hits = scanSource(src);
    if (ALLOWLIST.has(rel)) {
      if (hits.length === 0) clean.push(rel);
      continue;
    }
    if (hits.length > 0) offenders.push({ rel, hits });
  }
  if (offenders.length === 0) {
    console.log(`✓ no new direct @/lib/bindings value imports outside the allowlist (${ALLOWLIST.size} pending)`);
    if (clean.length > 0) {
      console.log("  allowlist 에서 뺄 수 있는 파일:");
      for (const rel of clean) console.log(`    ${rel}`);
    }
    process.exit(0);
  }
  console.error("✗ direct `commands`/`events`/`invoke` import outside the allowlist — go through `@/api/*` (`call`):");
  for (const { rel, hits } of offenders) {
    console.error(`  ${rel}`);
    for (const { line, names } of hits) console.error(`    ${line}: ${names}`);
  }
  console.error(
    "\n새 파일은 `@/api/oculpm` 같은 래퍼를 쓰세요. 옮길 수 없다면 scripts/check-bindings-imports.mjs 의 ALLOWLIST 에 사유와 함께 추가합니다.",
  );
  process.exit(1);
}

if (process.argv[1]?.endsWith("check-bindings-imports.mjs")) await main();
