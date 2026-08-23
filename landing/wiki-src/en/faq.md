---
title: FAQ
desc: Where first-time users actually get stuck — who writes the entries, does it cost money, should I commit .oculpm, what is a workday.
order: 2
updated: 2026-08-21
---

The questions that actually come up in the first few days. The confusing parts and the scary parts first.

## What does this do

### In one line

**It records what AI agents did to your code, in a form a human can read.**

A commit message tells you *what changed*. Ocul-PM records *why it was done that way, what was tried and failed, and how it was verified*.

### Do I have to write the entries?

**No. Agents write them.** You just read.

Adding a project creates an `AGENTS.md` rules file at the root, and agents like Claude Code, Cursor, and Gemini CLI read it. The rule is: "when you finish a unit of work, leave an entry." You don't even have to ask.

:::tip
You *can* write entries by hand — they're just markdown. But that isn't what the app is for.
:::

### Is this a tool that runs the AI for me?

Either way works. You can run Claude Code inside the app, or **keep using your terminal exactly as you do now and just receive the records**. As long as the app is open, work done in a terminal gets picked up too.

## Money and privacy

### Does it cost anything?

The app is free, and **journaling itself needs no API key**. It watches file changes and reads markdown that agents wrote — that costs nothing.

The only thing that costs money is **AI writing new prose**:

| Feature | Cost |
|---|---|
| Journal and planner records, search, code map, retro metrics | **Free** — all local |
| Retro narrative generation, Agent panel chat | Your API key, your billing |
| Claude Code inside the app | Your Claude subscription (no extra charge) |

:::tip
The retro's **"With Claude Code"** button hands the job to a terminal Claude Code session — it runs on your subscription with no API key, so you can produce a retro at no extra cost.
:::

### Where does my code go?

By default, **nowhere**. Even code-search embeddings are computed locally. Only three things leave the machine: LLM calls you configured, the update check, and Anthropic traffic when you use Claude Code in the app. No account server, no telemetry. ([Details](/wiki/en/data))

### Does it work offline?

Yes. Records, timeline, change diffs, code search, code map, and retro metrics are all local. Only AI calls and the update check need the network.

### What about Windows / Linux?

Right now it's **macOS (Apple Silicon) only**.

:::note
That said, `.oculpm/` records are plain markdown and read fine anywhere. If you have Windows teammates, they can read committed entries without trouble.
:::

## Git and teams

### Should I commit `.oculpm/`?

**Yes, we recommend it — and the app sets it up for you.**

Adding a project appends a managed block to `.gitignore` that excludes only the cache-like files:

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

So **entries, plans, discussions, and rules get committed; anything the app can rebuild does not.** Nothing for you to do.

### Do teammates see it?

Commit and push and it's shared. Teammates can read the markdown on GitHub without the app; install the app and the same records render as screens.

### Won't it cause merge conflicts?

Entries are **one file per unit of work** with a timestamp in the name (`2337_fix_….md`), so they rarely collide. The planner is one file several people may touch, but its change log is **append-only** — if it does conflict, keeping both lines is the correct resolution.

### What if I don't want entries in someone else's repo?

Put `.oculpm/` in `.gitignore` wholesale and it stays local. The app doesn't care.

## Concepts I find confusing

### What's a "workday"?

**You decide where the day boundary is.** The default is midnight, but that's awkward if you code into the small hours — work at 2am rolls into "tomorrow."

Set `day_starts_at = "03:00"` in the project's `.oculpm/config.toml` and anything before 3am files under the previous day.

### What's a "session"?

The app watches file changes and **opens a session when an agent starts working, closing it after things go quiet**. Roughly "one sitting." It's named like `20260821-002`, and entries are grouped by which session produced them.

### Journal vs Planner vs Discussions — what's the difference?

Different points on the timeline:

| | When | What |
|---|---|---|
| **Discussions** | **Before** deciding | Lay out options A/B/C and pick |
| **Planner** | **Now** | The current plan. Glyphs move as items progress |
| **Work Journal** | **After** the work | What was done, why, and how it was verified |

### Why are there two language settings?

They're different. **UI language** is the text on screen; **AI writing language** is the language of entries, planner items, and retros the AI produces.

You can run an English UI and keep records in Korean. Already-written documents don't change when you switch.

## As you use it

### Nothing is being recorded

The most common cause is **using an agent in a terminal without the plugin installed**. `AGENTS.md` rules alone can be forgotten at the end of a long session. [Install the plugin](/wiki/en/claude-code) and a session-end hook makes it structural.

The **honesty audit on Today** tells you if anything slipped — it lists observed changes that no entry mentions. ([Details](/wiki/en/journal))

### Can I edit entries?

Yes. They're plain markdown and the app re-reads them when you save. Note that **agents are told not to edit existing entries** — history that quietly changes can't be trusted. They write a new entry and link it with `related`.

### What if there are too many entries?

They collapse by date, there's search and filtering, and the retro summarizes by period. You can filter to **Verified** to see only what a human confirmed. And entries can be deleted — they're just files.

### If I uninstall the app, do I lose the records?

**No.** Everything lives as markdown inside the project folder; the app's database is only a cache for drawing screens quickly.

### Can I work on several projects at once?

Yes. `⌘T` opens a project tab, `⌘P` switches. Multiple windows work too. ([Details](/wiki/en/workspace))

### Can I mix several agents?

Yes. Each entry records who did it with which model, and the retro's **Agent contributions** card shows the split. ([Details](/wiki/en/agents))

### Can I delete `AGENTS.md`?

Delete it and **agents no longer see the journaling rules** — entries stop. If you already had your own `AGENTS.md`, don't worry: the app owns only the `<!-- oculpm:begin -->` block and leaves the rest alone.

### Does the app have to stay open?

To observe file changes, yes. Turn on **"Closing the window minimizes to the menu bar"** in Settings and it keeps watching after you close the window.

:::note
Agents still write entries when the app is closed — the rules live in `AGENTS.md`. What the app misses is *file-change observation*, and with it the change diffs and the honesty audit.
:::

## Not answered here?

Check [Troubleshooting](/wiki/en/troubleshooting) first, then open a [GitHub issue](https://github.com/bunhine0452/Ocul-PM/issues).
