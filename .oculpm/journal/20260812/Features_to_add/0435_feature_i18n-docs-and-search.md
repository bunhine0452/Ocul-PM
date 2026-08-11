---
schema_version: 1
type: feature
slug: "i18n-docs-and-search"
status: done
difficulty: medium
created_at: "2026-08-12T04:35:36+09:00"
session_id: "mcp-20260812-043536"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/docs/DocsScreenV2.tsx"
    op: update
  - path: "src/features/docs/DocsTree.tsx"
    op: update
  - path: "src/features/docs/DocsImage.tsx"
    op: update
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/features/skills/RulesTab.tsx"
    op: correct
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
  - "버그"
  - "mcp-tool"
---
[x] 문서·검색 화면 영어화 + 순수 함수에 훅을 넣던 버그 수정

## 추가 기능

DocsScreenV2 · DocsTree · DocsImage · SearchScreenV2 영어화 (40건). 사전 키 39개. allowlist 83 → 79. 12개 ui_v2 화면 중 11개 완료.

## 발생 원인 — `useT()` 를 순수 함수에 넣었다

`tools_v2` 검색 5건이 **"Rendered fewer hooks than expected"** 로 깨졌다.

`useT()` 를 컴포넌트 본문에 자동 삽입하는 스크립트가 `function` 선언을 전부 대상으로 잡았는데, 그중 `hint(scope)` 는 컴포넌트가 아니라 JSX 안에서 **조건부로 호출되는 순수 함수**였다. 훅이 조건부 호출이 되면서 렌더마다 훅 개수가 달라졌다.

## 해결 방법

컴포넌트는 PascalCase 라는 React 관례로 판별해 **소문자로 시작하는 함수의 `useT()` 호출을 전부 제거**했다. 같은 실수가 이번 라운드에서 이미 3곳 더 심어져 있었다 — `mirrorSummary`(RulesTab) · `collectFiles`·`ancestorDirs`(DocsScreenV2). 지금까지 테스트가 그 경로를 안 밟아서 드러나지 않았을 뿐이다.

이 함수들은 애초에 훅이 필요 없다 — 표시 문자열은 모듈 `t()` 로 충분하고, 리렌더 구독은 그 함수를 **부르는 컴포넌트**가 이미 갖고 있다. Phase 0 에서 언어를 모듈 스토어에 둔 설계가 여기서도 답이었다.

교훈: "모든 function 에 훅을 넣는다"는 일괄 변환은 위험하다 — 컴포넌트와 헬퍼를 구분하지 않으면 조건부 훅을 심는다.

## 검증

게이트 5종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build / cargo test.

## 남은 일

79파일. 화면은 코드 맵(그래프 70) · 터미널(29) · AI 패널(92) 셋. 그 외 TrayPopover 70 · GreenfieldWizard 56 · ProjectManager 39 등 + 테스트 20여 개 + Rust 에러 ~130곳.