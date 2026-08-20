<div align="center">

<img src="landing/banner.png" alt="Ocul-PM — Agents write the code. You keep the memory." width="100%" />

<p><b>While AI coding agents write your code, Ocul-PM keeps the record.</b><br/>
A local-first project manager for Claude Code · Codex · Cursor · Gemini CLI</p>

[![Latest release](https://badgen.net/github/tag/bunhine0452/Ocul-PM?icon=github&label=download&color=12a06b)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/bunhine0452/Ocul-PM/total?color=12a06b&label=downloads&cacheSeconds=3600)](https://github.com/bunhine0452/Ocul-PM/releases)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Built with Tauri 2](https://img.shields.io/badge/Tauri-2-24C8A0?logo=tauri&logoColor=white)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[oculpm.com](https://oculpm.com) · [Keynote](https://oculpm.com/keynote) · [Wiki](https://oculpm.com/wiki) · [Download](https://github.com/bunhine0452/Ocul-PM/releases/latest) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/bunhine0452/Ocul-PM/issues)

[한국어](README.md) · English

</div>

---

The more work you hand to agents, the more you pay a strange new tax: digging back through git log and your own memory to figure out which files Claude Code touched last week and why, or whether the bug Cursor claimed to fix actually stayed fixed. The code survives — the context doesn't.

Ocul-PM starts by planting a single rules file (`AGENTS.md`) in your project folder. Every time an agent finishes a unit of work, it follows those rules and writes a markdown journal entry to `.oculpm/journal/`; the app reads those entries and turns them into a timeline, a daily brief, change diffs, and retrospectives. Because the source of truth is plain markdown, it commits alongside your code and stays readable without the app.

There is no server. Your data lives in the project's `.oculpm/` folder and a local SQLite cache; the only things that leave your machine are the LLM API calls you make yourself and update checks.


<img src="landing/shots/08-receipt.jpg" alt="Ocul-PM — Claude Code inside the app, with edit diffs and a turn receipt" />
<p align="center"><i>A real screen — Claude Code inside the app edited a file, showed the diff, and wrote its own work journal.</i></p>

## It looks like three tools. It's one app.

### 📓 The journal — recording should be free

The moment an agent finishes, the journal entry is already written — classified as bug/feature/refactor, stamped with which agent ran on which model. The morning Today brief organizes yesterday, and standups, PR bodies, weekly reports and retros are each one button. The rear-view mirror becomes a steering wheel.

<img src="landing/shots/02-journal.jpg" alt="Automatic work journal — a timeline of entries by agent and model" />

### 🔍 The verifier — don't trust, look

Review what agents changed as a line-level local diff before you commit — side by side with the journal, so you compare "what it said" with "what actually changed". The code map warns you "changing this file affects N files" before you touch it.

<img src="landing/shots/03-diff.jpg" alt="Change diff — line-level local diff of agent-made changes" />

### 🖥️ The console — the agent, inside

A real `claude` runs inside the app (Agent Client Protocol). Tool calls flow as cards, edit diffs render right in them, and approval cards carry the exact command and the change being approved — no more allowing on a title alone. When a turn ends, a receipt remains: "4 tools · 2m 14s".

<img src="landing/shots/s2.jpg" alt="Approval card — the diff of the change visible inside the card" />

<table><tr>
<td width="50%"><img src="landing/shots/04-graph.jpg" alt="Code map — dependency graph with change impact" /><p align="center"><i>Code map — visible dependencies shrink fear</i></p></td>
<td width="50%"><img src="landing/shots/05-terminal.jpg" alt="⌘J terminal dock" /><p align="center"><i>⌘J — a terminal on any screen</i></p></td>
</tr></table>

## 🚀 v2.13.4 — three fixes in the Claude Code screen

- **A tab for the new session** — clicking "New session" showed nothing in the tab strip, so you couldn't tell whether it had registered. A session is only created when you send the first message, so there was nothing to list until then. A dashed placeholder tab now holds that spot and becomes the real tab in place once you speak (closable, ⌘W included).
- **Titles chasing the last prompt** — as a conversation went on, the tab name kept changing to whatever you had just typed. Until Claude Code generates a title, the most recent prompt stands in as one. The app now recognises that stand-in, keeps the opening message, and switches only when a real title arrives.
- **"What's contributing" in the usage card** — crammed into a narrow card in a monospace block, sentences wrapped four lines deep and the rest was cut off. The card is wider now, shares render as a bar with a number, and lists like "Top skills" become chips. Lines the app doesn't recognise are still shown verbatim, so nothing disappears as the report grows.

## v2.13.3 — the previous syllable reappearing after a space

- **Stale composition after commit** — typing `안녕` then space produced `안녕 녕`. Space commits the composition and the app clears its input buffer; if the IME is still holding that syllable, it re-inserts it into the now-empty buffer, and the app mistook it for fresh input. Late input with nothing to replace is now recognised as a leftover and dropped. The cause is the **opposite** of the previous version's space fix (too early vs. too late), which is why that one didn't catch it.
- **Why release builds only** — dev builds are slowed by diagnostic logging and dev tooling, which kept this window closed. It is a timing-sensitive race, so only the fast build exposed it.

## v2.13.2 — Korean input and save-path rough edges

- **Space mid-composition** — typing Korean quickly and hitting space repeated the previous letter and swallowed the space (`안뜨` → `안뜨뜬`). The IME's "rewrite that letter" signal arrives up to 0.24s after the keystroke; the space went out first, and the late rewrite deleted that space instead of the composing letter. During composition every keystroke now leaves through a single ordered path.
- **Cursor keys** — moving the caret with arrows / Home / End / Esc mid-Korean no longer lets the next letter erase the wrong character.
- **Code screen saves** — CRLF files no longer get rewritten to LF on save; a symlink inside the project can no longer open a file outside it; one ⌘S no longer fires two saves (and a bogus "conflict" banner); silently dropped unsaved edits and externally deleted open files now warn.
- **Diff badge** — content lines starting with `---` / `+++` (front-matter rules, for instance) were mistaken for file headers, making the `+N −M` badge vanish entirely.

## v2.13.1 — Korean text no longer typed twice in the terminal

- **Backspace mid-composition** — writing a long Korean prompt to Claude Code in the terminal and hitting backspace left the deleted letter on screen: `차` became `ㅊ차`, and two backspaces turned `호` into `하ㅎ호`. In a Korean IME, a backspace during composition is not a delete key — it steps the syllable back one stage. The app read that as "input finished" and dropped the composition state, so the next completed letter landed beside the old one instead of replacing it. The two cases are now told apart.

## v2.13.0 — the new Code screen: open and edit code right inside the app

- **An in-app code editor** — open any file from a filterable tree, edit with syntax highlighting (12 languages), save with ⌘S. Search results and the code map grow an "Open in the Code screen" button that jumps to the exact line.
- **Safe to share files with your agents** — if the disk changed while you were editing, saving never overwrites: a banner asks which version to keep. If an agent touches a file you have open, a clean buffer silently refreshes; a dirty one gets the same banner.
- **Unsaved edits survive** — switch files or screens and your edits stay, marked by a green dot in the tree. The editor follows the app theme (light/dark · all 6 accent palettes) and ⌘F search is localized.

<details>
<summary><b>Highlights from earlier versions</b> — v2.5 through v2.12.0</summary>

- **v2.12.0** — image previews in the change diff (before/after side by side) · real file line numbers · code map redesign with floating edges + direction arrows · code search grouped per file with match highlights and line jump
- **v2.11.0** — Claude Code edit diffs inline · approval cards carry the command/diff payload · waiting-for-approval sidebar badge · Korean IME Enter fix · a pile of chat-screen friction removed (auto-grow, recall, drag & drop, turn receipts, reconnect)
- **v2.10.3** — double-clicking the title strip only resizes · one broken piece no longer blanks the whole window (universal render boundary)
- **v2.10.2** — right-side terminal dock · draggable detached window · macOS tiling shortcuts (⌃⌥←→↑↓) restored
- **v2.10.1** — ⌘J terminal dock · detach into a window with the shell intact · Claude Code's to-do list · limits and model fallbacks recorded in the conversation
- **v2.10.0** — Claude Code runs inside the app (Agent Client Protocol)
- **v2.9** — projects as windows and tabs — Chrome-style tabs · tear-off · per-project state
- **v2.8** — English UI · Skill shop (25 vetted third-party skills) · terminal cleanup
- **v2.6 – v2.7** — the start screen becomes a cross-project cockpit · the Retro screen (7/14/30-day signals)
- **v2.5** — the Claude Code plugin (section below) · planner ▶Run dispatch · 3-level plans · the project-inception skill · a 60% AGENTS.md token diet
- Menubar residency (v2.3) · direct Claude integration (v2.2) — full history in the [CHANGELOG](CHANGELOG.md)

</details>

## Screens

- **Today** — everything that changed today, organized by workday: the commit graph, uncommitted changes, and an honesty audit that catches files agents modified but never journaled. "Copy standup" puts yesterday-to-today into your clipboard as shareable text.
- **Journal** — the timeline of what your agents did. Each entry shows which agent ran on which model, and keeps the change diff from that moment. Repos with no journal history can be backfilled from git in one pass.
- **Discussions** — the step *before* deciding what to do: define the problem, compare options, reach a conclusion — then promote it to a Planner document with one click.
- **Planner** — living plan documents. Every item links to the journal entries that touched it, and an opt-in auto-reconcile keeps plans in sync as new journal entries arrive.
- **Diff** — review what agents changed, offline. `j`/`k` moves between files, `/` searches inside the diff, and the code graph computes how far each changed file's impact reaches.
- **Retro** — what shipped and where you got stuck over the last 7/14/30 days, plus effort hotspots. AI-generated retrospectives, PR bodies and weekly reports, and `.md` export live here.
- **Code search** — three modes: semantic (local embeddings), symbol (AST), and full-text (FTS5).
- **Code map** — a dependency graph that goes beyond imports to calls, inheritance, and implementations. Pick a file and see "changing this affects N files" first.
- **Code** — an in-app code viewer and editor. Jump straight to a line from search or the code map, make a quick edit with syntax highlighting, save with ⌘S. A conflict banner protects you when an agent edits the same file, and unsaved edits survive screen switches. For heavy editing, "Open in external editor" hands off with the cursor line.
- **Docs** — browse your project's `docs/` folder like a wiki.
- **Terminal** — a PTY terminal inside the app. Run your agent here and watch journal entries stack up on the next screen over. **⌘J docks it onto any screen (bottom, left, or right), and it detaches into its own window** without dropping the shell. Also the escape hatch for CLI-only interactive features like `/plugin` and `/mcp`.
- **Claude Code** — runs a real `claude` inside the app as an agent (Agent Client Protocol). Tool calls, permission approvals, and Effort/mode all arrive as cards in the conversation, and sessions are managed as tabs. This is the screen where you tell it what to do.
- **AI panel** — chat that knows your code search, journal, planner, and git context. Supports Anthropic · OpenAI · Gemini · OpenRouter, with a fallback chain when a call fails. This is the screen where you ask it things.
- **Skills & rules** — manage Claude Code skills (`.claude/skills/`) and rules (`.claude/rules/`, `CLAUDE.md`) per project. Create and edit them in a GUI, and copy them between a project and your global `~/.claude/skills`. Disabling a skill doesn't delete it — it moves to `.disabled/` and simply drops out of loading. The **Shop tab** installs vetted third-party skills matched to your stack, 25 of them, in one click.

⌘1–⌘0 jump between screens, the ⌘K palette opens journals, plans, discussions and docs by title, ⌘P switches projects, and ⌘⇧M opens project management. Windows and tabs: ⌘T new tab · ⌘W close tab · ⇧⌘N new window · ⇧⌘W close window · ⌃Tab · ⌘⌥←→.

Pick your UI language — **한국어 · English** — in Settings → Appearance. The language your AI writes documents in (journals, retros, plans) is a separate setting that defaults to following the UI.

## Supported agents

Anything that can read `AGENTS.md` works.

- Zero setup: **Claude Code · Codex CLI · Gemini CLI · Antigravity · pi**
- Enable their rules file in Settings → Agents: **Cursor · Windsurf · GitHub Copilot · aider · Cline · Zed**
- **Claude Code · Claude Desktop** go one step further — hooks (precise session detection) and MCP tools (structured recording, plan queries) integrate directly (v2.2.0). Claude Code also runs as an in-app agent from the **Claude Code screen** (v2.10.0, Agent Client Protocol).

Git backfill tells agents apart by commit signatures.

## The Claude Code plugin — start without the app

Two lines in your terminal's Claude Code and recording begins:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

One plugin configures, across all your projects: a **hooks bridge** (session start/end as real-time signals — one local file append, no network), **5 MCP tools** (`journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init` — agents record through structured tools instead of imitating markdown, eliminating frontmatter errors), and **5 skills + `/oculpm:standup`** (recording spec · project-inception · self-audit · run-evals · tdd-workflow). It only acts in `.oculpm`-tracked projects and never touches untracked repos — see the [full read/write contract](docs/claude-integration/06-plugin-contract.md). Note it is an either/or with the app's per-project hook/MCP registration (the settings screen warns about double registration).

> The in-app **Claude Code screen** records without this plugin — the app attaches its journaling tools (MCP) to every session directly. Interactive CLI commands like `/plugin` and `/mcp` don't work inside in-app ACP sessions, so install the plugin from a terminal. The distinction is written up in the [wiki's Claude Code guide](https://oculpm.com/wiki/claude-code) (Korean).

## Install

Grab `Ocul-PM_x.y.z_aarch64.dmg` from the [latest release](https://github.com/bunhine0452/Ocul-PM/releases/latest) and drag it into `Applications`. It's built for macOS (Apple Silicon), and once installed it auto-updates in place.

The app isn't Apple-notarized yet, so the first launch may claim it "is damaged and can't be opened". It isn't — that's macOS quarantine. One line in the terminal fixes it:

```bash
xattr -dr com.apple.quarantine /Applications/Ocul-PM.app
```

The first semantic search downloads an embedding model (~135MB) once. After that it works offline.

Stuck on something? The [wiki](https://oculpm.com/wiki) collects common problems and fixes (Korean).

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
- [ ] Apple notarization
- [ ] Team sync (opt-in)

## One more thing

This repository is itself tracked by Ocul-PM. Open `.oculpm/journal/` and you'll find the actual journals agents wrote while building this app. Bugs and ideas go to [issues](https://github.com/bunhine0452/Ocul-PM/issues) — and if you like it, a star helps more than you'd think.

## License & promise

[MIT](LICENSE) © 2026 Kim Hyunbin

**Everything in this repository today stays free and MIT, forever.** Individual use is free forever — at work or at home. Paid plans will only ever apply to upcoming team features (sync server · team view — a separate module). Core features will never move behind a paywall.

Contributions are accepted under the [DCO (sign-off)](CONTRIBUTING.md), no CLA — the core stays MIT forever, so there is no reason to pool copyright.
