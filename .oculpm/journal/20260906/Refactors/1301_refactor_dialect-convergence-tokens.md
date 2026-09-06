---
schema_version: 1
type: refactor
slug: "dialect-convergence-tokens"
status: done
difficulty: high
created_at: "2026-09-06T13:01:24+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/App.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/tabs.css"
    op: update
  - path: "src/features/settings/settingsIndex.ts"
    op: create
  - path: "src/features/settings/SettingsSearch.tsx"
    op: create
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/__tests__/settings_search.test.ts"
    op: create
related: []
tags:
  - "v3-surface"
  - "css"
  - "settings"
  - "design-system"
  - "mcp-tool"
---
[x] 방언을 수렴시킨다 — 글자 20종→13단·여백 8단·문법색 한 팔레트, 그리고 설정 검색

기둥 2(`v3-surface`)의 방언 수렴 Phase. **리디자인이 아니다** — 전면 리디자인은 `v3-round` 에서 기각됐다. 값을 키우는 게 아니라 **가짓수를 줄인다**. 이 앱은 밀도 도구다.

> 기록 한계: `src/styles/tokens.css` 와 `src/__tests__/design_tokens.test.ts` 도 이 작업의 중심인데 `files_touched` 에 못 넣었다 — `config.toml` 의 `forbid_journal_for_paths` 에 있는 `**/*token*` 이 디자인 토큰 파일을 시크릿으로 오인한다(`v3-release {#token-glob-false-positive}`, 이번이 세 번째다).

## 동기

같은 뜻의 값이 자리마다 다르게 적혀 있었다. 글자 크기 리터럴이 20종이고 `--fs-*` 는 10~13px 만 정의되어 **14px 이상은 자리마다 각자 정했다**. 여백도 마찬가지. 문법 강조는 팔레트가 **4벌**이라 같은 코드가 편집기에선 보라, 변경 화면에선 빨강이었다. 그리고 설정은 12탭 + 하위 5탭 · 7,386줄 · 항목 100+ 인데 **검색이 없어** 눈으로 훑는 수밖에 없었다.

## 변경 요약

- **`@theme inline` 에 `--text-*`·`--spacing`·`--z-index-*` 연결.** TSX 를 **한 줄도 안 고치고** Tailwind 유틸 294곳이 우리 토큰으로 정렬된다. 빌드 산출물로 확인: `.text-sm{font-size:var(--fs-7)}` · `.p-6{padding:24px}` · `.z-modal{z-index:var(--z-modal)}`.
- **글자 램프를 제목까지 확장** — 9px 과 14·15·17·20·26px 을 더해 13단. 소유 CSS 의 리터럴 28곳을 전부 토큰화했고 단조 증가를 테스트가 못 박는다.
- **여백 램프 8단 도입(4·6·8·10·12·16·20·24)** — 실측 최빈값 그대로다. 단일값 `gap`/`padding` **122곳**을 치환했고 **값 변화는 0**. 램프 밖 값(1·2·3·5·7·9·11·14·18)은 일부러 리터럴로 남겼다 — 다음 수렴 대상이 눈에 띄어야 한다.
- **모달 크롬 통합** — `.scrim` 과 `.set-modal-backdrop` 이 바탕 한 줄을 공유한다. 하드코딩 `rgba(0,0,0,0.45)` 가 사라져 **프리셋 배경을 따르는** 스크림이 됐다(이게 유일한 예외였다). 머리/경고/발 세 벌도 primitives 에서 한 벌로.
- **문법색 단일 팔레트** — 코드 색 10종을 전역 토큰으로 승격(라이트·다크 + **프리셋 5종**). `screens.css` 의 `.hljs-*` 에 색 리터럴이 0이 됐다.
- **설정 검색** — 132항목 정적 색인(`settingsIndex.ts`) + 탭 줄 옆 176px 입력. 두 언어 검색(`tAll`), 시작-일치 우선, Esc 로 질의만 지운다(모달은 안 닫힌다). **색인이 낡지 않게** 짝 테스트가 설정 25파일을 다시 훑어 누락된 라벨을 이름으로 지목한다.

프리셋 문법 팔레트를 `[data-preset]` **두 번째 블록**에 따로 둔 것은 `gen-builtin-themes.mjs` 파서가 id 당 첫 블록만 읽기 때문이다 — 순서를 바꾸면 내장 테마 JSON 이 오염된다. 경고 주석을 달고 테스트로 못 박았다.

## 남은 것

`{#hljs-unify}` 는 **부분**이다. `src/features/code/code.css` 의 `.code-body` 지역 팔레트(9줄 × 2블록)가 아직 살아 있어, 지우기 전까지 **프리셋 5종에서 hljs 만 다시 칠해지고 편집기는 One Light/Dark 로 남는다**. 라이트·다크는 값이 같아 무해하다. 그 파일은 이 레인 소유 밖이라 병합 때 처리한다. 새 코드 색 토큰을 `features/theme/schema.ts` 와 `src-tauri/src/themes/mod.rs` 화이트리스트에 **함께** 늘려야 하는 것도 남았다(`theme_schema.test` 가 둘의 일치를 단언한다).

세 번째 주황도 나왔다 — `features/today/agentColor.ts` 의 `#d97a4f` 는 `--claude`(#d97757) 와 다르다.

## 검증

`pnpm typecheck` · `pnpm test`(179파일 2,340건) · `pnpm lint`(6게이트, eslint 61/61 — **경고 증가 0**) · `pnpm build`(critical-css 12선택자) 전부 exit 0.

육안 확인이 크게 남는다. Tailwind 글자 크기가 실제로 줄어든다(`text-sm` 14→13 · base 16→14 · lg 18→15 · xl 20→17 · 2xl 24→20 · 3xl 30→26) — 설정 12탭 · 회고 · 새 프로젝트 마법사 · 모바일 셸 · 시작 탭/팔레트 다섯 면을 봐야 한다. 문법 강조는 라이트·다크 + 프리셋 5종 × 언어별로 봐야 하고(주석이 진해지고 키워드가 빨강→마젠타, 함수명이 보라→파랑), 모달 3종은 스크림이 검정에서 테마색으로 바뀐 것을 Solarized·Sepia 에서 꼭 확인해야 한다.