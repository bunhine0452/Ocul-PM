---
title: FAQ
desc: Where first-time users get stuck most — who writes the journal, does it cost money, should I commit it, what's a workday.
order: 2
updated: 2026-10-29
---

The questions that actually come up in the first few days. The confusing concepts and the scary parts come first.

## What does it do

### In one line

**It leaves a human-readable record of what an AI agent did to your code.**

A commit message only says *what changed*. Ocul-PM records *why it was done that way, what was tried and failed, and how it was checked* — and the app unfolds only **what a person must see** from that record: failed verdicts · entries without evidence · unrecorded changes. The goal is to trust what the agent did, and decide what's next, in three minutes.

### Do I have to write the entries?

**No. Your agent writes them.** You just read.

Turning recording on creates a rules file called `AGENTS.md` at the root, and agents like Claude Code, Codex, Cursor and Gemini CLI read it. "When you finish a unit of work, write an entry" is the rule. You don't even have to ask.

:::tip
You can write one yourself if you like — it's just a markdown file. But that's not what the app is for.
:::

### Does the app run the AI for me?

No. Your agent runs **in your own terminal, exactly as before**, and the app receives the record, the evidence and the plan of that work. Keep the app open and work done in the terminal gets picked up. The app itself calls no LLM.

## Money and privacy

### Does it cost money?

**The app is free, and nothing in it costs money.** The 4.0 app calls no LLM, so it doesn't even take an API key — it watches file changes and reads the markdown your agent wrote, and that's all. The only cost is your agent's own subscription or usage in the terminal.

### Where does my code go?

**Nowhere.** There is no LLM client in the app, and its screens reach no outside host. Only two things leave the machine, and you start both — the update check, and links you click (your OS browser opens them). No account server, no telemetry. ([details](/wiki/en/data))

### Does it work offline?

Yes. Entries, plans and diffs are all local. Only the update check doesn't work.

### What about Windows / Linux?

They ship as a **beta** — Windows 10 2004+ and 11 (x64) and Linux x64 (AppImage · deb). Each release only ships the OS builds that passed an install test and a real-app E2E run on CI runners.

:::note
The `.oculpm/` records are plain markdown, readable on any OS. Teammates who never install the app can still read the entries committed to your repository.
:::

## git and teams

### Should I commit `.oculpm/` to git?

**Yes, we recommend it** — and **the app prepares it for you.**

When you turn recording on, a managed block is added to `.gitignore` that excludes only cache-like files:

```
# oculpm:begin v1
.oculpm/index/
.oculpm/hooks/
.oculpm/.lock
.oculpm/.schema-version
.oculpm/oculpm.log
.oculpm.backup-*/
# oculpm:end
```

So **entries, plans and rules get committed, and anything the app can rebuild stays out.** There's nothing for you to touch.

### Is it shared with teammates?

Commit and push and it's shared as-is. Teammates can read it as markdown on GitHub without the app, and installing the app draws those records on screen.

### Won't it conflict?

Entries are **one file per unit of work** with a timestamp in the name (`2337_fix_...md`), so they rarely collide. Several people can edit a plan file, but its change log is **append-only**, so if a conflict happens you keep both sides' lines and you're done. Parallel sessions don't grab the same item: `/oculpm:next` claims it as `[~]` first.

### What if I don't want entries in someone else's repo?

Put `.oculpm/` in `.gitignore` entirely and it stays local. The app works the same.

## Confusing concepts

### What's a "workday"?

**You decide where a day ends.** The default is midnight, but for someone coding past midnight that boundary is awkward — work done at 2 a.m. rolls into "tomorrow."

Change it in the project's `.oculpm/config.toml`, e.g. `day_starts_at = "03:00"`, and work before 3 a.m. goes into the previous day's folder.

### What's a "session"?

A unit the app **opens when an agent starts working and closes after things go quiet**, by watching file changes. Roughly "one sitting," named like `20260821-002`. Entries are grouped by the session that produced them automatically.

### Journal vs plan vs verdict — what's the difference?

Different points on the timeline:

| | When | What |
|---|---|---|
| **Plan** | **Now** | Done condition · check command · items. Glyphs move as items progress. Big decisions go in the decision block |
| **Work Journal** | **After** the work | What was done, why and how — and what was run to check it |
| **Verdict** | **After running** the check command | One line, `verdict ✓|✗ <last line>`. The result decides, not the agent's word |

The 3.x Discussions screen was removed in 4.0 — `.oculpm/discussion/` files are left as they are.

### Can the UI language differ from the language of the records?

Yes. The UI language (Settings → Display) is the app's text; the language of entries follows the agent writing them and the rules template. An English UI with Korean records is possible, and documents already written are never rewritten.

## Day to day

### No entries are piling up

The most common cause is **using an agent in the terminal without the plugin**. With `AGENTS.md` alone a model can forget to record at the end of a long session. [Install the plugin](/wiki/en/claude-code) and a session-end hook makes it structural.

**Today's "To check"** tells you if anything's missing — it points at observed changes no entry records and at conversations that ended without an entry. ([details](/wiki/en/troubleshooting))

### Can I edit entries?

Yes. They're plain markdown and the app re-reads them when you save. But **agents are told not to edit existing entries** — a history that changes quietly can't be trusted. An agent writes a new entry and links it with `related`.

### What if there are too many entries?

Today doesn't overflow even at 60 a day — work with evidence folds to one line per plan, and only what you must see unfolds. Work Journal groups by date, with journal search (`/`) and filters (type · no evidence). And you can delete entries — they're just files.

### What happens to my records if I uninstall?

**They stay.** Every record is markdown inside the project folder; the app's database is only a cache for drawing screens fast.

### Can I use several projects at once?

Yes — one window is one project. `⌘O` opens a recent project (bringing its window forward if it's open), and `⇧⌘N` opens a new window. ([details](/wiki/en/workspace))

### Can I mix several agents?

Yes. Each entry records who did it with which model. ([details](/wiki/en/agents))

### Can I delete `AGENTS.md`?

If you do, **agents can't see the recording rules** — entries stop. If you already had your own `AGENTS.md`, don't worry: the app owns only the `<!-- oculpm:begin -->` block and leaves the rest alone.

### Does the app need to stay open?

To observe file changes, yes. On macOS the app stays alive after you close its last window, so watching continues, and a Dock click opens a window again.

:::note
Agents still write entries when the app is closed — the rules live in `AGENTS.md`. What the app misses is *observing file changes* and what depends on it: change diffs and pointing out unrecorded changes.
:::

## Not answered here

Check [Troubleshooting](/wiki/en/troubleshooting) first, and if it's not there, tell us in a [GitHub issue](https://github.com/bunhine0452/Ocul-PM/issues).
