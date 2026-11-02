# Changelog

## 0.2.0 — 2026-11-02

Rebuilt from scratch as a receipt viewer. Works without the desktop app.

- Status bar: last check-command result of live plans, count of changes no journal entry mentions.
- Status bar: the open file's receipt (journal entries that touched it and the command each ran).
- Explorer badge `○` on unrecorded changes (`ocul.explorerBadges`).
- Commands: What needs my eyes · Journal entries for this file · Copy PR receipt.
- Reads `.oculpm/` only — no writes, no network, no child processes.

0.1.0 (2026-09-11) shipped only as a GitHub Release `.vsix`; its sidebar trees, checkbox toggles and MCP client are gone.
