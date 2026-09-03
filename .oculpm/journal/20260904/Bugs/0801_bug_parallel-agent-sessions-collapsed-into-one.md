---
schema_version: 1
type: bug
slug: "parallel-agent-sessions-collapsed-into-one"
status: done
difficulty: medium
created_at: "2026-09-04T08:01:18+09:00"
session_id: "20260904-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/session.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/oculpm/frontmatter.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/session_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/index.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_draft.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/query.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/indexing.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/import/journalize.rs"
    op: update
  - path: "src-tauri/src/oculpm/automation/runner.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/tests.rs"
    op: update
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
  - path: "src/features/tray/tray.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/tray_popover.test.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "session"
  - "hooks"
  - "attribution"
  - "parallel-agents"
  - "mcp-tool"
---
[x] 터미널을 4분할해도 대화는 하나로 보였다 — 훅이 준 id 를 문 앞에서 버리고 있었다

## 발생 원인

사용자가 터미널을 분할해 Claude Code 를 넷 띄웠는데 ocul-pm 이 세션 하나만 인식하는 것 같다고 신고했다.

실측으로 확인했다. `claude` CLI 프로세스가 6개 돌고 있었고 `.oculpm/hooks/` 의 세션 마커는 그날만 서로 다른 UUID 4개(07:19·07:19·07:20·07:34)였다. 그런데 `index/20260904/sessions.json` 에 남은 것은 `20260904-004` 하나뿐 — 05:49→07:00, file_event_count 699, files_unique 88 짜리 덩어리였고, 그날 일지의 `session_id` 는 전부 그것 아니면 `-001` 이었다.

원인은 셋이었다.

1. `SessionState` 가 `Idle | Active(Box<..>) | Closing` 이라 프로젝트당 활성 세션이 구조적으로 최대 1개다.
2. 훅 이벤트는 대화마다 다른 `session_id` 를 들고 도착하고 watcher 가 그 값을 로그로 찍기까지 하는데, 정작 액터에는 상수 `HOOK_AGENT_LABEL`(`"claude-code"`)만 넘어갔다. 대화 id 는 열린-집합 카운팅에만 쓰이고 세션 레코드엔 남지 않았다.
3. 일지 귀속은 `resolve_session_for_timestamp` — "ts 이전에 시작한 마지막 세션". 누가 썼는지는 판단 재료에 없었다.

정보는 문 앞까지 와서 버려지고 있었다.

## 해결 방법

작업 세션을 쪼개지 않기로 했다. 워처는 파일시스템을 볼 뿐 **누가** 썼는지 모르므로, 세션을 N개로 나누면 `file_event_count`·`files_unique`·`git_head_at_*` 가 임의로 복제되고 `resolve_session_for_timestamp` 는 동시에 열린 N개 앞에서 지금보다 더 모호해진다. 그릇은 그대로 두고 **누가 붙어 있었는지**를 기록하는 쪽을 택했다.

- `Session.agent_sessions: Vec<String>` — 그 작업 세션 동안 살아 있던 대화 id 전부. `#[serde(default)]` 라 옛 `sessions.json` 도 그대로 읽힌다.
- `SessionCmd::HookAgentActive`/`HookAgentEnded` 가 대화 id 를 함께 나르고, `watcher.rs` 가 상수 대신 `&ev.session_id` 를 넘긴다. 새 헬퍼 `record_agent_session` 은 집합에 실제로 새 값이 들어왔을 때만 `dirty` 를 세워 매 턴 upsert 를 막는다. 빈 id 는 버린다 — 셸 통합(OSC 133) 경로는 어느 대화인지 알 길이 없고, 빈 값을 세면 "대화 1개"라는 거짓말이 된다.
- 세션 재개(`try_resume_session`)는 참여자 목록을 이어받는다. 비우면 재개 직후 신호만 남아 앞쪽 대화들이 기록에서 사라진다.
- `AgentRef.session: Option<String>` — 일지가 **어느 대화**의 것인지 적는다. MCP 서버는 Claude Code 의 자식이라 `CLAUDE_CODE_SESSION_ID` 가 환경에 그대로 실려 있다(실측 확인). `journal_write` 가 인자 > 환경변수 순으로 채우고, 모르면 프론트매터에 줄 자체가 안 나간다.
- 트레이가 대화 수를 드러낸다 — 둘 이상일 때만 `대화 N` 칩(툴팁에 id 목록).

`skip_serializing_if` 는 뺐다. 붙였더니 specta 가 `AgentRef` 를 Serialize/Deserialize 둘로 쪼개 `JournalEntry`·`ManualEntryDraft` 와 커맨드 시그니처까지 바인딩 176줄이 흔들렸다. 프론트매터 YAML 은 손으로 쓰므로 그 속성이 디스크에 주는 이득은 0이다.

## 남은 것

1. **A2A 앱 표면 카드 충돌** — `acp/identity.rs` 가 `{provider}-app` 고정 id 로 카드를 올린다. 같은 provider 패널을 둘 띄우면 카드 하나를 덮어쓰고, 한쪽만 닫혀도 `withdraw_card` 가 공용 카드를 지워 살아 있는 패널이 목록에서 사라진다. 이 id 는 임대 actor 이름(`process.rs`)이자 `agent_send` 주소라 고치려면 주소 체계 결정이 먼저다 — 이번 판에서는 손대지 않았다.
2. **터미널 세션의 A2A 자동 등록** — `{provider}-term-{pid}` 는 대화마다 다르게 잘 나오는데 에이전트가 `agent_register` 를 직접 불러야 올라간다. 실측 시점에 CLI 6개 중 0개가 등록돼 있었다.

## 검증

게이트 전부 exit 0 을 직접 확인했다: `pnpm typecheck` 무오류, `pnpm test` 164파일 2149케이스 통과, `pnpm lint` 클린, `pnpm build` 성공, `cargo test` 20개 스위트 전부 ok, `cargo clippy --all-targets -- -D warnings` 무경고, `cargo fmt --check` 클린.

새 테스트 5개로 회귀를 막았다. `parallel_agent_conversations_are_all_recorded`(대화 넷이 겹쳐 돌면 작업 세션은 하나로 남고 참여 대화는 넷 다 남는다 — 이 버그의 직접 회귀), `blank_conversation_id_is_not_a_participant`, `agent_session_is_absent_when_unknown`(모르는 대화 id 가 되살아나 옛 일지를 흔들지 않는다), `journal_entries_carry_the_conversation_that_wrote_them`, 트레이 2건(넷이면 `대화 4`, 하나면 숫자를 안 붙인다).

**실기기 확인은 못 했다.** 설치본이 도는 중이라 dev 빌드를 띄우면 번들 id 를 공유해 app-data·SQLite·`.oculpm` 락이 경합한다. 다음 빌드에서 육안 확인이 필요하다.