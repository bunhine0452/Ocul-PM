---
schema_version: 1
type: bug
slug: ghost-window-cannot-be-closed
status: done
created_at: 2026-08-29T16:41:00+09:00
session_id: manual-20260829-164100
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/menu.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - 20260829/Bugs/1538_bug_close-is-not-focus-aware.md
tags: [windows, tabs, shortcuts, ghost-state, diagnosis]
---

[x] 레지스트리에서 빠진 창은 빨간 버튼 말고는 닫을 길이 없었다

## 발생 원인

사용자 보고: "창 분리 후 프로젝트 닫으려고 x 버튼 눌러도 분리된 창은 안 닫힘."
이어서: "**커맨드 W 도 씹히고 오직 빨간 창닫기 버튼만 먹히더라.**"

두 번째 보고가 결정적이었다. ⌘W 는 드래그와 무관한 완전히 다른 경로(OS 메뉴 →
Rust → `CloseIntent` 이벤트)라, 앞서 고친 네이티브 드래그와 **같은 뿌리가 아니다**.
그리고 "빨간 버튼만 먹힌다" 는 것은 **앱 코드를 거치는 길만 전부 죽었다**는 뜻이다.

그 조건을 만족하는 상태는 하나뿐이다 — **웹뷰는 살아 있는데 그 라벨이 탭
레지스트리에 없는 창**(이하 유령 창). 세 증상이 정확히 다 나온다:

| 조작 | 유령 창에서 |
| --- | --- |
| 탭 × | `closeTab(id)` → `remove_tab` → `locate_tab` **None** → 조용히 `Ok`, 아무 일 없음 |
| ⌘W | `active_tab_of` → `reg.get` **None** → `CloseIntent{tab: None}` → 프런트 `if (payload.tab != null)` 통과 못 함 |
| 빨간 버튼 | 순수 OS — 앱 코드를 안 거침 → **동작** |

`handle_window_closed` 는 `CloseRequested` 에서 **무조건** 레지스트리에서 창을
지우고 나서 닫을지를 정한다. 상주 모드에서 마지막 창이면 `prevent_close` 로
막고 숨기는데(= 의도된 휴면 상태, `create_window` 가 재사용한다), 그 사이에
`hide()` 가 실패하거나 다른 경로로 close 가 무산되면 **보이는 채로 유령**이 된다.

배제한 것 (전부 증거 있음): 레지스트리 산술(재현 테스트) · `win.close()` 자체
(`commit_move` 가 같은 호출로 빈 창을 닫고 그건 동작한다) · 커맨드 등록 ·
capability(`win-*`) · 창 라벨 파싱(로그에 정상 마운트) · 프런트 배선 ·
`snapshot` 의 tab_id · JS 예외(콘솔 브리지에 없음).

## 해결 방법

**유령 창이 어떻게 생겼든 닫을 수 있게 만든다.** 원인 경로를 못 잡아도 사용자가
갇히지는 않아야 한다.

- `close_tab` 이 **누가 요청했는지** 알게 했다 — Tauri 가 주입하는
  `WebviewWindow` 인자(런타임 주입이라 프런트 서명은 그대로다). 요청한 탭을
  레지스트리가 모르고 **그 창도 모르면** 유령이므로, 그 창을 닫는다. 지킬 탭이
  없으니 그것이 요청의 답이다.
- ⌘W(`menu.rs` CLOSE_TAB): `active_tab_of` 가 `None` 이면 유령이므로 이벤트를
  쏘지 않고 그 창을 닫는다. 예전엔 `CloseIntent{tab: None}` 을 쏘고 프런트가
  조용히 걸러내 아무 일도 안 일어났다.
- 판정은 순수 함수 `ghost_window(reg, asking)` 로 뺐다 — 이 조건이 느슨해지면
  **멀쩡한 창을 닫는** 반대편 사고가 되므로 런타임 없이 못 박아야 한다.
- 조용하던 갈래에 계측을 넣었다: 시도한 탭 id · 요청한 창 · 유령 여부 ·
  **레지스트리 전체 요약**(`main:[1(start),2(p=7)] win-1:[3(p=3)]`)을 함께 찍는다.

## 검증

- `cargo test` · `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm build` 전부 exit 0.
- 신규 Rust 3건 — 유령 판정(레지스트리가 모르는 앱 창만 참, 아는 창·터미널
  창·트레이·호출자 미상은 거짓), 진단 요약 형식 2건.
- `bindings.ts` 재생성 — `closeTab` 프런트 서명 불변(주석만 갱신).

## 메모

**원인 경로는 아직 못 잡았다.** 유령 상태가 세 증상을 유일하게 설명하지만,
그 창이 **어떻게** 그 상태가 됐는지는 증명하지 못했다. 다음 재현에서 위 로그
한 줄이 갈라 준다 — `registry=` 에 그 창 라벨이 없으면 확정이고, 있으면 유령
가설이 틀린 것이라 다른 갈래를 봐야 한다.

`handle_window_closed` 가 "닫을지 정하기 **전에**" 레지스트리에서 지우는 순서
자체가 이 상태의 씨앗이다. 순서를 뒤집는(정하고 나서 지우는) 것이 근본
예방이지만, 휴면 창 재사용이 그 제거에 기대고 있어 함께 설계해야 한다.
