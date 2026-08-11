---
schema_version: 1
type: feature
slug: "i18n-skills-screen"
status: done
difficulty: medium
created_at: "2026-08-12T04:30:07+09:00"
session_id: "mcp-20260812-043007"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/skills/SkillsScreenV2.tsx"
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
  - "mcp-tool"
---
[x] 스킬 화면 영어화 (89건) — 스킬·규칙 허브 5탭 전체 완료

## 추가 기능

`SkillsScreenV2.tsx` 89건 영어화. 사전 키 74개. allowlist 84 → 83.

이로써 **스킬·규칙 허브 5탭(스킬·샵·규칙·훅·플러그인) 전체**가 끝났다 — 앞선 SkillShopTab·RulesTab·skillsCatalog·skillsGallery 와 합쳐 이 화면은 완결이다.

## 상수 테이블, 여덟 번째

`HUB_TABS` 의 `label` → `labelKey`. 그리고 그 map 콜백이 `(t) =>` 였다 — `t` 섀도잉이 아홉 번째다. 전부 typecheck 가 잡았고, 이번에도 인자를 `entry` 로 개명했다.

이 라운드에서 확인된 반복 패턴 둘을 정리하면:

1. **상수 테이블은 예외 없이 `label: string`** — 8번 연속 같은 변환.
2. **`.map((t) => …)` 관용구가 흔하다** — 번역 함수를 `t` 로 부르는 대가인데, 타입 시스템이 100% 잡아주므로 감수할 만하다. 다만 남은 파일에서도 계속 나올 것으로 본다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build.

## 진척

12개 ui_v2 화면 중 **9개 완료** — Today · 작업 일지 · 문제 해결 · Planner · 변경 diff · 회고 · 설정 · 스킬·규칙. 남은 화면: 코드 검색 · 코드 맵 · 문서 · 터미널 · AI 패널.

allowlist 83. TrayPopover 70 · GreenfieldWizard 56 · AiPanelScreenV2 50 · ProjectManager 39 · GraphInspector 37 등 + 테스트 20여 개 + Rust 에러 ~130곳.