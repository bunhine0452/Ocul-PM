---
title: Planner
desc: A plan document agents keep current — glyphs, item ids, the change log, decisions, and locking.
order: 6
updated: 2026-08-21
---

If the journal is *what happened*, the planner is **the current plan**. With one difference: it isn't a to-do list you maintain, it's **a document agents update themselves every time they finish something**.

Files live at `.oculpm/planner/*.md` — plain markdown again.

## What a plan looks like

```
---
oculpm_plan: v1
id: session-attribution
title: "Session attribution cleanup"
status: active
owner: claude-code
---

## Phase Foundations {#foundation}
- [x] Timestamp attribution function {#resolve-by-time}
- [~] MCP tool adopts the live session {#mcp-adopt}
  - [x] Synchronous sessions.json read {#sync-read}
  - [ ] Fallback path tests {#fallback-test}
- [ ] Derive links {#derive-links}
```

- **Phases** are `##` headings. They carry no glyph — progress rolls up from their children
- **Items** are one line, ending with `{#a-stable-id}`
- **Nesting goes one level deep.** A parent with children takes its glyph from them, so nobody edits it directly

## Six glyphs

| Glyph | Meaning |
|---|---|
| `[ ]` | To do |
| `[~]` | In progress |
| `[x]` | Done |
| `[!]` | Blocked |
| `[>]` | Deferred |
| `[-]` | Dropped |

**The glyph in the body is the truth about current state.** The change log below is history.

## The change log — who moved what, when, why

A table sits at the bottom of each plan. Every time an agent moves an item it **appends one row** and never edits existing ones:

```
| time | #item-id | agent | old→new glyph | entry path | short note |
```

Because the entry path is right there, **you can jump from a line in the plan to the entry that explains that work.** The rule is to reference entries, never to paste their contents into the plan.

:::tip
When you wonder "why was this dropped?", open the entry linked on that log row — the reasoning at the time is preserved.
:::

## Locking decisions

Choices that are hard to reverse get pinned in a `## Decisions` section:

```
### Decision 3 — Keep the SQLite cache derived {#dec-cache-derived}
Locked: 2026-08-21 · claude-code
Rationale: on-disk markdown is the SSOT. Treating the cache as canonical would …
Affects: #resolve-by-time, #derive-links
```

It exists so you don't re-litigate "why did we do it this way" later.

## Status and locking

The plan document itself has a status.

| status | Meaning | Can agents edit it? |
|---|---|---|
| `active` | In progress | Yes |
| `done` | Finished | **No** |
| `archived` | Archived | **No** |

Agents **will not modify** a `done` or `archived` plan. That keeps a finished plan from quietly coming back to life and muddying the history; when there's follow-on work, a new plan is created. The sidebar marks these **Locked**.

## What the Planner screen offers

- **Sort** — recent · progress · remaining work · name
- **Group** — by status · by recent activity · by author
- **Stalled plans** — "stalled for 12 days" makes abandoned plans visible
- **Search** — narrow by plan name

## Who creates a new plan

Usually it's easiest to ask an agent — "turn these into a plan" and you get a spec-conforming file. You can also write one by hand: frontmatter, phase headings, item lines, and an empty log block, in that order.

:::warn
When writing item lines, `{#id}` must sit at the **end of the line** with no wrapping. An `{#id}` that spills onto a second line won't be read by the parser.
:::

## Next steps

- The record that pairs with plans → [Work Journal](/wiki/en/journal)
- Want to compare options before deciding → Discussions, in the [Screen Tour](/wiki/en/screens)
