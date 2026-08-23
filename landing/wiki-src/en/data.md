---
title: Data & File Layout
desc: The structure of the .oculpm folder, backup and moving, and what local-first actually means.
order: 14
updated: 2026-08-21
---

## The principle — files are the truth

Every record Ocul-PM keeps is a **markdown file inside your project**. The app's database (SQLite) is only a **cache** for drawing screens quickly, and can be rebuilt from the files at any time. Which means:

- delete the app and the records remain
- you can commit records to git and share them with your team
- you can read and edit them in an editor (they're ordinary markdown)

## `.oculpm/` structure

```
.oculpm/
├─ journal/      work journal — .md by date and category
│  └─ 20260816/
│     ├─ Features_to_add/
│     ├─ Bugs/
│     └─ …
├─ planner/      living plan documents .md
├─ discussion/   pre-decision discussion documents .md
├─ agents/       master template for the agent journaling rules
└─ index/        app-managed cache (do not edit)
```

:::warn
`index/` alone is the app's — don't edit or delete it by hand. Everything else is yours.
:::

## Backup and moving

Copy the folder. That's it. Move `.oculpm/` wholesale to the same project on another machine and the app reads it and rebuilds the cache. Including it in git is the simplest backup there is.

:::note
Adding a project also appends a managed block to `.gitignore` that excludes the cache-like paths (`index/`, `hooks/`, `.lock`, `.schema-version`, `oculpm.log`), so committing `.oculpm/` does the right thing with no setup.
:::

## What lives where

| Data | Location | Nature |
|---|---|---|
| Entries, plans, discussions | Project `.oculpm/` | Source of truth (markdown) |
| AGENTS.md journaling rules | Project root | Source of truth |
| Screen cache, search index | App data folder (SQLite) | Derived — rebuildable |
| LLM API keys | macOS keychain | Never in the app DB or files |
| App settings | App data folder | — |

## What leaves the machine

Three things: ① LLM calls you configured yourself, ② the new-version check, ③ Anthropic traffic when you use in-app Claude Code (on your subscription). There is no telemetry, no analytics, no account server. Embeddings for code search are computed locally too.
