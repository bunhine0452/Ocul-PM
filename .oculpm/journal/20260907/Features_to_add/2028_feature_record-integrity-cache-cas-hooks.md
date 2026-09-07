---
schema_version: 1
type: feature
slug: "record-integrity-cache-cas-hooks"
status: done
difficulty: high
created_at: "2026-09-07T20:28:11+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/migrations/037_oculpm_agent_session.sql"
    op: create
  - path: "src-tauri/src/db/registry.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/write.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/query.rs"
    op: update
  - path: "src-tauri/src/oculpm/reconcile.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/protocol.rs"
    op: update
  - path: "src-tauri/src/oculpm/config.rs"
    op: update
  - path: "src-tauri/src/commands/automation.rs"
    op: update
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "src-tauri/tests/forbid_journal_globs.rs"
    op: create
  - path: "src/features/skills/pluginDocs.ts"
    op: update
related: []
tags:
  - "cache"
  - "migration"
  - "cas"
  - "hooks"
  - "v3-release"
  - "mcp-tool"
---
[x] 캐시가 세션을 기억하고, 화해기가 CAS 문을 지나고, 훅이 줄을 안 깨뜨린다

## 추가 기능

v3-release 「기둥 1 이월」 7항목 중 5개를 닫고 2개는 사실 확인 뒤 보류했다.

**`{#cache-agent-session}`** — SQLite 캐시 `oculpm_journal` 에 `agent_session` 칸이 없어
`cache/query.rs` 가 영원히 `None` 을 주던 것. 마이그레이션 2단계(`037_*.sql` + `db/mod.rs` 의
`MIGRATIONS` 등록)와 `ADDITIVE_COLUMNS` 를 모두 밟았다. 기존 행 백필은 `COERCION_VERSION`
1→2 재투영으로 — 본문 해시가 같은 일지는 전면 재작성 경로를 안 타므로, 자기치유 UPDATE 에
칸을 끼우지 않으면 037 은 **앞으로 쓸 일지에만** 걸렸을 것이다.

**`{#reconcile-file-guard}`** — 앱 내부 화해기가 인프로세스 `plan_write_lock` 만 써서 앱과 MCP
서버가 동시에 같은 플랜을 고치는 창이 남아 있었다. MCP 가 이미 쓰던 파일 CAS 문지기를
`plan_ops::acquire_plan_guard` 로 내리고 화해기가 **그 문**을 지나게 했다(새 문지기를 만들지
않았다). 문지기 획득 → 재확인 → 원자적 쓰기를 한 함수로 묶었다 — 그 사이에 틈이 생기면 CAS 가
무의미하다.

**`{#token-glob-false-positive}`** — `**/*token*` 이 디자인 토큰 파일을 시크릿으로 오인해
`files_touched` 에서 조용히 떨궈, 그 파일을 고친 일지가 무엇을 고쳤는지 말하지 못했다.
좁히는 축은 **파일명이 아니라 확장자**로 골랐다 — 자격증명은 소스 확장자를 쓰지 않는다(실제
꼴은 확장자 없음 · 점파일 · `.json`/`.yml` · `.pem`/`.key`). 이름 글롭의 넓이는 그대로 두고
(모르는 꼴은 계속 막힌다) 소스 확장자 11종만 부정 규칙으로 되돌렸다. 같은 병으로
`**/*secret*` 이 막고 있던 `secrets.rs`(키체인 모듈)도 함께 풀렸다. **`.oculpm/config.toml` 과
`config.rs::default_forbid_paths()` 를 함께 고쳤다** — 한쪽만 고치면 새 프로젝트만 옛 오탐을
물려받는다.

**`{#event-ledger-hygiene}`** — 인라인 append 훅이 `cat >>` 라 개행을 안 붙여
`claude-events.jsonl` 2,428줄 중 **정확히 5줄**이 두 이벤트가 붙은 채 파싱 실패하고 있었다
(2257·2259·2260·2261·2263). `printf '%s\n'` 으로 바꾸고 `oculpm_ts`(UTC ISO-8601)를 주입한다.
소비자(`claude_hooks.rs`)는 깨진 줄을 건너뛰고 `consumed` 를 전진시켜 인박스가 막히진
않지만, 그 5개 이벤트는 **잃은 것**이다.

**`{#cas-doc-surfaces}`** — `MCP_INSTRUCTIONS` 와 `pluginDocs.ts` 가 실제 코드(`base_hash`
필수, 우회로 없음)보다 느슨하게 적혀 있던 것을 맞췄다. 되돌아가지 않게 `rule_canary` 단언에
`base_hash` 를 넣었다.

**`{#automation-error-key}`** — 플랜 전제가 틀렸다. 백엔드는 `automation_bad_condition` 을 낸
적이 없고, 조건 오류는 `parse_conditions` 가 **한국어 원문 경고**로만 내보내 영어 모드에서도
한국어로 떴다. `spec_error()` 가 `ConditionWhen::Unknown` 을 코드로 내게 하고(조건은 두 kind
공통이라 match 앞에서 본다) ko/en 사전에 키를 넣었다. `src/i18n/errors.ts` 에는 고칠 것이
없었다 — 그 파일은 옛 영어 문자열→키 정규식 표일 뿐이고 구조화된 코드는 그 표를 건너뛴다.

## 보류

**`{#neutral-session-env}`** — 옛 `CLAUDE_CODE_SESSION_ID` 폴백은 죽은 코드가 아니라
**터미널 경로의 유일한 신원 근거**다. `plugin/oculpm/.mcp.json` 에 `env` 가 아예 없어 MCP
서버는 부모에게서 물려받은 그 변수 하나로만 신원을 얻고, 실측 결과 `OCULPM_SESSION_ID` 는
비어 있다(세우는 자리는 앱 안 ACP 대화 하나뿐). 폴백 제거는 `.mcp.json` 에 매핑을 먼저 넣고
**실측으로 채워지는지 확인한 뒤**에만 안전하다. 플랜 문구의 우려("Claude 어댑터가 덮어쓸
가능성")는 이미 해소돼 있다 — `mcp/tools/mod.rs` 가 중립 이름을 먼저 읽는다.

## 검증

`cargo test` 30개 바이너리 전부 ok(신규 `forbid_journal_globs` 3건 ·
`agent_session_tests` 2건 · CAS 2건 포함) · `cargo clippy --all-targets -- -D warnings` exit 0 ·
`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` 전부 exit 0.
훅은 JSON 에서 꺼낸 명령 문자열 그대로 `/bin/sh`·`/bin/bash` 로 실행해 4경로(정상·빈 입력·
비JSON·비추적)를 확인했다.