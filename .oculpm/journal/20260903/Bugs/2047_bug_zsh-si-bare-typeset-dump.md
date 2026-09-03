---
schema_version: 1
type: bug
slug: "zsh-si-bare-typeset-dump"
status: done
difficulty: low
created_at: "2026-09-03T20:47:48+09:00"
session_id: "20260903-014"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/shell_integration/templates/oculpm.zsh"
    op: correct
  - path: "src-tauri/src/oculpm/shell_integration/mod.rs"
    op: update
related: []
tags:
  - "terminal"
  - "shell-integration"
  - "zsh"
  - "regression"
  - "mcp-tool"
---
[x] 터미널을 열 때마다 셸이 파라미터 표를 토했다 — 이름을 잃은 typeset -g

## 발생 원인

ocul-pm 터미널을 열면 프롬프트 위로 `array signals=( EXIT HUP … )`, `association readonly termcap`, `undefined watch` 같은 줄이 200줄 가까이 쏟아졌다.

zsh 셸 통합 스크립트(`templates/oculpm.zsh`) 52줄이 **이름 없는 `typeset -g`** 였다. zsh 에서 선언 빌트인을 이름 없이 부르면 셸의 전 파라미터를 속성과 함께 출력한다 (`zsh -c 'typeset -g' | wc -l` → 196).

편집 사고다. `8b01349` (세션 심)에서 심 PATH 블록을 끼워 넣을 때 원래 줄

    typeset -g __oculpm_nonce="${OCULPM_NONCE:-}"

의 **이름 부분이 새 주석에 덮여** `typeset -g # 세션 심 …` 이 됐고, nonce 대입은 블록 아래에 `typeset -g` 없는 형태로 다시 생겼다. 기능(nonce·OSC 133)은 멀쩡했고 — 그래서 아무 테스트도 울지 않았다 — 문법도 유효하다 (`zsh -n` 통과). 눈에 보이는 것은 출력뿐이었다. v2.38.0 에 그대로 실렸다.

bash 판은 같은 커밋에서 깨끗하게 삽입돼 무사하다.

## 해결 방법

- 심 PATH 블록을 nonce 주석 **위로** 옮기고, `typeset -g __oculpm_nonce="${OCULPM_NONCE:-}"` 를 원형대로 복구. `shell_version: 3`.
- 재발 방지: `scripts_never_declare_without_a_name` — 두 템플릿에서 `typeset|declare|local|export|readonly` 로 시작하는 줄에 플래그 말고 **이름이 하나는 있는지** 검사한다. 주석 토큰은 이름으로 치지 않는다 (첫 사고가 정확히 주석이었으므로). `zsh -n` 은 이 부류를 잡지 못한다 — 문법은 맞기 때문에.

스크립트는 `materialize_script` 가 내용 비교로 다시 쓰므로, 다음 빌드에서 앱데이터의 사본이 자동 교체된다. 설치된 v2.38.0 사본을 손으로 고치는 것은 소용없다 — 터미널을 열 때 다시 덮인다.

## 검증

- `cargo test --lib shell_integration` → 12 passed (신규 가드 포함).
- 가드 반증: 템플릿을 `typeset -g  # 이름을 잃은 선언` 으로 되돌려 놓으면 테스트가 실패한다(확인함). 주석을 이름으로 세던 첫 판은 이 반증을 통과하지 못해 고쳤다.
- `zsh -n templates/oculpm.zsh` 통과, `rustfmt` 적용.