---
title: Troubleshooting
desc: When entries don't pile up, when you're looking for a screen 4.0 removed, when macOS asks for permission — common snags.
order: 14
updated: 2026-10-29
---

## No journal entries appear

Check these in order:

1. **Is the project tracked?** The project root needs a `.oculpm/` folder and an `AGENTS.md`. If not, press "Turn on recording" in Settings → This project.
2. **Is it terminal Claude Code?** With AGENTS.md alone the model can forget to record. [Install the plugin](/wiki/en/claude-code) and it becomes automatic.
3. **Are the rules out of date?** When Settings → This project shows a newer version on the rules-file row, "Update" brings AGENTS.md to the latest spec.
4. **Another agent (Cursor etc.)?** Anything that reads AGENTS.md works as-is. For a dedicated rules file, add it to `[agents] active` in `.oculpm/config.toml` ([details](/wiki/en/agents)).

## I can't find Search, Discussions, Branch or Skills

4.0 removed them. The app has five surfaces: Today · Work Journal · Plan · Diff · Settings.

| You were looking for | In 4.0 |
|---|---|
| Journal search | `/` on Work Journal |
| Code search | your agent's grep — the app's index is gone |
| Discussions | a plan's decision block. `.oculpm/discussion/` files are still there |
| A branch's recorded rate | "unrecorded changes" on Today and Diff |
| Managing skills and rules | the plugin and Claude Code itself |
| In-app AI · summaries · rollups | the agent in your terminal (`journal_search` · `journal_read`) |
| Tabs · menu-bar tray | one window = one project, ⌘O · ⇧⌘N |

## The app's data shrank after updating

That's expected. The first launch after updating to 4.0 drops the 3.x code-index and embedding tables. It keeps an `ocul-pm.db.bak-v42` copy in the app data folder first, and Settings → Data → "Compact" hands the freed space back to the disk. Entries and plans are markdown in your project and are not affected.

## macOS asks for access to files or other apps' data

That's normal. It helps to tell two gates apart.

- **Notarization** asks "may this app **run**?" Ocul-PM is signed with an Apple Developer ID and notarized, so it passes.
- **A permission prompt** asks "may this app read **that data**?" — a separate gate, unrelated to notarization, and notarization doesn't make it go away.

It asks in roughly two cases.

**Your project is inside Desktop, Documents or Downloads.** macOS protects those, so reading files there needs one approval.

**A program the app launched reads a file.** When something the app ran for you — your external-editor command — reads a protected folder, macOS attributes the access **to the app that launched it**, not the program.

**If it asked again after an update**, it does that once for a version whose signature changed. macOS ties approvals to the app's code signature, so a new signer voids the old approval.

You can revoke approvals any time in System Settings → Privacy & Security.

## Not listed here

Tell us in a [GitHub issue](https://github.com/bunhine0452/Ocul-PM/issues). Attaching `oculpm.log` from Settings → Data → "Log folder" helps us catch it fast.
