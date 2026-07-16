---
schema_version: 1
type: refactor
slug: ai-chat-unification
status: done
difficulty: high
created_at: "2026-07-16T21:43:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/components/AiOverlay.tsx
    op: delete
  - path: src/components/ModelSelector.tsx
    op: delete
  - path: src/features/chat/ChatPanel.tsx
    op: delete
  - path: src/features/code/AiWorkbench.tsx
    op: delete
  - path: src/features/code/ClarifyDialog.tsx
    op: delete
  - path: src/features/code/fileTreeNav.ts
    op: delete
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/hooks/useGlobalShortcuts.ts
    op: update
  - path: src/components/CommandPalette.tsx
    op: update
  - path: src/App.tsx
    op: update
  - path: src/features/chat/AiPanelScreenV2.tsx
    op: update
  - path: src/__tests__/lite_w6_safety_net.test.ts
    op: update
  - path: src-tauri/src/commands/project.rs
    op: update
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: scripts/check-no-localstorage.mjs
    op: update
related: []
tags: ["ai-panel", "dedupe", "dead-code", "audit-fix", "backend-command"]
---

[x] AI 채팅 단일화 — ⌘\ 오버레이 스택(구버전 두 벌째) 은퇴, AI 패널이 유일 정본

## 동기

감사 HIGH #3: ⌘7 AI 패널(신버전, 한국어)과 ⌘\ 오버레이(ChatPanel 1,177줄 구버전,
`Context:` 등 영어 잔재)가 완전한 채팅 스택 두 벌로 공존 — 유지보수 이중 부담 +
"응답 스트리밍" 설정이 오버레이에만 걸리는 오작동의 원인.

## 변경 요약

**프런트 삭제(6파일)** — AiOverlay·ChatPanel·AiWorkbench·ClarifyDialog·fileTreeNav
(features/code 폴더 소멸)·ModelSelector. 공유 모듈(aiActions·aiContext·
ConversationHistoryModal)은 메인 패널 소비라 유지.

**⌘\ 는 유지, 목적지만 교체** — useGlobalShortcuts 와 ⌘K 팔레트 액션("AI 패널
열기")이 `setUiV2View("ai")` 로 간다. 기존 손버릇이 그대로 새 정본에 착지.

**상태 정리** — WorkspaceContext 의 aiOverlayOpen/aiWorkbenchMode 필드·세터·
migrateAiOverlayOpen 제거, 과거 영속 키는 loadFromStorage 에서 일방향 삭제.
죽은 모듈 전용이던 safety-net 테스트(fileTreeNav 11건 + aiOverlay 마이그레이션
2건)도 함께 제거 (146→133).

**백엔드 은퇴** — 유일 소비자가 오버레이 Quick-Edit 이던 G3 커맨드 2종
(clarify_edit_intent / generate_edit_prompt_with_answers)과 Clarify/EditPrompt
타입 4종을 project.rs·db.rs·lib.rs 에서 제거, bindings 재생성으로 표면 축소.

## 검증

- cargo test 전체 그린 + bindings 에서 clarify*/EditPrompt* 소멸 grep 확인.
- typecheck / test(133) / lint / build exit 0. 스토리지 lint allowlist 의
  ChatPanel 잔재 제거 후에도 lint 그린.

## 메모

- ChatPanel 이 갖고 있던 일회성 localStorage→SQLite 액션 마이그레이션도 함께
  사라짐 — W5(≈6주 전) 이후 오버레이를 한 번이라도 연 사용자는 이미 이관됐고,
  잔존 레코드는 읽히지 않을 뿐 파괴되지 않는다 (한계로 기록).
- Quick-Edit("영어 프롬프트 생성기")은 감사 MEDIUM #5 대로 대체 없이 은퇴 —
  인앱 채팅+플래너 액션이 이미 상위 호환.
