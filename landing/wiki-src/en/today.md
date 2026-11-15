---
title: Today
desc: The first screen you see — one line of numbers on the date line, "Needs your eyes" ending with "Next", entries finished without verification, and "Done today" folded by plan.
order: 4
updated: 2026-11-15
---

`⌘1` is the first screen you see. The principle is **show only the exceptions** — it unfolds only what a person must see and folds work with evidence into one line. 3 entries a day or 60, it's the same screen.

## Layout

The **date line** is on top, with **one line of numbers** on its right. Below it, the left column holds what to do — **Needs your eyes** (its last row is **Next**) → **Finished without verification** → sessions working now (only when there are some) — and the right column holds **Done today**. A narrow window folds them into one column. Per-plan progress and passing verdicts live on the [Plan](/wiki/en/planner) tab. The number next to the Today tab in the top bar counts only "Needs your eyes" (not the Next row).

## Numbers on the date line

They read like "Your turn 3 · Plans to close 1 · Arrived 2 · Only here 4". They don't change daily, so they stand as numbers rather than rows, and a zero isn't shown. Each number takes you to what it counts.

- **Your turn** — human-owned (`[user]`) items in your plans. Opens that plan
- **Plans to close** — plans with nothing left that are still listed as in progress. Close them with "Close plan" on the Plan screen
- **Arrived** — entries written on another machine or by a teammate, among the commits pulled today. Opens the newest. With none, in a repository that has received records from elsewhere before, "Synced N days ago" shows instead once the last pull or push is more than a day old — the app never fetches
- **Only here** — journal and plan files not committed or not pushed yet. Opens Diff, and "Ask Claude to push" beside it asks Claude in the in-app terminal to commit and push — the app itself never pushes

## Needs your eyes

Most urgent first, each row led by one status chip. When it is empty, one calm paragraph remains — but if something couldn't be read, it doesn't claim there is nothing.

| Chip | When it shows | Buttons |
|---|---|---|
| **Question** | Claude asks for your decision through the plugin's `ask_user` tool | the answers to pick · an answer box — it goes straight back to that Claude |
| **Waiting** | Claude in the in-app terminal waits for you, or Claude in an outside terminal does ("Outside terminal", via the plugin's Notification hook) | Open in terminal (in-app) · Got it (outside) |
| **Failed** | A plan's last verdict is `✗` | Check again · Open plan |
| **Changed** | The last verdict is `✓`, but a file that plan covers was saved again after it | Check again · Open plan |
| **Elsewhere** | The newest `✓` ran on another OS and hasn't run on this machine yet | Check again · Open plan |
| **No journal** | A file changed today that no entry mentions, or a conversation that ended without an entry | View changes (files) · Ask for an entry (conversations) |
| **Blocked** | A plan item is `[!]` | Open plan |
| **Update** | The plugin installed for the project is older than the app | Copy update command |
| **Next** | The last row — the plan's next item | Run in terminal |

"Check again" has Claude, in a new session of the in-app terminal, rerun that plan's check command on this machine against the current code and log the result to the plan — the app never writes the ✓ itself.

If Claude starts waiting while the window is in the background, an OS notification arrives too (macOS asks for notification permission the first time).

## Next

The last row of "Needs your eyes" is the plan's next item (the first `[ ]` that isn't human-owned) with one "Run in terminal" button — `claude` picks it up in a new session on the [Terminal](/wiki/en/screens) tab. `r` does it too. To hand off to the end, use "To the end (/goal)" on the Plan screen.

## Finished without verification

Bug · feature · refactor entries with no command under Verification, or whose content changed after you read them, in one group. **Mark read** (`v`) on each row, **Mark all read** on the group header. Click a title to open the entry. Past five rows, "N more" opens Work Journal filtered to "Unverified only".

## Done today

Today's entries grouped by plan, with anything outside a plan under "Outside plans". Each group header shows the count, plus how many lack verification when some do — the target for the evidence share is a number in the [promise document](https://github.com/bunhine0452/Ocul-PM/blob/main/docs/PROMISE.md) (97%). Up to 8 entries everything shows; past that, **every group folds to its header line** — entries without verification are already listed under "Finished without verification". Click a header to unfold it. With more than one group ("Outside plans" counts), switch between by-plan and by-time.

## Keys

Only inside the screen — `j`/`k` move · `Enter` default action · `v` read · `r` run the next item in the terminal.

:::note
Before the first entry, a "No entries yet" card shows three steps to your first entry — Connect an agent ("Connect in Settings" goes to Settings → Agents) · Hand off a first task ("Hand off in terminal") · First entry. The 3.x stat cards · activity ring · commit graph · standup · weekly summary were removed in 4.0.
:::

## Next steps

- How entries pile up and what the verification box reads → [Work Journal](/wiki/en/journal)
- Where verdicts and "Next" come from → [Plan](/wiki/en/planner)
