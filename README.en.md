<div align="center">

<img src="landing/banner.png" alt="Ocul-PM — Agents write the code. You keep the memory." width="100%" />

<img src="landing/demo.gif" alt="Ocul-PM demo — ask the agent for a change and the work journal writes itself" width="100%" />

<h3>Stop re-explaining to your AI where you left off yesterday.</h3>

<p>When Claude Code finishes a unit of work, a journal entry is left behind — and the next conversation starts from it.<br/>
A local-first project manager for Claude Code · Codex · Cursor · Gemini CLI — no server, no account.</p>

[![CI](https://github.com/bunhine0452/Ocul-PM/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bunhine0452/Ocul-PM/actions/workflows/ci.yml)
[![Latest release](https://badgen.net/github/tag/bunhine0452/Ocul-PM?icon=github&label=download&color=12a06b)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/bunhine0452/Ocul-PM/total?color=12a06b&label=downloads&cacheSeconds=3600)](https://github.com/bunhine0452/Ocul-PM/releases)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Built with Tauri 2](https://img.shields.io/badge/Tauri-2-24C8A0?logo=tauri&logoColor=white)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/beachcombers)

<a href="https://www.producthunt.com/products/ocul-pm?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-ocul-pm" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1237239&amp;theme=dark"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1237239&amp;theme=light" alt="Ocul-PM — find us on Product Hunt" width="250" height="54" /></picture></a>

[oculpm.com](https://oculpm.com/en) · [Keynote](https://oculpm.com/keynote) · [Wiki](https://oculpm.com/wiki/en) · [Download](https://github.com/bunhine0452/Ocul-PM/releases/latest) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/bunhine0452/Ocul-PM/issues)

[한국어](README.md) · English

</div>

---

If you build with AI every day, every morning starts the same way: open a new conversation and explain, from scratch, how far you got yesterday, why you touched those files, and what is still left. When the conversation ends, the context ends with it — the code survives, the context doesn't.

Ocul-PM removes that explanation. Plant a single rules file (`AGENTS.md`) in your project folder and the agent writes a markdown journal entry to `.oculpm/journal/` every time it finishes a unit of work; the next conversation receives those entries and the remaining plan items as its starting context and carries on. The app shows the same record as a timeline, a daily brief and change diffs. Because the source of truth is plain markdown, it commits alongside your code and stays readable without the app.

There is no server. Your data lives in the project's `.oculpm/` folder and a local SQLite cache, and the only things that leave your machine are **the ones you start yourself** — the LLM API calls you make, update checks, and things that exist only once you turn them on (GitHub fetches and theme downloads when you click, a one-time embedding-model download, Notion). The full list, countable for yourself, is at [oculpm.com/privacy](https://oculpm.com/privacy). The VS Code extension (`oculpm.ocul-pm`) keeps the same promise — it opens no network connection and writes only through this app's `oculpm-mcp`.

## One round trip — work · first entry · resume

This one round trip matters more than any feature list. Try it in the project you actually work in.

1. **Work** — ask Claude Code in your terminal for something, the way you always do. Adding the project plants `AGENTS.md`; [two lines in `/plugin`](#the-claude-code-plugin--start-without-the-app) add the hooks and the recording tools.
2. **First entry** — when the work is done the agent writes its entry, and Today's "First record" card confirms the first entry **of that conversation**. It judges by conversation id, not by total entry count, and it says plainly that a record is not a verification.
3. **Resume** — open a new conversation the next day and the plugin's SessionStart hook loads the open plan items and the last three entries into the starting context. Today's "Resume" card shows the same material and which conversation it was included in, and "Continue with this context" hands it to the terminal. You don't explain yesterday again.

This round trip was verified on the **terminal Claude Code + oculpm plugin** path. Other agents (Codex · Cursor · Gemini CLI …) do steps 1–2 from the rules file alone and have no step-3 hook — the tier table under [Supported agents](#supported-agents) spells out the difference. The demo above shows steps 1 → 2.


<img src="landing/shots/en/08-receipt.jpg" alt="Ocul-PM — Claude Code inside the app, with edit diffs and a turn receipt" />
<p align="center"><i>A real screen — Claude Code inside the app edited a file, showed the diff, and wrote its own work journal.</i></p>

## It looks like three tools. It's one app.

### 📓 The journal — recording should be free

The moment an agent finishes, the journal entry is already written — classified as bug/feature/refactor, stamped with which agent ran on which model. The morning Today brief organizes yesterday, and a standup is one button. The rear-view mirror becomes a steering wheel.

<img src="landing/shots/en/02-journal.jpg" alt="Automatic work journal — a timeline of entries by agent and model" />

### 🔍 The verifier — don't trust, look

Review what agents changed as a line-level local diff before you commit — side by side with the journal, so you compare "what it said" with "what actually changed". The code map warns you "changing this file affects N files" before you touch it.

<img src="landing/shots/en/03-diff.jpg" alt="Change diff — line-level local diff of agent-made changes" />

### 🖥️ The console — the agent, inside

A real `claude` runs inside the app (Agent Client Protocol). Tool calls flow as cards, edit diffs render right in them, and approval cards carry the exact command and the change being approved — no more allowing on a title alone. When a turn ends, a receipt remains: "4 tools · 2m 14s".

<img src="landing/shots/en/s2.jpg" alt="Approval card — the diff of the change visible inside the card" />

<table><tr>
<td width="50%"><img src="landing/shots/en/04-graph.jpg" alt="Code map — dependency graph with change impact" /><p align="center"><i>Code map — visible dependencies shrink fear</i></p></td>
<td width="50%"><img src="landing/shots/en/05-terminal.jpg" alt="⌘J terminal dock" /><p align="center"><i>⌘J — a terminal on any screen</i></p></td>
</tr></table>

### 🧩 VS Code extension — edit in the real VS Code

Instead of building "a VS Code-grade editor" inside the app, the **`oculpm.ocul-pm`** extension puts **today's journal and the active plans** in the VS Code sidebar. When an agent writes an entry it shows up there within a second; ticking a plan item's checkbox changes the `.md` and the app's planner with it — writes go only through this app's `oculpm-mcp` (read-only without the app). Copilot agent mode sees `journal_write` · `plan_update` as tools, "Open in editor" on a journal entry lands on that entry in the VS Code sidebar, and "Open in Ocul-PM" from the VS Code tree lands on it in the app. [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=oculpm.ocul-pm) · [Open VSX](https://open-vsx.org/extension/oculpm/ocul-pm) (Cursor · VSCodium). The extension opens no network connection.

## 🚀 v3.4.0 — first record and resume

- **Whether the first entry landed is now judged per conversation** — a project with zero entries gets a "First record" card that moves through ready → in progress → that conversation's first entry → ended without one → unattributed, keyed by the conversation id. Backfills and a neighbouring conversation's entries never count as success, and the card says recorded is not reviewed. Nine first-five-minutes strings were aligned with what actually happens.
- **The next session picks up where the last one stopped** — the plugin's SessionStart hook now carries the last three journal entries after the active plan items into the session-start context and writes one ledger line. Today's "Resume" card shows the same material and which conversation it was delivered to (and says it cannot know whether it was referenced or helped).
- **Finding, linking and grouping 700 entries** — `journal_search` answers from the SQLite cache with relevance ranking (132→25 ms), a Journal scope on the Search screen, related-entry suggestions with one-click linking, a tag dictionary and clean-up sheet, a weekly rollup layer, hotspot and velocity cards, an unreviewed queue, plan-log archiving, index usage clean-up.
- Two leaks into hidden project tabs — terminal ⌘D splitting background tabs, and the new-entry toast's Open landing on another project's screen.

## v3.3.0 — a supervisor's false alarm and look-alike plans

- **Running two instances made healthy watchers get cut and revived over and over** — each time a project lock moved to the new instance the supervisor woke immediately and judged a probe it had planted half a second earlier as "deaf" (52 times in two minutes). The hand-over wake now only yields locks, and a probe younger than 20 s is never judged.
- **`plan_create` points at look-alike active plans** — when an active plan with an overlapping title or id exists it refuses and returns that plan's id, title and hash so items go there instead (`allow_similar: true` overrides). Locked plans are never candidates.
- The Today headline's detached Korean particle, the Branch screen showing an error card for non-git projects, and the Search empty state gaining an icon and title.

## v3.2.2 — Korean file names and seventeen quiet defects

- **Non-ASCII file names came out of git octal-escaped** — backfilled journals' `files_touched`, the branch screen's file attribution, and journal diff capture (the quoted header went unrecognized, so that file's diff was dropped) all come back as the real file name now.
- **A hand-edited `config.toml` missing one key invalidated the whole project** — missing values are now filled from the new-project defaults.
- Secret masking leaving the tail of an overlapping match, an indexing panic on non-ASCII session ids, the settings screen rewriting the config on every open, stale responses overwriting the palette and plan screens, tray popover partial failures and sort order, double-click on a tab's ×, `[object Object]` in logs — seventeen fixes in all.

## v3.2.1 — menu bar clicks and deleted folders

- **On macOS 27, clicking the menu bar icon opened the "Open / Quit" menu instead of the status popover** — this OS intercepts left clicks too whenever a menu is attached to a status item. The menu is now attached only for the instant of a right click, so left click is the popover and right click is the menu.
- **Deleting a project folder in Finder while the app was running brought back an empty folder** — the file events from the deletion started a session, and writing that session recreated `.oculpm/index/` in the deleted spot. When the root is gone the watcher now drops the events and the index refuses to recreate anything.

## v3.2.0 — a review is bound to the content

- **"Verified" on a journal entry is now a promise, not a switch** — the mark is stored with a fingerprint of the body you verified; if an agent edits the body afterwards, the ledger row and the reading pane show **"Changed after review · re-check"**, and the "verified only" filter and change-review groups stop counting it as verified. Entries verified before 3.2.0 are honoured as-is.
- **Two processes could overwrite the same entry** — when the app and the MCP server (or two parallel agent sessions) wrote an entry with the same minute, type and title, the later one could silently replace the earlier one (an 8-process reproduction kept 3 of 24). New entries are now created exclusively. A slow process deleting another's lock after being reclaimed is closed too (locks are owned by a nonce, not a path).
- **Diagnostics tab "Watcher metrics"** — events, drops, queue depth, handling time. First measurement: of the 3.6 s it takes to settle after a branch switch, actual handling is 32 ms.
- **Agent support in four honest tiers** — see "Supported agents" below. Tiers were read from the code; the "Verified" column lists only what the changelog and journals record as actually run.
- **Releases are published only after verification** — the tag's commit must have a green CI run, the release is built as a draft, and it is published only after code-signing, notarization and updater-signature checks pass. 3.1.1 went out from a commit whose dependency audit was red; the machine now blocks that.
- Internals: the seven largest files (over 800 lines) split by responsibility (37 → 26 files over the limit), AI panel context assembly 4 → 2 sequential round-trips, extension unit tests in CI.

## v3.1.1 — macOS 27 menu bar icon restored

- **After updating to macOS 27 the Ocul-PM icon vanished from the menu bar** — not folded behind `«`, just gone. macOS 27 ties each status item to the process identity captured at launch, and this app re-launched itself right after start to apply its memory tuning (idle 645MB → 38MB), so the system no longer recognised it as "that app". The bundle now injects the same tuning at process creation, so nothing re-launches and the icon stays put. Nothing changes on macOS 26 and earlier.
- **Claude Code adapter 0.77.0** — the bundled Claude Code updates with it. Approvals the CLI marks "default to no" (delete-class commands, publishes) now list the decline buttons first, and account-verification / cloud-credential failures are distinguished from login failures.

## v3.1.0 — the quiet failures speak up

- **The installed app grew past 2GB after a day — fixed on Sep 12, never shipped.** The four commits (embedding arena 2.2GB → 940MB · vector table rebuild · unloading the model when idle 645MB → 38MB) sat on a branch outside 3.0.x. 3.1.0 ships them, and the index stops keeping copies of files git already has.
- **A retired default model failed silently for three weeks.** The background overview job now toasts on failure (once an hour per model) and stops retrying the same input; the model field in Settings warns when the name isn't in the provider's list.
- **oculpm tools showed up twice inside Claude Code sessions** (the app's server plus the plugin's). Inside an app-hosted conversation the plugin copy now offers no tools, so entries keep their session identity.
- Fixes: the VS Code Marketplace link in Settings led to a 404 (not published there yet — Open VSX only) · terminal color codes in the log file · build artifacts logged as warnings when skipped.

## v3.0.1 — the journal reading pane scrolls again

- **Opening a journal entry didn't scroll and everything below the fold was cut off** (3.0.0). The flex wrap meant for narrow windows let the reading pane grow to the length of the body — both panes now have a pinned height.

## v3.0.0 — only what we looked at ships

- **3.0 is an inspection release.** Seven releases (2.42–2.48) had left twenty-one lines of "seen in the harness, not on a real device" in the plan. We cashed them out — light/dark × five presets × six screens photographed, tab drag / PTY survival / mixed DPI / the wizard / English mode pressed by hand. What that turned up is below.
- **The Claude Code usage card says who it's running as** — "Claude Max · subscription · email". When logged out, the meter now stands as a **"Login needed"** pill even with no limits (it used to just vanish). Adapter 0.76.0.
- **Context compaction in its own shape** — "Context compaction · 128k → 42k tokens (−67%) · manual · 2.3s".
- **English mode** — a 15-screen render suite plus four things caught by eye (a unit, a plural, a header wrapping at the minimum window, the search box crushed to one character, the toolbar date). The English landing screenshots were retaken in English.
- **Fixed** — a second "Today" toolbar stacked over the Claude Code/Codex screens · opening and closing the wizard left a "New project" draft behind · the two ACP screens had no title · disabled buttons with no reason: **0**.

## Earlier releases at a glance — v2.5 through v2.48

The per-release narrative that used to live here has moved to the [web changelog](https://oculpm.com/changelog) and [CHANGELOG](CHANGELOG.md). Below, what those forty-odd releases left behind, one line per theme.

- **The Code screen became an IDE** (2.13 → 2.47) — starting from an in-app editor, then LSP code intelligence · tabs and side-by-side splits · a DAP debugger · project-wide search & replace (⇧⌘F) · image/PDF preview · drag from Finder and ⌘V · autosave and local history · a problems panel, and finally the core swapped for **Monaco** (VS Code's editor) with ⌘P quick open · git status colours · symbol breadcrumbs · ⌘K edit-by-instruction. 2.48 went the other way — the **VS Code extension `oculpm.ocul-pm`** puts the journal and plans in the real VS Code sidebar.
- **Terminal** (2.10 → 2.47) — the ⌘J dock · a vertical session rail · drag to split · tabs between windows · command blocks and "journal this right here" · agent-waiting detection · a colour per terminal · pane headbands and recent-command pips. Making **an app update not kill your sessions** took three tries (2.19 · 2.34.1 · 2.35) — the last one stuck. The Korean IME bugs (space, backspace, cursor keys mid-composition) were closed in the same era (2.13.x).
- **Agents run inside the app** (2.10 → 2.45) — Claude Code driven directly over the Agent Client Protocol, several conversations per project, import of past conversations, diffs inline in approval cards, a usage card, and **Codex** in the same seat (2.39 — one MCP registration per machine, the session picks the project). Four agents look like four (2.40), agents know about each other and claim work areas ahead of time (2.37), and an incoming message is data, not an instruction (2.38).
- **The record actually survives** (2.23 → 2.45) — watch automations that record when your hands stop, with provenance badges (2.27), scheduled self-review (2.26), the miscounted "session ended without a journal" and the lost write when two sessions edit the same plan (2.43), and plans with open items that refuse to close (2.45). The context budget became honest (2.29 · 2.36) and skills & rules answer **when they fire**, in one screen (2.24 · 2.26 · 2.45).
- **Windows and screens** (2.9 → 2.47) — Chrome-style tabs and tear-off (2.9), tabs into real windows (2.24) and back (2.25), a first-run wizard and settings as one document (2.30), the Branch and Sessions screens (2.40 · 2.44), the Retro and Docs screens removed (2.46). Planner, journal, start tab and sidebar went from piles of cards to **ledgers** (2.47).
- **Design and themes** — themes became files, installable from a link, one per project (2.28 · 2.31). The "made by AI" look was removed (2.33), the same code no longer changes colour between screens (2.44), and a disabled button says **why** (131 → 10 places, 2.45–2.47).
- **Structure and honesty** (2.41 → 2.44) — errors first (⌘W killing a running agent without asking; one screen failing without taking the app down), the loads that froze the app — a big paste, indexing, settings saves — measured and removed (2.42), and a link with Korean in it or a README over 24KB halting the app, fixed by counting characters as characters (2.44.1). Outbound connections are counted by the repository itself (2.43).
- **And** — Ocul-PM on your phone (mobile beta, 2.18) · English UI and a skill shop (2.8) · a changelog and a privacy ledger on the web (2.31) · signed and notarised builds that open straight from the download (2.45) · the Claude Code plugin (2.5, section below).

## Screens

- **Today** — everything that changed today, organized by workday: the commit graph, uncommitted changes, and an honesty audit that catches files agents modified but never journaled. "Copy standup" puts yesterday-to-today into your clipboard as shareable text.
- **Journal** — the timeline of what your agents did. Each entry shows which agent ran on which model, and keeps the change diff from that moment. Repos with no journal history can be backfilled from git in one pass.
- **Discussions** — the step *before* deciding what to do: define the problem, compare options, reach a conclusion — then promote it to a Planner document with one click.
- **Planner** — living plan documents. Every item links to the journal entries that touched it, and an opt-in auto-reconcile keeps plans in sync as new journal entries arrive.
- **Changes** — review what agents changed, offline. `j`/`k` moves between files, `/` searches inside the diff, and the code graph computes how far each changed file's impact reaches.
- **Branch** — "what happened on this branch." Commits, journal entries, plan items and changed files under one coordinate, with a **recorded rate** and the changes that still have no entry. Exportable as a single markdown page — it exports, and sends nothing anywhere.
- **Search** — three modes: semantic (local embeddings), symbol (AST), and text (exact match). (Still findable in ⌘K under its old name, Code Search.)
- **Code map** — a dependency graph that goes beyond imports to calls, inheritance, and implementations. Pick a file and see "changing this affects N files" first.
- **Editor** — an in-app IDE. **Tabs and a split view** keep several files in sight; the tree handles create, rename, drag-to-move, and delete-to-Trash — and **drag from Finder or press ⌘V** to bring files and folders in (name clashes become `-2` rather than overwriting). **⇧⌘F project-wide search & replace** (case / whole word / regex) lives in the sidebar, and **⌘F / ⌥⌘F find & replace** lives inside the editor. The core is **Monaco** — VS Code's own editor — so folding, bracket matching, auto-closing, wrap-selection, multiple cursors (⌥click, ⌥⇧drag for column select), the minimap, bracket-pair colorization and indent guides come as standard, with **semantic highlighting** from the language server layered on top. **⌘K rewrites the selection from a plain-language instruction** (review it hunk by hunk; turn them all off and you have the original back), and that edit is recorded as an agent's in the journal and local history. On top of **autocomplete, diagnostics, hover, go-to-definition, find references, outline, rename, signature help, and formatting** (LSP) there is now a **debugger** (breakpoints, stepping, variables — Rust · Python · Go), and a compare button in the path bar overlays **what agents changed right in the buffer** — with a jump to the journal entries that touched the file. A conflict banner protects you when an agent edits the same file, and unsaved edits survive screen switches. **Images and PDFs open as previews** instead of an editor — pictures with fit-to-window ↔ actual size, PDFs as documents, and **svg renders beside the code from the unsaved buffer**. The hygiene of an editor you leave open all day lives here too: **save-time whitespace/final-newline cleanup and auto-save** (off by default), **preview tabs** that don't pile up while you skim, **⇧⌘O symbols · ⌃G lines**, **sticky scroll** that keeps the enclosing function in view, a **problems panel** collecting project-wide diagnostics, and **local history** — a version per save and per agent edit, to overlay or restore.
- **Terminal** — a PTY terminal inside the app. Run your agent here and watch journal entries stack up on the next screen over. Sessions stand in a **vertical rail** on the left, each card showing status, agent, elapsed time and the last command. **Drag a session onto a screen edge and it splits there**, putting two side by side; the grip (⠿) on a split pane moves it elsewhere or pulls it out into its own session. **⌘J docks it onto any screen (bottom, left, or right), and it detaches into its own window** without dropping the shell. Also the escape hatch for CLI-only interactive features like `/plugin` and `/mcp`.
- **Agents** — runs a real `claude` and `codex` inside the app (Agent Client Protocol), with **Sessions** as the third branch under the same row. Tool calls, permission approvals, and Effort/mode all arrive as cards in the conversation, and sessions are managed as tabs. This is the screen where you tell it what to do.
- **AI panel** — chat that knows your code search, journal, planner, and git context. It loads a **capability list** once per conversation and pulls content on demand; past records attach only when a question asks for them (or push them yourself with `/rules`, `/plan`, `/journal`, `/skill`). Supports Anthropic · OpenAI · Gemini · OpenRouter, with a fallback chain when a call fails. This is the screen where you ask it things.
- **Skills & rules** — manage Claude Code skills (`.claude/skills/`) and rules (`.claude/rules/`, `CLAUDE.md`) in **one screen with three zones**: a **context budget bar** saying how much goes in per session, one merged list sorted by how often each fires (zero firings in 30 days and disabled skills demote into a collapsed *dormant* section), and a proposal inbox. Create and edit them in a GUI, and copy them between a project and your global `~/.claude/skills`. Disabling a skill doesn't delete it — it moves to `.disabled/` and simply drops out of loading. "Add" installs vetted third-party skills matched to your stack, 25 of them, and **rules that don't belong to this project** are flagged by two deterministic signals with prescriptions to narrow, clean up or fix a trigger. Rules and skills can also be created straight from a journal entry, a diff, a terminal block, Today or ⌘K.
- **Sessions** — every agent currently attached to this project, plus the **teams you grouped**, on one screen. The ledger names them all `claude-code-term-<pid>`, so with four attached nothing tells them apart; this screen layers **alias, registered name, surface (app or terminal), claimed ground and last activity** until they do. Sessions you haven't grouped are **visible only**, and pending approvals for delegated work show as a sidebar badge so you don't have to open the screen to notice.

⌘1–⌘0 jump between screens (reassigned in v2.44.0 — ⌘1 Today, ⌘2 Journal and ⌘4 Planner are unchanged), the ⌘K palette opens journals, plans, discussions and docs by title, ⌘P switches projects, and ⌘⇧M opens project management. Windows and tabs: ⌘T new tab · ⌘W close tab · ⇧⌘N new window · ⇧⌘W close window · ⌃Tab · ⌘⌥←→. **Drag** tabs to reorder, tear one out into its own window, or drop it on another window's tab row to merge — **right-click** (Shift+F10 from the keyboard) offers the same moves as a menu.

Pick your UI language — **한국어 · English** — in Settings → Appearance. The language your AI writes documents in (journals, discussions, plans) is a separate setting that defaults to following the UI.

## Supported agents

"Supported" hides four different promises, so we split them into tiers. The tiers are read from code, not from marketing copy — the rules-file adapter table (`src-tauri/src/oculpm/agents/`), the MCP registrars (`oculpm/mcp/register.rs` · `mcp/codex.rs`), the hooks (`plugin/*/hooks/`) and the ACP adapters (`src-tauri/src/acp/`).

| Tier | What it means |
|---|---|
| **1 · Rules-compatible** | Ocul-PM only writes the rules file that agent reads (`AGENTS.md`, a `.claude/CLAUDE.md` block, `.cursor/rules/*.mdc`, `GEMINI.md` …). Journals get written only as far as the model obeys the rules. |
| **2 · Structured journaling** | The agent can call the `oculpm` MCP server's tools (`journal_write` · `plan_update` …), and Ocul-PM registers that server for it. |
| **3 · Session observation** | Ocul-PM receives session start/stop through hooks and can tell when a conversation ended without a journal (the Stop delivery gate · `sessions.json` · the verdict). |
| **4 · In-app** | The agent runs inside the app (Agent Client Protocol) — tool approvals and output arrive as conversation cards, and the journaling tools are attached to the session directly. |

| Agent | Tier | What Ocul-PM does | Verified |
|---|---|---|---|
| **Claude Code** | 4 In-app | Runs in-app (ACP) · hooks (plugin or `.claude/settings.local.json`) · `.mcp.json` MCP registration · `AGENTS.md` + `.claude/CLAUDE.md` block | v3.0.0 · 2026-09-11 |
| **Codex** | 4 In-app | Runs in-app (ACP) · Codex plugin hooks · `~/.codex/config.toml` MCP registration · `AGENTS.md` (native, no dedicated file) | v2.37.0 · 2026-09-03 |
| **Claude Desktop** | 2 Structured journaling | MCP server registered in `claude_desktop_config.json` — no hooks, no rules file | — (shipped v2.2.0 · no live-connection record) |
| **Gemini CLI** | 1 Rules-compatible | `AGENTS.md` + `GEMINI.md` block | — |
| **Cursor** | 1 Rules-compatible | `.cursor/rules/ocul-pm.mdc` | — |
| **GitHub Copilot** | 1 Rules-compatible | `.github/copilot-instructions.md` block | — (shipped v2.0.0) |
| **Windsurf** | 1 Rules-compatible | `.windsurf/rules/ocul-pm.md` | — (shipped v2.0.0) |
| **Cline** | 1 Rules-compatible | `.clinerules/ocul-pm.md` | — (shipped v2.0.0) |
| **aider** | 1 Rules-compatible | `CONVENTIONS.md` block | — (shipped v2.0.0) |
| **Zed** | 1 Rules-compatible | `.rules` block | — (shipped v2.0.0) |
| **Antigravity** | 1 Rules-compatible | `.agent/rules/ocul-pm.md` | — (shipped v1.11.0) |
| **pi** | 1 Rules-compatible | `AGENTS.md` only (no dedicated file) | — (shipped v1.11.0) |

How to read it:

- **Verified** is the latest evidence in this repository's own `CHANGELOG.md` and `.oculpm/journal/` that the tier **actually ran** (app version · date). `—` means the code exists but there is no on-device record; "shipped" in parentheses is the version the CHANGELOG lists the feature under. No dates or versions were invented.
- `AGENTS.md` is always planted when you add a project; the other rules files are switched on in Settings → Agents (the detect button suggests candidates). If you're on a tier-1 agent, glance at Today's honesty audit now and then — files edited without a journal show up there.
- A CLI started in the built-in terminal (`claude` · `codex` · `gemini` · `cursor-agent` · `aider` …) is caught by shell integration for **start and stop only**. There is no missing-journal verdict, so that is not tier 3.
- Not yet seen on a real machine: a live Claude Desktop connection · Codex's tool-approval → file-change flow end to end · the VS Code extension exposing MCP tools to Copilot agent mode and to Cursor (`.cursor/mcp.json`). All three exist in code, and for that reason none of them raised a tier in the table.
- **Platform**: official builds are macOS Apple Silicon only. Intel Macs are on hold because the embedding runtime (ONNX) has no x86_64 prebuilt; Windows is later. The table describes that build.

Git backfill tells agents apart by commit signatures.

## The Claude Code plugin — start without the app

Two lines in your terminal's Claude Code and recording begins:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

For Codex, two lines in a terminal:

```
codex plugin marketplace add bunhine0452/Ocul-PM
codex plugin add oculpm-codex@oculpm
```

One plugin configures, across all your projects: a **hooks bridge** (session start/end as real-time signals — one local file append, no network), **7 MCP tools** (`journal_search` · `journal_read` · `journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init` — agents record through structured tools instead of imitating markdown, eliminating frontmatter errors, and search the hundreds of accumulated entries *before* starting work: one query tells you why that file was touched before), and **5 skills + `/oculpm:standup`** (recording spec · project-inception · self-audit · run-evals · tdd-workflow). It only acts in `.oculpm`-tracked projects and never touches untracked repos — see the [full read/write contract](docs/claude-integration/06-plugin-contract.md). Note it is an either/or with the app's per-project hook/MCP registration (the settings screen warns about double registration).

> The in-app **Claude Code screen** records without this plugin — the app attaches its journaling tools (MCP) to every session directly. Interactive CLI commands like `/plugin` and `/mcp` don't work inside in-app ACP sessions, so install the plugin from a terminal. The distinction is written up in the [wiki's Claude Code guide](https://oculpm.com/wiki/en/claude-code).

## Install

Grab `Ocul-PM_x.y.z_aarch64.dmg` from the [latest release](https://github.com/bunhine0452/Ocul-PM/releases/latest) and drag it into `Applications`. It's built for macOS (Apple Silicon), and once installed it auto-updates in place.

The app is signed with an Apple Developer ID and notarized, so it opens straight from the download — no `xattr` quarantine workaround needed.

macOS may still ask for **access to files or to other apps' data**. That's a separate gate from notarization and doesn't go away because an app is notarized. In particular, when a command you run in the **built-in terminal** — or an agent running inside it — reads a file, macOS attributes that access to the app, so the prompt names `Ocul-PM.app`. [Troubleshooting](https://oculpm.com/wiki/en/troubleshooting) explains why and how to revoke it.

The first semantic search downloads an embedding model (~135MB) once. After that it works offline.

Stuck on something? The [wiki](https://oculpm.com/wiki/en) collects common problems and fixes.

## Where your data lives

```text
your-project/
├── AGENTS.md          # journaling rules agents read (planted & versioned by the app)
└── .oculpm/
    ├── journal/       # work journals — the source of truth
    ├── planner/       # plan documents
    ├── discussion/    # discussion documents
    └── index/         # app-managed cache · diff archive
```

SQLite is only a derived cache for fast rendering — it can always be rebuilt from the files. API keys and tokens that accidentally land in journals or diffs are masked before saving (`[REDACTED]`).

## Tech

A Tauri 2 native app — not Electron — so the dmg stays under 60MB and cold start under 1.5s. The backend is Rust (tokio · rusqlite · sqlite-vec), the frontend React 19 + TypeScript. Code analysis is tree-sitter (Rust · TS · JS · Python · Go), embeddings run fully local via fastembed, and API keys live in the OS keychain, not the database.

## Build from source

```bash
git clone https://github.com/bunhine0452/Ocul-PM
cd Ocul-PM
pnpm install
pnpm tauri dev      # run in dev
pnpm tauri build    # .dmg / .app bundle
```

Requires Node 18+, pnpm, Rust stable, and Xcode Command Line Tools on macOS.

## Roadmap

- [ ] macOS (Intel) · Windows builds
- [ ] Team sync (opt-in)

## One more thing

This repository is itself tracked by Ocul-PM. Open `.oculpm/journal/` and you'll find the actual journals agents wrote while building this app. Bugs and ideas go to [issues](https://github.com/bunhine0452/Ocul-PM/issues) — and if you like it, a star helps more than you'd think.

## Support

Ocul-PM is built and maintained by one person. The app stays free, but building it costs time and money. If it has been useful, you can [buy me a coffee on Ko-fi](https://ko-fi.com/beachcombers) — one-off or monthly.

Supporting changes nothing about what you get. The promise below holds either way.

## License & promise

[MIT](LICENSE) © 2026 Kim Hyunbin

**Everything in this repository today stays free and MIT, forever.** Individual use is free forever — at work or at home. Paid plans will only ever apply to upcoming team features (sync server · team view — a separate module). Core features will never move behind a paywall.

Contributions are accepted under the [DCO (sign-off)](CONTRIBUTING.md), no CLA — the core stays MIT forever, so there is no reason to pool copyright.
