---
title: Today
desc: The first screen you see — one line a day, "To check", and "Done today" folded by plan.
order: 4
updated: 2026-10-29
---

`⌘1` is the first screen you see. The principle is **show only the exceptions** — it unfolds only what a person must see and folds work with evidence into one line. 3 entries a day or 60, it's the same screen.

## One line a day

The line at the top: **entries N · outside-judge evidence M · % · sessions K · to check X.** "Outside-judge evidence" is an entry whose verification section holds the command that ran and its last line of output — the target for that share is a number in the [promise document](https://github.com/bunhine0452/Ocul-PM/blob/main/docs/PROMISE.md) (97%).

## To check

Sorted by severity. When it is empty, one calm paragraph remains — but if something couldn't be read, it doesn't claim there is nothing.

| Kind | When it shows | Buttons |
|---|---|---|
| **Failed verdict** | A plan's last verdict is `✗` | See output → that plan |
| **No evidence** | A bug · feature · refactor entry whose verification section has no command evidence, and no human has checked it (or it changed after the check) | diff · Checked |
| **Unrecorded change** | A file changed today that no entry mentions, or a conversation that ended without an entry | See changes |
| **Blocked** | A plan item is `[!]` | Open plan |
| **Decision needed** | A human-owned (`[user]`) item is open — one row per plan | Open plan |
| **New plugin version** | The plugin installed for the project is older than the app | Copy command |

## Done today

Today's entries grouped by plan, with anything outside a plan under "Outside plans". Each group header shows count · evidence · none · checked. Up to 8 entries everything shows; past that, **groups whose evidence is complete fold to their header line**, and groups missing something show only those rows ("Show N more"). Switch between by-plan and by-time.

## Right column

- **Working now** — agent sessions currently open
- **Plans** — progress and verdict (✓ / ✗ / none) of each active plan
- **Next** — the next item of a plan. `c` copies a prompt that picks it up

## Keys

Only inside the screen — `j`/`k` move · `Enter` default action · `v` checked · `c` copy the next prompt.

:::note
Before the first entry, one hint stands alone — it points to Settings → Agent connections. The 3.x stat cards · activity ring · commit graph · standup · weekly summary were removed in 4.0.
:::

## Next steps

- How entries pile up and what the verification box reads → [Work Journal](/wiki/en/journal)
- Where verdicts and "Next" come from → [Plan](/wiki/en/planner)
