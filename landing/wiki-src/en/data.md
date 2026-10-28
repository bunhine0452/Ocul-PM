---
title: Data & file layout
desc: The layout of the .oculpm folder, backup and moving, and what local-first actually means.
order: 15
updated: 2026-10-29
---

## The rule — files are the truth

Every record in Ocul-PM is **a markdown file inside your project**. The app's database (SQLite) is only a **cache** for drawing screens quickly, and can always be rebuilt from the files (Settings → Data → "Rebuild from scratch"). So:

- Uninstalling the app leaves your records behind
- You can commit the records to git and share them with your team
- You can read and edit them in any editor (it's plain markdown)

## The `.oculpm/` layout

```
.oculpm/
├─ journal/      work journal — .md by date and kind
│  └─ 20260816/
│     ├─ Features_to_add/
│     ├─ Bugs/
│     └─ …
├─ planner/      living plan documents .md (done condition · check command · verdict log)
├─ agents/       the master of the agent recording rules and the entry spec (journal-spec.md)
└─ index/        app-managed cache (do not edit)
```

The `discussion/` · `rollups/` · `automation/` folders 3.x created are no longer read by the 4.0 app, but **never deleted** — they are your files.

:::warn
Only `index/` is managed by the app — don't edit or delete it. Everything else is yours.
:::

## Backup and moving

Copy the folder and you're done. Move `.oculpm/` wholesale into the same project on another machine and the app reads it and rebuilds the cache. Keeping it in git is the simplest backup.

## What lives where

| Data | Location | Nature |
|---|---|---|
| Entries · plans | the project's `.oculpm/` | source (markdown) |
| AGENTS.md recording rules | project root | source |
| Screen cache · diff baselines | app data folder (SQLite) | derived — rebuildable |
| App settings | app data folder | — |

:::note
The first launch after updating to 4.0 drops the 3.x code-index and embedding tables (358MB of an 837MB database on one install). It keeps an `ocul-pm.db.bak-v42` copy first, and Settings → Data → "Compact" hands the freed space back to the disk.
:::

## What leaves the machine

Two things, and you start both: ① the update check (destination fixed in the app configuration, signature verified), ② links you click (your OS default browser opens them). **The app calls no LLM**, its screens (the webview) reach no outside host, and it takes no API key. No telemetry, analytics or account server. The full ledger is on the [privacy](/privacy) page.
