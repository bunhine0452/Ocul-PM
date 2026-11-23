---
title: Claude Code
desc: The three places terminal Claude Code meets Ocul — the rules file, the plugin (hooks · MCP tools · commands), and the app's screens.
order: 9
updated: 2026-11-15
---

In Ocul, Claude Code runs **in your own terminal**. The app's place is to receive what the terminal `claude` does as **record · evidence · plan**, and to unfold only what a person must see. The app calls no LLM.

| Place | What it does | Install |
|---|---|---|
| **Rules file** `AGENTS.md` | Tells the agent to write an entry after every unit of work, to state a done condition as an outcome before code, and to leave pass or fail to a check command (template v20) | Automatic when you turn recording on |
| **Plugin** `oculpm` | Hooks (session start · end) · MCP recording tools · commands — recording becomes **structure**, not a rule | The two lines below |
| **App** | Entries show up within seconds, diffs are attached, and failed check commands and entries without evidence land on Today | Just download it |

## Install the plugin

AGENTS.md alone does get entries written, but only **as far as the model follows the rule** — it can forget at the end of a long session. With the plugin installed, a hook judges each session as it ends, and if code changed with no entry it blocks the turn once and asks for the record.

Two lines inside the terminal `claude`:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

:::tip
The same commands sit in the app under **Settings → Agents** with copy buttons. When the installed version is older than the app, that spot and Today hand you the update command.
:::

Once installed:

- **Start hook** — for each recently updated plan: done condition · check command · **last result** · open items, plus the last three entries, go into the starting context. You don't explain yesterday again
- **End hook** — judges whether the session ended without an entry
- **Notification hook** — when Claude waits for you (Notification), a "Waiting" row ("Outside terminal") appears under "Needs your eyes" on Today in the app, plus an OS notification if the window is in the background
- **8 MCP tools** — `journal_search` · `journal_read` · `journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init` · `ask_user` (asks for your decision on Today in the app and waits for the answer, up to 25 minutes)
- **Commands** — `/oculpm:inception` (what happens next → four depth questions → the field's methods → a hard numeric goal → a plan whose first item is a check command that is red now) · `/oculpm:next` (claim the item as `[~]` → implement → check command → entry → plan; with `until-done`, until the check command passes) · `/oculpm:redteam` (runs the claims, reports only counter-examples) · `/oculpm:help`

It is all configured globally under `~/.claude`, so it works in **every project** (it records only where `.oculpm/` exists). The `.oculpm/` folder exists once you turn recording on in the app, and the recording tools (MCP) ship inside it, so the app is needed once. You also need Claude Code and git (Git Bash on Windows); if entries don't arrive, see “Journal entries not arriving” in Settings → Agents. More on the [plugin page](/en/plugin).

## The result line

An agent that ran the check command logs the result as a `plan_update` note, one line: `verdict ✓|✗ <last line of output>` (`판정` in Korean). The start hook and the Plan screen read that line by the same rule and show it as the "last result". More in [Plan](/wiki/en/planner).

## What the app hands to your terminal

- **[Run in terminal]** (Plan screen · `r` on Today) — opens a new session in the in-app terminal and starts `claude` with a prompt that picks up the next item. If the `claude` command isn't found, it says so.
- **[To the end (/goal)]** — starts `claude` and, once it waits for input, hands the plan's done condition and check command to Claude Code's `/goal`. It keeps going until the condition holds.
- **"Send to Claude"** (entries · plan items · changed files · diff notes · terminal output selected with `⌘L`) — puts text carrying that context into an in-app claude session, opening a new one if there is none; while Claude is working it waits in line and goes in when Claude stops.
- **Diff [Ask for an entry]** — asks for an entry covering the files no entry mentions.
- **Today's hand-off buttons** — "Check again" (rerun a check command and log the result to the plan) · "Ask for an entry" (a conversation that ended without one) · "Ask Claude to push" (commit and push) · "Hand off in terminal" before the first entry (a first task) start `claude` in a new session with a prompt for that job. With no plan at all, the Plan screen's [Plan it in the terminal] hands over `/oculpm:inception` the same way.
- **The Plan's [Run in shell]** — shows the full check command in a confirm dialog and only then runs that one line in a new shell session. Writing the result line is still Claude's job.

The app writes into a terminal only when you press a button like these, and never into a terminal outside the app. The other direction — Claude asking you — is the `ask_user` tool: the question shows up on Today, and the answer you pick or type goes straight back to Claude.

## Summary — what should I install?

- **You use Claude Code in a terminal** → install the plugin with the two lines above. Without it, sessions can go unrecorded.
- **Codex · Cursor · Gemini CLI** → [Other agents](/wiki/en/agents).
