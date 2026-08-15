---
schema_version: 1
type: feature
slug: "acp-diff-view-and-ux-overhaul"
status: done
difficulty: high
created_at: "2026-08-16T02:54:47+09:00"
session_id: "mcp-20260816-025447"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AcpDiffView.tsx"
    op: create
  - path: "src/features/chat/lineDiff.ts"
    op: create
  - path: "src/features/chat/promptHistory.ts"
    op: create
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/acpBusyBus.ts"
    op: update
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: update
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/acp_line_diff.test.ts"
    op: create
  - path: "src/__tests__/acp_prompt_history.test.ts"
    op: create
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/__tests__/acp_working_indicator.test.tsx"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "diff"
  - "polish"
  - "mcp-tool"
---
[x] ACP 대화면 대수리 — 편집 diff 가 보인다 · 블라인드 승인의 끝 · 마찰 20종 일소

## 추가 기능

사용자 요청 "oculpm 속 Claude Code 를 온전한 기능으로 + 짜잘한 마찰 일소 + 채팅 UI 를 레퍼런스 기준으로 재점검". 백엔드 감사·설계문서 감사·UX 감사(50건) 세 갈래를 병렬로 돌려 발견을 모은 뒤 한 라운드로 구현했다.

**구조적 공백 셋 (P0급)**

1. **편집 diff 구조화** — 어댑터의 `ToolCallContent::Diff` 를 `"[diff]"` 문자열로 버리고 있었다(session.rs `content_text`). `AcpToolDiff { path, old_text, new_text }` 로 나르고 (`ToolCall.diffs` / `ToolUpdate.diffs: Option` — None 은 "안 왔다", 부분 갱신 규약 유지), 프런트 `lineDiff.ts` 가 줄 비교(공통 머리·꼬리 트림 + LCS, 250k 칸 상한 넘으면 통짜 교체 폴백)를 해 `AcpDiffView` 가 그린다. 도구 카드 줄에 `+N −M`, 접힌 카드에 diff 머리 8줄, 펼치면 전체(400줄 상한).
2. **블라인드 승인의 끝** — 승인 카드에 diff(편집)와 `input`(실행 명령, `raw_input` 의 primary 추출)이 카드 **안에** 실린다. execute/delete 는 카드 낯빛이 앰버로 바뀌고, "이번만 허용"만 primary — "항상 허용"은 outline 으로 물러난다. 승인 대기는 사이드바 배지(`acpBusyBus` attention 축, 깜빡임)로도 알린다 — 작업 중과 달리 눌러야 풀리는 멈춤이라 신호를 갈랐다.
3. **어댑터 사망 감지** — 4초 폴에 `acp_status` 를 끼워 살아있던 프로세스가 죽으면 배너 + "다시 연결". 재연결은 메모리 기록을 비워 `session/load` 경로를 강제한다 (안 비우면 openSession 의 "이미 본 대화" 지름길을 타서 새 어댑터가 그 대화를 모른 채가 된다).

**마찰 일소 (발췌)** — 한글 조합 Enter 전송(isComposing+229 가드, AI 패널 동승) · 컴포저 자동 확장 · ↑/↓ 프롬프트 recall(`promptHistory.ts`, 초안 stash) · 파일 드래그&드롭(Tauri `onDragDropEvent`, `isVisible()` 게이트) · 대기열 세션 고정(오배송 차단)+클릭=회수/X=폐기 · 세션별 draft stash · 답변/IN/OUT 복사 · 오류 재시도/닫기 · 스크롤 FAB · 턴 영수증(`turnReceipt` — 도구·파일·명령·시간) · 실행 중 경과 초 · 삭제 2단계 확인 · 탭 ←/→ 순회+활성 밑줄 · 할일 취소선 제거 · 히트타깃 24px · 생 hex 토큰화(MODE_COLOR, warn 앰버) · 마이크로 텍스트 대비 승격 · 묶음 안(14px)/밖(36px) 간격 분리 · 팝오버 진입 모션 통일.

## 동작 흐름

diff: 어댑터 `tool_call(update)`/`request_permission` → session.rs `content_diffs` (양쪽 clamp 20KB) → `AcpEvent` → 리듀서 `AcpToolCall.diffs` (부분 갱신은 온 것만) → `AcpDiffView` (diffLines → focusWindow). 승인 대기: `permission` 이벤트 → `setAcpAttention(key, true)` → Sidebar `useAcpAttentionCount` → `.nav-badge.attention`. 죽음: `acpStatus` null 전이(살아있던 것만) → 배너 → `reconnect()` = `acp_start` → transcripts 비움 → `openSession` (load 재생).

## 한계

- diff 는 라이브 스트림 기준. `session/load` 재생에도 같은 이벤트로 오므로 복원되지만, 재생 턴에는 시각이 없어 영수증의 소요 시간은 빠진다 (의도 — 없는 시간을 지어내지 않는다).
- 실기기 미확인: 드래그&드롭(웹뷰 밖 테스트 불가), 승인 카드 diff 실측(어댑터가 request_permission 에 content 를 실어 주는지는 스키마 문서 기준), 어댑터 사망 배너(죽여 봐야 안다).
- UX 감사 잔여: 세션별 busy 맵(지금은 화면 단일), 탭 더블클릭 rename, 탭 오버플로 페이드, combobox ARIA 완전체, 타이포 스케일 4단 수렴 — 후속 라운드 몫.

## 검증

- `pnpm typecheck` / `pnpm test` 925 (신규 24: lineDiff 10 · promptHistory 8 · turnReceipt 4 · attention 2) / `pnpm lint` / `pnpm build` 전부 exit 0.
- `cargo test` 589 통과 (신규 3: diff 구조화 · 부분 갱신 None/빈 구분 · 승인 diffs+input). bindings.ts 재생성 확인.
- 커밋 3aeb42e (19 files, +2075 −152).