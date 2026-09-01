---
schema_version: 1
type: feature
slug: theme-files-phase4
status: done
difficulty: high
created_at: 2026-09-01T12:40:00+09:00
session_id: manual-20260901-124000
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/themes/mod.rs
    op: create
  - path: src-tauri/src/themes/store.rs
    op: create
  - path: src-tauri/src/commands/themes.rs
    op: create
  - path: src-tauri/migrations/034_project_theme.sql
    op: create
  - path: src-tauri/src/db/mod.rs
    op: update
  - path: src-tauri/src/db/projects.rs
    op: update
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: scripts/gen-builtin-themes.mjs
    op: create
  - path: src/features/theme/schema.ts
    op: create
  - path: src/features/theme/builtins.ts
    op: create
  - path: src/features/theme/accent.ts
    op: create
  - path: src/features/theme/apply.ts
    op: create
  - path: src/features/theme/store.ts
    op: create
  - path: src/features/theme/ThemeGallery.tsx
    op: create
  - path: src/features/theme/ThemeEditor.tsx
    op: create
  - path: src/features/theme/ProjectThemePicker.tsx
    op: create
  - path: src/api/themes.ts
    op: create
  - path: src/contexts/SettingsContext.tsx
    op: update
  - path: src/features/settings/tabs/AppearanceTab.tsx
    op: update
  - path: src/lib/theme.tsx
    op: update
  - path: src/mobile/theme.ts
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
  - path: src/windows/TerminalWindow.tsx
    op: update
  - path: src/windows/StartTab.tsx
    op: update
  - path: src/components/Icons.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: docs/20260831_osaurus-bench/03-themes.md
    op: update
related:
  - 20260901/Features_to_add/1113_feature_provenance-phase3.md
  - 20260831/Features_to_add/2047_feature_watcher-automation-phase2.md
tags:
  - osaurus-bench
  - phase4
  - themes
  - design-tokens
---

[x] 색을 만들어 주고받는다 — 테마 파일화 · 프로젝트 바인딩 (Phase 4)

## 추가 기능

프리셋 5종이 `tokens.css` 에 하드코딩돼 있었다. 사용자는 색을 **만들 수 없고,
주고받을 수 없고, 프로젝트마다 다르게 둘 수 없었다.** 이 라운드가 테마를 파일로
만든다.

- **스키마 v1** — 키가 CSS 변수 이름 그대로다(D3). 부분 지정이 정상이고, 허용
  토큰은 31개 화이트리스트다. 저장 위치는 `.oculpm` 밖 앱 데이터
  (`app_data_dir()/themes/<uuid>.json`) — 테마는 프로젝트가 아니라 사람에게 속한다.
- **내장 5종을 같은 스키마로** — `scripts/gen-builtin-themes.mjs` 가
  `[data-preset]` 블록에서 JSON 을 뽑는다. 내장이 곧 예제가 된다.
- **적용 경로** — `data-preset="custom"` + 인라인 CSS 변수. 강조 5토큰을 하나도
  지정하지 않은 테마는 사용자의 `data-accent` 를 **유지**한다.
- **가져오기 / 내보내기** — `metadata.id` 는 버리고 새 UUID, `is_built_in` 은 강제
  false, 256KB 상한, 이름이 겹치면 되묻는다(조용한 덮어쓰기 금지).
- **라이브 프리뷰 편집기** — 별도 미리보기 캔버스가 없다. 입력 즉시 앱 전체가
  바뀐다. 토큰마다 「가족 기본값으로 되돌리기」.
- **`follows_system_accent`** — macOS 시스템 강조색에서 강조 5토큰을 유도한다.
- **프로젝트별 테마** — `034_project_theme.sql` 의 한 컬럼(`theme_id`). 창 단위로
  적용되고, 바인딩이 없으면 전역 설정으로 폴백한다.

## 동작 흐름

**적용은 한 곳에서만 계산한다.** 창의 색을 정하는 입력이 넷으로 늘었다 — 전역
설정 · 프로젝트 바인딩 · 편집 중 초안 · 사용자 테마 파일. `resolveThemeAttrs`
(순수 함수)가 그 넷을 받아 `{family, preset, accent, vars}` 하나를 내고,
`SettingsContext` 의 이펙트가 그 결과를 `<html>` 에 얹기만 한다. 예전에 테마
이펙트와 강조 이펙트로 갈라져 있던 판정이 하나로 합쳐졌다.

**그래서 `useTheme()` 도 다시 계산하지 않는다.** `lib/theme.tsx` 는 설정값에서
가족을 유도하고 있었는데, 그대로 두면 다크 커스텀 테마에서 코드 하이라이트만
라이트로 그려진다. 이제 `<html data-theme>` 을 `MutationObserver` 로 읽는다.
같은 이유로 `PRESET_FAMILY` 도 손으로 적은 표를 버리고 내장 테마에서 유도한다.

