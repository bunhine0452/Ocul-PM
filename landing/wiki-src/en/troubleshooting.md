---
title: Troubleshooting
desc: Nothing is being recorded, in-app Claude Code acting up, and the rest of the common friction.
order: 14
updated: 2026-09-08
---

## Nothing is being recorded

Check in order:

1. **Is the project actually tracked?** The project root needs a `.oculpm/` folder and `AGENTS.md`. If not, re-open the folder from the start screen.
2. **Is this terminal Claude Code?** AGENTS.md alone can be forgotten by the model. [Install the plugin (hook bridge)](/wiki/en/claude-code) and it becomes automatic.
3. **Are the rules stale?** Use **Resend rules** in Settings → ocul-pm → Agents to reinstall the current spec.
4. **Is it a different agent (Cursor, etc.)?** Enable that agent's rules file in Settings. Agents that read AGENTS.md work as-is.

## `/plugin`, `/mcp`, `/login` don't work in in-app Claude Code

That's expected — the ACP protocol can't carry the CLI's interactive commands. Use the **terminal button** at the top right of the Claude Code screen to open a real `claude` and run them there. Full reasoning in [Claude Code](/wiki/en/claude-code).

## "Preparing runtime" takes a long time

The adapter is auto-installed on first launch only (npm, pinned version — a few minutes). After that it attaches immediately. Check status in Settings → ocul-pm → Integration.

## In-app Claude Code says I'm not logged in

The app has no login screen — the adapter doesn't provide an auth flow. Run `claude` in a terminal and log in once; the app reuses those credentials.

## I didn't notice it was waiting for approval

When an agent stops for approval, a **blinking badge appears on the Claude Code row in the sidebar** (v2.11). You'll see it from any screen. The approval card shows the exact command to run or the content that will change, so you can read before clicking.

## I'm worried about usage

The gauge in the Claude Code toolbar shows **today, weekly, and per-model** usage. Click it for reset times; typing `/usage` opens the same widget. This lookup costs no tokens.

## An update cut off the conversation I was having

An update restart relaunches the adapter process along with the app. **The conversation itself is on disk and comes back**, but the one answer streaming at that instant is lost. That's why the app defers update restarts while an answer is in flight.

## It says the Claude Code process died

Rarely the adapter exits and a banner appears (v2.11). **Reconnect** relaunches it and restores the conversation you were looking at.

## Code search and code map are slow at first

The first run downloads a local embedding model and indexes the project. After that only changes are refreshed, so it's fast. It's all local computation — your code doesn't leave the machine.

## A new conversation isn't in the history list

A conversation with no messages isn't listed — the moment you send the first message a real session is created and it appears.

## macOS asks for access to files or other apps' data

That's expected. Two separate gates are easy to confuse:

- **Notarization** asks "may this app **run**?". Ocul-PM ships signed with an Apple Developer ID and notarized, so it clears that one outright.
- **Permission prompts** ask "may this app read **that data**?". They are unrelated to notarization and do not go away because an app is notarized.

There are two common cases.

**Your project lives in Desktop, Documents, or Downloads.** macOS protects those folders, so reading files inside them needs a one-time approval.

**You ran something in the built-in terminal.** This is the surprising one — when a command you ran, or an agent running inside it (Claude Code, Codex), reads a file, macOS attributes that access to **the app that launched the command, not the command itself**. So a single `find ~/Library` raises "'Ocul-PM.app' would like to access data from other apps". Every app that embeds a terminal (VS Code, iTerm, …) behaves the same way.

**Asked again after an update?** That happens once when the signature changes. macOS ties an approval to the app's code signature, so a new signing identity invalidates the previous grant. The keychain (your API keys) asks once for the same reason — click "Always Allow" and it's done.

**The app never asks first.** The Claude Desktop row in Settings → ocul-pm → Integration has to read Claude Desktop's app data to report its status, so it only looks **when you press [Check Desktop]**. Leave it alone and that folder is never touched.

Anything you approved can be revoked in System Settings → Privacy & Security.

## Not listed here?

Tell us in a [GitHub issue](https://github.com/bunhine0452/Ocul-PM/issues). Attaching the information from Settings → Diagnostics helps us fix it faster.
