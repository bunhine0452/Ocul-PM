---
schema_version: 1
type: bug
slug: "acp-idle-spin-and-per-session-config"
status: done
difficulty: high
created_at: "2026-09-02T11:21:43+09:00"
session_id: "20260902-002"
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
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/acpOptions.ts"
    op: create
  - path: "src/__tests__/acp_idle_traffic.test.tsx"
    op: create
  - path: "src/__tests__/acp_options.test.ts"
    op: create
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
related: []
tags:
  - "acp"
  - "claude-code"
  - "performance"
  - "multi-session"
  - "mcp-tool"
---
[x] Claude Code 화면이 가만히 있을 때 어댑터를 초당 수천 번 두들기던 것 · 설정과 제목이 대화 사이로 새던 것

앱 안 Claude Code(ACP) 기능을 감사해 결함 셋을 잡았다. 첫째가 압도적으로 크고, 셋 다 **눈에 안 보이는** 종류였다.

## 발생 원인

### 1. 되읽기 효과가 스스로를 다시 부른다 (치명)

`AcpConversation` 의 설정 되읽기 효과가 `session` **객체 자체**를 의존성으로 잡은 채, 그 안에서 `setSession((prev) => ({ ...prev, options: res.data }))` 로 매번 **새 객체**를 만들었다. `acp_options` 는 값이 그대로여도 새 배열을 주므로, 비교 없이 넣으면 아이덴티티가 항상 바뀐다.

```
sync() → acp_options → setSession(새 객체) → session 바뀜 → 효과 재실행 → sync() → …
```

`session` 에 걸려 있던 목록 조회 효과(`useEffect(…, [session, refreshHistory])`)도 같은 고리에 물려 있었다. 결과:

- jsdom 재현 결과 **800ms 동안 `acp_status`·`acp_options`·`acp_session_title`·`acp_list_sessions` 가 각각 2,979회**
- 마지막 것은 로컬 읽기가 아니라 **어댑터로 나가는 진짜 JSON-RPC 왕복**(`session/list`) — Claude Code 프로세스와 `canonicalize` 시스템콜까지 함께 두들겼다
- 매 회전마다 `acpSessionChanged` 리스너를 해제·재등록(그것도 IPC 왕복)
- 화면에는 아무 변화가 없어 **눈으로는 전혀 안 보인다**. 화면이 보일 때만 도는 `isVisible()` 가드 때문에 jsdom 기존 테스트도 못 잡았다

### 2. 설정과 제목이 대화 사이로 샌다

백엔드 `Running` 이 `options` 와 `title` 을 **프로젝트당 한 칸씩** 들고 있었다. 대화를 나란히 돌리는 지금 두 가지가 동시에 틀렸다.

- **탭 전환** — `acp_select_session` 은 어댑터에 아무 것도 묻지 않는다(그게 요점이다: 물으면 그 대화에 흐르던 스트림의 자리를 빼앗는다). 그래서 옮겨 간 대화의 셀렉터가 **방금 떠나온 대화의 모델·권한 모드**를 그대로 가리켰다
- **알림** — 뒤에서 도는 대화가 모델을 바꾸거나 제목을 받으면 그 값이 보고 있는 대화의 칸을 덮었다. 보고 있는 탭이 남의 제목으로 개명되고, 셀렉터가 남의 값을 그렸다

둘 다 "Auto 라 적혀 있는데 실은 Manual" 부류의 거짓말이다 — 사용자가 자동 승인될 거라 믿는 순간이라 안전 문제이기도 하다.

### 3. 버려지는 이벤트가 스레드를 통째로 다시 그린다

`applyAcpEvent` 가 아무 것도 안 한 자리에서도 `[...turns]` 로 새 배열을 만들었다. 호출부(`editTurns`)는 그것을 "바뀌었다"로 읽고 기록 지도를 새로 지어, 묶음 나누기와 `TurnRow` memo 가 헛돌았다. 취소한 턴에 청크가 계속 들어오는 구간이 특히 그랬다.

## 해결 방법

1. **고리 끊기** — `sameOptions` 순수 비교(`acpOptions.ts`)를 새로 두고 **달라졌을 때만** 상태를 갈아 끼운다. 효과 의존성에서 `session` 객체를 빼고 `hasSession` 불리언 + `sessionRef` 로 바꿨다. 목록 조회는 `session?.session_id` 에 건다. 뒤에서 도는 대화의 제목이 탭에 닿는 길은 `acpSessionChanged` 의 `created`/`deleted`/`title` 종류에서만 목록을 다시 읽어 되살렸다(`usage` 는 턴이 도는 동안 계속 오므로 제외).
2. **대화별 장부** — `Running` 의 `session`·`options`·`title` 셋을 `SessionBook` 타입으로 묶고 `options`/`titles` 를 대화 id 로 가른다. `set_options`·`patch_option`·`set_title` 이 세션을 인자로 받고, 알림 핸들러는 알림이 실려 온 세션의 칸에 쓴다. `acp_set_config_option` 은 요청 전에 대상 대화를 붙잡아 둔다 — 요청이 도는 동안 탭을 옮기면 엉뚱한 대화의 모델이 바뀐 것처럼 보였다.
3. **참조 계약** — `applyAcpEvent`/`closeTurn` 이 버릴 때 받은 배열을 그대로 돌려주고, `editTurns` 는 같은 배열이면 지도를 새로 짓지 않는다.

## 검증

- 새 특성화 테스트 `acp_idle_traffic.test.tsx` — 고치기 전 304회(짧은 창)에서 실패, 고친 뒤 명령마다 1회. `getClientRects` 를 스텁해 "보이는 척"해야 이 고리가 드러난다는 점도 함께 못 박았다.
- `acp_options.test.ts` 7건(비교의 양방향) · `acp_turns.test.ts` 에 참조 계약 5건 추가 · `process.rs` 에 `SessionBook` 단위 테스트 6건(탭 전환 복원 · 배경 대화가 셀렉터/탭 이름을 안 덮음 · 빈 화면이 남의 설정을 안 지움 · `None` 제목은 "모른다").
- 게이트 전부 exit 0 직접 확인: `pnpm typecheck` · `pnpm test` (150파일 1,863건) · `pnpm lint` · `pnpm build` · `cargo test` (1,107 + 통합) · `cargo fmt` · `cargo clippy --all-targets -D warnings`. `bindings.ts` 무변경(커맨드 시그니처는 그대로).