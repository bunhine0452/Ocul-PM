---
schema_version: 1
type: bug
slug: "terminal-width-adopt-on-attach"
status: done
created_at: "2026-09-07T22:23:47+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  session: "9b2717b7-fba7-4aec-a7be-c3d077c9fb96"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "mcp-tool"
---
[x] 도크↔터미널 화면을 오갈 때 대화가 좁게 굳던 것 — 붙을 때 세션 폭을 이어받는다

## 무엇이 문제였나

사용자 보고: "터미널의 텍스트가 한번 줄여지면 다시 원상복귀가 안 되고 줄어든 채로 보인다."
확인 결과 **새 출력은 정상 폭, 이미 찍힌 과거 출력만 좁게 굳어** 있었고, 계기는 ⌘J 도크 ↔ 터미널 화면 이동과 페인 분할/분할 닫기였다.

셸이 그냥 뱉은 긴 줄은 xterm 이 접은 것이라(soft wrap) 폭이 바뀌면 xterm 이 다시 편다.
그런데 claude code 같은 TUI 는 자기가 `process.stdout.columns` 를 읽어 **직접 개행을 넣어** 뱉는다.
그렇게 들어간 개행은 스크롤백 안에서는 그냥 줄바꿈 문자라 어떤 리플로도 지울 수 없다.
즉 **좁은 폭으로 한 번 찍힌 텍스트를 나중에 되살리는 길은 없다** — 애초에 폭을 흔들지 않는 것이 유일한 수단이다.

폭이 흔들린 자리는 도크와 터미널 화면이 **같은 세션**을 다른 크롬으로 그린다는 점이었다
(도크는 `compact` 레일 168px·좁은 여백, 화면은 200px·넓은 여백). 자리를 옮기기만 해도 열 수가 몇 칸
달라지고, 그 몇 칸이 매번 대화를 한 번씩 접었다.

## 무엇을 고쳤나

붙는 순간에는 **세션이 쓰던 폭을 그대로 이어받는다**.

- `AttachPayload`/`PtyAttach` 에 `cols` 추가. 호스트는 장부를 따로 두지 않고 `master.get_size()` 로
  커널에게 직접 묻는다. 구버전 호스트는 이 필드를 모르므로 `#[serde(default)]`, `0` 은 "모른다".
- `ptyResize.ts` 에 순수 판정 `adoptedCols(adopt, fitted, width)` — 자리가 있고(`cols <= fitted`)
  남는 띠가 `ADOPT_SLACK_COLS`(12) 안일 때만 이어받는다. 붙었을 때의 컨테이너 폭을 함께 들고 있다가
  **그 값이 달라지면 놓는다** — 창 크기·도크 손잡이·분할이 전부 여기에 걸린다.
- `TerminalInstanceImpl` 의 크기 맞춤을 `applyFit` 한 함수로 모았다. `fitRef`·`resizeQueueRef` 를
  없애고 `applyFitRef` 하나만 남긴 이유는 `fit()` 을 직접 부르는 길이 하나라도 남으면 그 길만
  판정을 건너뛰기 때문이다. 글자 크기·밀도 변경은 `applyFit(true)` 로 이어받기를 명시적으로 놓는다.

남는 오른쪽 띠는 눈에 띄지 않는다 — `.term-pane` 배경과 xterm 테마 배경이 둘 다 `--term-bg` 다.

## 한계

- **이미 좁게 찍힌 과거 출력은 복구되지 않는다.** 하드 랩된 개행은 데이터라, 앞으로 안 깨지게 할 수는
  있어도 지난 것을 펴는 길은 없다.
- **좌/우 도크(기본 460px)는 여전히 접힌다.** 터미널 화면과 열 수 차이가 slack 을 훨씬 넘어 이어받을
  자리가 없다. 기본값인 **하단 도크**는 폭이 화면과 같아 이제 무손실이다.
- **분할은 의도적 축소**라 그대로 접힌다. 분할을 닫을 때 다시 접히지는 않는다(넓어지는 방향).

## 검증

- `src/__tests__/terminal_pty_resize.test.ts` 에 `adoptedCols` 5 케이스 추가 (없음/이어받음/자리 없음/
  너무 넓어짐/사람이 바꿈).
- typecheck · test(190 파일 2468) · lint 6게이트 · build · `cargo test` · `cargo fmt --check` ·
  `cargo clippy --all-targets -D warnings` 전부 exit 0.
- `host.rs` 는 파일 크기 래칫(1143줄)에 걸려, 별도 필드 대신 `master.get_size()` 를 쓰고 Attach 팔의
  튜플을 한 줄로 접어 기준선에 맞췄다.

**실기기 확인은 아직**이다 — 앱을 띄워 ⌘J 왕복으로 대화가 접히지 않는지 봐야 한다.