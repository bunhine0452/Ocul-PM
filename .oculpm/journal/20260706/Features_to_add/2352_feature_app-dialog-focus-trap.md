---
schema_version: 1
type: feature
slug: app-dialog-focus-trap
status: done
difficulty: medium
created_at: "2026-07-06T23:52:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/hooks/useModalBehavior.ts
    op: create
  - path: src/components/ui/AppDialog.tsx
    op: create
  - path: src/features/oculpm/ManualEntryModalV2.tsx
    op: update
  - path: src/features/chat/ConversationHistoryModal.tsx
    op: update
  - path: src/features/discussion/DiscussionScreenV2.tsx
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/__tests__/app_dialog.test.tsx
    op: create
related: []
tags: ["v2-release", "U13", "modal", "focus-trap", "a11y"]
---

[x] U13 공용 모달 동작 — useModalBehavior 훅 + AppDialog 셸 (포커스 트랩·복원)

## 추가 기능

- **`useModalBehavior` 훅**: 오버레이 8곳이 각자 `fixed inset-0` 를 구현하며 전무했던 규칙을 한 곳에 — 열릴 때 트리거 저장→첫 포커서블(또는 initialFocus) 포커스, Tab/Shift+Tab 내부 순환 트랩, Esc 닫기(패널 스코프 리스너 — 다른 오버레이 무간섭), 닫힐 때 트리거 복원, body 스크롤락. 설계 조정: 기존 모달의 마크업/CSS(set-modal, disc-modal)를 유지한 채 **동작만 얹는 훅 방식** — AppDialog 강제 이전보다 시각 회귀·테스트 churn 위험이 없음.
- **`<AppDialog>` 셸**: 훅 내장 + 백드롭 클릭 닫기 + 토큰 스타일 패널 — 신규 모달용. 첫 소비자로 U10 산출물 모달 이전.
- **훅 채택 3곳**: 수동 일지 모달(제출 중 Esc 가드 유지, 기존 창-레벨 Esc/autofocus 효과 2개 제거), AI 대화 기록 모달, 토의 승격 모달.
- offsetParent 가시성 필터를 의도적으로 배제 — fixed 오버레이 안에선(그리고 jsdom 에선) 정상 요소도 null 이라 트랩이 통째로 비는 함정 (코드 주석 기록).

## 동작 흐름

모달 열림 → 포커스가 내부로 이동, Tab 이 모달 안에서만 순환 → Esc/백드롭 → 열었던 버튼으로 포커스 복귀 (키보드 사용자가 길을 잃지 않음).

## 검증

- 신규 `app_dialog.test.tsx` 4케이스: 초기 포커스, Tab/Shift+Tab 순환, Esc 닫기+트리거 복원, 백드롭 vs 패널 클릭 구분.
- 기존 모달 스위트(journal_v2 수동일지 axe 포함) 전부 그린 — 마크업 불변 확인.
- 게이트: typecheck=0 / test=0 / lint=0 / build=0.
