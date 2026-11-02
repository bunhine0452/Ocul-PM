# Changelog

## 0.3.0 — 2026-11-03

Works hand in hand with the Ocul app and with Claude — still without needing the app.

- Status bar: **Claude waiting N** — sessions where Claude is asking for permission or waiting for input (from the plugin's Notification hook), and questions Claude asked through `ask_user`. Waits older than 30 minutes drop off. Same rules as the app, checked against one shared case table.
- **Ocul: Open in Ocul** — jump to Today, a journal entry that touched this file, or a live plan in the app (the app asks before opening). Also in the Explorer and tab right-click menus and the status-bar hover.
- **Next up** — the next open item of each live plan (the same rule as the app's Today and `/oculpm:next`), in "What needs my eyes" and the status-bar hover.
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

0.1.0 (2026-09-11) shipped only as a GitHub Release `.vsix`; its sidebar trees, checkbox toggles and MCP client are gone.
