---
schema_version: 1
type: feature
slug: "mcp-ask-user-answer-in-app"
status: done
difficulty: high
created_at: "2026-10-30T00:31:38+09:00"
session_id: "mcp-20261030-003138"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools/ask.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/protocol.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "src-tauri/src/oculpm/claude_waiting.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/hooks.rs"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/features/terminal/attention.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20261029/Features_to_add/2345_feature_notify-hook-outside-terminal-waiting.md"
    kind: "followup"
tags:
  - "mcp"
  - "today"
  - "ocul-next"
  - "mcp-tool"
---
[x] Claude 가 묻고 앱에서 답한다 — MCP ask_user + 오늘의 답 칸

## 추가 기능

사용자가 고른 소통 방식 「Claude 가 묻고 내가 답하기」를 만들었다.

- **도구** — `oculpm-mcp` 의 `ask_user(question, options≤6)`, 파일은 `mcp/tools/ask.rs` 다(`tools/mod.rs` 가 800줄에 닿아 따로 뗐다).
  - 질문을 `.oculpm/hooks/questions/<id>.json` 에 쓴다. 이 폴더는 gitignore 관리 블록 안이다.
  - 훅 인박스에 `OculpmQuestion` 한 줄을 남겨 앱의 워처를 깨운다.
  - 앱이 `<id>.answer.json` 을 쓰면 그 답을 돌려주고 두 파일을 지운다.
  - 25분 안에 답이 없으면 질문을 거두고 `answer: null` 과 「터미널에서 다시 물어 주세요」를 돌려준다. stdio MCP 는 30분 동안 무응답이면 끊기므로 그 안에서 거둔다.
  - 앱 안 터미널이든 바깥 터미널이든 같은 길이다. 답이 도구의 결과로 Claude 에게 간다.
- **기다리는 동안 막히지 않기** — 서버는 요청을 한 줄씩 차례로 처리했다. 그대로면 Claude Code 가 2분 넘은 호출을 뒤로 돌린 뒤(공식 문서) 부르는 `journal_write` 가 답을 기다리느라 멈춘다.
  - 바이너리가 `is_long_call` 로 `ask_user` 만 골라 따로 스레드에서 돌린다.
  - 그 응답은 같은 출력 통로(잠금 한 번에 한 줄)로 나간다.
- **앱**
  - 명령 `claude_questions`(답 파일이 있는 것은 뺀다), `claude_question_answer`(id 검증, 거둔 질문 거부, 임시 파일 뒤 rename).
  - 워처가 인박스의 `OculpmQuestion*` 에 `ClaudeQuestionsChanged` 를 보낸다.
- **오늘**
  - 「먼저 볼 것」 맨 위에 「Claude 가 물어요」 줄이 선다.
  - 줄 안에 답 칸이 있다: 고를 답 단추, 직접 쓰는 칸(Enter), 「보내기」(빈 칸이면 이유를 말하는 비활성).
  - 창이 뒤에 있으면 처음 보는 질문을 OS 알림으로 알린다.

## 남은 것

- 실제 Claude Code 에서 2분 넘은 `ask_user` 가 뒤로 돌았다가 답과 함께 돌아오는지는 설치본에서 봐야 한다(#eyes-installed).
- `MCP_INSTRUCTIONS` 에는 넣지 않았다. 도구 설명이 「사람이 터미널을 보고 있지 않을 수 있을 때」를 말한다.

## 검증

- Rust 테스트를 더했다.
  - `ask::tests` 셋: 앱이 쓴 답이 돌아오고 파일이 지워지며 인박스에 두 줄이 남는다 · 시간 안에 답이 없으면 거둔다 · 미추적 프로젝트와 빈 질문은 거부한다.
  - `claude_waiting` 하나: 답한 질문은 빠지고, 거둔 질문 · 이상한 id · 빈 답은 거부한다.
  - `protocol` 하나: `ask_user` 만 긴 호출이고, 휴면 인스턴스는 아니며, 도구 목록에 있다.
  - `cargo fmt --check && cargo clippy -D warnings && cargo test --locked` → 1153 passed.
- `today_v4` 에 「고른 답 · 쓴 답이 그 질문으로 간다」를, `terminal_attention` 에 「처음 보는 질문만」을 더했다. `pnpm test` → 943 passed, lint · build exit 0.