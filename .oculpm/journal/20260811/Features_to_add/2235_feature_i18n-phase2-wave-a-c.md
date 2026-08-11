---
schema_version: 1
type: feature
slug: "i18n-phase2-wave-a-c"
status: in_progress
difficulty: high
created_at: "2026-08-11T22:35:05+09:00"
session_id: "mcp-20260811-223505"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/useTodayBrief.ts"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/App.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "영어화"
  - "phase2"
  - "mcp-tool"
---
[ ] i18n Phase 2 1차 — 셸·공용·설정·Today 영어화 (allowlist 130→103)

## 추가 기능

Phase 0 뼈대 위에서 실제 문자열 추출 시작. 이번 회차는 **사용자가 가장 자주 보는 표면**부터 — 셸·공용 컴포넌트, 설정 패널, Today 화면 26파일. 사전 키 300개 추가.

- 셸·공용 (10) — Sidebar · ShellV2 · App · CommandPalette · Toaster · Skeleton · OculSpinner · MarkdownImpl · UpdateBanner · EmbeddingModelBanner
- 설정 (1) — SettingsPanel 154건
- Today (15) — TodayScreenV2 32건 + 위젯 14개

## 설계 판단 4가지

**표시 문자열이 타입 판별자이던 곳을 id 로 분리.** `CommandPalette` 의 `group` 이 `"프로젝트 열기" | "이동" | "액션" | "ocul-pm"` 이었다 — 한글 문자열이 그대로 유니온 타입이라 언어를 바꾸면 타입이 따라 바뀌어야 했다. id 를 고정하고(`"projects" | "nav" | ...`) 헤딩만 `t()` 로 그린다. `SettingsPanel` 의 `TABS.label` · `ACCENTS.label` 도 같은 이유로 `labelKey: I18nKey` 로.

**문장 가운데 강조값은 대상을 문장 밖으로 빼거나 prefix/suffix.** 프로젝트 삭제 확인이 `{이름}을(를) … 제거하시겠습니까?` 로 굵은 이름이 문장 중간에 박혀 있어, 번역하려면 조사 자리에서 쪼개야 했다. 이름을 위로 단독 배치했다 — 파괴적 확인에서 대상이 먼저 보이는 편이 낫기도 하다. 버전 번호처럼 정말 가운데여야 하는 것만 prefix/suffix 로 나눴다(양 언어 모두 "앞+강조+뒤" 어순이라 성립).

**요일 라벨은 사전이 아니라 `Intl`.** `["일","월",…]` 하드코딩 배열을 `Intl.DateTimeFormat(lang, { weekday: "short" })` 로 교체했다. 7개 키를 넣는 것보다 정확하고(로케일별 축약 규칙을 브라우저가 안다) 언어를 늘려도 손댈 게 없다.

**카운터 단위는 분리.** `6건` `57개` 처럼 숫자에 붙던 한국어 조수사를 `unit` 으로 뽑았다 — 영어는 `entries` / `files` 가 되고 레이아웃(큰 숫자 + 작은 단위)은 그대로 산다.

## 도중에 잡힌 것

`t` 라는 이름이 세 군데서 섀도잉되고 있었다 — `TABS.map((t) => …)`, `tasks.map((t) => …)`, `const t = token.trim()`. 전부 typecheck 가 즉시 잡았다. 번역 함수를 `t` 로 부르는 관례의 대가인데, 타입 시스템이 100% 잡아주므로 감수할 만하다.

`useT()` 를 자동 삽입하는 스크립트가 여러 줄 함수 시그니처 중간에 넣어 파싱을 깨뜨렸다 — 괄호 매칭으로 본문 시작을 찾도록 고쳤다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / test(54파일 649건) / lint / build.

기존 테스트가 안 깨진 이유: Phase 0 에서 setup 이 언어를 `ko` 로 고정했고, 한국어 문안은 `ko.ts` 로 **문자 그대로** 옮겼기 때문. 번역이 아니라 이동이라 렌더 결과가 같다.

## 남은 일

**103파일 · 약 2,700 문자열.** 진척은 `PENDING.size` 로 정확히 측정된다 (130 → 103).

상위: OculpmSettings 146 · skillsGallery 112 · PlannerScreenV2 99 · SkillsScreenV2 89 · RetroScreenV2 72 · TrayPopover 70 · RulesTab 63 · DiscussionScreenV2 58 · GreenfieldWizard 56 · AiPanelScreenV2 50. 테스트 파일 20여 개(한글 문자열로 요소를 찾는 것들)와 Rust 에러 130곳·프롬프트 12파일도 미착수.