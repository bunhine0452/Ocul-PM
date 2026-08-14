---
schema_version: 1
type: bug
slug: "acp-first-connect-race"
status: done
difficulty: high
created_at: "2026-08-14T22:15:02+09:00"
session_id: "mcp-20260814-221502"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: update
related: []
tags:
  - "acp"
  - "race"
  - "rust"
  - "bug"
  - "mcp-tool"
---
[x] 첫 연결이 항상 실패하던 문제 — 어댑터가 둘 뜨고 먼저 죽는 쪽이 나중 것을 지웠다

## 발생

에이전트 화면에 처음 들어가면 항상 실패하고, "다시 시도"를 누르면 붙었다.

```
세션을 만들지 못했습니다: Internal error:
"response to `session/new` never received: oneshot canceled"
```

## 원인

`React.StrictMode` 가 effect 를 두 번 실행한다(main.tsx). 자동 시작을 effect 에 넣었으므로 **`acp_start` 가 동시에 두 번** 불렸고, `process::start` 의 "이미 떠 있으면 조기반환" 검사는 첫 번째가 아직 레지스트리에 등록하기 전에 통과한다. 그래서 어댑터가 둘 뜬다.

그 다음이 진짜 사고다. 두 번째 `Running` 이 맵에서 첫 번째를 **덮으면서** 첫 번째의 `_stop` sender 가 drop 된다 → 첫 번째 연결 클로저가 풀려 종료 경로로 들어가고 → 거기서 `state.remove(project_id)` 가 **두 번째(살아 있는) 등록을 지운다.** 뒤이어 `ensure_session` 이 그 죽은 연결로 `session/new` 를 보내니 응답 채널이 끊겨 "oneshot canceled" 가 된다. 재시도가 되는 건 그때는 이미 하나만 남아 정리된 뒤이기 때문.

StrictMode 가 방아쇠였을 뿐, **프런트가 몇 번 부르든 프로세스는 하나여야 한다** — 백엔드에서 막았다.

## 해결

- `AcpState.start_lock` 으로 시작을 직렬화. 두 번째 호출자는 락을 기다렸다가 조기반환에 걸려 같은 어댑터를 공유한다.
- `Running.epoch` 도입. 종료 경로는 `remove_if(project_id, epoch)` 로 **자기 세대일 때만** 지운다 — 죽는 연결이 더 새 연결의 등록을 지우지 못한다.
- 핸드셰이크에 60초 타임아웃. 이 함수가 `start_lock` 을 쥐고 있어서, 어댑터가 응답 없이 매달리면 **재시도 버튼까지 막힌다**. 락을 잡은 채 무한 대기하지 않는다.
- `session_lock` 추가 — `acp_start` 와 `acp_prompt` 가 겹쳐 들어오면 세션이 둘 만들어지고 하나는 에이전트 쪽에 남아 샌다.

## 검증

백엔드 569 유닛 통과. 통합 6건(실물 어댑터) 전부 통과.

병렬 실행에서 `attached_resource_links_are_read_by_the_agent` 가 한 번 실패했는데, 단독 재실행은 통과했다 — 각 테스트가 Claude Code 세션을 하나씩 띄우므로 6개 동시 기동이 레이트리밋에 걸린 것이다. 본 변경과 무관하며, 테스트 파일 헤더에 `--test-threads=1` 요구사항으로 명시했다.

**한계**: 이 경합 자체의 회귀 테스트는 없다. 재현하려면 `AppHandle` 과 실제 연결 두 개가 필요한데 유닛 테스트 층에서 만들 수 없다. 대신 정리 경로를 세대 비교로 좁혀 "죽는 쪽이 산 쪽을 지우는" 형태를 구조적으로 불가능하게 했다.