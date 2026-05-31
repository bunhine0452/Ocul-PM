#!/usr/bin/env node
/**
 * Lint rule: direct `localStorage` access is forbidden outside
 * `WorkspaceContext.tsx` (MASTER-GUIDE §6.1). Persistence happens through
 * the single `aipm:workspace:v1` key managed by the context — anything else
 * causes the "12 useState + 5 useEffect with scattered keys" regression.
 *
 * Runs in any Node 18+ environment with zero deps. Intent matches the
 * eslint `no-restricted-syntax` rule but avoids pulling in the full eslint
 * tree just for this single check.
 *
 * Exit 0 on clean, non-zero with a report on violations.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;

// Files that are explicitly allowed to call `localStorage` directly.
// Add a new entry ONLY with justification; the goal is to keep this list
// short and aim for the empty state.
const ALLOWLIST = new Set([
  "contexts/WorkspaceContext.tsx", // Owns persistence + legacy-key migration.
  // The two below are W5-scope (ChatPanel action_* keys → conversation_actions
  // SQLite table; TerminalPanel sessions → WorkspaceContext). Tracked in
  // MASTER-GUIDE §7.3 "W5 — G3 + UI-5". Remove when migrated.
  "features/chat/ChatPanel.tsx",
  "features/terminal/TerminalPanel.tsx",
  // The four below are W3-scope ocul-pm UI state. Per-project keys
  // (`oculpm_dismissed_${id}`, `oculpm.session.expanded.…`, `oculpm.filter.${id}`)
  // are intentionally outside the WorkspaceContext envelope: they're
  // ephemeral, project-scoped, and would force a context schema bump per
  // PR otherwise. Tracked in docs/major_update/oculpm/W3 PR5/PR6/PR8.
  // Migration to a project-scoped persistence layer is a W6 stabilize
  // candidate; until then these direct calls are sanctioned.
  "features/oculpm/OculpmOnboardingModal.tsx", // PR5 dismiss flag
  "features/oculpm/SessionCard.tsx",            // PR6 expand state
  "features/oculpm/filters.ts",                 // PR8 category filter
  "features/today/TodayScreen.tsx",             // PR5 dismiss-bar read
  // W5 MigrationModal owns its auto-trigger dismiss flag per project
  // (`aipm:migration:dismissed:<projectId>`). Per-project key, ephemeral,
  // intentionally outside the WorkspaceContext envelope to avoid a schema
  // bump per project. Removed when MigrationModal retires post-1.0.
  "features/projects/MigrationModal.tsx",
  // Per-project overview-card expanded flag. Same per-project ephemeral
  // pattern as the oculpm UI state above; not worth a WorkspaceContext
  // schema bump.
  "features/overview/ProjectMetaHeader.tsx",
  // Lite-W6 PR2 — vitest scenario seeds localStorage to verify the
  // BottomDrawerTab "problems" → "terminal" migration. Test-only.
  "__tests__/lite_w6_safety_net.test.ts",
  // Lite-W6 PR10 Part 2 — axe-core a11y suite clears localStorage between
  // mounts so each screen renders from the default WorkspaceContext state.
  // Test-only.
  "__tests__/a11y_screens.test.tsx",
  // Final UI Update PR-UI 3 — JournalScreenV2 tests clear localStorage between
  // mounts so the persisted journalFilter (aipm:workspace:v1 envelope) doesn't
  // leak a scope-chip choice from one test into the next. Test-only.
  "__tests__/journal_v2.test.tsx",
  // Final UI Update PR-UI 4 — DiffScreenV2 tests seed the persisted
  // WorkspaceContext envelope (recentChanges / diffActivePath) so the diff
  // file list mounts populated. Test-only.
  "__tests__/diff_v2.test.tsx",
]);

const EXT = new Set([".ts", ".tsx"]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXT.has(entry.name.slice(entry.name.lastIndexOf(".")))) yield full;
  }
}

const offenders = [];
for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split("\\").join("/");
  if (ALLOWLIST.has(rel)) continue;
  const src = await readFile(file, "utf8");
  if (!src.includes("localStorage")) continue;
  const hits = src
    .split("\n")
    .map((line, i) => ({ line: line.trim(), num: i + 1 }))
    // Skip single-line comments and block-comment continuations — they may
    // legitimately mention `localStorage` in documentation.
    .filter(({ line }) => /\blocalStorage\b/.test(line) && !/^(\/\/|\*)/.test(line));
  if (hits.length > 0) offenders.push({ rel, hits });
}

if (offenders.length === 0) {
  console.log("✓ no direct localStorage access outside the allowlist");
  process.exit(0);
}

console.error("✗ direct `localStorage` access detected — route through WorkspaceContext:");
for (const { rel, hits } of offenders) {
  console.error(`  ${rel}`);
  for (const { num, line } of hits) {
    console.error(`    ${num}: ${line}`);
  }
}
console.error(
  "\nIf this is intentional (e.g. a deferred migration), add the file to ALLOWLIST in scripts/check-no-localstorage.mjs with a comment explaining the timeline.",
);
process.exit(1);
