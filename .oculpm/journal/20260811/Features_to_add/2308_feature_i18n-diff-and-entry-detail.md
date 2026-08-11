---
schema_version: 1
type: feature
slug: "i18n-diff-and-entry-detail"
status: done
difficulty: medium
created_at: "2026-08-11T23:08:29+09:00"
session_id: "mcp-20260811-230829"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/features/oculpm/ManualEntryModalV2.tsx"
    op: update
  - path: "src/__tests__/setup.ts"
    op: correct
  - path: "src/__tests__/i18n.test.ts"
    op: correct
  - path: "src/__tests__/i18n_settings_wiring.test.tsx"
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
  - "테스트"
  - "mcp-tool"
---
[x] 변경 diff · 일지 상세 · 수동 일지 영어화 + 테스트 언어 고정의 구멍 수정

## 추가 기능

핵심 루프 3화면 영어화 — DiffScreenV2(38건) · EntryDetailView(21건) · ManualEntryModalV2(19건). 직전 회차에서 미리 넣어 둔 사전 키 121개를 전부 소진했다. allowlist 99 → 96.

## 발생 원인 — Phase 0 의 테스트 언어 고정이 실제로는 안 걸려 있었다

`diff_v2` 4건이 깨졌다. 한글 문자열을 못 찾는다는 거였는데, setup 이 `setLangSetting("ko")` 로 고정하고 있었으니 말이 안 되는 실패였다.

원인: **`SettingsProvider` 를 마운트하는 테스트는 그 고정을 덮어쓴다.** provider 의 effect 가 저장된 설정을 스토어로 밀어넣는데, 테스트 환경엔 저장된 값이 없어 기본값 `"system"` 이 들어가고, `"system"` 은 jsdom 의 `en-US` 로 풀린다. 결과적으로 화면이 영어로 렌더된다.

문자열이 하드코딩 한글이던 동안에는 이 경로가 아무 영향이 없어 드러나지 않았다. 화면을 `t()` 로 옮기는 순간 그 테스트들만 골라서 깨진 것이다 — Phase 0 에서 심어 놓고 몰랐던 구멍이다.

## 해결 방법

`setLangSetting` 이 아니라 **`navigator.language` 자체를 고정**했다:

```
Object.defineProperty(navigator, "language", { value: "ko-KR", configurable: true });
```

이러면 `"system"` 경로까지 결정적이 된다 — provider 가 몇 번 덮어쓰든 해석 결과가 같다. 앰비언트 의존을 스토어가 아니라 **근원**에서 제거한 것이다.

곁가지로 `resolveLang("system")` 을 en 으로 단언하던 i18n 테스트 5건을 ko 로 맞췄다. 이 단언들은 원래 jsdom 기본 로케일에 기대고 있었는데, 이제 고정된 값을 검증하므로 더 정직해졌다.

## 함께 정리한 것

`EntryDetailView` 의 `WEEKDAYS_KO` 하드코딩 배열을 `Intl.DateTimeFormat` 로 교체 — `useTodayBrief` 에서 쓴 방식과 통일.

## 검증

게이트 5종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build / cargo test(실패 0).

## 남은 일

96파일. OculpmSettings 146 · skillsGallery 112 · PlannerScreenV2 99 · SkillsScreenV2 89 · RetroScreenV2 72 · TrayPopover 70 · RulesTab 63 · DiscussionScreenV2 58 · GreenfieldWizard 56 · AiPanelScreenV2 50 등. 테스트 20여 개와 Rust 사용자 노출 에러 ~130곳도 미착수.