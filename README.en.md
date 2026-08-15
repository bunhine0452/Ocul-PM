<div align="center">

<img src="https://raw.githubusercontent.com/bunhine0452/Ocul-PM/main/landing/og.png" alt="Ocul-PM" width="440" />

<h1>Ocul-PM</h1>

<p><b>While AI coding agents write your code, Ocul-PM keeps the record.</b><br/>
A local-first project manager for Claude Code · Codex · Cursor · Gemini CLI</p>

[![Latest release](https://badgen.net/github/tag/bunhine0452/Ocul-PM?icon=github&label=download&color=12a06b)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/bunhine0452/Ocul-PM/total?color=12a06b&label=downloads&cacheSeconds=3600)](https://github.com/bunhine0452/Ocul-PM/releases)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Built with Tauri 2](https://img.shields.io/badge/Tauri-2-24C8A0?logo=tauri&logoColor=white)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[oculpm.com](https://oculpm.com) · [Download](https://github.com/bunhine0452/Ocul-PM/releases/latest) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/bunhine0452/Ocul-PM/issues)

[한국어](README.md) · English

</div>

---

The more work you hand to agents, the more you pay a strange new tax: digging back through git log and your own memory to figure out which files Claude Code touched last week and why, or whether the bug Cursor claimed to fix actually stayed fixed. The code survives — the context doesn't.

Ocul-PM starts by planting a single rules file (`AGENTS.md`) in your project folder. Every time an agent finishes a unit of work, it follows those rules and writes a markdown journal entry to `.oculpm/journal/`; the app reads those entries and turns them into a timeline, a daily brief, change diffs, and retrospectives. Because the source of truth is plain markdown, it commits alongside your code and stays readable without the app.

There is no server. Your data lives in the project's `.oculpm/` folder and a local SQLite cache; the only things that leave your machine are the LLM API calls you make yourself and update checks.

## 🚀 v2.11.0 — see what it changes, no more blind approvals

- **Edit diffs on screen** — when Claude Code edits a file, the diff renders right in the tool card (removed lines in red, added in green) with a `+12 −3` badge on the row. This information used to be dropped entirely.
- **Approval cards show the payload** — the diff for edits, the exact command for executions, inside the card. No more approving on a title alone. Execute/delete approvals wear a different face.
- **Waiting-for-approval badge in the sidebar** — a blinking badge tells you the agent is blocked on *you*, even from another screen.
- **Korean IME Enter fix** — the Enter that commits a Hangul composition no longer sends the message.
- **A pile of friction removed** — auto-growing composer · ↑/↓ prompt recall · drag & drop file attachments · per-conversation drafts · queue delivery pinned to its conversation · turn receipts ("7 tools · 3 files · 1m 12s") · copy buttons for responses and tool output · "Send again" on errors · dead-process detection with one-click reconnect.

## v2.10.3 — double-click resizes the window, and no more blank screens

- **Double-clicking the empty strip at the top of the window** — that strip is the title bar, but "double-click = new tab" was layered on top of it, so one double-click **resized the window and opened a tab at the same time.** Now it only resizes (new tabs are still `+` and `⌘T`).
- **Start tab → Settings → ocul-pm** — opening it before any project was picked turned **the entire window blank**, with a restart as the only way out. Now it just says to pick a project first.
- **One broken piece no longer takes the window with it** — an error is confined to that piece, which shows a "Try again" button in place. Other tabs and the tab strip keep working.

## v2.10.2 — dock on the right, drag the detached window

- **Three dock positions** — the move button cycles **bottom → left → right → bottom**. The two vertical positions share one remembered width.
- **Drag the detached terminal window by its top strip** — that window has no title bar, so the app has to offer the grab area itself; it was missing, which left the window **impossible to move.**
- **macOS window tiling shortcuts (⌃⌥←→↑↓)** — they worked everywhere except here. Reclaiming `⌘W` meant building the menu by hand, and **macOS was never told which submenu is the Window menu**, so the "Move & Resize" items were never created.

## v2.10.1 — a terminal on every screen

To see a shell you had to leave for the Terminal screen, then leave again to read a journal entry or a plan. Now **⌘J** opens a terminal right on top of whatever you are looking at.

- **Pick where it docks** — **bottom** (wide) or **left** (tall). Drag the edge to resize; it remembers where and how big you left it.
- **Detach it into its own window** — the **shell keeps running, scrollback and all**. The app keeps a placeholder telling you where it went, with a button to bring it back.
- **Terminal font size in Settings, in px** — Settings → Appearance now has a slider, a px field, and a **preview drawn in the actual terminal font**. The Terminal screen, the dock, and detached windows all share one value.
- **Claude Code's to-do list shows up** — the plan the agent builds now appears once per turn, and Claude Code inside the app **writes work journal entries itself** (wired to ocul-pm's journaling tools).
- **Hitting a limit — or a model swap — is recorded in the conversation** — usage limits, auth failures, provider overload, and **model fallbacks** used to be silent.

## v2.10 — Claude Code runs inside the app

The AI panel used to be just a chat bolted onto an LLM provider — actual coding all happened in a terminal CLI, and the app only picked up the trail through file watching and hooks. There's now a new screen, **Claude Code**, in the sidebar. Ask it to do something there and a real `claude` runs inside the app — editing files, calling tools, asking for approval (via the Agent Client Protocol). It reuses your existing subscription login, and the adapter installs itself on first run.

- **Session tabs · tool cards** — the top bar becomes a row of conversation tabs. Tool calls like file edits and command runs arrive as collapsible cards, and permission requests before a tool runs show up as cards too.
- **Effort and permission mode on one track** — pick thinking effort and permission mode (manual approval · auto-accept edits · plan · unrestricted) together. The top tier, **ultracode**, turns out to be a prompt keyword, not a setting.
- **Image paste · model-switch dividers · a widget for `/usage`** — paste a screenshot straight in, get a divider line in the conversation when you switch models, and `/usage` now opens a dedicated dashboard instead of crowding the conversation.
- **A terminal escape hatch** — features that live only in the CLI's own interactive screen, like `/remote-control`, get launched as a real `claude` in a terminal tab instead. The terminal screen also lets you type an exact font size in px now.
- **Updates no longer cut the conversation short** — the restart is deferred, and when the app reopens you're back in the conversation you were having.

## v2.9 — projects as windows and tabs

- **One window holds several projects as tabs** — just like Chrome. Drag a tab to reorder it, or drag it out to spawn a new window. Each project remembers its own screen, filters and sidebar state, and **terminal sessions are bound to the project**, so they survive a tab moving between windows.
- **A new tab is a start tab** — `⌘T` opens the project list, and picking one converts that tab **in place**. `⌘W` closes the **tab**, not the window (the window closes when it's the last tab). Close the window with `⇧⌘W`, open a new one with `⇧⌘N`, move between tabs with `⌃Tab` · `⌃⇧Tab` · `⌘⌥←→`.
- **The start screen was rebuilt** — the three-tier bento is gone; **every registered project** now lays out in a single grid you take in at a glance. Cards open from anywhere on the card, not just the name, and each project takes **one of 8 colors and 10 icons** so tabs stay tellable apart by shape (derived from the name if you don't pick).
- **The menubar now watches every tracked project** — file watching used to be tied to a tab's lifetime, so **a project without an open tab went unnoticed even when its agent wrote journals**. Fixed alongside: the menubar popover follows your theme, "Open app" opens the project you actually selected, and the icon no longer spins.

## v2.8 — English support · Skill shop · Terminal cleanup

- **The app speaks English (v2.8.5)** — pick your UI language in Settings → Appearance and all 12 screens switch over. Not just labels: **error messages**, the journals, retros and plan items your AI writes, and the `AGENTS.md` planted into new projects follow along. **UI language and AI writing language are separate settings** (English UI, Korean journals is a valid combination), and documents already on disk are never rewritten. The ⌘K palette matches in both languages, so your muscle memory survives the switch.
- **Skill shop (v2.8.0)** — the **Shop tab** on the Skills screen detects your project's stack (manifest-based — zero LLM, zero network) and recommends from a **catalog of 25 vetted third-party skills** (all MIT, commit-pinned vendored copies, unmodified). Search, filter by tag, preview the body, install into `.claude/skills/` in one click — it's a native Claude Code feature, so it works without the plugin. Full catalog: [oculpm.com/plugin](https://oculpm.com/plugin). Shipping alongside it, a **delivery gate** catches sessions that changed code but wrote no journal, once per session, and tells the agent to record.
- **Project management screen (v2.8.1)** — `⌘⇧M` lays every registered project out as a **flat table**: search by name/path, sort by last activity, entry count or name, and **remove several at once** via checkboxes. Whether to also delete the folder's `.oculpm` · `AGENTS.md` is a separate opt-in at the confirmation step (off by default — the project only leaves your workspace).
- **Terminal Korean input & paste fixes (v2.8.2 · v2.8.3)** — Korean glyphs rendering larger than Latin ones, characters and spaces being delivered twice while a Korean IME was active, and pasted text arriving twice — where the second copy skipped bracketed paste and could **execute each line as a command**.
- **Typography and speed (v2.8.4)** — the body typeface is now **Pretendard**, and 96 places where the designed font weight wasn't actually rendering are fixed. The diff screen loads its syntax-highlighting data only when you open it (266KB → 125KB right after opening a project), and the first code indexing batches its chunk writes.

## v2.6 – v2.7 — the first screen, and retros

- **Bento cockpit home** — the resume tile gathers your next tasks (active plan), latest entry, a 14-day activity sparkline, and the last agent + model in one place; the flow tile streams today's journals across all projects. Type anywhere to search (Korean initial-consonant matching included), `↓↑⏎` to move and open, `⌘O` folder · `⌘N` new project · `⌘E` rename · `⌘⌫` remove.
- **Unrecorded-session signal** — Claude Code sessions that end without a journal are detected and surfaced as a Today card (auto-resolved once recorded), plus a statusline badge and `/oculpm:inception` · `/oculpm:next` commands.
- **[Via Claude Code] retro generation** — a terminal session writes the retro to `.oculpm/retro/` markdown, no API key or billing. Recurring tags surface as **skill candidates** to promote into `.claude/skills/`, and `project_init` starts tracking a new project with the plugin alone (explicit confirmation required).

## v2.5 — Claude Code plugin, and plans that drive implementation

**Recording starts without the app.** Two lines in Claude Code:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

One plugin configures, across all your projects: a **hooks bridge** (session start/end as real-time signals — one local file append, no network), **5 MCP tools** (`journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init` — agents record through structured tools instead of imitating markdown, eliminating frontmatter errors), and **5 skills + `/oculpm:standup`** (recording spec · project-inception · self-audit · run-evals · tdd-workflow). It only acts in `.oculpm`-tracked projects and never touches untracked repos (the sole exception: `project_init`, which starts tracking only after you explicitly ask and confirm) — see the [full read/write contract](docs/claude-integration/06-plugin-contract.md). Note it is an either/or with the app's per-project hook/MCP registration (the settings screen warns about double registration).

**The planner becomes a steering wheel**: press **▶Run** on a plan item and a prompt assembled from the item, its linked journals and update instructions is prefilled into the terminal — one Enter starts a real Claude Code session on it. Plans now nest sub-tasks (parent status rolls up from children), and the **project-inception** skill turns an idea into a problem statement → 3-level plan → `EVALS.md` done-criteria → starter `.claude/rules`, researching the stack landscape first, then settling the optimal spec with you through research-backed choices.

**60% agent-token diet** — the always-injected rules file (AGENTS.md v7) went from ≈2,900 to ≈1,150 tokens with every compliance-critical rule intact.

> Menubar residency (v2.3), direct Claude integration (v2.2) and the full history: [CHANGELOG](CHANGELOG.md).

## Screens

- **Today** — everything that changed today, organized by workday: the commit graph, uncommitted changes, and an honesty audit that catches files agents modified but never journaled. "Copy standup" puts yesterday-to-today into your clipboard as shareable text.
- **Journal** — the timeline of what your agents did. Each entry shows which agent ran on which model, and keeps the change diff from that moment. Repos with no journal history can be backfilled from git in one pass.
- **Discussions** — the step *before* deciding what to do: define the problem, compare options, reach a conclusion — then promote it to a Planner document with one click.
- **Planner** — living plan documents. Every item links to the journal entries that touched it, and an opt-in auto-reconcile keeps plans in sync as new journal entries arrive.
- **Diff** — review what agents changed, offline. `j`/`k` moves between files, `/` searches inside the diff, and the code graph computes how far each changed file's impact reaches.
- **Retro** — what shipped and where you got stuck over the last 7/14/30 days, plus effort hotspots. AI-generated retrospectives, PR bodies and weekly reports, and `.md` export live here.
- **Code search** — three modes: semantic (local embeddings), symbol (AST), and full-text (FTS5).
- **Code map** — a dependency graph that goes beyond imports to calls, inheritance, and implementations. Pick a file and see "changing this affects N files" first.
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

## Install

Grab `Ocul-PM_x.y.z_aarch64.dmg` from the [latest release](https://github.com/bunhine0452/Ocul-PM/releases/latest) and drag it into `Applications`. It's built for macOS (Apple Silicon), and once installed it auto-updates in place.

The app isn't Apple-notarized yet, so the first launch may claim it "is damaged and can't be opened". It isn't — that's macOS quarantine. One line in the terminal fixes it:

```bash
xattr -dr com.apple.quarantine /Applications/Ocul-PM.app
```

The first semantic search downloads an embedding model (~135MB) once. After that it works offline.

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
