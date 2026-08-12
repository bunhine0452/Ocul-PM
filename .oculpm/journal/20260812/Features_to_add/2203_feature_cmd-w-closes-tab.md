---
schema_version: 1
type: feature
slug: cmd-w-closes-tab
status: done
created_at: 2026-08-12T22:03:36+09:00
session_id: "manual-20260812-220336"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/menu.rs
    op: create
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src/contexts/SettingsContext.tsx
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
related:
  - .oculpm/journal/20260812/Features_to_add/2101_feature_start-tab-and-theme-sync.md
tags: [tabs, menu, macos, shortcuts]
---

[x] ⌘W 를 탭 닫기로 — 앱 메뉴를 직접 구성해 기본 메뉴에서 되찾았다

## 추가 기능

`⌘W` = **탭 닫기**, `⇧⌘W` = 창 닫기 (Chrome/Safari 와 같은 계약). 탭이 하나뿐일 때는 그 탭을 닫는 것이 곧 창을 닫는 것이고, 그 창이 마지막이면 상주 설정에 따라 종료되거나 트레이로 내려간다 — 이미 있던 연쇄가 그대로 이어진다.

`⌘T`(새 탭)와 `⇧⌘N`(새 창)도 같은 메뉴에 실었다.

## 동작 흐름

지난 라운드에 "메뉴를 직접 구성해야 해서 범위 밖" 이라고 미뤄 뒀던 일이다. **프런트에서 `keydown` 을 잡는 방법은 없다** — macOS 는 메뉴 액셀러레이터를 웹뷰보다 먼저 소비하므로, Tauri 기본 메뉴가 `⌘W` 를 Close Window 에 묶어 둔 이상 이벤트가 웹뷰에 도달하지 않는다.

그래서 `src-tauri/src/menu.rs` 에서 메뉴 전체를 세운다. 직접 구성하면 **표준 항목이 자동으로 붙지 않는다는 것**이 이 작업의 진짜 함정이다 — 특히 편집 메뉴(실행 취소·잘라내기·복사·붙여넣기·전체 선택)가 빠지면 웹뷰 안 텍스트 입력에서 `⌘C`/`⌘V` 가 통째로 죽는다. Edit 서브메뉴는 장식이 아니라 필수다.

메뉴 이벤트에는 **대상 창이 실려 오지 않는다.** `focused_app_window` 가 실제 포커스를 먼저 보고(가장 정확), 못 찾으면 레지스트리가 기억하는 마지막 포커스 창으로 떨어진다 — 메뉴를 여는 순간 창이 포커스를 잃는 플랫폼이 있기 때문이다. 트레이 팝오버는 앱 창이 아니라 제외된다.

커맨드 본문을 `close_tab_inner` / `new_start_tab_inner` / `new_window_inner` 로 떼어 메뉴와 프런트가 **같은 경로**를 타게 했다. 두 진입로가 다른 코드를 돌면 언젠가 어긋난다.

`⌘T` 는 이제 메뉴가 소유하므로 프런트의 중복 핸들러를 제거했다 — 안 지웠으면 macOS 에서 탭이 두 개 열릴 수 있다. `⌃Tab`·`⌘⌥←→`(탭 순환)는 메뉴에 없으므로 프런트에 그대로 남는다.

## 검증

`pnpm typecheck` · `pnpm test`(725) · `pnpm lint` · `pnpm build`(+CSS 가드) · `cargo test`(**552** 단위 + 통합 12스위트 0실패) 전부 exit 0 을 직접 확인.

신규 Rust 테스트 4개 중 핵심은 **`cmd_w_closes_the_tab_not_the_window`** — `⌘W`/`⇧⌘W` 가 뒤바뀌거나 같아지면 "⌘W 로 창이 통째로 닫히는" 예전 동작으로 조용히 되돌아간다. 액셀러레이터 중복 검사와 메뉴 id 네임스페이스 검사도 함께.

## 메모

- **메뉴 라벨 언어는 프런트가 알려 준다** (`apply_menu_language`). Rust 는 프런트의 i18n 사전을 읽지 않고, `language: "system"` 을 OS 로케일로 푸는 것도 백엔드에서는 불안정하다 (GUI 프로세스에는 `LANG` 이 없다). 이미 해석을 끝낸 쪽이 결과만 넘기는 게 정확하다. 시작 시엔 한국어로 세우고 프런트가 마운트하면서 교정하므로, 영어 사용자는 콜드 스타트 직후 아주 잠깐 한국어 메뉴를 볼 수 있다.
- 트레이 아이콘 메뉴("Ocul-PM 열기/종료")는 별개 메뉴라 이번 변경과 무관하다 — 다만 그쪽은 아직 한국어 하드코딩이다.
- **실기기 확인 필요**: 탭 2개에서 ⌘W → 탭만 닫히는지, 탭 1개에서 ⌘W → 창이 닫히는지, 그리고 **웹뷰 입력에서 ⌘C/⌘V 가 살아 있는지**(메뉴를 직접 구성한 대가가 여기 있다).
