---
schema_version: 1
type: chore
slug: loading-rule-toolbar-terminology
status: done
created_at: 2026-08-30T15:26:00+09:00
session_id: "manual-20260830-152600"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src/features/docs/DocsScreenV2.tsx
    op: update
  - path: src/features/skills/SkillsScreenV2.tsx
    op: update
  - path: src/features/code/CodeScreenV2.tsx
    op: update
  - path: src/features/settings/SettingsPanel.tsx
    op: update
  - path: src/features/settings/tabs/DataTab.tsx
    op: update
  - path: src/features/planner/PlannerScreenV2.tsx
    op: update
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
  - path: src/features/chat/AiPanelScreenV2.tsx
    op: update
  - path: src/components/CommandPalette.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related:
  - .oculpm/journal/20260830/Features_to_add/1526_feature_error-card-confirm-settings-deeplink.md
tags: [ux, i18n, loading, toolbar, polish-round]
---

[x] 로딩·툴바 제목·용어 규칙 정리 — 평문 로딩 4곳, 하드코딩 제목 3곳, 검증/재인덱싱 표기 흔들림

## 배경

같은 감사에서 나온 잔가지들. 하나하나는 작지만 화면을 오갈 때 "다른 앱 같다"는 느낌을 만들던 것들이다.

## 변경

- 로딩 규칙: 목록은 `SkeletonList`, 단일 대기는 `OculSpinner`. 문서 트리·스킬 목록·코드 파일 트리의 평문 「불러오는 중…」 을 스켈레톤으로, 설정 패널의 영문 `"Loading settings…"` 는 스피너 + `common.loading`, `DataTab` 의 `"Loading…"`/`"Dismiss"` 도 i18n 키로.
- 툴바 제목은 `t("nav.*")` 하나에서 온다: 플래너(하드코딩 「플래너」)·Diff(「변경 diff」≠사이드바 「변경」)·AI 패널(「AI」≠「AI 패널」) 을 사이드바·⌘K 와 같은 글자로. 새로고침 아이콘은 액션 묶음 첫 자리.
- 용어: 사용자가 누르는 `verified_by_user` 는 「확인」(검증/검토 혼용 정리 — `entry.verify`·`entry.verified`·`journal.filterVerified`, en 은 Verify→Confirm), 팔레트 「재인덱싱」→「인덱스 재구축」(설정과 동일), ⌘K 의 중복 「ocul-pm 설정」 항목 제거(「설정」 하나 + 딥링크).

## 검증

`pnpm typecheck` · `lint` · `vitest`(1451) · `build` exit 0. ko/en 키 짝 맞음(추가 10·삭제 1 양쪽 동일).
