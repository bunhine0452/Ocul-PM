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
  "api/invoke.ts",
  "api/automation.ts",
  "api/claudeSurface.ts",
  // 아직 옮기지 않은 직접 호출자 (2026-08-30 기준, 87개). 새로 늘리지 말 것 —
  // 옮기면 여기서 빼고, 목록이 비면 이 주석도 지운다.
  "components/CommandPalette.tsx",
  "contexts/SettingsContext.tsx",
  "contexts/WorkspaceContext.tsx",
  "features/chat/AcpConversation.tsx",
  "features/chat/AcpUsageMeter.tsx",
  "features/chat/AiPanelScreenV2.tsx",
  "features/chat/ConversationHistoryModal.tsx",
  "features/chat/aiActions.tsx",
  "features/chat/aiContext.ts",
  "features/code/CodeDebugPanel.tsx",
  "features/code/CodePane.tsx",
  "features/code/CodePreview.tsx",
  "features/code/CodeScreenV2.tsx",
  "features/code/CodeSearchPanel.tsx",
  "features/code/useCodeImport.ts",
  "features/code/useDebug.ts",
  "features/code/useLsp.ts",
  "features/diff/BinaryFileView.tsx",
  "features/diff/DiffScreenV2.tsx",
  "features/discussion/DiscussionScreenV2.tsx",
  "features/discussion/DiscussionView.tsx",
  "features/docs/DocsImage.tsx",
  "features/docs/DocsScreenV2.tsx",
  "features/graph/GraphInspector.tsx",
  "features/graph/GraphScreenV2.tsx",
  "features/oculpm/useJournalDays.ts",
  "features/oculpm/useOculpmLive.ts",
  "features/onboarding/GreenfieldWizard.tsx",
  "features/onboarding/StartScreen.tsx",
  "features/onboarding/home/useHomeBrief.ts",
  "features/planner/PlannerScreenV2.tsx",
  "features/projects/ProjectManager.tsx",
  "features/retro/DeferLedger.tsx",
  "features/retro/EvalTrend.tsx",
  "features/retro/RetroScreenV2.tsx",
  "features/retro/RuleCandidates.tsx",
  "features/retro/SkillCandidates.tsx",
  "features/retro/retroGen.ts",
  "features/search/SearchScreenV2.tsx",
  "features/settings/CodeSettings.tsx",
  "features/settings/MobileSettings.tsx",
  "features/settings/OculpmSettings.tsx",
  "features/settings/tabs/AppearanceTab.tsx",
  "features/settings/tabs/DataTab.tsx",
  "features/settings/tabs/DiagnosticsTab.tsx",
  "features/settings/tabs/DoctorSection.tsx",
  "features/settings/tabs/IndexingTab.tsx",
  "features/settings/tabs/LlmTab.tsx",
  "features/settings/tabs/UpdateTab.tsx",
  "features/shell/ShellV2.tsx",
  "features/skills/PluginDocsTab.tsx",
  "features/skills/SkillShopTab.tsx",
  "features/skills/useFiringLedger.ts",
  "features/terminal/TerminalAway.tsx",
  "features/terminal/TerminalBlockMenu.tsx",
  "features/terminal/TerminalDock.tsx",
  "features/terminal/TerminalInstanceImpl.tsx",
  "features/terminal/TerminalSurface.tsx",
  "features/terminal/dispatchTarget.ts",
  "features/terminal/useAgentRuns.ts",
  "features/today/DiscussionPending.tsx",
  "features/today/JournalMissingCard.tsx",
  "features/today/PlanUpdates.tsx",
  "features/today/TodayGitGraph.tsx",
  "features/today/TodayScreenV2.tsx",
  "features/today/WhatsNewCard.tsx",
  "features/today/useTodayBrief.ts",
  "features/today/useTodayMonitor.ts",
  "features/tray/TrayPopover.tsx",
  "lib/externalLinks.ts",
  "lib/llmTarget.ts",
  "lib/oculpmLog.ts",
  "mobile/EntryDetail.tsx",
  "mobile/MobileApp.tsx",
  "mobile/tabs/AiTab.tsx",
  "mobile/tabs/DiscussionTab.tsx",
  "mobile/tabs/JournalTab.tsx",
  "mobile/tabs/PlannerTab.tsx",
  "mobile/tabs/TodayTab.tsx",
  "mobile/theme.ts",
  "windows/ProjectTab.tsx",
  "windows/StartTab.tsx",
  "windows/TabbedWindow.tsx",
  "windows/TerminalWindow.tsx",
  "windows/useTabRunningWork.ts",
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
