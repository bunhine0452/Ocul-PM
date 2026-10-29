---
title: Today
desc: The first screen you see — "Look first", entries finished without verification, a one-line "Next", and "Done today" folded by plan.
order: 4
updated: 2026-10-30
---

`⌘1` is the first screen you see. The principle is **show only the exceptions** — it unfolds only what a person must see and folds work with evidence into one line. 3 entries a day or 60, it's the same screen.

## One column

Top to bottom: **date · entries N** → **Look first** → **Finished without verification** → **Next** (one line) → a one-line **your turn** → sessions working now (only when there are some) → **Done today**. Per-plan progress and passing verdicts live on the [Plan](/wiki/en/planner) tab. The number next to the Today tab in the top bar counts only "Look first".

## Look first

Most urgent first. When it is empty, one calm paragraph remains — but if something couldn't be read, it doesn't claim there is nothing.

| Kind | When it shows | Buttons |
|---|---|---|
| **Claude asks** | Claude asks for your decision through the plugin's `ask_user` tool | the answers to pick · "Another answer" — it goes straight back to that Claude |
| **Claude is waiting** | Claude in the in-app terminal waits for you, or Claude in an outside terminal does ("Outside terminal", via the plugin's Notification hook) | Open in terminal · Got it |
| **Failed** | A plan's last verdict is `✗` | View output → that plan |
| **No journal** | A file changed today that no entry mentions, or a conversation that ended without an entry | View changes |
| **Blocked** | A plan item is `[!]` | Open plan |
| **New plugin version** | The plugin installed for the project is older than the app | Copy command |

If Claude starts waiting while the window is in the background, an OS notification arrives too (macOS asks for notification permission the first time).

## Finished without verification

Bug · feature · refactor entries with no command under Verification, or whose content changed after you read them, in one group. **Read** on each row, **Mark all read** on the group header. Click a title to open the entry.

## Next · your turn

The plan's next item (the first `[ ]` that isn't human-owned) on one line, with one "Run in terminal" button — `claude` picks it up in a new session on the [Terminal](/wiki/en/screens) tab. `r` does it too. To hand off to the end, use "To the end (/goal)" on the Plan screen.

Below it, one line for human-owned (`[user]`) items — "N items your turn in N plans" and "Open in Plan". They don't change daily, so they don't unfold.

## Done today

Today's entries grouped by plan, with anything outside a plan under "Outside plans". Each group header shows the count and the evidence — the target for the evidence share is a number in the [promise document](https://github.com/bunhine0452/Ocul-PM/blob/main/docs/PROMISE.md) (97%). Up to 8 entries everything shows; past that, **groups whose evidence is complete fold to their header line**, and groups missing something show only those rows ("Show N more"). Switch between by-plan and by-time.

## Keys

Only inside the screen — `j`/`k` move · `Enter` default action · `v` read · `r` run the next item in the terminal.

:::note
Before the first entry, one hint stands alone — it points to Settings → Agent connections. The 3.x stat cards · activity ring · commit graph · standup · weekly summary were removed in 4.0.
:::

## Next steps

- How entries pile up and what the verification box reads → [Work Journal](/wiki/en/journal)
- Where verdicts and "Next" come from → [Plan](/wiki/en/planner)
