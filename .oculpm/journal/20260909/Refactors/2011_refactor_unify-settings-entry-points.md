---
schema_version: 1
type: refactor
slug: "unify-settings-entry-points"
status: done
difficulty: low
created_at: "2026-09-09T20:11:04+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "c997b348-9e50-41e9-845f-4681b1fda66a"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "design"
  - "ia"
  - "settings"
  - "dead-code"
  - "mcp-tool"
---
[x] 설정이 키보드로 열면 모달, 마우스로 열면 화면이던 것을 하나로

## 동기

같은 설정 패널이 프로젝트 창에서 **두 벌**로 열렸다.

| 진입점 | 결과 |
|---|---|
| ⌘, | `ProjectTab.tsx:93` 이 `settings` 만 가로채 `SettingsOverlay` = `.scrim` 모달 |
| 사이드바 「설정」 | `ShellV2.tsx:343` = `<Toolbar>` + 전체화면 |
| Doctor·Automation 안내 버튼 | `settingsNav.ts` → `useShellNav.ts:102` = 전체화면 |

한 사람이 설계했으면 나올 수 없는 분기다. 사용자는 "설정이 어디에 있는 물건인지" 를 진입 방법마다 다시 배워야 했다.

## 변경 요약

**전체화면 경로는 이미 완성돼 있었다** — `ShellV2` 가 `<Toolbar title sub>` + `SettingsPanel` 을 그리고, `useShellNav` 가 딥링크(`openSettings(tab)`)도 그리로 보낸다. 그래서 고칠 것은 `ProjectTab` 의 가로채기 하나였다.

- `uiV2Nav` 의 `if (v === "settings")` 분기 제거 → ⌘, 가 다른 15개 화면과 **같은 길**로 간다.
- 딥링크 두 곳(`plugin_install`/`skill_install`, `theme_install`)이 `openSettings(...)` 뒤에 `setSettingsOpen(true)` 를 덧붙이고 있었다 — 앞의 호출이 이미 셸을 옮기므로 중복이다.
- 팔레트의 `onOpenSettings` → `setUiV2View("settings")`.
- `SettingsOverlay` 는 **런처 탭 전용**으로 남는다. 사이드바가 없는 창에서는 그게 유일한 자리다.

### 감사가 지적한 것 중 하나는 틀렸고, 대신 죽은 갈래를 찾았다

감사는 "탭 내비가 진입점 따라 가로 스트립(`:164`)과 세로 192px 열(`:185`)로 갈린다" 고 했지만, 프로덕션 소비처를 세어 보니 **둘 다 `embedded`**(가로 스트립)였다. 세로 갈래는 "사이드바 없는 모달용" 이라는 사유로 남아 있었는데 그 모달(`SettingsOverlay`)도 `embedded` 를 넘기고 있어서 **테스트만 그 갈래를 렌더**하고 있었다.

`embedded` 프롭을 통째로 지웠다 — 카드 껍데기·중복 헤더·세로 열이 함께 사라진다(약 40줄). 테스트 둘이 그 헤더의 "설정"/"Settings" 를 마커로 쓰고 있어서, 실제로 렌더되는 첫 탭 라벨("모양"/"Appearance")로 옮겼다. 두 언어가 각각 렌더된다는 보증은 그대로다.

### 오버레이 크롬

- 하드코딩 영어 `<h2>Settings</h2>` → `t("shell.settings.title")`.
- 손으로 붙인 인라인 SVG 닫기 → 공유 `X` 아이콘 + `aria-label`.

## 검증

`pnpm typecheck` · `pnpm test`(193 파일 2,514개) · `pnpm build` · design 게이트 각 exit 0. a11y·i18n 두 스위트가 마커 이동 뒤에도 통과한다.