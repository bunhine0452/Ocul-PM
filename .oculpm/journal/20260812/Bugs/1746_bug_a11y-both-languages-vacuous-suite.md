---
schema_version: 1
type: bug
slug: "a11y-both-languages-vacuous-suite"
status: done
difficulty: medium
created_at: "2026-08-12T17:46:15+09:00"
session_id: "mcp-20260812-174615"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/a11y_screens.test.tsx"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "a11y"
  - "test-quality"
  - "mcp-tool"
---
[x] a11y 스위트가 로딩 스켈레톤을 검사하고 있었다 — 양 언어화하다 발견

03-i18n.md §8 의 마지막 미착수 항목("기존 a11y 스위트를 양쪽 언어로") 을 하다가 **세 개의 실제 결함**이 나왔다.

## 발생 원인

### ① a11y 스위트가 공허했다

`a11y_screens.test.tsx` 는 `SettingsPanel` 을 렌더하고 바로 axe 를 돌렸다. 그런데 이 패널은 설정을 비동기로 읽어 그동안 `"Loading settings…"` 한 줄만 그린다. **axe 는 그 로딩 스켈레톤을 감사하고 통과**하고 있었다 — 설정 화면의 a11y 는 한 번도 검사된 적이 없다.

양 언어 단언(`findAllByText(marker)`)을 넣자 처음으로 로딩이 끝날 때까지 기다리게 됐고, 그 순간 실제 위반이 드러났다.

### ② 슬라이더에 접근 가능한 이름이 없었다

```
Form elements must have labels
<input type="range" min="70" max="160" step="5">
```

`Field` 가 그리는 `<Label>` 에 `htmlFor` 가 없어 컨트롤과 연결되지 않는다. 글자 크기 슬라이더 + `NumberSlider` 8개 호출부가 전부 이름 없는 컨트롤이었다. 스크린 리더는 "슬라이더, 100" 만 읽는다.

`NumberSlider` 에 **필수** `ariaLabel` prop 을 넣어 타입이 강제하게 하고, 각 호출부가 `Field` 라벨과 같은 표현식을 넘긴다. 새 슬라이더가 라벨 없이 추가되면 컴파일이 막힌다.

### ③ 하드코딩 영어 — 게이트가 구조적으로 못 보는 것

`SettingsPanel.tsx:1730` 이 `<h2>Settings</h2>` 였다. **한국어 모드에서도 "Settings"** 로 뜬다.

`pnpm lint` 는 **한글**을 찾는 게이트라 하드코딩 *영어*는 원리적으로 못 잡는다. 이번엔 "ko 렌더에 `설정` 이 있는가" 단언이 잡았다 — 반대 방향 검사가 필요하다는 증거다.

## 해결 방법

`describe.each([ko, en])` 로 양 언어를 돌리고, 각 언어마다:

1. **마커 단언** — ko 는 `설정`, en 은 `Settings` 가 실제로 렌더됐는지. 이게 없으면 언어 배선이 깨져 두 행이 같은 언어로 그려져도 axe 는 통과하므로 **스위트가 다시 공허해진다**. (실제로 이 단언이 ③을 잡았다.)
2. **axe** — 이제 로딩이 끝난 실제 패널을 감사한다.
3. **사전 키 누출 검사** — `aria-label` / `title` / `placeholder` 가 비었거나 `a.b.c` 모양(번역 키가 그대로 샌 흔적)인지. axe 는 "비어 있지 않음" 만 보므로 키 문자열은 통과시킨다.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 677통과(+3) / lint(남은 0) / build.