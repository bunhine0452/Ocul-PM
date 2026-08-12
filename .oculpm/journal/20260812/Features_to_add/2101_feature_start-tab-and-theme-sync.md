---
schema_version: 1
type: feature
slug: start-tab-and-theme-sync
status: done
created_at: 2026-08-12T21:01:31+09:00
session_id: "manual-20260812-210131"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: docs/20260811_three-features/01b-chrome-tabs.md
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/commands/config.rs
    op: update
  - path: src-tauri/src/tray.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/main.tsx
    op: update
  - path: src/lib/windowRoute.ts
    op: update
  - path: src/windows/StartTab.tsx
    op: create
  - path: src/windows/LauncherWindow.tsx
    op: delete
  - path: src/windows/TabbedWindow.tsx
    op: update
  - path: src/windows/ProjectTab.tsx
    op: update
  - path: src/features/shell/TabStrip.tsx
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/features/tray/TrayPopover.tsx
    op: update
  - path: src/contexts/SettingsContext.tsx
    op: update
  - path: src/styles/shell.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/tab_strip.test.tsx
    op: update
  - path: src/__tests__/multi_window.test.tsx
    op: update
  - path: src/__tests__/theme_toggle.test.ts
    op: update
related:
  - .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md
tags: [tabs, start-tab, theme, tray, ux, a11y]
---

[x] 시작 탭 · 창 가로지르는 테마 동기 · 상단바에서 고른 프로젝트 열기

## 추가 기능

사용자 요청 3건 + "할 수 있는 UX 개선 전부".

**① 시작 탭 (크롬 새 탭 페이지)** — 프로젝트 메인 화면이 별도 창이 아니라 **탭**이 됐다. `+` 는 시작 탭을 열고, 거기서 프로젝트를 고르면 **그 자리에서** 그 탭이 프로젝트 탭이 된다 (새 탭이 생기지 않는 게 Chrome 과 같은 점). 그 결과 "런처 전용 창" 개념이 통째로 사라졌다 — `tauri.conf.json` 이 만드는 `main` 도 시작 탭 하나를 문 평범한 탭 창이고, `adopt_first_window` 로 setup 에서 레지스트리에 편입된다.

**② 상단바 테마 연동** — 원인은 테마 코드가 아니라 **수명**이었다. 트레이 팝오버는 앱 시작 때 한 번 만들어져 세션 내내 살아 있는데, `SettingsProvider` 는 마운트 때 한 번만 설정을 읽는다. 그래서 앱에서 테마를 바꿔도 상단바는 만들어질 때의 값을 계속 그렸다. 창이 여럿이 된 지금은 **창끼리도 같은 문제**다. 백엔드가 `settings_set`/`settings_set_many` 직후 `SettingsChanged` 를 쏘고, 모든 `SettingsProvider` 가 그걸 듣고 다시 읽는다.

**③ 상단바 "앱 열기"** — 프로젝트를 골라도 무시하고 앱만 앞으로 가져왔다. 선택이 있으면 그 프로젝트 탭을 연다.

**UX 보강** — `⌘T` 새 탭 · `⌃Tab`/`⌃⇧Tab`·`⌘⌥←→` 탭 순환 · 빈 스트립 더블클릭으로 새 탭 · `+` 우클릭으로 "안 열린 프로젝트" 지름길 · 탭 오버플로(가로 스크롤 대신 균등 축소) · 시작 탭 전용 아이콘 · **탭 활동 점**(그 프로젝트에 세션이 도는 중 — 백그라운드 탭에서는 이게 유일한 신호다).

## 동작 흐름

탭 모델이 `Vec<u32>`(프로젝트 id) 에서 `Vec<Tab { id, project_id: Option<u32> }>` 로 바뀌었다. 탭 id 를 프로젝트 id 와 **별개 네임스페이스**로 둔 이유 둘: 시작 탭에는 프로젝트가 없고, 같은 프로젝트가 탭을 옮겨도 탭 신원은 유지돼야 한다. 커맨드도 전부 tab id 기준으로 재작성했다 (`new_start_tab` / `set_tab_project` / `close_tab` / `activate_tab` / `reorder_tabs` / `detach_tab`).

`WindowTabsChanged` 가 이름까지 실어 나르도록 바꿔서 프런트의 후속 조회를 없앴다 (예전엔 id 만 오고 처음 보는 id 가 있으면 다시 물어봐야 했다).

창 종료 판정도 단순해졌다. 예전엔 "런처 닫기"와 "마지막 프로젝트 창 닫기"가 서로 다른 두 경로였는데, 창의 종류가 하나가 되면서 `should_exit_on_last_window_close(remaining, keep_running)` 하나로 합쳐졌다.

## 검증

`pnpm typecheck` · `pnpm test`(58파일 723테스트) · `pnpm lint` · `pnpm build` · `cargo test`(12 스위트 0실패) 전부 exit 0 을 직접 확인.

Rust 레지스트리 단위 테스트를 시작 탭까지 덮도록 다시 짰다 — 탭 id 가 창을 가로질러 유일함, 시작 탭이 "열림" 목록에 안 낌, 승격이 **자리와 탭 id 를 유지**함, 시작 탭을 닫을 때 정리할 프로젝트가 없음(PTY·watcher 를 건드리면 안 된다), 알 수 없는 탭 승격이 no-op. 프런트는 스트립 테스트에 시작 탭 라벨·활동 점·`+` 클릭/우클릭 분기·빈 스트립 더블클릭을 추가했다.

## 메모

- **테마 증상의 진짜 원인은 CSS 가 아니었다.** 토큰·프리셋 배선은 멀쩡했고, 팝오버 창의 `SettingsProvider` 가 재조회를 안 한 게 전부였다. CSS 부터 뒤졌으면 오래 걸렸을 것 — "이 창은 언제 만들어지고 언제 다시 읽나"를 먼저 본 게 주효했다.
- **상주 모드에서 숨은 웹뷰가 새던 경로**를 하나 잡았다. 마지막 창을 닫으면 종료 대신 숨기는데, 그게 `main` 이 아니면 다음 "열기"가 새 라벨을 발급해 숨은 창이 영원히 남았다. "웹뷰는 살아 있는데 레지스트리엔 없는 창"(=휴면 창)을 새 창보다 먼저 재사용하게 해서, 앱 시작 직후의 `main` 편입과 같은 규칙으로 합쳤다.
- **`⌘W` 는 손대지 않았다.** macOS 기본 메뉴가 먼저 잡아 "창 닫기"로 간다. 탭 닫기로 바꾸려면 앱 메뉴를 직접 구성해야 하는데 Edit 메뉴(복사·붙여넣기)까지 재구성해야 해서, 테스트할 수 없는 상태로 위험을 키우기보다 범위 밖으로 뒀다.
- `TabbedWindow` 청크가 68KB → 248KB 로 커졌다. 시작 탭이 첫 화면이라 지연 로드할 이유가 없어 정적으로 넣었다 (ShellV2 는 여전히 lazy).
- **수동 검증 11종(01b §7)은 아직 안 돌렸다.**
