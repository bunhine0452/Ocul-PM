---
title: Troubleshooting
desc: Nothing is being recorded, in-app Claude Code acting up, and the rest of the common friction.
order: 13
updated: 2026-08-21
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

## Not listed here?

Tell us in a [GitHub issue](https://github.com/bunhine0452/Ocul-PM/issues). Attaching the information from Settings → Diagnostics helps us fix it faster.
