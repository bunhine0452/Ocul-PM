# Changelog

## 0.3.0 — 2026-11-03

Works hand in hand with the Ocul app and with Claude — still without needing the app.

- **Ocul panel** in the Activity Bar — Claude is waiting · Needs your eyes · Next up · Recent journal entries, most urgent first, with a badge for what needs you now. Native tree view, no webview. It replaces the "What needs my eyes" quick pick.
- **One status-bar item** instead of two: Claude waiting · last check result · unrecorded changes. Coloured only when you must act (red on a failing check, yellow while Claude waits). Click opens the panel.
- **Claude waiting** — sessions where Claude is asking for permission or waiting for input (from the plugin's Notification hook), and questions Claude asked through `ask_user`. Waits older than 30 minutes drop off. Same rules as the app, checked against one shared case table. A notification pops once when a new wait starts (`ocul.notifyWhenClaudeWaits`).
- **Ocul: Open in Ocul** — jump to Today, a journal entry that touched this file, or a live plan in the app (the app asks before opening). Also in the Explorer and tab right-click menus, the panel rows and the status-bar hover.
- **Next up** — the next open item of each live plan (the same rule as the app's Today and `/oculpm:next`), in the panel (▶ continues it in a terminal) and the status-bar hover.
- **Ocul: Continue in terminal** — types `claude "/oculpm:next <plan>"` into a VS Code terminal. Only when you click, only in a trusted workspace.
- Matching the app: pick a project colour in Ocul and this window's title bar takes it (written to `.vscode/settings.json` by the app).
- Still writes nothing to `.oculpm/` and opens no web address; the only link it opens is the app's own `oculpm://`.

## 0.2.0 — 2026-11-02

Rebuilt from scratch as a receipt viewer. Works without the desktop app.

- Status bar: last check-command result of live plans, count of changes no journal entry mentions.
- Status bar: the open file's receipt (journal entries that touched it and the command each ran).
- Explorer badge `○` on unrecorded changes (`ocul.explorerBadges`).
- Commands: What needs my eyes · Journal entries for this file · Copy PR receipt.
- Reads `.oculpm/` only — no writes, no network, no child processes.

0.1.0 (2026-09-11) shipped only as a GitHub Release `.vsix`; its writable sidebar trees, checkbox toggles and MCP client are gone (the 0.3.0 panel only reads).
