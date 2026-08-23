---
title: Retro
desc: Gathering signals over 7/14/30 days, the deferred-shortcut ledger, generating standups and PR descriptions, exporting.
order: 7
updated: 2026-08-21
---

Once entries pile up they become material. Pick a period on the Retro screen (`⌘6`) and it pulls **deterministically computed signals** out of that period's records — shown before any AI is involved, with narrative layered on top only if you want it.

Periods are **Last 7 days · 14 days · 30 days**.

## Four numbers first

| Metric | Meaning |
|---|---|
| **Entries** | Records left in the period |
| **Shipped** | Completed feature-side work |
| **Resistance** | Bugs and error cycles — how much wall you hit |
| **Agents** | How many agents contributed |

The ratio of Shipped to Resistance characterizes the period. A week where resistance spikes usually means the design wobbled or you were in unfamiliar territory.

## Signal cards

- **What shipped / What pushed back** — which work fell on each side
- **Files that came up again and again** — if the same file keeps appearing in bug and error entries, that file is the problem
- **Where the effort went** — files that took the most work, overlaid with dependency fan-out from the code map. A file flagged **Core hub** is *heavily edited and heavily depended on* — the most dangerous place to touch
- **Agent contributions** — who did what, if you run several

:::tip
"Files that came up again and again" is the fastest way to pick refactor candidates. Not by instinct, but by how many times that file actually cost you time.
:::

## The deferred-shortcut ledger

Leave a comment like this in code and the retro harvests it into one place:

```
// oculpm-defer: <ceiling>; <revisit trigger>
```

- **Ceiling** — how far this shortcut holds (e.g. "up to 1000 items")
- **Revisit trigger** — when to look again (e.g. "when pagination lands")

A marker with no trigger is flagged **No trigger**, because a shortcut without a revisit condition quietly rots — write a trigger, or promote it to a planner item outright.

## Generating artifacts

Turns collected entries into something shareable. Three formats:

| Kind | Use |
|---|---|
| **Standup** | What I did yesterday / what's next |
| **PR description** | Explaining this period's changes on a PR |
| **Weekly status** | A week summarized |

Two ways to produce them:

- **Generate** — uses the default AI provider and model from Settings (your API key, your billing)
- **With Claude Code** — hands it to a terminal Claude Code session. **No API key and no extra billing** — it runs on your subscription, and you watch it work in the terminal

Even without AI, the **plain template** gives you the bones. Generated artifacts show how many entries they came from and whether they were AI-written or templated.

## Exporting

- **Export `.md`** — the period's entries as a single markdown file
- **Copy to clipboard** — paste the artifact straight out
- **To Notion** — creates a page and opens it in a new window

## Eval trend

Record scores from a test suite and the retro draws a trend. With no records the card says it's empty — log scores with the `run-evals` skill and it starts filling in.

## When to open it

- **Friday afternoon** — build the weekly status and check "files that came up again and again"
- **Right before opening a PR** — pull a PR description as your draft
- **Starting a new sprint** — pick what to repay from the deferred-shortcut ledger

## Next steps

- How the raw material accumulates → [Work Journal](/wiki/en/journal)
- Promoting what you picked into a plan → [Planner](/wiki/en/planner)
