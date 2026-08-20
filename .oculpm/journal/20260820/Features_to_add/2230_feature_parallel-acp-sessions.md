---
schema_version: 1
type: feature
slug: "parallel-acp-sessions"
status: done
difficulty: high
created_at: "2026-08-20T22:30:00+09:00"
session_id: "manual-20260820-223000"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/acp-panel/spike/acp_concurrency_spike.py"
    op: create
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: update
  - path: "src/__tests__/acp_parallel_sessions.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags: ["acp", "claude-code", "sessions", "concurrency"]
---

[x] 한 프로젝트에서 대화 여러 개를 **동시에** 돌린다

제보: "한 프로젝트 세션을 쓰는 중에 새 세션을 추가하고 싶은데 멀티 세션이 안 되는
것 같다." 탭은 진작에 여러 개 열렸다 — 안 되던 것은 나란히 굴리는 것이었다.

## 무엇이 막고 있었나

두 겹이었다.

1. **백엔드** — `acp_prompt` 가 세션 인자를 안 받고 `Running.session`("활성 대화"
   장부)으로 보냈다. 그래서 탭을 옮기는 순간 수신자가 바뀌었다.
2. **프런트** — `busy` 가 화면 전체에 하나였다. A 가 도는 동안 B 에 친 말은
   `busy` 를 보고 **대기열**로 들어갔고, 드레인은 `!busy` 일 때만 돌았다.

## 먼저 확인한 것 (스파이크 4)

고치기 전에 어댑터가 그걸 해 주는지부터 봤다. 안 해 주면 프런트를 아무리 갈라도
두 번째 턴은 첫 번째가 끝날 때까지 멎는다.

`acp_concurrency_spike.py` — 한 stdio 연결에 `session/new` 두 번, 프롬프트 두 개를
거의 동시에. **교차했다**: A 첫 청크 2.23초 · B 2.43초 · A 종료 3.27초 · B 3.32초,
A↔B 전환 3회. 직렬이면 B 의 첫 청크가 A 의 응답 뒤에 왔을 것이다.

## 무엇을 바꿨나

**백엔드 — 대화를 인자로 받는다.** `acp_prompt`·`acp_cancel` 에 `session_id`
(`Option<String>`). `None` 이면 예전처럼 장부를 따른다(어댑터가 죽었다 살아난 뒤의
첫 프롬프트). 이벤트 싱크는 이미 `(project, session)` 키였다 — 배관은 절반 깔려
있었고 프롬프트 경로만 묶여 있었다.

**승인 카드를 대화 단위로.** `PendingPermission` 에 `session_id` 를 싣고
`cancel_pending_permissions(project, Option<&session>)` 로 좁혔다. 이게 없으면 한
대화를 ESC 로 멈출 때 **옆 대화의 승인 카드가 함께 거절**된다 — 누르지도 않은
거절이라 안전 문제다. `acp_new_session` 은 이제 아무것도 안 닫는다: 새 대화를 여는
것은 하던 대화를 버리는 것이 아니다. `acp_load_session` 은 다시 읽는 그 대화 것만.

**프런트 — 화면 상태를 대화별로 갈랐다.** `busy`·`error`·`usage`·`permission` 을
세션 키 맵으로 바꾸고, 화면 나머지는 "보고 있는 대화의 몫"을 파생값으로 예전 이름
그대로 본다(호출부 대부분 무변경). 특히 `permission` 이 갈려야 뒤에서 돌던 대화가
물어본 것을 보고 있던 대화에 띄우지 않는다 — 그러면 **무엇을 허용하는지 못 본 채**
허용을 누르게 된다.

`send(text, target)` 가 향할 대화를 직접 짚는다. 그 덕에 대기열 드레인이 "지금 열려
있는 대화의 것만"이라는 제약을 벗었다 — 그 제약은 보낼 곳을 백엔드 장부가 정하던
시절의 오배송 방어였다. 곁가지로 두 가지가 같이 고쳐졌다: 대기열에서 꺼낸 문장이
**지금 입력창의 초안·첨부를 쓸어 가던 것**, 그리고 뒤에 있는 대화의 전송이 보고 있는
화면을 바닥으로 끌어내리고 `session/load` 재생 세대를 끊던 것.

## 검증

`acp_parallel_sessions.test.tsx` 2건 — A 가 도는 중에 연 새 대화가 곧장 나가는가
(대기열이 아니라), 같은 대화에 연달아 치면 예전처럼 줄을 서는가. 앞의 것은 옛 동작
(전역 busy)으로 되돌려 **실패하는 것을 확인**했다. Rust 611건(권한 취소가 옆 대화를
안 건드리는지 새 테스트 1건 포함), vitest 1041건, typecheck·lint 통과.

## 메모

`pnpm build` 는 이번 변경과 무관한 이유로 빨간불이다 — 다른 세션이 편집 중인
`src/features/oculpm/EntryDetailView.tsx` 에서만 오류가 난다(미정의 `disambiguateLabels`).
내 변경 파일에는 오류가 없다.

세션 id 를 명시하면 `ensure_session` 폴백을 안 타므로, 어댑터 재시작 뒤 옛 id 로
보내면 조용히 새 대화가 열리는 대신 **오류가 뜬다.** 의도한 쪽이다 — 화면에는 다시
연결 배너와 `session/load` 경로가 이미 있다.
