---
schema_version: 1
type: feature
slug: "i18n-phase0-skeleton"
status: done
difficulty: medium
created_at: "2026-08-11T21:44:05+09:00"
session_id: "mcp-20260811-214405"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/index.ts"
    op: create
  - path: "src/i18n/ko.ts"
    op: create
  - path: "src/i18n/en.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: create
  - path: "scripts/gen-i18n-allowlist.mjs"
    op: create
  - path: "src/__tests__/i18n.test.ts"
    op: create
  - path: "src/__tests__/i18n_lint_scanner.test.ts"
    op: create
  - path: "src/__tests__/i18n_switch.test.tsx"
    op: create
  - path: "src/__tests__/i18n_settings_wiring.test.tsx"
    op: create
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/__tests__/setup.ts"
    op: update
  - path: "package.json"
    op: update
related: []
tags:
  - "i18n"
  - "영어화"
  - "lint"
  - "phase0"
  - "mcp-tool"
---
[x] i18n Phase 0 — 언어 스토어·사전·역방향 lint 게이트 + navRegistry 파일럿

## 추가 기능

세 기능 라운드([three-features-round] 플랜) Phase 0. 영어화의 **뼈대**만 깔아 이후 Phase 의 신규 UI 가 처음부터 `t()` 로 작성되게 한다. 실제 2,100개 문자열 추출은 Phase 2.

- `src/i18n/{index,ko,en}.ts` — 라이브러리 없는 ~180줄 자체 구현
- `Settings.language` (`"system"|"ko"|"en"`) + 설정 → 모양 → 언어 섹션
- `scripts/check-no-hardcoded-korean.mjs` + `pnpm lint` 편입
- 파일럿 번역: `lib/navRegistry.ts` (+ 소비처 Sidebar / CommandPalette)

## 동작 흐름

```
SQLite settings.language → SettingsContext → setLangSetting() → 모듈 스토어
                                                                  ├─ t()          (순수 모듈)
                                                                  └─ useT()       (React, useSyncExternalStore)
```

**언어를 React 컨텍스트가 아니라 모듈 레벨 스토어에 둔 게 핵심 결정이다.** 번역 대상의 상당수가 컴포넌트가 아니라 순수 모듈에 있다 — `lib/toast.ts`, `lib/updater.ts`, `features/planner/planList.ts`, `features/projects/managerModel.ts`. 컨텍스트에만 두면 이들은 `t()` 를 못 부른다. SettingsContext 가 스토어로 값을 밀어넣고, React 는 `useSyncExternalStore` 로 구독한다.

사전은 점 표기 flat 키. 중첩 객체 + 경로 타입은 타입 곡예가 필요한데, flat 은 `keyof typeof ko` 만으로 완전한 타입 안전을 얻는다. `en: Record<keyof typeof ko, string>` 제약이 **키 누락을 typecheck 에러로** 만들어 별도 완결성 검사기가 필요 없다.

## 역방향 allowlist — 이 Phase 의 진짜 산출물

검사기는 `check-no-localstorage.mjs` 와 같은 구조지만 allowlist 를 **거꾸로** 쓴다. 현재 한글이 있는 130개 파일을 전부 등재해 통과시키고, Phase 2 에서 파일을 번역할 때마다 한 줄씩 뺀다.

- Phase 0 직후부터 **신규 파일은 한글 하드코딩이 불가능** (allowlist 에 없으니 즉시 걸림)
- Phase 2 진척도가 `PENDING.size` 로 정확히 측정 (130 → 0)
- 이미 끝낸 파일의 회귀가 즉시 잡힘

실제로 작동함을 확인했다 — 이 작업 중 새로 만든 테스트 3개를 게이트가 그대로 잡아서 사유와 함께 `PERMANENT` 로 분류해야 했다.

탐지는 라인 정규식이 아니라 **문자 단위 상태 기계**다. `"https://… 에서 확인하세요"` 의 `//` 를 주석 시작으로 오독하면 그 뒤 한글을 놓쳐 게이트가 조용히 뚫린다. 이 케이스를 회귀 테스트로 고정했다.

allowlist 시딩은 `gen-i18n-allowlist.mjs` 가 **검사기 자신의 `scanSource`** 로 만든다. 별도 grep 으로 만들면 판정이 어긋나 "allowlist 에 없는데 검사기는 잡는" 유령 위반이 생긴다.

## 파일럿에서 확정한 정책

`navRegistry` 를 파일럿으로 고른 이유는 `alias`(⌘K 팔레트 검색어) 때문이다. "영어 모드에서도 한글로 검색돼야 하는가?" 를 초반에 강제로 결정하게 한다.

**결정: 별칭은 사전에 언어별로 두되, 팔레트가 `tAll()` 로 양 언어를 모두 색인한다.** 한 문자열에 두 언어를 욱여넣는 방식(기존 `"journal 일지 timeline 기록"`)이 아니라 구조적으로 보장한다 — 사람이 양쪽 언어를 기억해 넣어야 하는 규율이 아니게 된다. 한국어 사용자가 영어 모드를 켜도 `일지` 로 찾히고, 반대도 된다.

`NavEntry.label`/`alias` 는 `labelKey`/`aliasKey` 로 바뀌었다. 문자열을 레지스트리에 직접 두면 모듈 로드 시점에 언어가 굳어 설정을 바꿔도 사이드바가 안 바뀐다.

## 도중에 고친 것

`useT()` 가 렌더마다 새 `t` 함수를 돌려주고 있었다. 그러면 `t` 를 deps 에 넣은 소비처 `useMemo`(⌘K 팔레트 아이템 목록)가 **매 렌더** 재계산된다. `useMemo([lang])` 로 감싸 문서화한 계약(언어 변경 시에만 아이덴티티 변경)과 실제 동작을 일치시켰다.

`__tests__/setup.ts` 에서 언어를 `ko` 로 고정했다. 기본값 `"system"` 은 `navigator.language` 를 따르는데, 그러면 같은 스위트가 한국 개발 머신에서 통과하고 CI(en-US jsdom)에서 깨진다 — 실제로 `sidebar_a11y` 3건이 그렇게 실패했다. 앰비언트 로케일 의존을 제거한 것이지 실패를 덮은 게 아니다.

## 검증

게이트 4종 전부 exit 0 을 직접 확인 — typecheck 0 / test 0 (54파일 649건) / lint 0 / build 0.

신규 테스트 23건: 사전 품질(빈 값·영어 사전 한글 잔존) · 언어 해석(깨진 DB 값 방어) · `tAll` 중복 제거 · 스캐너 16종(URL `//` 오독·이스케이프 따옴표·i18n-ignore 범위) · 언어 전환 리렌더 · SettingsContext→스토어 배선 4종.

사전 완결성(ko 의 모든 키가 en 에 있는가)은 타입 제약이 잡으므로 런타임 테스트로 중복 검증하지 않았다.