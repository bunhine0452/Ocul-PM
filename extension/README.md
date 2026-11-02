# Ocul — receipts for coding agents

Your coding agent says “done, all tests pass.” Ocul shows you the receipt, right next to your code:
**the command it actually ran and the last line it printed**, and **which changes no record mentions**.

It reads the plain-markdown records in your project's `.oculpm/` folder — written by your agent through the
[Ocul plugin](https://oculpm.com) for Claude Code (or the rules file for Codex, Cursor, Gemini CLI).
No account, no server, no network, no LLM. The extension only reads.

## What you see — only the exceptions

| Where | What |
|---|---|
| **Ocul panel** (the eye in the Activity Bar) | One look at everything, most urgent first: **Claude is waiting** (a permission prompt, input, or a question it asked you) · **Needs your eyes** (failing check commands, today's entries without a command run, changes no entry mentions — or one line saying nothing does) · **Next up** (each live plan's next item, ▶ to continue it with claude in a terminal) · **Recent journal entries** (click for a preview, ↗ to open it in the app). The panel's badge counts what needs you now. |
| **Status bar, left** | One item: `🔔 Claude waiting 1` first when Claude waits, then `✓ 12m ago` — the last check-command result of your live plans — and `○ 3` for changes no journal entry mentions. Red when a check fails, yellow while Claude waits, plain otherwise. Click to open the panel. |
| **Status bar, right** | The receipt of the file you have open: how many journal entries touched it, and on hover, what each one ran (`pnpm test 1005 passed`). `○ no record` if the change is in none. |
| **Explorer** | `○` on changed files no journal entry mentions. |
| **Notification** | Once, when Claude starts waiting for you — so you don't miss it while you're in another file. Turn it off with `ocul.notifyWhenClaudeWaits`. |

Work with evidence folds away. You look only where something is missing. Claude's waits are read from the plugin's hooks, so they show up without the app.

## Commands

- **Ocul: Show the Ocul panel** — also a click on the status bar.
- **Ocul: Journal entries for this file** — also in the Explorer and tab right-click menus.
- **Ocul: Copy PR receipt** — Markdown for the PR description: the branch's journal entries with the command each ran, the plans' check results, and the files no entry mentions. Also a button in the Source Control and Ocul panel title bars. Reviewers read it without Ocul.
- **Ocul: Open in Ocul** — jump to Today, a journal entry that touched this file, or a live plan in the desktop app. The app asks before it opens anything.
- **Ocul: Continue in terminal** — types `claude "/oculpm:next <plan>"` into a VS Code terminal, so Claude picks up the plan's next item. Only when you click, only in a trusted workspace.

### With the desktop app

Ocul and this extension hand work to each other: the app opens a project, a file or a journal entry's changed file in VS Code, and gives each project a colour that this window's title bar takes too; the extension opens the same project's Today, entries and plans in the app. Claude's questions are answered in the app — the extension never writes to `.oculpm/`.

## Get started

1. Install the plugin in Claude Code (two lines):
   ```
   /plugin marketplace add bunhine0452/Ocul-PM
   /plugin install oculpm@oculpm
   ```
2. Work as usual. When the agent finishes a unit of work it leaves a journal entry in `.oculpm/journal/`.
3. Open the folder in VS Code. The Ocul panel and the status bar show up as soon as `.oculpm/` exists.

The desktop app ([oculpm.com](https://oculpm.com)) is the second step, for people who want to see the records on screens of their own. This extension doesn't need it.

## Privacy

- Reads `.oculpm/` only (journal, plans, and the plugin's hook inbox). Writes nothing there.
- Uses VS Code's built-in Git extension API for changed files — it starts no process of its own. "Continue in terminal" types into a VS Code terminal only when you click it.
- The only link it opens is the desktop app's `oculpm://` deep link.
- No network access; a test in the repository fails the build if any appears.
- Works in untrusted workspaces (it runs no code from the folder).

---

## 한국어

코딩 에이전트가 「다 됐어요, 테스트 통과」라고 말하면, Ocul 은 그 영수증을 코드 옆에 보여 줘요 — **실제로 돌린 명령과 그 결과 끝 줄**, 그리고 **어느 기록에도 없는 변경**.

- **Ocul 패널** (활동 표시줄의 눈 아이콘) — 급한 것부터 한눈에: **Claude 가 기다려요**(허락 · 입력 · 질문) · **지금 볼 것**(실패한 확인 명령 · 돌린 명령이 없는 오늘 일지 · 기록 없는 변경, 없으면 「볼 것이 없어요」 한 줄) · **다음 할 일**(계획마다 다음 항목, ▶ 로 터미널의 claude 가 이어서) · **최근 일지**(누르면 미리보기, ↗ 로 앱에서). 배지는 지금 손댈 것의 수.
- **상태 표시줄 왼쪽** — 한 칸. Claude 가 기다리면 「🔔 Claude 기다림 1」 이 맨 앞, 그다음 마지막 확인 명령 결과(`✓ 12분 전`)와 기록 없는 변경 수(`○ 3`). 실패면 빨강, Claude 가 기다리면 노랑, 그 밖엔 바탕 그대로. 누르면 패널.
- **상태 표시줄 오른쪽** — 지금 연 파일의 영수증. 올려 두면 그 파일을 건드린 일지와 돌린 명령.
- **탐색기** — 어느 일지에도 없는 변경 파일에 `○`.
- **알림** — Claude 가 기다리기 시작하면 한 번. 끄려면 `ocul.notifyWhenClaudeWaits`.
- **PR 영수증 복사** — PR 설명에 붙일 마크다운. 리뷰어는 Ocul 없이 읽어요.
- **Ocul 에서 열기** — 앱의 오늘 · 이 파일을 건드린 일지 · 계획으로 바로. 앱은 열기 전에 물어요.
- **앱과 짝** — 앱에서 프로젝트 색을 고르면 이 창 제목 표시줄도 그 색, 앱에서 일지의 변경 파일을 누르면 VS Code 로. Claude 의 질문에는 앱에서 답해요.

시작은 Claude Code 에 플러그인 두 줄이에요. 확장은 `.oculpm/` 을 읽기만 하고, 네트워크도 LLM 도 쓰지 않아요.
