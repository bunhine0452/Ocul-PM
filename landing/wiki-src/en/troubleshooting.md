---
title: Troubleshooting
desc: Nothing is being recorded, permission prompts, and the rest of the common friction.
order: 14
updated: 2026-10-28
---

## Nothing is being recorded

Check in order:

1. **Is the project actually tracked?** The project root needs a `.oculpm/` folder and `AGENTS.md`. If not, re-open the folder from the start screen.
2. **Is this terminal Claude Code?** AGENTS.md alone can be forgotten by the model. [Install the plugin (hook bridge)](/wiki/en/claude-code) and it becomes automatic.
3. **Are the rules stale?** Use **Resend rules** in Settings → ocul-pm → Agents to reinstall the current spec.
4. **Is it a different agent (Cursor, etc.)?** Enable that agent's rules file in Settings. Agents that read AGENTS.md work as-is.

## It says the Claude Code process died

Rarely the adapter exits and a banner appears (v2.11). **Reconnect** relaunches it and restores the conversation you were looking at.

## Code search is slow at first

The first run downloads a local embedding model and indexes the project. After that only changes are refreshed, so it's fast. It's all local computation — your code doesn't leave the machine.

## A new conversation isn't in the history list

A conversation with no messages isn't listed — the moment you send the first message a real session is created and it appears.

## macOS asks for access to files or other apps' data

That's expected. Two separate gates are easy to confuse:

- **Notarization** asks "may this app **run**?". Ocul-PM ships signed with an Apple Developer ID and notarized, so it clears that one outright.
- **Permission prompts** ask "may this app read **that data**?". They are unrelated to notarization and do not go away because an app is notarized.

There are two common cases.

**Your project lives in Desktop, Documents, or Downloads.** macOS protects those folders, so reading files inside them needs a one-time approval.

**A program the app launched read a file.** When the external-editor command or the new-project wizard's scaffold CLI reads a protected folder, macOS attributes that access to **the app that launched it**, not the program. (Before 2026-10-28, a single command in the in-app terminal raised the same prompt.)

**Asked again after an update?** That happens once when the signature changes. macOS ties an approval to the app's code signature, so a new signing identity invalidates the previous grant. The keychain (your API keys) asks once for the same reason — click "Always Allow" and it's done.

**The app never asks first.** The Claude Desktop row in Settings → ocul-pm → Integration has to read Claude Desktop's app data to report its status, so it only looks **when you press [Check Desktop]**. Leave it alone and that folder is never touched.

Anything you approved can be revoked in System Settings → Privacy & Security.

## Not listed here?

Tell us in a [GitHub issue](https://github.com/bunhine0452/Ocul-PM/issues). Attaching the information from Settings → Diagnostics helps us fix it faster.
