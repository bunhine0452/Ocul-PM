---
schema_version: 1
type: feature
slug: "i18n-retro-screen"
status: done
difficulty: medium
created_at: "2026-08-12T03:07:09+09:00"
session_id: "mcp-20260812-030709"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/retro/RetroScreenV2.tsx"
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
  - "회고"
  - "mcp-tool"
---
[x] 회고 화면 영어화 (72건) — 12개 화면 중 8개 완료

## 추가 기능

`RetroScreenV2.tsx` 72건 영어화. 사전 키 71개. allowlist 89 → 88.

기간 프리셋, 산출물 3종(스탠드업·PR 본문·주간 보고), Notion 내보내기, 신호 카드 4종(출시·저항·노력·에이전트), 난이도 분포까지.

## 문안 하나를 고쳤다

`"위 신호를 바탕으로 **한국어** 회고를 생성할 수 있어요."` — 원문에 "한국어" 가 박혀 있었다. 언어가 설정으로 갈라진 지금 이 문장은 거짓이 될 수 있다: 영어 UI 를 쓰는 사용자에게 "한국어 회고를 생성한다"고 안내하면서 실제로는 `content_language` 설정에 따라 영어로 쓸 수도 있다.

산출물 언어를 문장에서 빼고 "회고를 생성할 수 있어요"로 줄였다. 실제 언어는 설정 → AI 작성 언어가 결정하고, 그 설정 화면이 그걸 설명한다 — 두 군데서 말하면 어긋난다.

## 상수 테이블 패턴, 일곱 번째

`Preset`(기간) · `SUMMARY_STYLES`(산출물 종류) · `TYPE_LABEL` · `buckets`(난이도) 전부 `label: string` → `labelKey: I18nKey`. 이 코드베이스의 상수 테이블은 예외 없이 이 모양이라, 남은 파일에서도 같은 변환이 기계적으로 반복될 것으로 본다.

`summaryLabel()` 은 배열에서 라벨을 찾아 돌려주는 헬퍼라 `t()` 를 안에서 불러야 했다 — 컴포넌트 안의 클로저로 두고 훅의 `t` 를 잡게 했다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build.

## 진척

12개 ui_v2 화면 중 **8개 완료** — Today · 작업 일지 · 문제 해결 · Planner · 변경 diff · 회고 · 설정(2파일). 남은 화면: 코드 검색 · 코드 맵 · 문서 · 터미널 · AI 패널 · 스킬·규칙.

allowlist 88. skillsGallery 112 · SkillsScreenV2 89 · TrayPopover 70 · RulesTab 63 · GreenfieldWizard 56 · AiPanelScreenV2 50 · skillsCatalog 50 · ProjectManager 39 · GraphInspector 37 등. 테스트 20여 개와 Rust 에러 ~130곳도 미착수.