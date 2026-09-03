---
schema_version: 1
type: chore
slug: "stop-hook-probe-and-gate-test"
status: done
difficulty: medium
created_at: "2026-09-03T18:55:49+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tests/delivery_gate.rs"
    op: create
  - path: ".oculpm/planner/mcp-lifecycle-hooks.md"
    op: update
related:
  - ref: "20260903/Features_to_add/1842_feature_session-shim-cli.md"
    kind: "followup"
tags:
  - "hooks"
  - "probe"
  - "delivery-gate"
  - "buzz-borrows"
  - "mcp-tool"
---
[x] 실측이 플랜을 접었다 — 기구는 이미 있었고, 없던 것은 그 기구의 테스트였다

## 무엇을 했나

`mcp-lifecycle-hooks` 플랜의 Phase A(실측)를 돌렸다. 이 플랜은 착수 조건이 실측이었고 — "불러주는 하네스가 하나도 없으면 이 플랜을 접는다, 그것도 결과다" — 실제로 접혔다.

## 실측 결과

**① Claude Code `Stop` 훅** — 존재하고, `exit 2` 로 턴 종료를 막고 stderr 가 에이전트에게 전달된다 (공식 문서 확인). 그런데 **우리는 이미 그것을 쓰고 있었다**: `plugin/oculpm/hooks/delivery-gate.sh`. 2026-07-31 에이전틱 A/B 실측(규칙 주입만으로는 헤드리스 세션 기록 준수 0/12)을 근거로 만들어졌고, buzz 의 `_Stop` 이 말하는 주권 제약도 이미 갖췄다 — `stop_hook_active` 가드(무한 차단 방지) · 세션당 1회 플래그 · 모든 실패 exit 0. 오히려 buzz 에 없는 것도 있다: **세션 귀속 판정**(마커보다 새 파일만 — 이전 세션 WIP 는 이 세션의 변경이 아니다).

**② `_` 접두 MCP 훅** — 부르는 하네스가 없다. Claude Code 의 대응물은 **네이티브 훅 이벤트**이지 MCP 도구가 아니라서, Claude Code 는 `_Stop` 을 영원히 부르지 않는다. Codex·ACP 에도 그런 규약이 없다. 만들면 죽은 코드다.

**③ `_PostCompact` 대응물** — Claude Code 에 `PreCompact`·`PostCompact` 이벤트는 있지만, 문서상 `PostCompact` 는 `additionalContext` 주입을 지원하지 않는다(사후 이벤트라 결정 시점이 지났다). 압축 뒤 플랜 재주입은 **확인되지 않은 가정 위에 지을 수 없다** — 이 플랜의 규율이 "실측 없이 구현 금지"이므로 짓지 않았다.

## 그래서 남은 하나

실측이 진짜 구멍을 하나 드러냈다. 배달 게이트의 계약을 무는 것이 `plugin_manifest.rs` 의 **문자열 존재 단언**뿐이었다 — 스크립트에 `exit 2` 라는 *글자*가 있는지만 봤다. 판정 로직을 통째로 지우고 그 글자만 남겨도 통과한다. buzz 의 리뷰 규칙 3번이 그대로다: **없애도 아무 테스트가 안 깨지는 가드는 아무것도 지키지 않는다.**

`src-tauri/tests/delivery_gate.rs` — 임시 git 저장소를 세우고 훅을 실제로 실행해 종료 코드를 본다. 7가지:

- 코드 변경 + 일지 없음 → **exit 2** 이고 stderr 에 사유가 있다
- 이 세션에 일지를 썼으면 통과
- `stop_hook_active` 로 돌아온 턴은 재차단하지 않고, 그 뒤에도 세션당 1회 규율이 산다
- `.oculpm/` 안만 바뀐 것은 코드 변경이 아니다
- 마커보다 **오래된** WIP 는 이 세션에 귀속되지 않는다
- 비추적 프로젝트·마커 없음 → 침묵 (모름을 위반으로 읽지 않는다)

## 검증

**반증 확인을 직접 했다.** 스크립트 앞에 `exit 0` 을 넣어 게이트를 무력화하니 7개 중 2개가 즉시 깨졌다(`it_blocks_when_code_changed_without_a_journal`·`it_never_blocks_twice_in_a_row`). 원상 복구 후 7/7 통과, `git diff` 로 스크립트가 원본과 바이트 동일함을 확인했다.

게이트 전부 exit 0 — `cargo fmt --check` · `clippy --all-targets -D warnings` · `cargo test`(1337, 0 실패) · `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm build`.

## 메모

플랜 22항목 중 **13개를 폐기**했다. 폐기 사유가 전부 "이미 있다" 또는 "부를 사람이 없다" 또는 "확인 못 했다"라서, 이 라운드의 산출물은 코드가 아니라 **판단**이다. buzz 에서 가져올 것이 있다고 본 F1 은 절반만 맞았다 — 발상은 옳았고 우리는 그것을 이미 더 나은 모양으로 갖고 있었으며, 정작 없던 것은 그 사실을 지켜 줄 테스트였다.