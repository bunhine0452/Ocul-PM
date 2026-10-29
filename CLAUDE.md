# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Ocul-PM** (`ocul-pm`) is a **Tauri 2 native desktop app** (Rust backend + system webview, *not* Electron) — a local-first AI project manager that records what external coding agents (Claude Code, Codex, Cursor, Gemini CLI) do, as human-readable markdown work-journals, and shows a person only what needs their eyes. All data stays in each project's `.oculpm/` directory plus a local SQLite cache. **The app calls no LLM and its webview reaches no outside host** (CSP `connect-src` has none — `webview_csp.rs`). The only things that leave the machine are ones the user starts — the update check and links the user opens (handed to the OS browser) — plus whatever the user's own external-editor command does. `src-tauri/tests/egress_inventory.rs` is the ledger that keeps this list honest — it fails the build on a new outbound call that is neither guarded nor listed with a reason — and `egress_spawn_ledger.rs` beside it does the same for child processes: every launch site is classified network-capable (with what opens that door) or local.

UI language is **Korean** — match it in UI strings, journals, and commit messages.

## Scope freeze (since 2026-10-08)

The periphery (code editor · LSP · DAP · terminal/PTY host · ACP chat · mobile bridge · Notion · themes · code graph) had grown as large as the core (journal · planner · Today), and of the 211 `fix` commits in the 60 days to 2026-10-08, 95 touched the periphery against 80 for the core. One maintainer cannot keep both honest — an external review said so, and the numbers agree. **On 2026-10-28 the whole hold tier was removed** (plan `simplify-round-20261028`), and **4.0 (2026-10-29, plan `v4-major-20261028`) cut the app to five surfaces: Today · Journal (journal search lives here) · Planner · Diff · Settings**, plus the start window when a window holds no project. One rule drives every screen: **show only the exceptions** (failed verdicts, journals without command evidence, changes no journal mentions, blocked items, human decisions); work with evidence folds to one line. No density modes. Agents run in the user's own terminal.

