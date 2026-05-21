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
