<div align="center">

<img src="landing/banner-en.png" alt="Ocul: Not “all done” — a receipt. The app's Today screen on the right." width="100%" />

<img src="landing/demo-en.gif" alt="Ocul demo: answer Claude's question on Today, Claude receives it in the terminal and records an entry and a result, then Journal, Plan and Diff" width="100%" />

<sub>Real screens, filled with this repository's journal; only Claude's question is demo data. Running the agent in your own terminal leaves the same records.</sub>

<h3>Not “all done” — a receipt.</h3>

<p>When Claude Code or Codex says “done”, see what changed and which command proved it — and trust it, or push back, in three minutes. Local Markdown, no account. Every time a coding agent finishes, <b>what it changed and the command that checked it</b> are kept in your project folder as Markdown. Ocul puts <b>only what isn't proven</b> in front of you — failed check commands, entries without command evidence, changes no entry mentions.<br/>
With Claude Code, turn recording on in the desktop app and add two plugin lines. Codex · Cursor · Gemini CLI record through one rules file. No server, no account, and the app never calls an LLM.</p>

[![CI](https://github.com/bunhine0452/Ocul-PM/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bunhine0452/Ocul-PM/actions/workflows/ci.yml)
[![Latest release](https://badgen.net/github/tag/bunhine0452/Ocul-PM?icon=github&label=download&color=12a06b)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/bunhine0452/Ocul-PM/total?color=12a06b&label=downloads&cacheSeconds=3600)](https://github.com/bunhine0452/Ocul-PM/releases)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Windows beta](https://img.shields.io/badge/Windows-x64%20beta-111?logo=windows)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Linux beta](https://img.shields.io/badge/Linux-x64%20beta-111?logo=linux&logoColor=white)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Built with Tauri 2](https://img.shields.io/badge/Tauri-2-24C8A0?logo=tauri&logoColor=white)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/beachcombers)

<a href="https://www.producthunt.com/products/ocul-pm?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-ocul-pm" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1237239&amp;theme=dark"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1237239&amp;theme=light" alt="Ocul — find us on Product Hunt" width="250" height="54" /></picture></a>

[oculpm.com](https://oculpm.com/en) · [Wiki](https://oculpm.com/wiki/en) · [Download](https://github.com/bunhine0452/Ocul-PM/releases/latest) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/bunhine0452/Ocul-PM/issues)

[한국어](README.md) · English

</div>

---

When an agent finishes, it says "all done". Whether the tests really passed, which files it changed and why, what it skipped — none of that is in the sentence. To check, you reread the diff and the logs from the top, and tomorrow's new conversation doesn't even have that context.

Starting takes three steps. ① [Download the app](https://github.com/bunhine0452/Ocul-PM/releases/latest) (macOS; Windows · Linux in beta), open your project folder and turn recording on — that creates `.oculpm/` and the rules file, and the plugin's recording tools ship inside the app. ② Run the two plugin lines in a terminal (inside Claude Code: `/plugin marketplace add …` · `/plugin install …`). ③ Restart any Claude that was open.

```text
claude plugin marketplace add bunhine0452/Ocul-PM
claude plugin install oculpm@oculpm
```

What you need: the [Claude Code](https://code.claude.com) CLI (`claude` runs in your terminal) · `git` (to match changes against entries) · on Windows, Git for Windows (Git Bash). The plugin only acts in projects that have `.oculpm/`, and without the app nothing creates that folder.

**If entries don't arrive**, check in this order — Settings → Agents shows "To fix" and a "Journal entries not arriving" row that point at the same things. ① Is the plugin on for this project (`/plugin` inside Claude)? ② Is the app where it was installed, e.g. in Applications (the plugin finds the app's recording tool there)? ③ Is the app's live refresh still on? ④ Does the project have `.oculpm/` (without it hooks and tools do nothing — turn recording on in the app)? ⑤ Does `claude` open from your PATH?

Ocul leaves a receipt instead of that sentence. Plant a single rules file (`AGENTS.md`) in your project folder and the agent writes a markdown journal entry to `.oculpm/journal/` every time it finishes a unit of work; the next conversation receives those entries and the remaining plan — done condition · check command · last result — as its starting context and carries on. From that record the app unfolds **only what a person needs to look at**: failed check commands, entries without command evidence, changes no entry mentions, blocked items, decisions that are yours to make. Work that has its evidence folds to one line. Because the source of truth is plain markdown, it commits alongside your code and stays readable without the app.

There is no server. Your data lives in the project's `.oculpm/` folder and a local SQLite cache, **the app calls no LLM, and its screens (the webview) reach no outside host.** The only things that leave your machine are the ones you start — the update check, and links you click (your OS browser opens them). The full list, countable for yourself, is at [oculpm.com/privacy](https://oculpm.com/privacy), and the build keeps it honest (`src-tauri/tests/egress_inventory.rs`).

> **The promise is ten sentences** — [docs/PROMISE.md](docs/PROMISE.md) (Korean). One rules file makes the agent write a journal entry, the entry shows up in seconds, a diff is attached, Today unfolds only what you need to look at, the next conversation inherits the done condition · check command · last result, and the data never leaves your machine. The app is five screens — **Today · Journal · Plan · Diff · Terminal** (Settings opens with ⌘,; a start window shows when no project is open). One principle: **show only the exceptions** — the screen grows with what a person must see, not with how much the agent did, so someone with 3 entries a day and someone with 60 use the same screen with no modes. What was removed, and the measurements behind it, are in that document too.

## One round trip — work · entry and result · resume

This one round trip matters more than any feature list. Try it in the project you actually work in.

1. **Work** — ask Claude Code in your terminal for something, the way you always do. Pick the folder in the app and turn recording on to plant `AGENTS.md`; [two lines in `/plugin`](#the-claude-code-plugin) add the hooks and the recording tools.
2. **Entry and result** — when the work is done the agent writes its entry, and with the app open it appears in Journal and Today within seconds. An entry whose verification section has no command and last result line lands in Today's "Finished without verification". Running the plan's check command leaves one line, `판정 ✓|✗ <last line of output>` (`verdict ✓|✗` in English; the app shows it as “Check passed / failed”), which becomes the "last result" right under the plan's title.
3. **Resume** — open a new conversation the next day and the plugin's SessionStart hook loads the recent plans' done condition · check command · last result · open items and the last three entries into the starting context. [Run in terminal] on Today and Plan (`r` on Today) has `claude` pick up the next item in a new session of the in-app terminal, and [To the end (/goal)] hands the plan's done condition and check command to Claude Code's `/goal`, so it keeps going until the check command passes. You don't explain yesterday again.

This round trip is checked by a person on every release, on the **terminal Claude Code + oculpm plugin** path. Other agents (Codex · Cursor · Gemini CLI …) do steps 1–2 from the rules file alone (Codex has hooks too) — the tier table under [Supported agents](#supported-agents) spells out the difference.

## Why results get better — a place for the five principles of using agents

How to use a coding agent well is close to settled. [Anthropic's Claude Code guide](https://code.claude.com/docs/en/best-practices), [Simon Willison's agentic engineering patterns](https://simonwillison.net/2026/Feb/23/agentic-engineering-patterns/), [Sonar's 2026 developer survey](https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/) and [METR's productivity measurements](https://metr.org/blog/2026-02-24-uplift-update/) say the same five lines. The problem is that all five vanish on `/clear`, and Ocul is where those five questions survive the session boundary ([Rieseberg's altitude, depth and range](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/), as is).

| Principle | Source | Where it lives in Ocul |
|---|---|---|
| ① Write a **done condition** as an outcome before code | Anthropic "write the spec first" | One `**Done when:**` line per plan — not a to-do, but "what must be true to be done, and what should happen next". The session-start hook ships it before the items, and the Plan screen shows it right under the title |
| ② Give the agent **something that passes or fails** | Anthropic "something it can run that comes back pass or fail" · Willison "first run the tests" | The plan's `**Check:**` command. Its result is logged as `verdict ✓|✗ <last line>` and the start hook and the Plan screen read the "last result" by the same rule — all items closed is not done until the check command passes. `/oculpm:inception` makes that command in the first item and shows it red now |
| ③ Take **the command and its output**, not a claim, as evidence | Anthropic "'All tests pass' tells you very little" | The entry's verification section. An entry with no command evidence lands in Today's "Finished without verification", and the verification box in Journal calls it "a claim" |
| ④ Green tests are not a running program — **run it** | Willison "passing tests don't mean the server boots" | Rules template v20, "the check is something that isn't you" — if there's no check command, make one first; even when green, launch it and use it once if you can. Failures get an error entry too |
| ⑤ An **outside judge** decides | Sonar: 96% distrust, 48% always check · METR: feeling ≠ measurement | `/oculpm:redteam` hunts counter-examples before a merge. The target for the share of entries with outside-judge evidence is a number in [PROMISE.md](docs/PROMISE.md) (97%) |

What it doesn't give is written down too. Ambition itself is the human's job — Ocul doesn't write the done condition for you and doesn't decide pass or fail for you. It asks and points; it never blocks.

## 🚀 v4.13 — Something developers and AI users can love

A first-time developer is no longer stopped by a false "connected" or "nothing here", an agent no longer edits plan files by hand, and the five screens show the exceptions first. Fourteen lanes across a dev team and a design team fixed the 121 findings seven scouts turned up, each lane checked by an independent review.

- **An honest first ten minutes** — the plugin reads "connected" only when this project has it switched on; otherwise it says what is missing and puts the one command to copy right there. A folder that isn't a git repo, a missing claude, live updates that stopped — each is said plainly, and Settings has a "Journal entries not arriving" check.
- **Agents keep the plan through tools** — `plan_update` adds items, locks decisions and records a check result on its own, and a wrong call hears every missing argument at once. Items owned by a person (`[user]`) are never suggested as "next", and a claude started in a subfolder still reaches the repo's records.
- **Cursor · Gemini CLI get the recording tools** — registered into that project's `.cursor/mcp.json` · `.gemini/settings.json` only when you press the button in Settings. The Codex plugin gains next · inception · redteam.
- **"Since I looked" · receipts everywhere** — viewed files fold into "Viewed N" and only those changed afterwards open again. ⇧⌘C copies a receipt from Today, Journal or Changes, and it saves as a single HTML page too.
- **Keep awake · terminal** — the machine stays awake only while Claude works (Settings, off by default). ⌘V of files copied in Finder pastes their paths, copies from tmux · ssh (OSC 52) reach the clipboard, right ⌥ types @ · €, and `.worktreeinclude` brings `.env` into a race lane.
- **Five screens, exceptions first** — failing plans at the top of the list, no warning colour on chores, a narrower list and wider diff in small windows, `?` for "Keys for this screen", a "This screen" group in ⌘K, and "What goes out of this device" in Settings.

## Earlier releases at a glance

The per-release narrative is in the [web changelog](https://oculpm.com/changelog) and [CHANGELOG](CHANGELOG.md). Below, one line per theme — many of these screens were removed on 2026-10-28 and in 4.0; the reasons are in [PROMISE.md](docs/PROMISE.md).

- **Keeping up when agents run ahead** (4.12) — the plugin's MCP tools on Windows too, one nudge when an item closes without running the check, actions auto mode denied · new kinds of waiting, files you only pulled are not "changed since the pass", screens that stay quiet at volume. 4.12.1 keeps Windows updates from stopping at "couldn't close Ocul-PM".
- **More exact, quieter, faster** (4.11) — a terminal built for Claude Code (Shift+Enter newline · sessions named after their conversation · no freeze on big output · cleaned pastes), ⌘J to the waiting session, Today in one column, an exact diff with "viewed", "Run in shell" for the check command, a Claude Code theme file
- **A smoother Windows install and update** (4.11.2) — a % bar while downloading and "Updating Ocul" while it swaps, waiting for a running claude in the terminal before swapping, updates no longer logging sessions as crashes, and an installer that looks like Ocul (art · welcome text · "Open Ocul now").
- **Working across a Mac and a Windows PC** (4.10) — a ✓ pulled in from another machine reads "Not checked here" (the result line ends with the OS it ran on), "Only on this machine" on Today (uncommitted changes · unpushed commits), the project colour follows the repository through `.oculpm/config.toml`, and an older app no longer writes the journaling-spec file (`journal-spec.md`) back.
- **Windows: Korean typed twice in the terminal, SessionEnd hook cut off** (4.9.3) — the pane where you pressed Alt+V entered every Korean syllable twice, and the plugin hook cut off with "Hook cancelled" when Claude Code exits (it now ends in 0.24s and writes the result and record after).
- **Queue messages while Claude works** (4.9) — "Send to Claude" waits while Claude is working or asking, then goes in ("Send now" ⇧⌘↩), nested repositories' `.gitignore` are followed, and one update check for the whole app.
- **Lighter on Windows: terminal · git · plugin hooks** (4.9.2) — a terminal that keeps up during builds, git usually started 0–1 times, the plugin's session-start hook from 20s+ to under 2s, and an installer without the Visual C++ Redistributable.
- **Windows: one title bar with the app, PowerShell 7 in the terminal** (4.9.1) — minimize · maximize · close in the top bar's corner, PowerShell 7 when `pwsh` is installed, a running terminal asks before it closes, and records that failed with "Access is denied".
- **Arrange 2–6 windows, pick your app icon** (4.8) — layout buttons in the ⌘O list arrange your 2–6 most recent windows (⌥⌘T does six), nine app icons (macOS), the start window as a table whose columns line up, previews for terminal image paths that wrap, and a narrow-window top bar that measures and folds one step at a time.
- **Switch windows with ⌥Tab, each window in its own colour** (4.7) — the ⌥Tab window switcher (a tap goes to the previous window), the whole top bar in the project colour, and a fix for uncoloured projects' dots following the current window's colour.
- **Windows side by side, screens like a receipt** (4.6) — ⌥⌘T tiles project windows at the same width, VS Code opens per project, the project colour tints the whole window, colour only for exceptions (the "receipt" rule, DESIGN.md), and a fix for background windows showing blank.
- **Ocul and VS Code, as a pair** (4.5) — project colours on the VS Code title bar, open an entry's changed files in VS Code, "Open in Ocul" from the extension, the Ocul VS Code extension 0.3.0 (panel · one status-bar item · a waiting notification), and finding updates as soon as you're back online (4.5.1).
- **Many windows, many terminals, at your fingertips** (4.4) — project colours (a band across the top · a dot before the name · the ⌘O list), ⌘W closes the terminal session first, a working session asks before it closes, ⇧⌘[ ] between sessions, ⌘= ⌘- ⌘0 text size, type to filter ⌘O.
- **Stale passes flagged, the terminal in many panes** (4.3) — Today flags files saved again after a ✓ check, plus the re-fix warning (plugin) · PR receipt · teammates' entries · the result line, terminal split panes · find, Open in VS Code · the waiting window · the Ocul VS Code extension 0.2.0 (4.3.1 · 4.3.2).
- **Pick from several, comment per line** (4.2) — run one task in 2–4 worktrees of claude and pick by evidence, line notes → Claude (Fixed · Open on their own), drag from Finder · image previews, windows down to 480pt, entry titles as "Area: what was done".
- **Talking with Claude, and the name is Ocul** (4.1) — the visible name Ocul (the install name stays), one line on Today plus an OS notification when Claude waits, answering Claude in the app through the MCP tool `ask_user`, "Send to Claude" · `/goal`, ⌃Tab · ⌥⌘1–9, a first-run guide.
- **Five screens, exceptions only** (4.0) — Today · Journal · Plan · Diff · Terminal (Settings is ⌘,) remain, and Today unfolds only failed check commands · entries without evidence · unrecorded changes · blocked items · decisions that are yours. A plan ends at its **last result** (the check command's last result line), not its items. The app calls no LLM (summaries · rollups · automation · semantic code search are gone), one window = one project, rules template v20.
- **Records you can trust** (3.2 → 3.17) — a review is bound to the content it saw (3.2), two processes can no longer overwrite the same entry (3.2), an "evidence" grade on every entry and a plugin-version check (3.15.1), done condition → check command at the head of every plan (3.16), a start hook that hands the last entries to the next session (3.4), and finding and linking at 700 entries (3.4).
- **Safe to open someone else's repository** (3.8 → 3.11) — repository settings alone never start background work, secret masking is always on, symlinks can't reach outside the project, a CSP on the screens, and repository-chosen commands run only after you trust the project.
- **Windows · Linux beta** (3.6 → 3.13.7) — only OSes whose build passes install → launch → real-app E2E on CI runners ship. Releases go CI-green tag commit → draft → signature, notarization and updater-signature checks → public (3.2).
- **Shrinking** (3.7 → 3.13.6) — the Sessions (A2A) screen (3.7), Notion (3.13), the mobile beta · debugger · Code Map · remote theme gallery · VS Code extension (3.13.6).
- **v2.5 → v2.48** — the Claude Code plugin (2.5), English UI (2.8), Chrome-style tabs (2.9), in-app editor · LSP · debugger · terminal · in-app agents (2.10 → 2.47), theme files (2.28), a web changelog and privacy ledger (2.31), removing the "made by AI" look (2.33), the repository counting its own outbound connections (2.43), signed and notarised builds (2.45). Most of that era's side screens were removed in later releases.

## Screens

The app is five screens (Today · Journal · Plan · Diff · Terminal) plus Settings. One principle — **show only the exceptions.** On first launch, the four-page "Getting started" guide walks through this briefly; reopen it from the Help menu or ⌘K.

<p>
<img src="landing/shots/v4/en/today.webp" alt="Today: Look first (Claude's question and wait, a failed check command, changes with no journal) and entries finished without verification" width="49%" />
<img src="landing/shots/v4/en/journal.webp" alt="Journal: the list and an entry's body" width="49%" />
<img src="landing/shots/v4/en/planner.webp" alt="Plan: done condition, last result, items by phase" width="49%" />
<img src="landing/shots/v4/en/diff.webp" alt="Diff: files with no entry first, Ask for an entry, line-by-line diff" width="49%" />
</p>

- **Today** (⌘1) — one column. On the right of the date line, **one line of numbers** — Your turn (the human-owned share of plans) · Plans to close · From other machines (entries written on another machine or by a teammate) · Not on other machines (journal and plan files not pushed yet). A zero isn't shown, and each number takes you to what it counts. With nothing arrived but more than a day since the last sync it says "Last pushed or pulled N days ago", and when something isn't pushed, "Ask Claude to push" has Claude commit and push it. Below that, **"Needs your eyes"**: Claude asks (answer it right there) · a waiting session · failed check commands · changed after pass · a ✓ from another machine · changes with no journal · conversations that ended without an entry · blocked items · a plugin update, with the next item and [Run in terminal] as its last row. When it's empty, one calm paragraph. Then "Finished without verification" (Read · Mark all read; past five rows, "N more" opens Journal's "Unverified only"), who is working now, and on the right "Done today" grouped by plan (a group whose evidence is complete folds to one line). `j`/`k` move · `↩` row action · `v` read · `r` run next.
- **Journal** (⌘2) — a list on the left (by date · type · evidence) and the detail on the right. In the list an entry with command evidence is one line and only exceptions (no verification · unfinished · aborted) take two; entries none of whose touched files exist anymore fold into "Entries about code that is gone" at the end of their day. The detail starts with the verification box (the command that ran and its last result line, or "a claim" when there's none), then the body, an inline diff per recorded file, related entries. The "Plan … #item" in the header jumps to that plan item. `j`/`k` move and `v` marks read, so you can read straight through. Journal search (`/`) lives here — titles · files · tags · body, with entries about code that is gone ranked last.
- **Plan** (⌘3) — `.oculpm/planner/*.md` is the source. Right under the title: done condition · check command · **last result** (the same four states as Today — passed · failed · changed after pass · passed on another machine; "Not run yet" when there is none), the next item with [Run in terminal] · [To the end (/goal)], and items by phase. [Run in shell] beside the check command shows the full command in a confirm dialog and only then runs it in a new shell session (writing the result line stays Claude's job). Click an item's box to change its status; every item has "Send to Claude". A plan with nothing left gets "Close plan" (the notification's "Undo" reopens it). `j`/`k` items · `[` `]` plans · `↩` status · `r` run next. Creating and editing plans is the agent's job (`plan_create` · `plan_update`).
- **Diff** (⌘4) — uncommitted / last-commit diffs, offline, line by line. **"No entry"** (files no entry mentions) comes first, the rest grouped by entry. "Copy receipt" in the top bar copies this branch's work and check results as Markdown for a PR description. A file with no journal gets [Ask for an entry] (asks the in-app terminal's claude to record it) and [Record it myself]. One line per file (M · A · D), unified / split, changed words highlighted · ignore whitespace · generated files folded, and "Viewed" per file (`v` — flagged again if it changes after). A cut diff says how much in numbers ("64 KB / 212 KB shown"). Hover a line for "+" to leave a note, hand the notes to Claude in one go ("Hand N notes to Claude"), and each sent note shows on its own whether its line changed (Applied · Not yet). Files you mark "Viewed" fold away, and only the ones an agent changes again open back up in place; ⇧⌘C copies the receipt from Journal and Today too, and a receipt can be saved as one HTML page. A journal's result carries a source chip, so a check only the agent claimed reads "No command".
- **Terminal** (⌘5) — in-app sessions started in the project folder. They end with the window or the app, and closing while something runs asks first. One session is just the terminal; two or more get a tab row on top. Claude Code's status signal tells it working · waiting · done, and a session is named after the conversation title Claude Code sends. Tabs show only the name and exceptions (waiting · no journal · ended), and a band above the pane flags waiting · ended without an entry · "Reopen" for an ended session. In Claude · Codex input Shift+Enter is a newline (Enter in a shell or vim), ⌘L sends the selected output to Claude, pastes go in with control characters stripped, and an image-only clipboard reaches Claude as a picture. ⌘D · ⇧⌘D split panes as often as you like (⌥⌘ + arrows to move, ⇧⌘↩ to expand one, ⌘F to find), "Run side by side" runs one task in 2–4 worktrees for you to pick from, dragging from Finder types the path, and hovering an image path shows the picture.
- **Settings** (⌘,) — one status table: "To fix N" on top, then four sections — Agents (Claude Code plugin · Claude Code theme · Codex · Direct MCP registration) · This project (rules file · location · rebuild the cache) · Appearance (theme · text size · app icon) · App (language · open files in · updates · log folder · compact the cache). The Claude Code theme row is the app keeping a file (`~/.claude/themes/ocul.json`) that matches Claude Code's colours to the Ocul terminal; you pick it with `/theme` inside Claude. The Agents section also shows whether the plugin is really attached to this project (off · only in other projects · app not found), a "Journal entries not arriving" diagnosis, and one-click recording-tool (MCP) registration for Cursor and Gemini CLI; "Keep awake" in the App section stops the machine sleeping only while Claude works (macOS · Windows).
- **Start window** — a window with no project: recent projects and Open folder — pick a folder and that window becomes the project. Removing a project (×) can also move its record folder (.oculpm) to the Trash.

One window is one project. ⌘1–⌘5 or ⌃Tab · ⌃⇧Tab switch screens, ⌘K finds terminal sessions (waiting first) · screens · actions (all shortcuts · open folder · open in editor · arrange windows) · projects · plans · entries (Hangul initial consonants work too — ㅇㅈ → 작업 일지), and ⌘J jumps to the waiting session (longest-waiting first, press again for the next — if none is in this window, it brings forward a project window that has one). ⌘[ / ⌘] or a two-finger swipe go back and forward. ⌘O opens recent projects, ⌥⌘1–9 jumps to a project window in most-recent order (the current project has no number · Alt+1–9 on Windows · Linux), ⇧⌘N opens a new (start) window, ⌘W closes the window. One-letter keys like j · k · v work with a Korean keyboard layout on. Click the project name (▾) in the top bar to see each project's most urgent state as one chip (N waiting · Check failed · New · N running · Open). Pick your UI language — **한국어 · English** — in Settings → App.

## Supported agents

"Supported" hides three different promises, so we split them into tiers. The tiers are read from code, not from marketing copy — the rules-file adapter table (`src-tauri/src/oculpm/agents/`), the MCP registrars (`oculpm/mcp/register.rs` · `mcp/codex.rs`), the hooks (`plugin/*/hooks/`).

| Tier | What it means |
|---|---|
| **1 · Rules-compatible** | Ocul only writes the rules file that agent reads (`AGENTS.md`, a `.claude/CLAUDE.md` block, `.cursor/rules/*.mdc`, `GEMINI.md` …). Journals get written only as far as the model obeys the rules. |
| **2 · Structured journaling** | The agent can call the `oculpm` MCP server's tools (`journal_write` · `plan_update` …). The plugin registers the server (Claude Code), walks you through it (Codex), or Settings writes it for you (Cursor · Gemini CLI). |
| **3 · Session observation** | Ocul receives session start/stop through hooks and can tell when a conversation ended without a journal (the Stop delivery gate · `sessions.json`). |

| Agent | Tier | What Ocul does | Verified |
|---|---|---|---|
| **Claude Code** | 3 Session observation | the oculpm plugin (hooks · MCP tools · skills) · `AGENTS.md` + `.claude/CLAUDE.md` block | v3.0.0 · 2026-09-11 |
| **Codex** | 3 Session observation | the Codex plugin (hooks · guidance for the `~/.codex/config.toml` MCP registration) · `AGENTS.md` (native, no dedicated file) | v2.37.0 · 2026-09-03 |
| **Gemini CLI** | 2 Structured recording | `AGENTS.md` + `GEMINI.md` block · Settings registers the recording tool (MCP) in `.gemini/settings.json` | — (added this release) |
| **Cursor** | 2 Structured recording | `.cursor/rules/ocul-pm.mdc` · Settings registers the recording tool (MCP) in `.cursor/mcp.json` | — (added this release) |
| **GitHub Copilot** | 1 Rules-compatible | `.github/copilot-instructions.md` block | — (shipped v2.0.0) |
| **Windsurf** | 1 Rules-compatible | `.windsurf/rules/ocul-pm.md` | — (shipped v2.0.0) |
| **Cline** | 1 Rules-compatible | `.clinerules/ocul-pm.md` | — (shipped v2.0.0) |
| **aider** | 1 Rules-compatible | `CONVENTIONS.md` block | — (shipped v2.0.0) |
| **Zed** | 1 Rules-compatible | `.rules` block | — (shipped v2.0.0) |
| **Antigravity** | 1 Rules-compatible | `.agent/rules/ocul-pm.md` | — (shipped v1.11.0) |
| **pi** | 1 Rules-compatible | `AGENTS.md` only (no dedicated file) | — (shipped v1.11.0) |

How to read it:

- **Verified** is the latest evidence in this repository's own `CHANGELOG.md` and `.oculpm/journal/` that the tier **actually ran** (app version · date). `—` means the code exists but there is no on-device record; "shipped" in parentheses is the version the CHANGELOG lists the feature under. No dates or versions were invented.
- `AGENTS.md` is always planted when you turn recording on. If you're on a tier-1 agent, glance at Today's "No entry" rows now and then — files edited without a journal show up there.
- One-click MCP registration for Claude Desktop was removed in 4.0 (it never had a single live-connection record).
- **Platform**: official builds are macOS Apple Silicon plus Windows x64 and Linux x64 as a **beta** (see [Install](#install)). The evidence in the table comes from the macOS build — every Windows/Linux release has passed an install smoke test and a real-app E2E run on CI runners, but reports from real users' PCs are still accumulating, so they stay beta. There is no Intel Mac build yet.

Git backfill tells agents apart by commit signatures.

## The Claude Code plugin

Two lines in a terminal and recording begins (inside Claude Code, the same lines as `/plugin …`):

```
claude plugin marketplace add bunhine0452/Ocul-PM
claude plugin install oculpm@oculpm
```

To update, run `claude plugin update oculpm@oculpm`, then restart any open Claude. The app's Settings and Today screens copy the line that matches what this project is missing (install · turn on · update).

For Codex, two lines in a terminal:

```
codex plugin marketplace add bunhine0452/Ocul-PM
codex plugin add oculpm-codex@oculpm
```

One plugin configures, across all your projects:

- **A hooks bridge** — session start/end and the moment Claude waits for you (Notification) as real-time signals (one local file append, no network). The app turns that signal into a "Waiting" row under "Needs your eyes" on Today. The start hook ships the recent plans' done condition · check command · last result · open items and the last three entries.
- **8 MCP tools** — `journal_search` · `journal_read` · `journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init` (starts tracking a new project once the user confirms) · `ask_user` (asks for your decision on the app's Today screen and waits for the answer, up to 25 minutes). Agents record through structured tools instead of imitating markdown, eliminating frontmatter errors, and search the hundreds of accumulated entries *before* starting work — one query tells you why that file was touched before.
- **4 commands + 1 skill** — `/oculpm:inception` (what happens next → four depth questions → the field's methods → a hard numeric goal → a plan whose first item is a red check command) · `/oculpm:next` (claim the item as `[~]` → implement → check command → entry → plan; with `until-done`, until the check command passes) · `/oculpm:redteam` (runs the claims, reports only counter-examples) · `/oculpm:help`, plus the recording-spec skill for when the tools are absent. The seven that overlapped (self-audit · run-evals · tdd-workflow · standup · board · project_init · project-inception) were removed on 2026-10-28.
- It only acts in `.oculpm`-tracked projects and never touches untracked repos — see the [full read/write contract](docs/claude-integration/06-plugin-contract.md).
- The 4.0 app has no per-project hook settings — the plugin is the way, and the "Agents" section of Settings shows whether it's installed along with the install/update command. Its "Direct MCP registration" row is a workaround for running without the plugin or with a plugin older than 4.12 (since 4.12 the plugin's MCP server starts on Windows too, so with both on every tool shows up twice): it writes this project's `.mcp.json`.


## Install

Grab the file for your OS from the [latest release](https://github.com/bunhine0452/Ocul-PM/releases/latest). The name you see inside the app is Ocul; the install files and the installed app keep the name `Ocul-PM`.

| OS | File | Requirements | Updates |
| --- | --- | --- | --- |
| **macOS** (Apple Silicon) | `Ocul-PM_x.y.z_aarch64.dmg` | — | in-app, automatic |
| **Windows** x64 — beta | `Ocul-PM_x.y.z_x64-setup.exe` | Windows 10 2004 (build 19041) or later · 11 | in-app, automatic |
| **Linux** x64 — beta | `Ocul-PM_x.y.z_amd64.AppImage` | glibc 2.35+ (Ubuntu 22.04 · Debian 12 or later) · libEGL · libGLESv2 · FUSE 2 | in-app, automatic |
| **Linux** x64 — beta (Debian · Ubuntu) | `Ocul-PM_x.y.z_amd64.deb` | same as above (no FUSE needed) | your package manager |

**macOS** — open the `.dmg` and drag the app into `Applications`. It's signed with an Apple Developer ID and notarized, so it opens straight from the download — no `xattr` quarantine workaround needed.

**Windows (beta)** — the installer puts the app in your user folder without admin rights. The beta isn't code-signed, so on first launch SmartScreen shows "Windows protected your PC" — click **More info → Run anyway**. On Windows older than 10 2004 the installer explains why and stops.

- Since 4.12 the Claude Code plugin brings its recording tools (MCP) up on Windows too. The hooks need Git for Windows (Git Bash).

**Linux (beta)** — for the AppImage, `chmod +x Ocul-PM_*_amd64.AppImage` and run it; it auto-updates in-app. It needs FUSE 2 (`sudo apt install libfuse2` on Ubuntu 22.04, `libfuse2t64` on 24.04). Install the deb with `sudo apt install ./Ocul-PM_*_amd64.deb` and update it the same way with the next `.deb` — it isn't updated in-app.

Only Windows/Linux builds that pass install → launch → real-app E2E on CI runners are published for each release. A version that didn't pass has no file for that OS, and its release notes say so. Please report what you hit on a real PC as an [issue](https://github.com/bunhine0452/Ocul-PM/issues) — the app's logs are in Settings → App → "Log folder". That's what graduates the beta.

macOS may still ask for **access to files or to other apps' data**. That's a separate gate from notarization and doesn't go away because an app is notarized — [Troubleshooting](https://oculpm.com/wiki/en/troubleshooting) explains why and how to revoke it.

The app is where recording is switched on, and the screen. If a repository already has `.oculpm/` (a teammate turned it on, or a cloud session), the plugin's hooks run without the app, but the recording tools (MCP) use the executable inside the app (or whatever `OCULPM_MCP_BIN` points to).

Stuck on something? The [wiki](https://oculpm.com/wiki/en) collects common problems and fixes.

## Where your data lives

```text
your-project/
├── AGENTS.md          # journaling rules agents read (planted & versioned by the app)
└── .oculpm/
    ├── journal/       # work journals — the source of truth
    ├── planner/       # plan documents
    ├── agents/        # the rules master and the entry spec (journal-spec.md)
    └── index/         # app-managed cache · diff archive
```

SQLite is only a derived cache for fast rendering — it can always be rebuilt from the files (Settings → This project → Cache → "Rebuild from scratch"). The `discussion/` · `rollups/` · `automation/` folders 3.x created are no longer read by the app, and never deleted. API keys, tokens, private keys and connection strings that accidentally land in journals or diffs are masked before saving (`[REDACTED]`). Only known shapes are caught, so this is not a guarantee for every secret — add patterns with `auto_redact_patterns` in `.oculpm/config.toml`.

## Tech

A Tauri 2 native app — not Electron — so the dmg stays under 60MB and cold start under 1.5s. The backend is Rust (tokio · rusqlite), the frontend React 19 + TypeScript. There is no LLM client, no embedding model and no API-key store in the app — the screens are drawn deterministically from the files.

## Build from source

```bash
git clone https://github.com/bunhine0452/Ocul-PM
cd Ocul-PM
pnpm install
pnpm tauri dev      # run in dev
pnpm tauri build    # your OS's bundle (.dmg · NSIS .exe · AppImage/.deb)
```

Requires Node 18+, pnpm, Rust stable, plus Xcode Command Line Tools on macOS, the MSVC build tools and WebView2 on Windows, and [Tauri's system dependencies](https://v2.tauri.app/start/prerequisites/#linux) (`libwebkit2gtk-4.1-dev` etc.) and `libdbus-1-dev` on Linux.

## Roadmap

- [x] Windows · Linux x64 builds — beta
- [ ] Graduate the Windows · Linux beta (E2E green for three releases in a row + zero P0 user reports)
- [ ] macOS (Intel) — the embedding runtime (ONNX) that blocked it left in 4.0; adding the build and signing pipeline remains
- [ ] Team sync (opt-in)

## One more thing

This repository is itself tracked by Ocul. Open `.oculpm/journal/` and you'll find the actual journals agents wrote while building this app. Bugs and ideas go to [issues](https://github.com/bunhine0452/Ocul-PM/issues) — and if you like it, a star helps more than you'd think.

## Support

Ocul is built and maintained by one person. The app stays free, but building it costs time and money. If it has been useful, you can [buy me a coffee on Ko-fi](https://ko-fi.com/beachcombers) — one-off or monthly.

Supporting changes nothing about what you get. The promise below holds either way.

## License & promise

[MIT](LICENSE) © 2026 Kim Hyunbin

**Everything in this repository today stays free and MIT, forever.** Individual use is free forever — at work or at home. Paid plans will only ever apply to upcoming team features (sync server · team view — a separate module). Core features will never move behind a paywall.

Contributions are accepted under the [DCO (sign-off)](CONTRIBUTING.md), no CLA — the core stays MIT forever, so there is no reason to pool copyright.
