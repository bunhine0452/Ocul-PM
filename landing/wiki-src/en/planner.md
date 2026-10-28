---
title: Plan
desc: A plan document agents keep current — done condition · check command · last verdict, glyphs, the change log, decisions, and locking.
order: 6
updated: 2026-10-29
---

If the journal is *what happened*, the plan is **the current plan**. With one difference: it isn't a to-do list you maintain, it's **a document agents update every time they finish something** (`plan_create` · `plan_update`).

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

**Done when:** entries written without a session are attributed by write time, and Today can count them per conversation
**Check:** `cargo test --test session_verdict`

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

**The glyph in the body is the truth about current state.** The change log below is history. `/oculpm:next` flips an item to `[~]` the moment it claims it, so a parallel session doesn't grab the same item.

## Done condition · check command · last verdict

"All items are closed" and "the goal is met" are different claims. So two lines sit at the head of a plan.

- **Done when** — an outcome, not a task: what must be true to be done, and what should happen next
- **Check** — a command that comes back pass or fail. If the agent can't name one, it builds one first

The result of running the check command is logged as **one line** in the change log's note column:

```
verdict ✓ 418 passed · exit 0
verdict ✗ 2 failed, 418 passed
판정 ✓ …          (Korean template — same shape)
```

The newest such line is the plan's **last verdict**. The plugin's start hook and the app's Plan screen read it by **the same rule** (`^(판정|verdict) (✓|✗)`), so the next session's agent and you see the same verdict. A plain note with a colon, like "verdict:", is not a verdict. **All items closed is not done until the verdict passes** — a failed verdict goes to the top of Today's "To check".

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

It exists so you don't re-litigate "why did we do it this way" later. Since 4.0 removed the Discussions screen, big decisions and option comparisons live in this block.

## Status and locking

The plan document itself has a status.

| status | Meaning | Can agents edit it? |
|---|---|---|
| `active` | In progress | Yes |
| `done` | Finished | **No** |
| `archived` | Archived | **No** |

Agents **will not modify** a `done` or `archived` plan. That keeps a finished plan from quietly coming back to life and muddying the history; when there's follow-on work, a new plan is created. In the Plan screen's rail they fold into one "N finished plans" line.

## The Plan screen (`⌘3`)

- **Rail** — each active plan with a progress bar · verdict (✓ / ✗ / none) · updated time, most recently updated first
- **Verdict card** — done condition · check command · last verdict (last line of output) right under the title; "Not run yet" when there is none
- **Next** — the first open item (human-owned ones skipped) with **[Copy prompt]** · **[Copy with until-done]**. Paste it and the agent in your terminal picks the item up; with until-done it keeps going until the verdict passes
- **Item status** — click an item's box to pick one of six states. Marking it done without a verifying entry asks once
- "Change log N lines · decisions M" stays folded

## Who creates a new plan

In 4.0 **agents write plans** — there is no button in the app to create a plan or add items. For a new feature area, `/oculpm:inception` in the terminal goes through "what should happen next" and four depth questions and creates, with `plan_create`, a plan whose first item is a check command that is red right now. You can also write one by hand: frontmatter, done condition · check command, phase headings and item lines, in that order.

:::warn
When writing item lines, `{#id}` must sit at the **end of the line** with no wrapping. An `{#id}` that spills onto a second line won't be read by the parser.
:::

## Next steps

- The record that pairs with plans → [Work Journal](/wiki/en/journal)
- Where a failed verdict shows up → [Today](/wiki/en/today)
