# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Ocul-PM** (`ocul-pm`) is a **Tauri 2 native desktop app** (Rust backend + system webview, *not* Electron) — a local-first AI project manager that records what external coding agents (Claude Code, Cursor, Gemini CLI) do, as human-readable markdown work-journals. All data stays in each project's `.oculpm/` directory plus a local SQLite cache; nothing leaves the machine except LLM API calls the user makes and update checks.

UI language is **Korean** — match it in UI strings, journals, and commit messages.

## Commands

```bash
pnpm install            # deps (Node 18+, pnpm, Rust stable, Xcode CLT on macOS)
pnpm tauri dev          # run the full app (Rust + Vite) — primary dev loop
pnpm tauri build        # produce .dmg / .app bundle
pnpm dev                # Vite frontend only (no Rust backend; commands will fail)

pnpm typecheck          # tsc --noEmit
pnpm test               # vitest run (frontend, jsdom)
pnpm test:watch         # vitest watch
pnpm lint               # 6 gates: storage · i18n · bindings · design · file-size · eslint (see below)
pnpm build              # tsc && vite build (what `beforeBuildCommand` runs)

# Single frontend test
pnpm vitest run src/__tests__/today_v2.test.tsx
pnpm vitest run -t "name of the test"

# Rust (run from src-tauri/)
cargo test                          # all backend tests + regenerates bindings.ts (see below)
cargo test --test oculpm_migration  # one integration suite (files in src-tauri/tests/)
cargo build
```

Before committing, confirm typecheck / test / lint / build each exit 0 directly — don't assume.

**Releasing?** [docs/RELEASE.md](docs/RELEASE.md) is the SSOT and has more detail than this paragraph. A release is done only when the change is on every surface: the **6 version files**, `CHANGELOG.md` (the sole source of the GitHub release notes), **`README.md` + `README.en.md`**, and **both landings** (`landing/index.html` *and* `landing/en/index.html` — 6 version strings each, plus JSON-LD `featureList` / FAQ / bento cell for a new feature), then `node landing/wiki-src/build.mjs` to re-bake the generated pages. The landing site has no git integration — deploy it with `cd landing && vercel --prod`.

## Critical: the Rust↔TS command bridge

The frontend never invokes Tauri directly. It calls typed functions from **`src/lib/bindings.ts`**, which is **auto-generated** by `tauri-specta` — **never hand-edit it.** It is regenerated two ways:
- on every `cargo test` (the `export_bindings_typescript` test in `lib.rs`), and
- on `pnpm tauri dev` in debug builds (`builder.export(...)` in `run()`).

**To add or change a backend command:**
1. Write the `#[tauri::command]` handler under `src-tauri/src/commands/`.
2. In `src-tauri/src/lib.rs`, add it to **both** the `use crate::commands::{...}` import **and** the `collect_commands![...]` list inside `build_specta_builder()`. (Events go in `collect_events![...]`.)
3. Run `cargo test` (or `cargo build` then `tauri dev`) to regenerate `bindings.ts`.
4. Call it from the frontend as `commands.yourCommand(...)` — returns a `{ status: "ok", data } | { status: "error", error }` envelope.

For the `.oculpm` commands, the frontend goes through **`src/api/oculpm.ts`** (`oculpmApi`), which unwraps that envelope into resolve/reject (`OculpmApiError`) — prefer it over reaching into `bindings.ts` directly.

## Backend architecture (`src-tauri/src/`)

- **`lib.rs`** — app entry (`run()`): logging setup, specta builder, plugin registration, ~13 pieces of managed state (`Db`, `Embedder`, `PtyState`, `OculpmManager`, `AcpState`, `LspState`, `DapState`, …), graceful-shutdown lock release.
- **`commands/`** — thin Tauri command handlers, one file per domain (`oculpm`, `plan`, `git`, `llm`, `graph`, `diff`, `terminal`, `code`, `acp`, `lsp`, `dap`, …; there is no `planner.rs`). Keep logic in the modules below; commands orchestrate.
- **`oculpm/`** — the heart of the product: the file-based `.oculpm/` subsystem (replaces a legacy SQLite changelog). `manager/` (per-project lifecycle + locks), `watcher.rs` (notify-based fs watching), `frontmatter/`, `markdown.rs`, `index/` + `cache/` (rebuild the SQLite cache from disk), `session/`, `planner/`, `discussion/`, `a2a/` (multi-agent ledger), `mcp/` (the MCP tool server), `automation/`, `agents/` (AGENTS.md template sync/upgrade), `redact.rs` (secret scrubbing), `entry_diffs.rs`, `lock.rs`. **SSOT is the on-disk markdown; SQLite is a derived cache.** The on-disk layout / frontmatter schema / locking are spec'd — don't change them without bumping `schema_version`.
- **`db/`** — `rusqlite` + `tokio-rusqlite` + `sqlite-vec`, one `impl Db` split across `mod.rs` + domain files (`code_index`, `graph`, `planning`, `changes`, `settings`, …). DB lives at `app_data_dir()/ocul-pm.db`. **A migration is two steps, not one:** write the next `src-tauri/migrations/0NN_*.sql`, **then register it in the `MIGRATIONS` table in `db/mod.rs`** (`include_str!`) — a file that isn't in that table never runs, and `025_fts.sql` shipped that way and was retired unregistered. `migration_registry_matches_disk` now guards it. Never reuse a number; an `ADD COLUMN` migration also goes in `ADDITIVE_COLUMNS` (`heal_columns` repairs DBs that skipped it).
- **`ast.rs`** — `tree-sitter` symbol/relation extraction (Rust/TS/JS/Py/Go). **`indexer.rs`** — incremental (blake3 hash-gated) chunking. **`embedding.rs`** — `fastembed` local embeddings; cache is pinned to an absolute app-data dir (the packaged `.app` runs with CWD `/`).
- **`llm/`** — provider adapters (`anthropic`, `openai`, `gemini`, `nim`) behind a common trait; OpenRouter rides on the generalized `openai` path.
- **`git.rs`** — local diff/log/graph (shells out to `git`); no token, no network. There is no `github.rs` — GitHub reach lives in the updater plugin, `plugins/source.rs` and `deeplink.rs`. **`secrets.rs`** — API keys via the OS keychain (`keyring`), never DB/localStorage.

