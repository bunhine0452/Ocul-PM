---
schema_version: 1
type: feature
slug: "vscode-app-pairing"
status: done
difficulty: high
created_at: "2026-11-03T03:09:03+09:00"
session_id: "20261103-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "6fc3a353-b7f3-424c-8f8a-3203b542643e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/bridge.ts"
    op: create
  - path: "extension/src/model/waiting.ts"
    op: create
  - path: "extension/src/model/applink.ts"
    op: create
  - path: "extension/src/model/plan.ts"
    op: update
  - path: "extension/src/store.ts"
    op: update
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/guard.spec.ts"
    op: update
  - path: "extension/package.json"
    op: update
  - path: "src-tauri/src/deeplink.rs"
    op: update
  - path: "src-tauri/src/oculpm/waiting_cases.json"
    op: create
  - path: "src-tauri/src/oculpm/claude_waiting.rs"
    op: update
  - path: "src/features/deeplink/deepLinkPlan.ts"
    op: update
  - path: "src/features/shell/useOpenInEditor.ts"
    op: create
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/shell/useShellNav.ts"
    op: update
  - path: "CLAUDE.md"
    op: update
related: []
tags:
  - "확장"
  - "vscode"
  - "extension"
  - "deeplink"
  - "mcp-tool"
---
[x] 확장: 앱과 VS Code 를 서로 잇는다

## 추가 기능
사용자 요청(11-03) 「VS Code 와 연동성을 더 — 둘이 환상의 짝꿍이 되게」. 고른 넷을 모두.
- **VS Code → 앱**: 확장 0.3.0 「Ocul 에서 열기」 — 오늘 · 이 파일을 건드린 일지 · 살아 있는 계획을 앱에서. 앱 딥링크 `oculpm://open` 에 `journal=` · `plan=` 을 더했다(경로 칸 검사, 앱은 여전히 열기 전에 묻는다). 계획 대상은 새 칸 대신 `WindowNavigate.entry_path` 에 `plan:<id>` 로 싣는다(창 네 겹에 칸을 끌고 다니지 않게).
- **앱 → VS Code**: 작업 일지의 변경 파일 머리에 「VS Code 에서 열기」. 편집기 이름 찾기 · 열기를 `useOpenInEditor` 훅으로 뽑아 프로젝트 메뉴와 같이 쓴다.
- **확장에 Claude 기다림 · 다음 할 일**: 플러그인 훅 인박스(`.oculpm/hooks/claude-events.jsonl`)와 `ask_user` 질문 파일을 확장이 직접 읽어 「Claude 기다림 N」 — 앱 없이도. 규칙은 앱 `apply_waiting` 과 **공유 사례표** `waiting_cases.json`(Rust · TS 둘 다 읽음). 다음 항목은 앱 오늘 · `/oculpm:next` 와 같은 규칙(첫 `[ ]` 리프, 사람 몫 건너뜀).
- **VS Code 터미널에서 이어하기**: 「터미널에서 이어서」 가 통합 터미널에 `claude "/oculpm:next <계획>"` — 누를 때만, 신뢰한 작업 영역에서만. 계획 id 는 단순 이름으로 걸러 셸 주입을 막는다.

## 동작 흐름
- 확장은 여전히 `.oculpm/` 에 쓰지 않는다(`.claude/rules/vscode-extension.md`) — 그래서 질문에 VS Code 에서 바로 답하는 것은 뺐고 「Ocul 에서 답하기」 로 앱 오늘 화면을 연다.
- 가드: `openExternal` 은 `bridge.ts` 한 곳, `appUri`(oculpm 스킴)를 거친 것만. 웹 주소 금지는 그대로.
- 함정: 앱이 인박스를 1MB 넘으면 비운다 — 그 앞의 기다림은 확장이 잊는다(앱은 기억).

## 검증
- 확장 vitest 65 passed(사례표 8건 · 인박스 · 질문 · 앱 링크 · 다음 항목 · 가드), check-types · esbuild 통과
- cargo test --lib 939 passed(딥링크 대상 · 경로 트릭 거절, 공유 사례표), clippy 깨끗
- pnpm test 1025 passed, typecheck/lint/build 0
- 실제 VS Code · 설치본 육안 확인은 아직