- **Don't build** a new screen, a new external integration, or a new long-lived process or network listener. Proposing one is fine; building it needs the user's explicit go-ahead *and* a named existing surface it retires.
- **Do** fix, shrink, or replace what exists. A replacement ends by removing the old path, not by keeping both (cf. `native-agent-drivers` `{#drop-node}`).
- **No screen tiers since 4.0** — all five surfaces are core and each maps to a promise in [`docs/PROMISE.md`](docs/PROMISE.md). Don't rebuild anything listed below; the measured reason for each 4.0 removal is in that file's 「4.0 에서 걷은 것」 table (earlier ones: plan `external-review-2026-10-08`).
- **Already removed (2026-10-24):** the mobile bridge (Tailscale phone web app), the DAP debugger, the Code Map screen, the remote theme gallery (GitHub/oculpm.com theme downloads) and the VS Code extension; Notion went 2026-10-14. **2026-10-28:** the in-app terminal + PTY host (`--pty-host` binary mode, detached `term-*` windows, shell integration), the Monaco code editor + LSP, the Claude Code / Codex ACP screens (`acp/`, `acp-lock/`), the AI panel chat (`chat`/`chat_stream` commands, conversations, recall) and the per-screen settings tabs (코드 · 컨텍스트). Today's 「이어서 작업」 and the planner's ▶실행 now copy the prompt to the clipboard. **Same day, the plugin shrank:** skills 12 → 5 (`next` · `redteam` · `inception` (absorbed `project-inception`) · `help` · `oculpm-journal`; `board` · `standup` · `self-audit` · `run-evals` · `tdd-workflow` · `project_init` went, along with the `oculpm::board` renderer and the MCP binary's `board` subcommand), template v19 moved §3 (journal file format) into the app-managed `.oculpm/agents/journal-spec.md`, active plans went 18 → 4 (`polish-round-20261027` is the 확인 날·사용자 결정 inbox, `tech-backlog-20261028` the technical carry ledger) and the start hook ships only the 3 most recently updated plans. **2026-10-29 (4.0, plan `v4-major-20261028`):** code semantic search + indexing + the Search screen (`embedding.rs`, `indexer`, `ast.rs`, fastembed/tree-sitter; migration `043_drop_code_index.sql` drops the chunk · embedding · symbol · graph tables), **every in-app LLM call** (`llm/`, API keys + keychain `secrets.rs`, summaries/standup, weekly rollups, release-note drafts, planner AI refresh), automation (`oculpm/automation/`, journal drafts, background reconcile), conversation import, declarative config, Claude Desktop MCP registration, the Skills/Rules screen + plugin bundle import, the Discussion screen (tiptap), the Branch screen, the menu-bar tray, theme presets (light/dark/system + an accent remain), the new-project wizard (scaffold CLIs), the density toggle, and Chrome-style tabs/tear-off. The user's `.oculpm/` files for removed features (`discussion/`, `rollups/`, `automation/`) are never deleted — the app just stops reading them. Leftover unused DB table `mobile_devices` (migration 029) stays; never reuse it or any name 043 dropped.

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
pnpm vitest run src/__tests__/today_v4.test.tsx
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

- **`lib.rs`** — app entry (`run()`): logging setup, specta builder, plugin registration, managed state (`Db`, `OculpmManager`, `WindowProjects`, `HistoryState`), graceful-shutdown lock release.
- **`commands/`** — thin Tauri command handlers, one file per domain (`oculpm`, `plan`, `today`, `git`, `diff`, `journal_search`, `project`, `window/`, …; there is no `planner.rs`). Keep logic in the modules below; commands orchestrate. `window/` owns the window → project registry (one window = one project; opening a project that already has a window focuses it).
- **`oculpm/`** — the heart of the product: the file-based `.oculpm/` subsystem (replaces a legacy SQLite changelog). `manager/` (per-project lifecycle + locks), `watcher/` (notify-based fs watching), `frontmatter/`, `markdown.rs`, `index/` + `cache/` (rebuild the SQLite cache from disk), `session/`, `planner/`, `mcp/` (the MCP tool server), `agents/` (AGENTS.md template sync/upgrade), `redact.rs` (secret scrubbing), `entry_diffs.rs`, `lock.rs`. In `planner/`: **`judge.rs`** reads a plan's last verdict — the newest plan-log note matching `^(판정|verdict) (✓|✗)`, the same regex as the plugin's `plan-context.sh` start hook (change one, change both); **`digest.rs`** is the deterministic (no LLM) rollup behind the **`today_digest`** command — verdicts, next leaf, human-owned and blocked items, journal → plan links — that the Today screen reads. **SSOT is the on-disk markdown; SQLite is a derived cache.** The on-disk layout / frontmatter schema / locking are spec'd — don't change them without bumping `schema_version`.
- **`db/`** — `rusqlite` + `tokio-rusqlite`, one `impl Db` split across `mod.rs` + domain files (`projects`, `planning`, `changes`, `settings`, …). `sqlite-vec` is still loaded only so migration 043 can drop the old vec0 table. DB lives at `app_data_dir()/ocul-pm.db`. **A migration is two steps, not one:** write the next `src-tauri/migrations/0NN_*.sql`, **then register it in the `MIGRATIONS` table in `db/mod.rs`** (`include_str!`) — a file that isn't in that table never runs, and `025_fts.sql` shipped that way and was retired unregistered. `migration_registry_matches_disk` now guards it. Never reuse a number; an `ADD COLUMN` migration also goes in `ADDITIVE_COLUMNS` (`heal_columns` repairs DBs that skipped it).
- **`git/`** — local diff/log/status (shells out to `git` through `git/safe.rs`); no token, no network. There is no `github.rs` — the app's only GitHub reach is the updater plugin's `latest.json` endpoint in `tauri.conf.json`. `deeplink.rs` only parses `oculpm://open` and asks before acting.
- The packaged `.app` runs with CWD `/` — build paths from the app-data dir (`app_data_dir()`, or `app_dirs.rs` where there is no `AppHandle`), never from the CWD.

Capabilities/permissions are in `src-tauri/capabilities/default.json`; app/window/updater config in `src-tauri/tauri.conf.json`.

## Frontend architecture (`src/`)

- **`main.tsx`** — the entry point (**there is no `App.tsx`**; only `App.css` keeps the old name). It renders **`windows/AppWindow`** for every window. **One window = one project**: `AppWindow` asks the backend which project its window holds (and follows `WindowProjectChanged`), then shows either `features/start/StartWindow` (no project — recent projects + first-run steps) or **`windows/ProjectWindow`** inside one `WorkspaceProvider`. Picking a project in the start window turns that same window into the project. No tabs, no tray. A non-webview load (`pnpm dev` in a browser) renders the start window without IPC.
- **`windows/ProjectWindow.tsx`** — wires `.oculpm` auto-init + watcher start, the ⌘K palette and the deep-link sheet, and lazy-mounts **`features/shell/ShellV2`** (the only shell).
- **`ShellV2.tsx`** — owns the top bar (`features/shell/TopBar.tsx`: project ▾ · four tabs · screen actions · Find ⌘K · settings gear) + a router over `state.uiV2View`: **Today · Journal · Planner · Diff**, plus `settings` (⌘,). There is no sidebar — it stacked beside the journal/plan/diff list columns as a second one (removed 2026-10-29). The list of views is `contexts/uiV2View.ts`; a saved value for a removed screen folds to `today`. **Each screen renders its own `<Toolbar>`**; inside the shell its title is dropped and its actions portal into the top bar (`components/toolbarSlot.ts`). Tabs/⌘K palette/⌘-number shortcuts all derive from `src/lib/navRegistry.ts` (single source — four entries own ⌘1~⌘4; the palette jumps to screens, projects, journals and plans). Settings is the only lazy chunk (`features/shell/screens.ts`). ⌘[ / ⌘] walk the screen history (`hooks/useNavHistory.ts`). ⌘O opens recent projects (`hooks/useGlobalShortcuts.ts`); ⌘W closes the window and ⇧⌘N opens a new start window (`src-tauri/src/menu.rs`, `hooks/useWindowKeys.ts` off macOS). On macOS closing the last window keeps the app alive and a Dock click reopens one; elsewhere it quits (`exits_on_last_window_close`).
- **`features/`** — one folder per screen/domain (`today`, `oculpm` = journal, `planner`, `diff`, `settings`, `start`, `shell`, `deeplink`, `theme`).
- **`contexts/WorkspaceContext.tsx`** — **owns ALL `localStorage`**, one record **per project** under `aipm:workspace:v2:p<projectId>` (current view, filters, rail state, …) — `storageKeyFor(projectId)` builds it; the old single key `aipm:workspace:v1` survives only as a one-shot migration source. **Direct `localStorage` access anywhere else is forbidden and enforced by `pnpm lint`** (`scripts/check-no-localstorage.mjs`, with a small justified allowlist). Route persistence through this context.
- **`contexts/SettingsContext.tsx`** — settings persisted via backend `settings_*` commands (SQLite), not localStorage. Theming: `<html>` carries only `data-theme` (the light/dark family; "system" follows the OS) and `data-accent` (the accent colour) — `features/theme/apply.ts`, tokens in `src/styles/tokens.css`. There are no palette presets.
- **`lib/`** — `bindings.ts` (generated), `theme.tsx`, `settings.ts`, `updater.ts`, `toast.ts`, `oculpmLog.ts` (console bridge → `oculpm.log`). **`components/ui/`** is shadcn (`components.json`, style `radix-nova`, lucide icons). Path alias `@/` → `src/`.

Tests live in `src/__tests__/` (vitest + Testing Library + `vitest-axe` for a11y).

## This repo dogfoods itself

`AGENTS.md` at the repo root is the journaling-rules template Ocul-PM injects into tracked projects — **and this repo is itself tracked.** When you finish a logical unit of work here (bug fix / feature / refactor / error cycle / chore), the AGENTS.md rules apply: write one markdown entry under `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/` and update the corresponding `.oculpm/planner/*.md` item, following `AGENTS.md` and the file format in `.oculpm/agents/journal-spec.md` exactly. Record a check command's result as a plan-log note `판정 ✓|✗ <last line of output>` — the start hook and the planner read that line. **Never write to `.oculpm/index/**`** (app-managed) and never put secrets in journals/diffs.

Design docs (per major effort) live under `docs/`. **Start at [`docs/README.md`](docs/README.md)** — it splits the tree into *living SSOT* and *archive*. Roughly two thirds of `docs/` is historical, and several archived master plans still call themselves "the single source of truth"; only the folders the index lists as living are. Even in a living folder, **the code wins over the doc** — a design decision recorded as locked has been reversed more than once (each such line now carries an inline correction).
