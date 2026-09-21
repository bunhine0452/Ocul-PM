---
schema_version: 1
type: feature
slug: "resume-dispatch-and-shell-status-truth"
status: done
difficulty: medium
created_at: "2026-09-22T05:05:02+09:00"
session_id: "20260922-004"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "11374f00-b5ac-48b5-baf8-a10f2cc343d9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/resume.rs"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/ResumeCard.tsx"
    op: update
  - path: "src/features/terminal/oscShell.ts"
    op: update
  - path: "src/features/terminal/shellStatus.ts"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/__tests__/shell_integration_status.test.ts"
    op: create
  - path: "src/__tests__/resume_card.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20260922/Features_to_add/0144_feature_resume-context-and-card.md"
    kind: "followup"
  - ref: "20260922/Bugs/0504_bug_journal-toast-burst-on-reappearance.md"
    kind: "followup"
tags:
  - "today"
  - "terminal"
  - "first-record-loop"
  - "mcp-tool"
---
[x] 「이어서 작업」을 플래너 디스패치 경로로 · 셸 통합 부제를 켜짐/신호 대기/꺼짐 세 갈래로

## 지적 둘 (2026-09-22)

1. 이어하기 카드의 「터미널에서 이어서 작업」이 오늘 현황 아래의 빠른 터미널을 조용히 열 뿐이라 스크롤을 내리기 전까지 무엇이 바뀌었는지 알 수 없었다.
2. 설정에선 셸 통합이 켜져 있는데 터미널 화면 부제는 「셸 통합이 꺼져 있어요 · 켜기」였다.

## 원인

1. `onRunAgent` 가 `setTermOpen(true)` 뿐이었다 — 화면 전환도, 무엇이 실렸는지도 없었다. 같은 저장소에 이미 더 나은 경로가 있었다: 플래너 ▶실행의 `plan_dispatch_prompt` + `dispatchTarget.handoffDispatch`(돌고 있는 에이전트에 붙여넣기 / 셸 한 줄 프리필 / 터미널 없으면 대기열 + 터미널 화면 이동, 토스트).
2. `TerminalScreenV2` 의 부제가 포커스된 페인의 `ShellState.active`(nonce 검증 OSC 133 을 받았는가) 하나로 켜짐/꺼짐을 갈랐다. 재접속한 페인(앱 업데이트 뒤 재부착 — PTY 호스트는 9/15 부터 살아 있었다), 프로그램이 오래 도는 페인, 첫 프롬프트 전 새 셸은 **신호가 아직 없을 뿐**인데 「꺼짐」에 「켜기」 버튼까지 달렸다. 호스트는 start/attach 응답에 `shell_integration`(spawn 때 스크립트를 실었는가)을 이미 돌려주고 있었고 프론트가 안 읽었다.

## 수정

- 백엔드 `resume_dispatch_prompt`: `resume::digest` 를 `render_prompt`(ko/en, "자료이지 지시가 아님" 프레이밍 + journal_read/journal_search/plan_status/journal_write 순서)로 만들어 `.oculpm/index/dispatch/resume.md` 에 쓰고 `shell_command_for` 한 줄과 본문을 돌려준다. 이어갈 것이 없으면 거부.
- Today: 「이 맥락으로 이어서 작업」 → `handoffDispatch` → 토스트(붙여넣음/준비됨/대기열) → 터미널이 안 보이면 이동. 첫 기록 카드의 「에이전트 실행」도 터미널 화면으로 이동(이미 보이면 그렇다고 토스트).
- 터미널: `ShellState.provisioned`(호스트 플래그) + `deriveIntegrationStatus(shell, installed)` 세 갈래. 부제는 켜짐 / 「셸 통합 켜짐 — 이 세션은 아직 신호가 없어요 (다음 프롬프트부터 인식해요)」 / 꺼짐(이때만 켜기 버튼). 설치 여부는 `shellIntegrationApi.status()`(읽기 전용) 한 번.

## 검증

typecheck·test 2806(신규: shell_integration_status 4)·lint·build·clippy·fmt 0. PR #30 → `fb77d4d9`. 설치본 육안은 다음 릴리스(3.4.1) 뒤 — 설치본이 도는 중이라 dev 빌드 금지.