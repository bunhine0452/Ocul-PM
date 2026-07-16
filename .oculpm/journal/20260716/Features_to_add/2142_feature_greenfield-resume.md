---
schema_version: 1
type: feature
slug: greenfield-resume
status: done
difficulty: low
created_at: "2026-07-16T21:42:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/onboarding/GreenfieldWizard.tsx
    op: update
  - path: src/features/onboarding/StartScreen.tsx
    op: update
  - path: src/App.tsx
    op: update
  - path: src/__tests__/start_screen.test.tsx
    op: update
related: []
tags: ["greenfield", "onboarding", "blueprint", "audit-fix"]
---

[x] 대시보드 "복원"이 실제로 복원 — 저장된 blueprint 의 단계·입력·id 를 이어서 시작

## 추가 기능

감사 HIGH #1: "복원" 버튼이 `TODO: Resume` 잔재로 항상 새 마법사를 열어, 초안이
이어지지 않고 중복 초안만 쌓였다. 이제:
- StartScreen 의 복원 버튼이 해당 `ProjectBlueprint` 를 App 에 넘기고, App 이
  마법사에 `resume` prop 으로 전달한다.
- GreenfieldWizard 는 `resume` 이 오면 **단계(wizard_step, 0~4 클램프)·아이디어·
  대상 사용자·스택(프리셋 재결합)·폴더·seed goals(관대 JSON 파싱)·blueprint id** 를
  초기 상태로 복원한다. 같은 id 로 autoSave 가 이어지므로 중복 초안이 생기지 않는다.

## 동작 흐름

복원 클릭 → App.greenfieldResume 설정 + 마법사 오픈 → 마법사가 저장 단계에서 시작
→ 이후 자동저장은 기존 blueprint id 를 갱신 → 완료 시 기존 경로대로 blueprint 정리.
새로 시작(onStartGreenfield)은 resume 을 명시적으로 null 로 초기화.

## 검증

- typecheck / test(133) / lint / build exit 0. start_screen 테스트 prop 계약에
  onResumeBlueprint 추가.
- 실기기 왕복(닫기→복원→완료) 확인은 미수행 — {#reskin-verify} 실기기 라운드에 포함.
