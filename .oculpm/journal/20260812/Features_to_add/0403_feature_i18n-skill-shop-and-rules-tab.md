---
schema_version: 1
type: feature
slug: "i18n-skill-shop-and-rules-tab"
status: done
difficulty: medium
created_at: "2026-08-12T04:03:48+09:00"
session_id: "mcp-20260812-040348"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/skills/SkillShopTab.tsx"
    op: update
  - path: "src/features/skills/RulesTab.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "phase2"
  - "스킬"
  - "규칙"
  - "mcp-tool"
---
[x] 스킬 샵 · 규칙 허브 영어화 (91건)

## 추가 기능

SkillShopTab(28건) · RulesTab(63건) 영어화. 사전 키 87개. allowlist 86 → 84.

스킬 샵의 스택 추천·카탈로그 검색·미리보기 모달, 규칙 허브의 범위(프로젝트/전역)·paths 글롭 편집기·Cursor 미러 배포·CLAUDE 메모리 섹션까지.

## 모듈 헬퍼와 컴포넌트를 갈라 다뤘다

`RulesTab` 의 `scopeLabel()` · `mirrorSummary()` 는 컴포넌트가 아니라 모듈 스코프 헬퍼라 훅을 쓸 수 없다 — 모듈 `t()` 를 직접 부르게 했다. Phase 0 에서 언어를 컨텍스트가 아니라 모듈 스토어에 둔 이유가 정확히 이런 곳이고, 이 라운드에서 반복해서 값어치를 하고 있다.

컴포넌트 쪽은 표시에 모듈 `t()` 를 써도 값은 맞지만 **언어를 바꿔도 리렌더가 안 걸린다** — `useT()` 를 구독용으로만 호출해(`useT();`) 리렌더를 보장했다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build.

## 남은 일

84파일. SkillsScreenV2 89 · TrayPopover 70 · GreenfieldWizard 56 · AiPanelScreenV2 50 · ProjectManager 39 · GraphInspector 37 · SearchScreenV2 · DocsScreenV2 · TerminalScreenV2 계열 등. 테스트 20여 개와 Rust 사용자 노출 에러 ~130곳도 미착수.