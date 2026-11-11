---
schema_version: 1
type: bug
slug: "plugin-hooks-windows-spawns"
status: done
difficulty: medium
created_at: "2026-11-11T20:53:31+09:00"
session_id: "manual-20261111-205331"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "plugin/oculpm-codex/hooks/hooks.json"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm/hooks/delivery-gate.sh"
    op: update
  - path: "plugin/oculpm/hooks/session-marker.sh"
    op: update
  - path: "plugin/oculpm/hooks/refix-warn.sh"
    op: delete
  - path: "plugin/oculpm/bin/oculpm-mcp"
    op: update
  - path: "src-tauri/src/oculpm/mcp/hook.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/hook_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/refix.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: update
tags:
  - "플러그인"
  - "windows"
  - "성능"
---
[x] 플러그인: Windows 훅의 프로세스 수를 줄였다

## 발생 원인
Windows 의 Claude Code 는 훅을 Git Bash 로 돌리고, 거기서는 `$(...)` 서브셸 · `sed` · `grep` 하나가 각각 프로세스 하나다.

- 이벤트 싱크(UserPromptSubmit · Stop · Notification …): 이벤트마다 `cat` · `date` · `mkdir` 를 하나씩 띄웠다.
- PreToolUse(편집마다): `refix-warn.sh` 가 payload 를 sed/grep 파이프라인으로 뜯느라 열 개 넘게 띄웠다. 그다음 셔틀이 `dirname` 과 서브셸을 띄우고 나서야 바이너리를 불렀다.
- SessionStart · SubagentStart: `plan-context.sh` 가 플랜 파일마다 `sed | grep` 을 서너 번 띄웠다. 이 저장소처럼 플랜이 94개면 프로세스가 수백 개다. 같은 출력이 이 PC 에서 57초 걸렸다(빌드가 같이 돌던 때).

## 해결 방법
- 싱크: Git Bash(`OSTYPE` msys · cygwin)에서는 셸 내장만 쓴다. stdin 은 `read -d ''`, 시각은 `TZ=UTC0 printf '%(…)T'` 로 읽어 프로세스를 하나도 띄우지 않는다. macOS · Linux 는 예전 `$(cat)` · `date -u` 그대로다(dash · bash 3.2 에는 이 내장이 없다). 이미 있는 폴더에는 `mkdir` 을 띄우지 않는다.
- PreToolUse: 셸 스크립트를 걷어냈다. 훅이 셔틀을 거쳐 `oculpm-mcp hook pre-tool-use` 를 부르고, 바이너리가 stdin JSON 을 직접 읽는다(`mcp/hook.rs` → `refix::warning`). 바이너리가 없으면 셔틀은 `OCULPM_HOOK_QUIET=1` 을 보고 stdin 만 비운 뒤 exit 0 으로 끝낸다.
- 셔틀: 플러그인 루트를 매개변수 확장으로 얻는다. 자식 프로세스를 하나도 띄우지 않는다.
- `plan-context.sh`: 모든 플랜을 awk 한 번으로 훑는다. 실을 플랜 블록도 awk 한 번에 만든다. 판정 정규식 `^(판정|verdict) (✓|✗)` 와 출력은 그대로다. 같은 저장소 사본에서 옛/새 출력이 바이트 단위로 같다.
- `delivery-gate.sh` · `session-marker.sh`: session_id 와 transcript_path 를 매개변수 확장으로 뽑는다.

## 검증
- `cargo test --no-fail-fast`(src-tauri, CARGO_BUILD_JOBS=3) → exit 0, 0 failed (lib 957 passed; egress_inventory · egress_spawn_ledger 포함 1121 passed). 종료 코드 접기를 더한 뒤 `cargo test --test plugin_xplat --test plugin_manifest` → 14 passed · 10 passed. `cargo fmt --check` → exit 0
- 같은 저장소 사본에서 옛/새 `plan-context.sh` 출력 비교 → `same=true`
- Git Bash 실측(Node 가 `bash.exe -c` 로 띄움, 각 측정 직전 `rustc` 0개, 평균): 싱크 368 → 142 ms · PreToolUse 821 → 227 ms · SessionStart 25,585 → 1,686 ms · SubagentStart 22,639 → 1,596 ms

## 메모
- 측정 조건: 이 저장소 `.oculpm`(플랜 94 · 일지 1012) 사본이다. 횟수는 n=20 이고, 옛 plan-context 만 n=5 다(한 번에 20초 넘게 걸려서).
- 플러그인 버전은 앱 버전과 묶여 있다(`plugin_manifest` 가 동기를 강제한다). 그래서 다음 앱 릴리스의 버전 6곳 올리기에 같이 실린다. 앱이 옛 판이면 설치된 `oculpm-mcp` 는 `hook` 을 모른다. 그 바이너리는 exit 2 를 내고, PreToolUse 에서 2 는 「막기」라 편집이 통째로 막힐 뻔했다. 그래서 셔틀의 훅 모드는 exec 대신 바이너리를 실행하고 종료 코드를 0 으로 접는다. 이 경우를 `hook_mode_folds_an_old_binarys_refusal_into_success` 가 잡는다. 접은 뒤에 다시 잰 PreToolUse 는 218 ms 다(옛 판 870 ms, 같은 조건).
