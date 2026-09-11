---
schema_version: 1
type: chore
slug: "acp-adapter-0760-bump"
status: done
difficulty: verylow
created_at: "2026-09-11T14:02:28+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
related:
  - ref: "20260911/Chores/1354_chore_revive-acp-0751-branch.md"
    kind: "followup"
tags:
  - "acp"
  - "adapter-bump"
  - "release-3.0"
  - "mcp-tool"
---
[x] ACP 어댑터 0.75.1 → 0.76.0 — dist 대조로 무영향 확인 후 상수 한 줄

되살린 0.75.1 브랜치를 머지하고 보니 npm 최신이 `0.76.0`(2026-09-09) 이었다. 3.0.0 에 같이 싣기로 하고 올렸다.

## 동기

3.0.0 이 어댑터를 새로 내려받게 하는 릴리스라면 한 번에 최신으로 가는 편이 낫다 — 단, 0.75 가 `/usage` 를 통째로 바꿨던 전례가 있어 추측 대신 tarball 을 대조했다.

## 변경 요약

- 두 버전의 `dist/` 를 내려받아 `diff -rq`: 바뀐 파일은 `acp-agent`·`air-extension`·`clear-context-coordinator` 셋, 새 모듈 `session-model`·`session-effort` 둘. 내용은 모델/effort 설정 옵션의 내부 정리(effort 고정 상태를 `effortPinnedByUser` 불리언에서 `effortPinnedLevel`/`appliedEffortLevel` 로)와, **클라이언트가 광고해야만 켜지는** AIR capability `recommendedValue` 하나. 우리는 `air` 배열을 `[sessionFailure, agentFileChangeReport]` 로 두고 있어 무영향.
- `usage-markdown.js` 바이트 동일(`cmp`) → 0.75.1 픽스처가 그대로 유효. 번들 `claude-agent-sdk` 도 `0.3.257` 동일.
- 그래서 `adapter.rs` 의 `PINNED_VERSION` 만 `0.76.0` 으로, 그 위 문서 주석에 대조 결과를 날짜와 함께 남겼다. 테스트·프런트의 "0.75.1" 언급은 픽스처 출처 표기라 사실 그대로 둔다.

## 검증

- `cargo test --test acp_handshake acp_handshake_survives_tokio_runtime -- --ignored`: 임시 앱데이터에 **실제 0.76.0 을 npm 설치**하고 node 로 띄워 `initialize` 응답의 `agentInfo.version == 0.76.0` 확인 — ok.
- `cargo test --no-fail-fast` 전 스위트 0 failed · `bindings.ts` 무변경 · `clippy --all-targets -D warnings` 무경고 · `cargo fmt --check` ok. 프런트는 손대지 않았다.