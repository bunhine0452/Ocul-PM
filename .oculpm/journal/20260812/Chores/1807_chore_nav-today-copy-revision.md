---
schema_version: 1
type: chore
slug: "nav-today-copy-revision"
status: done
difficulty: verylow
created_at: "2026-08-12T18:07:39+09:00"
session_id: "mcp-20260812-180739"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/__tests__/sidebar_a11y.test.tsx"
    op: update
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
  - path: "src/__tests__/i18n.test.ts"
    op: update
related: []
tags:
  - "i18n"
  - "copy"
  - "mcp-tool"
---
[x] Today 라벨 카피 수정 — 오늘 → 오늘 현황

직전 커밋(f2b329b)의 `nav.today` = `오늘` 이 **너무 직역**이라는 사용자 지적. `오늘 현황` 으로 바꿨다.

## 근거

이 화면이 담는 건 시각(時)이 아니라 **하루치 작업 현황**이다 — 오늘의 일지 수·변경 파일·활동 링·커밋 그래프·다음 할 일. `오늘` 은 시점을 가리키고 `오늘 현황` 은 내용을 가리킨다.

후보로 `일과(日課)` · `하루` · `오늘 현황` 을 사이드바 모양으로 놓고 비교했고 사용자가 `오늘 현황` 을 골랐다 — 가장 명확하고 오해가 없다.

## 폭이 오히려 맞아떨어졌다

길어져서 248px 사이드바가 걱정이었는데 재 보니 **기존 라벨과 정확히 동일**했다:

```
오늘 현황  9단위 ≈ 59px
작업 일지  9단위 ≈ 59px
문제 해결  9단위 ≈ 59px
스킬·규칙  9단위 ≈ 59px
```

한글 2+2 구조가 사이드바의 지배적 리듬이라 `오늘` (4단위)이 오히려 혼자 짧아 튀었던 셈이다.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 678통과 / lint(남은 0) / build.