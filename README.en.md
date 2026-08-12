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

## 🚀 v2.8 — English support · Skill shop · Terminal cleanup

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
- **Terminal** — a PTY terminal inside the app. Run your agent here and watch journal entries stack up on the next screen over.
- **AI panel** — chat that knows your code search, journal, planner, and git context. Supports Anthropic · OpenAI · Gemini · OpenRouter, with a fallback chain when a call fails.
- **Skills & rules** — manage Claude Code skills (`.claude/skills/`) and rules (`.claude/rules/`, `CLAUDE.md`) per project. Create and edit them in a GUI, and copy them between a project and your global `~/.claude/skills`. Disabling a skill doesn't delete it — it moves to `.disabled/` and simply drops out of loading. The **Shop tab** installs vetted third-party skills matched to your stack, 25 of them, in one click.

⌘1–⌘0 jump between screens, the ⌘K palette opens journals, plans, discussions and docs by title, ⌘P switches projects, and ⌘⇧M opens project management.

Pick your UI language — **한국어 · English** — in Settings → Appearance. The language your AI writes documents in (journals, retros, plans) is a separate setting that defaults to following the UI.

## Supported agents

Anything that can read `AGENTS.md` works.

- Zero setup: **Claude Code · Codex CLI · Gemini CLI · Antigravity · pi**
- Enable their rules file in Settings → Agents: **Cursor · Windsurf · GitHub Copilot · aider · Cline · Zed**

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
