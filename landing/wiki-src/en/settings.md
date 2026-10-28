---
title: Settings
desc: Themes and presets, text size, API keys and fallback chains, indexing and RAG, diagnostics and updates.
order: 13
updated: 2026-10-24
---

`⌘,` opens it. Seven tabs, mixing things you set once with things you may never open.

| Tab | When to open it |
|---|---|
| **Appearance** | Once — theme, text size, menu bar |
| **LLM** | Only for AI features — keys, models, fallbacks |
| **ocul-pm** | Managing agent rules, plugin install instructions |
| **Indexing & RAG** | When search isn't behaving as expected |
| **Data** | Export and cleanup |
| **Diagnostics** | When reporting a problem |
| **Updates** | Manual check, past release notes |

## Appearance

### Theme

A two-layer system: **Light / Dark / System**, with **preset themes** on top.

- 5 presets — Solarized · Sepia · Nord · Dracula · High Contrast
- 6 accent colors — Green (default) · Blue · Purple · Orange · Rose · Teal

:::note
**Choosing a preset disables accent selection.** Presets bring a whole color system of their own. To change only the accent, stay on Light/Dark/System without a preset.
:::

### Two text sizes

**App scale** (%) is the one setting — it applies to the whole app like browser zoom. (The terminal font size went with the in-app terminal on 2026-10-28.)

### Two languages

**UI language** (on-screen text) and **AI writing language** (the language of entries, planner items and discussions the AI produces) are separate. You can run an English UI and keep records in Korean. Already-written documents don't change.

### Menu bar · external editor

Menu bar residency and external editor wiring are covered in [Windows, Tabs, External Editor](/wiki/en/workspace).

## LLM

Needed only for AI-generated text (weekly rollups, entry drafts, plan drafts, skill promotion proposals). **Journaling itself needs no key.**

### API keys

**Stored only in the OS keychain** — never in the app database or a file. The status (set / unset) is cached locally, so opening Settings doesn't trigger a keychain prompt; press **Verify against keychain** only when you really want to check.

### Providers and models

Pick a default provider, and optionally override the model per provider. Leave it blank to use the built-in default.

- **OpenRouter** — hundreds of models over an OpenAI-compatible API. Model id example: `openai/gpt-6-luna`
- **NIM** — the OpenAI-compatible endpoint at `integrate.api.nvidia.com`

### Fallback chain

When the default model call fails, these are retried top to bottom. One `provider:model` per line.

```
openai:gpt-6-luna
anthropic:claude-haiku-5-5
openrouter:google/gemini-3.8-flash
```

:::tip
If you run AI during hours when rate limits bite, a fallback chain makes a real difference.
:::

### Generation

Temperature (lower is focused, higher is creative), max output tokens, and a system prompt prepended to every chat.

## Indexing & RAG

The tab to open when code search isn't behaving.

- **Auto-index on change** — when files change, only the changed files are indexed. To rebuild from scratch, use **Rebuild index**
- **Chunking** — **larger** chunks mean richer context per snippet, **smaller** ones mean sharper search. Overlap has to be smaller than the chunk size
- **RAG context** — how many top chunks go to the model per chat message
- **Work context** — automatically inject recent entries and the AGENTS rules into chat so direction survives a change of session or model. More entries means richer context but more tokens (0 injects rules only)
- **File scan** — max file size, extra exclude patterns (gitignore-style, applied on top of `.gitignore`)

:::warn
Scan setting changes take effect **at the next reindex**. Rebuild the index to apply them now.
:::

## Diagnostics · Updates

- **Diagnostics** — the information to attach when reporting a problem. DevTools opens from here too
- **Updates** — manual check and past release notes (GitHub releases). Normally the app updates itself

:::note
An update restart relaunches the Claude Code adapter along with the app. That's why restarts are deferred while an answer is streaming — the conversation is on disk and comes back, but the answer in flight at that moment is lost.
:::

## ocul-pm

The tab for managing agent rules — choose which agents' rules files to install, use **Resend rules** when the spec has moved, and **Detect** to narrow to agents that appear to be in use here. The plugin install commands and the Claude Desktop MCP snippet live here too, with copy buttons. ([Details](/wiki/en/agents))

## Next steps

- Rules files and adapters → [Other Agents](/wiki/en/agents)
- Where data is stored → [Data & File Layout](/wiki/en/data)
