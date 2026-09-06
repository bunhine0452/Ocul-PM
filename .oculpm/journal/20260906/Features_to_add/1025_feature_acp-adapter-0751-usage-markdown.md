---
schema_version: 1
type: feature
slug: "acp-adapter-0751-usage-markdown"
status: done
difficulty: medium
created_at: "2026-09-06T10:25:22+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "78ba3819-412c-43f7-bae3-bfcbc67b04f9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/usage.rs"
    op: create
  - path: "src-tauri/src/acp/mod.rs"
    op: update
  - path: "src/features/chat/usageDetail.ts"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/features/chat/acpTitle.ts"
    op: update
  - path: "src/__tests__/acp_usage_detail.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "usage"
  - "adapter-bump"
  - "mcp-tool"
---
[x] ACP 어댑터 0.75.1 — /usage 의 답이 마크다운으로 바뀌어 계기가 눈을 잃었다

`@agentclientprotocol/claude-agent-acp` 고정 버전을 0.73.0 → **0.75.1** 로 올렸다. 판올림 자체는 상수 한 줄이지만, 0.75.0 이 `/usage` 의 답을 통째로 갈아 끼워 **사용량 계기가 조용히 빈칸이 되는** 회귀가 딸려 있었다.

## 추가 기능

**1. 무엇이 바뀌었는지 먼저 실측했다.** 0.73.0 과 0.75.1 의 npm tarball 을 받아 `dist/` 를 대조했다.

- `session/update` 종류 **15종 그대로**, `_meta._claude/*` 자리 4개(`rateLimit`·`origin`·`sdkMessage`·`askUserQuestionOption`)도 불변. 번들 Claude Code(`claude-agent-sdk`)도 `0.3.257` 그대로 — 이번엔 어댑터만 움직였다.
- 새 모듈 7개: `usage-markdown`·`context-compaction`(+meta)·`auth-status`·`hide-claude-auth`·`resumed-session`·`session-timing`.

**2. `/usage` 가 더는 CLI 평문이 아니다.** 어댑터가 `isUsageCommandText()` 로 `/usage` 턴을 가로채, SDK 의 구조화 응답을 **마크다운으로 다시 그려** 보낸다. 우리는 `Current session: 0% used` 같은 평문을 읽고 있었으니 한도도 기여도 대목도 전부 못 읽게 된다. 계기는 한도가 없으면 **아예 안 그려지므로** 조용히 사라졌을 자리다.

실제 문구를 추측하지 않으려고 어댑터의 `formatUsageResponse` 를 그대로 떼어내 실측 입력을 먹여 출력을 뽑았고, 그 출력을 테스트 픽스처로 박았다.

- 백엔드 `parse_usage_report` 에 마크다운 갈래 — `**5-hour limit** — **42%** · Resets …`.
- 백엔드 `parse_usage_detail` 의 머리글이 `What's contributing to your limits usage?` → `What's using your limits?`(굽은 따옴표). 따옴표 모양에 기대지 않도록 앞뒤 조각으로 찾는다.
- 프런트 `usageDetail.ts` 에 인용줄(`> …`)·강조(`**Last 24h**`)·마크다운 표 갈래. 표는 예전 `top` 블록으로 접어 카드 렌더러를 그대로 쓴다.
- **옛 평문 갈래는 남긴다.** 구조화 조회가 실패하면 어댑터가 원래 CLI 출력을 그대로 흘려보낸다(`preserving Claude Code output`) — 어느 쪽이 올지는 그때 가 봐야 안다.

**3. 두 출처의 어휘를 하나로 모았다.** 마크다운 라벨을 `_meta` 가 쓰는 기계 이름(`five_hour`·`seven_day`·`seven_day_opus`·`seven_day_sonnet`)으로 접는다. `kind` 가 중복 제거 열쇠라, 접지 않으면 같은 한도가 계기에 두 줄로 서고 툴바에 영문 문장이 박힌다. 모르는 이름(`model_scoped` 의 모델 표시명)은 건드리지 않고 원문으로 흘려보낸다.

**4. 나머지 새것은 우리 쪽 변경이 필요 없음을 확인했다.**

- `_auth/status_update` — 우리가 모르는 알림은 크레이트가 조용히 버린다(`Ignoring unhandled notification`, `jsonrpc/incoming_actor.rs`). 연결이 끊기지 않는다.
- 컨텍스트 압축은 평범한 `tool_call`("Compact conversation", kind=think)로 온다. 이미 그려진다.
- `sessionFailure.reason` 은 `--hide-claude-auth` 전용이고 우리는 그 플래그를 넘기지 않는다. `failure_of` 는 모르는 키를 무시한다.
- `contextCompaction` 은 capability 가 아니라 `_meta` 키다 — 광고할 것이 없다. `air` capability 배열은 `[sessionFailure, agentFileChangeReport]` 그대로 둔다(`subagent_*`·`async_task_*` 를 켜면 Rust `SessionUpdate` 가 모르는 태그로 역직렬화에 실패한다).

## 동작 흐름

`acp_refresh_usage` → 전용(감춰진) 대화에 `/usage` 프롬프트 → 어댑터가 구조화 응답을 마크다운으로 그려 `agent_message_chunk` 로 보냄 → 우리가 갈무리한 텍스트를 `parse_usage_report`(한도) + `parse_usage_detail`(기여도)로 뜯음 → `replace_limits` 가 계기 상태를 교체 → `AcpUsageMeter` 가 pill·카드로 그림.

곁들여 `session.rs` 가 파일 크기 래칫(1477줄)을 넘겨서, 사용량 도메인을 **`acp/usage.rs`** 로 갈랐다. 부르는 자리가 계속 `session::` 을 볼 수 있도록 `session.rs` 에서 다시 내보낸다 — 호출부 변경 0. 1477 → 1235 + 404.

## 검증

- 어댑터 0.75.1 의 `dist/usage-markdown.js` 를 실제로 실행해 뽑은 출력을 픽스처로 삼아 백엔드 4건 · 프런트 4건 신규 테스트 (평문 폴백 테스트는 전부 그대로 통과).
- `cargo test --no-fail-fast` 29개 스위트 전부 ok (1350 lib + 통합), `cargo clippy --all-targets -D warnings` 무경고, `bindings.ts` diff 없음.
- `pnpm typecheck` / `test`(177파일 2320건) / `lint`(6게이트) / `build` 전부 exit 0 직접 확인.

## 메모

이월 두 건 — ① `_meta.contextCompaction`(trigger·pre/postTokens·durationMs)을 아직 안 읽어, 압축이 일반 도구 카드로만 보인다. ② `_auth/status_update` 를 안 받아, 어떤 계정으로 로그인돼 있는지 앱이 모른다. 둘 다 새것이 **깨지지 않는다**는 것만 확인한 상태다.

실기기 육안 확인은 남았다 — 설치본이 도는 중에 dev 빌드를 띄우지 않는 규율 때문에, 실제 0.75.1 어댑터를 깔고 계기에 네 줄이 뜨는지는 앱을 껐다 켠 뒤에 본다.