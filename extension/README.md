# Ocul — receipts for coding agents

Your coding agent says “done, all tests pass.” Ocul shows you the receipt, right next to your code:
**the command it actually ran and the last line it printed**, and **which changes no record mentions**.

It reads the plain-markdown records in your project's `.oculpm/` folder — written by your agent through the
[Ocul plugin](https://oculpm.com) for Claude Code (or the rules file for Codex, Cursor, Gemini CLI).
No account, no server, no network, no LLM. The extension only reads.

## What you see — only the exceptions

| Where | What |
|---|---|
| **Status bar, left** | `✓ 12m ago` — the last check-command result of your live plans. Turns red with the failing line (`✗ 2 failed`) when one fails. `○ 3` counts changes no journal entry mentions. Click for everything that needs your eyes. |
| **Status bar, right** | The receipt of the file you have open: how many journal entries touched it, and on hover, what each one ran (`pnpm test 1005 passed`). `○ no record` if the change is in none. |
| **Explorer** | `○` on changed files no journal entry mentions. |

Work with evidence folds away. You look only where something is missing.

## Commands

- **Ocul: What needs my eyes** — failing check commands, today's entries without a command run, unrecorded changes.
- **Ocul: Journal entries for this file** — also in the Explorer and tab right-click menus.
- **Ocul: Copy PR receipt** — Markdown for the PR description: the branch's journal entries with the command each ran, the plans' check results, and the files no entry mentions. Also a button in the Source Control title bar. Reviewers read it without Ocul.

## Get started

1. Install the plugin in Claude Code (two lines):
   ```
   /plugin marketplace add bunhine0452/Ocul-PM
   /plugin install oculpm@oculpm
   ```
2. Work as usual. When the agent finishes a unit of work it leaves a journal entry in `.oculpm/journal/`.
3. Open the folder in VS Code. The status bar shows up as soon as `.oculpm/` exists.

The desktop app ([oculpm.com](https://oculpm.com)) is the second step, for people who want to see the records on screens of their own. This extension doesn't need it.

## Privacy

- Reads `.oculpm/**/*.md` only. Writes nothing.
- Uses VS Code's built-in Git extension API for changed files — it starts no process of its own.
- No network access; a test in the repository fails the build if any appears.
- Works in untrusted workspaces (it runs no code from the folder).

---

## 한국어

코딩 에이전트가 「다 됐어요, 테스트 통과」라고 말하면, Ocul 은 그 영수증을 코드 옆에 보여 줘요 — **실제로 돌린 명령과 그 결과 끝 줄**, 그리고 **어느 기록에도 없는 변경**.

- **상태 표시줄 왼쪽** — 진행 중인 계획의 마지막 확인 명령 결과(`✓ 12분 전`, 실패하면 빨갛게 `✗ 2 failed`)와 기록 없는 변경 수(`○ 3`). 누르면 지금 볼 것.
- **상태 표시줄 오른쪽** — 지금 연 파일의 영수증. 올려 두면 그 파일을 건드린 일지와 돌린 명령.
- **탐색기** — 어느 일지에도 없는 변경 파일에 `○`.
- **PR 영수증 복사** — PR 설명에 붙일 마크다운. 리뷰어는 Ocul 없이 읽어요.

시작은 Claude Code 에 플러그인 두 줄이에요. 확장은 `.oculpm/` 을 읽기만 하고, 네트워크도 LLM 도 쓰지 않아요.