**인라인 변수는 매번 화이트리스트 전체를 지우고 새로 얹는다.** 무엇을 얹었는지
기억할 필요가 없어지고, 테마를 갈아탈 때 옛 토큰이 남는 종류의 버그가 구조적으로
사라진다. 31번의 `removeProperty` 는 그 값어치가 있다.

**검증은 신뢰 경계에 둔다.** 색 값은 파서를 만들지 않고 **모양이 아닌 문자를
전부 거부**한다 — hex 이거나 `rgb()/rgba()/hsl()/hsla()` 이고, 괄호 안은
숫자·구분자뿐이다. `var()`·`url()`·`;` 로 인라인 스타일을 빠져나가는 경로가
남지 않는다. 화이트리스트가 두 언어에 있는 것은 그래서다 — 백엔드가 막고,
프런트는 그룹과 라벨이 필요하다. 어긋나면 테스트가 잡는다.

**창 단위 = 활성 탭.** 창 하나가 탭 여럿을 물고 `<html>` 은 창에 하나뿐이므로,
`TabbedWindow` 가 활성 탭의 프로젝트에서 `theme_id` 를 읽어 모듈 스토어로 민다.
바인딩이 다른 창에서 바뀌면 `ThemesChanged{reason:"binding"}` 이 목록을 다시
읽게 한다. 떼어낸 터미널 창도 자기 프로젝트의 바인딩을 쓴다.

**충돌은 파일을 두 번 고르게 하지 않는다.** `theme_import` 는 이름이 겹치면
에러가 아니라 `status:"conflict"` + `source_path` 를 돌려주고, 사용자가 고른 뒤
같은 경로로 다시 부른다. 덮어쓰기는 **기존 id 를 유지**한다 — 그래야 그 테마를
쓰던 설정과 프로젝트 바인딩이 살아 있다.

## 검증

`pnpm typecheck` · `pnpm test`(133 파일 1626건) · `pnpm lint`(storage/i18n/
bindings 3게이트) · `pnpm build` · `cargo test`(1000건) · `cargo clippy
--all-targets -- -D warnings` · `cargo fmt --check` 전부 exit 0 을 직접 확인.

새 테스트 — `theme_schema.test.ts`(19건): 내장 JSON == `tokens.css` 블록 ·
프런트 그룹 == Rust `ALLOWED_TOKENS`(소스 파싱 대조) · 왕복 손실 0 · 부분 지정 ·
테마 교체 시 잔여 토큰 0 · 화이트리스트 밖 토큰 차단 · 강조 소유 규칙 · 시스템
강조 유도 · 창 A/B 독립 · 사라진 테마 폴백 · 초안 우선 · **WCAG 대비**(내장 5종
4.5:1, high-contrast 7:1). `theme_gallery.test.tsx`(8건): 내장 읽기 전용 · 카드
적용 · 라이브 프리뷰 · 되돌리기 · 저장/취소 · 충돌 3갈래.
Rust `themes::tests`·`themes::store::tests`(17건): 색 값 수용/거부 · 화이트리스트 ·
정규화 · 경로 탈출 · 크기 상한 · 같은 id 두 번 임포트 → 다른 두 테마.

## 메모

**설계와 다르게 간 것 여섯 가지**는 `docs/20260831_osaurus-bench/03-themes.md`
§7 에 전부 적었다. 요약하면:

1. 화이트리스트를 편집기 다섯 그룹(31개)으로 **닫았다** — 편집기에 없는 토큰을
   임포트로만 칠할 수 있으면 되돌릴 방법이 없는 색이 생긴다.
2. 내장 5종은 프런트에만 산다 (`theme_list` 는 사용자 테마만).
3. 프로젝트 바인딩 값은 설정 `theme` 와 **같은 축**이다 — `builtin:` 같은 두
   번째 이름 체계를 만들지 않았다(D3 과 같은 이유).
4. 대비 테스트는 "유지" 가 아니라 **신설**이다. jsdom 에 레이아웃이 없어 axe 의
   `color-contrast` 는 꺼져 있고, 그래서 토큰 값에서 직접 계산했다.
5. `useTheme()` 이 DOM 을 읽는다.
6. 모바일은 커스텀 테마를 해석하지 못해 OS 다크모드로 떨어진다.

남긴 것: 임포트 사본 이름은 `"{name} (2)"` 고정(세 번째도 `(2) (2)`) · 시스템
강조색은 창 포커스마다 다시 읽는다(분산 알림을 듣지 않는다) · 커스텀 테마가
설정에 있을 때 첫 그림은 목록을 읽는 동안 폴백(`system`)으로 그려진다.
