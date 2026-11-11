---
schema_version: 1
type: bug
slug: "sessionend-hook-cancelled-windows"
status: done
difficulty: medium
created_at: "2026-11-12T03:27:00+09:00"
session_id: "9d4f1e46-b6ae-4587-878b-58718e0f6a47"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/hooks/session-end.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/session-end.sh"
    op: update
  - path: "src-tauri/tests/session_verdict.rs"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: update
related: []
tags:
  - "플러그인"
  - "windows"
  - "훅"
---
[x] 플러그인: Windows 에서 SessionEnd 훅이 잘리지 않는다

## 발생 원인
사용자 보고(11-12): `SessionEnd hook ["${CLAUDE_PLUGIN_ROOT}/hooks/session-end.sh"] failed: Hook cancelled`.

Claude Code 는 SessionEnd 훅 전체에 1.5초만 준다. 종료 · /clear · /resume 전환 때 모두 그렇다. 플러그인 훅의 `timeout` 은 그 예산을 늘리지 못한다(공식 hooks 문서 SessionEnd 절). Windows 의 Git Bash 에서는 프로세스 하나가 0.2초 남짓 든다. 이 PC 실측으로 `sh -c 'exit 0'` 230ms, `git --version` 247ms, 이 저장소에서 `oculpm-mcp verdict` 838ms 였다. 설치본(4.9.0) 훅을 빈 프로젝트에 돌리면 세 번 다 1.28~1.29초가 걸렸다. 실제 저장소에서는 판정만 0.84초라 예산을 넘는다. 잘리면 판정 · 인박스 append · 마커 청소가 다 빠진다.

## 해결 방법
- `session-end.sh`: Git Bash(OSTYPE msys·cygwin)에서는 stdin 을 내장 `read` 로 읽는다. 루트 확인 뒤 나머지(판정 · 마커 청소 · 인박스 append · 넛지)를 `finish </dev/null >/dev/null 2>&1 &` 로 떼어 내고 곧장 끝난다. 종료 코드 0 의 stderr 는 사용자에게 보이지 않으니 잃는 안내는 없다. `OCULPM_HOOK_SYNC=1` 이면 예전처럼 기다린다(테스트용).
- 모든 OS 에서 프로세스를 덜 띄운다. JSON 값은 `json_str` 내장 함수로 꺼낸다(delivery-gate.sh 와 같은 함수). `\\` 풀기도 프로세스 없이 한다. `rm` 둘을 하나로, `find` 둘을 `\( -o \)` 하나로 줄였다. Codex 판 사본도 같은 파일이다.
- 시험: 기존 훅 실행 자리에는 `OCULPM_HOOK_SYNC=1` 을 붙였다. Windows 전용 시험을 하나 더했다. 훅의 출력이 비어 있고(떼어 냈다), 30초 안에 원장 · 인박스 · 마커 청소가 끝나야 한다.

## 검증
- 새 Windows 시험이 옛 훅에서 `test result: FAILED. 0 passed; 1 failed`(stderr 에 판정 안내가 붙어 나옴), 새 훅에서 `cargo test --locked --test session_verdict --test plugin_xplat --test plugin_manifest` → `6 passed` · `14 passed` · `10 passed`
- 실측(이 PC, 임시 저장소): 동기 902ms. 떼어 낸 모드는 훅이 236ms 에 끝나고 원장 `"verdict":"missing"` · 인박스 한 줄 · 마커 청소가 896ms 안에 끝났다.
- `cargo fmt -- --check` exit 0 · `sh -n` · `dash -n` 통과

## 메모
/clear 직후엔 새 대화의 생존 흔적이 판정보다 먼저 찍힐 수 있다. 그러면 미기록이 「판정 불가(live_peers)」 로 적힌다. 잘려서 아무것도 남지 않던 것보다는 낫다. 설치된 플러그인은 아직 4.9.0 이다. 이 고침은 다음 플러그인 판에 실린다.
