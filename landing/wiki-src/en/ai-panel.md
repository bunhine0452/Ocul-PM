---
title: Agent Panel
desc: Ask several LLMs with the same context — context chips, the token badge, planner action proposals.
order: 10
updated: 2026-08-21
---

**Agent** in the sidebar (`⌘\`) is where you talk to several LLM providers. If in-app Claude Code is where code gets *changed*, this is where things get *asked and sorted out*.

:::note
This screen calls providers **directly with your API key**. Without a key you get a prompt to add one instead of the chat — add it in [Settings](/wiki/en/settings). Journaling itself needs no key.
:::

## What's different — context comes along

There's one difference from a generic chatbot. **You can attach this project's context to the question.**

Toggle it with the chips above the input:

| Chip | What it attaches |
|---|---|
| **Code** | Code passages semantically near your question (chosen by local search) |
| **Journal** | Recent entries |
| **Planner** | Current plan items and their status |
| **git** | Recent commit flow |

Which is why these questions actually get answered:

- "Summarize this project's structure at a glance"
- "Based on recent entries, suggest what to do next"
- "Summarize planner progress and call out the risks"
- "Review the recent commit flow"

Those four sit on the first screen as buttons.

## Token badge — see the cost before you send

An **estimated input token** count sits beside the input. Click it and you get a per-item breakdown — system prompt, N code passages, journal, planner, action protocol.

:::warn
**Every send re-transmits the context plus the entire conversation history.** The longer a conversation runs, the more each send costs. When the subject changes, starting a new conversation is cheaper.
:::

The badge is a heuristic estimate (±30%). It's for *calibration*, not an exact bill.

## Planner action proposals

This is what makes the screen special. When something in the conversation warrants a change to the plan, the model emits a **proposal card**:

| Proposal | Meaning |
|---|---|
| 🗂 Create plan | A new planner document |
| ➕ Add items | Add work to an existing plan |
| ✅ Change status | Move an item's glyph |
| ✏️ Rename item | |
| 🗑 Remove item | |

**Nothing happens until you approve.** Click and it's actually applied to the planner file, and the card flips to **✓ Applied**. The model does not rewrite your plan on its own.

:::tip
Ask something like "look at what I did this week and draft next sprint's items" and it reads the journal context and proposes plan items. Approve only the ones you like.
:::

## Picking models and history

- **Model select** — switch per message, beside the input. Only providers you have keys for appear
- **New conversation / History** — reopen past conversations
- **Stop** — cut off a long answer
- `⏎` sends · `⇧⏎` newline

## Automatic work context

Turn on **"Inject journal and rules automatically"** under Settings → Indexing & RAG and recent entries plus the AGENTS rules go into every conversation without touching the chips. Change sessions or models and the direction of work carries over.

The number of entries injected is adjustable — more context, more tokens. Set it to 0 to inject rules only.

## How this differs from in-app Claude Code

| | Agent panel | In-app Claude Code |
|---|---|---|
| Purpose | Asking and sorting out | Actually changing code |
| Cost | Your API key | Claude subscription |
| Providers | Several (Anthropic, OpenAI, Gemini, OpenRouter, NIM) | Claude |
| Edits files | No (planner proposals only after approval) | Yes |

## Next steps

- To actually have code changed → [Claude Code](/wiki/en/claude-code)
- Keys, models, fallback chains → [Settings](/wiki/en/settings)
- Where proposals land → [Planner](/wiki/en/planner)
