---
schema_version: 1
type: chore
slug: dead-toggle-and-debug-adapters
status: done
created_at: 2026-08-30T11:11:00+09:00
session_id: "manual-20260830-111100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/features/code/CodeDebugPanel.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related: []
tags: [settings, debugger, dead-surface, audit-round]
---

[x] 아무 동작도 없던 `journal_committed` 설정 토글을 내리고, 디버그 패널이 어댑터 설치 상태를 말한다

## 왜·무엇

- **죽은 토글**: 설정 「Git」 섹션의 "journal/ 를 git commit 으로 추적" 토글은 `config.git.journal_committed` 만 바꿀 뿐 `git commit` 을 호출하는 코드가 0 이었다(6월 백로그 A2 미착수). 켜져 있는 채로 보이면 "추적되고 있다" 는 거짓 믿음을 준다. 화면에서 뺐고 설정 키는 스키마 호환을 위해 남겼다. 섹션 설명·i18n(`op.git.track` 삭제) 정정.
- **디버그 어댑터**: `dap_adapters` 커맨드("어느 언어를 디버그할 수 있고 없으면 어떻게 까는지") 는 프런트 호출처가 0 이라 디버거가 왜 안 뜨는지 사용자가 알 길이 없었다. 세션이 없을 때 패널의 스택 자리 아래에 언어별 `준비됨 / 미설치 — 설치 방법` 목록을 그린다(기존 `code.debug.adapterMissing` 문구 재사용).

## 검증

`pnpm typecheck` · `lint` · `test`(1450) · `build` exit 0. a11y 스위트 통과(목록에 `aria-label`).

## 메모

감사가 꼽은 프런트 미호출 커맨드 18개 중 `chat` 은 모바일 브리지 dispatch 가 쓰므로 죽은 것이 아니다. 나머지(프로젝트 개요 4종·daily_brief·blueprint·seed_goals·overview_stats·reindex/resnapshot_paths·conversation 2·discussion_attach·dap breakpoints 2·acp_stop)의 등록 제거는 같은 이름의 Db 메서드·파이프라인(overview.rs·cache/stats.rs)까지 연쇄로 죽어 이 라운드 범위를 넘는다 — `ci-and-module-boundaries #dead-command-audit` 로 남긴다.
