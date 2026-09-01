---
title: Automation
desc: It records when your hands stop — pick a background model, set schedules and watchers, and know exactly what gets billed and what never leaves.
order: 8
updated: 2026-09-02
---

The surest way to get a record written is to **not have to ask for one**. Automation runs once in the background — at a set time, or the moment your hands stop — and leaves a draft journal entry for the work you just did.

All of it is **opt-in and off by default.** On a machine where nothing is configured, not a single background request happens.

## Two-minute setup

### 1. Pick a background model

**Settings → LLM → Background work model.** Until you pick one, the automation UI stays locked and jobs are **silently skipped** — that is how "I didn't know it was billing me" is prevented structurally.

There is a second reason to keep it separate from your chat model: background work wants a cheap, fast model. A weekly summary does not need your best one.

:::tip
If a provider doesn't answer, the failover chain answers **that one call** instead. Your settings don't change, and the answer carries a badge saying a fallback produced it.
:::

### 2. Turn on the global switches

**Settings → Automation** has two.

| Switch | What |
|---|---|
| Schedules | Run at set times |
| Watchers | Run when file changes settle |

A job runs only when **both** the global switch and its own on/off are on. Turning a switch off stops every automation in that project immediately.

The daily run budget lives here too (20 by default). Past it, jobs are skipped with a reason recorded — a runaway loop cannot quietly bill you.

### 3. Start from an example

The presets under **Start with this** are created **switched off**. Read them, edit them, then turn them on.

- **Weekly dev summary** — every Friday, that week's entries in one page
- **Morning brief** — each morning, yesterday's work and today's remaining plan
- **Monthly retro** — a month of signals, collected
- **Draft when things settle** — a watcher: five quiet minutes after the last change, draft the entry

## Schedules — reacting to the clock

Frequencies: **once · every N minutes · every N hours · daily · weekly · monthly · yearly · cron**. Cron is standard 5-field; write weekdays by name (`MON-FRI`) to stay unambiguous.

Dates that don't exist in a given month (the 31st, Feb 29) are pulled back to the last day.

:::warn
Schedules run **while the app is open**. A run scheduled for a time your laptop was closed does not happen — the run history records why.
:::

## Watchers — reacting to files

A watcher's signal is not "something changed" but **"changes stopped."** It does nothing while you work, and runs once after your hands come off the keyboard.

How long the quiet has to last is one of six **responsiveness tiers**.

| Tier | Quiet period | When |
|---|---|---|
| Immediate | 0.2s | React on every save |
| Balanced | 1s | |
| Patient | 3s | |
| Relaxed | 1m | |
| Deferred | 5m | Once, when the task is actually done |
| Extended | 10m | Long-running work |

The watch path is relative to the project. Empty or `.` means the whole project, and you choose whether subfolders count.

Journal entries, planner files, automation definitions and the index are **excluded as causes**. That breaks the loop where a job's own output wakes it again — structurally, not by convention.

## The instructions are everything

Automation calls the background model **directly** — none of your rules or skills ride along the way they do in the chat panel. So write two things into every instruction.

1. **What to read and what to produce** — "read the last 7 days of entries and summarise as shipped / resisted / next"
2. **Skip what you've already handled** — automations run more than once

Definitions are markdown files under `.oculpm/automation/`. Edit them by hand and commit them — that is how a team shares the same automations.

## What gets billed, what never leaves

**Billed**: exactly one LLM call, when a job actually runs. Browsing or editing automations sends nothing.

**Never leaves**: automation adds no new outbound path. Only the records your instruction asks for go to the provider **you chose**, and usage statistics and crash reports are **not collected at all**. The full list is on [what leaves and what never does](/privacy).

**Offline**, a job is not failed but **deferred** — opening your laptop on a plane doesn't lose the weekly summary; it catches up when you reconnect.

**What ran, when, and why** is in each card's **History** — the outcome (ok, skipped, dropped, deferred), the reason, and a link to the entry it produced.

## When something looks wrong

Three symptoms cover nearly all automation debugging.

- **It never ran** — check that the global switch and the job's own switch are **both** on, that the watched folder exists, that subfolder coverage isn't off, and that the app was open at that time. The run history records the skip reason.
- **It runs too often** — use a longer responsiveness tier and spell out "skip what you've already handled" in the instructions. Check the daily budget too.
- **The result is wrong** — read the outcome and reason in the run history first, then make the instructions more specific.

The same guidance is folded into the app under **Settings → Automation**.