Capabilities/permissions are in `src-tauri/capabilities/default.json`; app/window/updater config in `src-tauri/tauri.conf.json`.

## Frontend architecture (`src/`)

- **`main.tsx`** — the entry point (**there is no `App.tsx`**; only `App.css` keeps the old name). `parseWindowRoute()` picks the window: `windows/TerminalWindow` (torn-off terminal), `features/tray/TrayApp` (menu-bar popover), or **`windows/TabbedWindow`** (the project window); a non-webview load renders `mobile/MobileApp`.
- **`windows/TabbedWindow.tsx`** — Chrome-style tabs, one `WorkspaceProvider` per tab. A tab is `windows/StartTab` (launcher/picker) or **`windows/ProjectTab`**, which lazy-mounts **`features/shell/ShellV2`** (the only shell) and wires `.oculpm` auto-init + watcher start + auto-index. Inactive tabs stay mounted, so once-per-window behaviour is gated on `active`.
- **`ShellV2.tsx`** — owns the sidebar + a router over `state.uiV2View` across **16 screens** (Today, Journal, Discussion, Planner, Diff, Retro, Search, Code Map/Graph, Docs, Terminal, Code, Claude Code, Codex, AI panel, Skills, Sessions). **Each screen renders its own `<Toolbar>`.** Sidebar/⌘K palette/⌘-number shortcuts all derive from `src/lib/navRegistry.ts` (single source — the first 10 entries own ⌘1~⌘0, so append new screens at the END). Today/Journal/Diff/Planner are eager; the rest are lazy chunks. ⌘\ jumps to the AI panel (the ⌘\ overlay chat stack was retired 2026-07-16). **Three** chat surfaces, not one: `AiPanelScreenV2` (provider chat), `ClaudeCodeScreenV2` and `CodexScreenV2` (ACP).
- **`features/`** — one folder per screen/domain (`today`, `oculpm` = journal, `discussion`, `planner`, `diff`, `retro`, `search`, `graph`, `docs`, `terminal`, `code`, `chat` = all three AI surfaces, `skills`, `sessions`, `onboarding`, `settings`, `projects`, `deeplink`, `theme`, `tray`, `shell`).
- **`contexts/WorkspaceContext.tsx`** — **owns ALL `localStorage`**, one record **per project** under `aipm:workspace:v2:p<projectId>` (current view, filters, sidebar state, open code tabs, …) — `storageKeyFor(projectId)` builds it; the old single key `aipm:workspace:v1` survives only as a one-shot migration source. **Direct `localStorage` access anywhere else is forbidden and enforced by `pnpm lint`** (`scripts/check-no-localstorage.mjs`, with a small justified allowlist). Route persistence through this context.
- **`contexts/SettingsContext.tsx`** — settings persisted via backend `settings_*` commands (SQLite), not localStorage. Theming: `data-theme` carries the light/dark *family*; `data-preset` layers full palettes (Solarized/Nord/…) on top (`src/styles/tokens.css` + `App.css`).
- **`lib/`** — `bindings.ts` (generated), `theme.tsx`, `settings.ts`, `updater.ts`, `toast.ts`, `oculpmLog.ts` (console bridge → `oculpm.log`). **`components/ui/`** is shadcn (`components.json`, style `radix-nova`, lucide icons). Path alias `@/` → `src/`.

Tests live in `src/__tests__/` (vitest + Testing Library + `vitest-axe` for a11y).

## This repo dogfoods itself

`AGENTS.md` at the repo root is the journaling-rules template Ocul-PM injects into tracked projects — **and this repo is itself tracked.** When you finish a logical unit of work here (bug fix / feature / refactor / error cycle / chore), the AGENTS.md rules apply: write one markdown entry under `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/` and update the corresponding `.oculpm/planner/*.md` item, following the frontmatter and section rules in `AGENTS.md` exactly. **Never write to `.oculpm/index/**`** (app-managed) and never put secrets in journals/diffs.

Design docs (per major effort) live under `docs/`. **Start at [`docs/README.md`](docs/README.md)** — it splits the tree into *living SSOT* and *archive*. Roughly two thirds of `docs/` is historical, and several archived master plans still call themselves "the single source of truth"; only the folders the index lists as living are. Even in a living folder, **the code wins over the doc** — a design decision recorded as locked has been reversed more than once (each such line now carries an inline correction).
