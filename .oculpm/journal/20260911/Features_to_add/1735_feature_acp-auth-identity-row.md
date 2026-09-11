---
schema_version: 1
type: feature
slug: "acp-auth-identity-row"
status: done
difficulty: medium
created_at: "2026-09-11T17:35:40+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/auth_status.rs"
    op: create
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/acp/usage.rs"
    op: update
  - path: "src-tauri/src/acp/mod.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/acp_identity_row.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20260911/Features_to_add/1715_feature_acp-context-compaction-row.md"
    kind: "followup"
tags:
  - "acp"
  - "auth"
  - "adapter-meta"
  - "usage-meter"
  - "mcp-tool"
---
[x] 어댑터가 밀어 주는 신원(`_auth/status_update`)을 사용량 카드에 — 로그아웃은 침묵과 다르다

0.75.1 이월 둘째 항목. 어댑터(`auth-status.js`)는 자기 신원을 `_auth/status_update` 로 **밀어 주는데**(연결 단위·push 전용·값이 바뀔 때만) 크레이트가 모르는 알림이라 조용히 버려, 앱은 구독/API키/게이트웨이를 구별하지 못했다.

## 추가 기능

**1. 받는 길 — 크레이트의 폴백은 못 쓴다.** 처음엔 `AgentNotification`(session/update + `_`접두 확장 폴백) 핸들러를 하나 더 붙였는데, 크레이트 소스를 읽어 보니 그 열거형의 `matches_method` 가 **전부 `true`** 다. `$/cancel_request` 같은 알림이 우리 핸들러에서 파싱 오류로 삼켜져 기본 핸들러(`handle_handler_error` → warn 로그, 연결은 산다)에 못 간다 — 대기 중 요청 취소가 조용히 사라지는 회귀다. 그래서 `JsonRpcMessage`/`JsonRpcNotification` 을 직접 구현한 **`AuthStatusUpdate`** 타입을 두었다: `matches_method` 가 이 메서드 하나만 `true` 라 나머지는 손대지 않고 다음 핸들러로 흐른다. 등록 순서는 `ChainedHandler` 가 먼저 등록된 것부터 시도하므로 `session/update` 핸들러 뒤에 둔다.

**2. 사는 자리 — 한도와 같은 벌.** 새 커맨드·이벤트 대신 `AcpUsage.identity: Option<AcpAuthStatus>`. 한도는 계정의 것이라 "누구의 한도인가"가 같은 벌에 사는 게 맞고, 계기가 이미 `acp_usage` 를 읽고 `Usage` 변화 이벤트를 듣고 있어 배관이 0 이다. 세 병합 경로가 모두 신원을 보존해야 해서 `process.rs` 에 흩어져 있던 규칙을 **`AcpUsage::fold_update`(누적)·`fold_report`(교체·보존)·`with_identity`** 순수 함수로 옮기고 테스트 3건을 붙였다 — 덕분에 `process.rs` 가 1060 → 1043 으로 줄어 래칫도 지켰다.

**3. 침묵 ≠ 로그아웃.** `identity: None` 은 "어댑터가 못 읽었다"라 카드에 아무 줄도 없다. `kind: "none"` 은 **로그아웃이라는 값**이라 카드 줄이 경고색이고, 한도가 없어도(한도가 없는 **이유**이므로) 계기가 「로그인 필요」 pill 하나로 선다. 나머지는 이름표(`label` 원문: "Claude Max"·"Anthropic API key") + 종류 배지(구독 계정/API 키/게이트웨이/외부 클라우드) + 둘째 줄(detail → 이메일 → 조직). 얼굴: CircleUser · KeyRound · Cloud · LogOut.

## 동작 흐름

어댑터 `_auth/status_update {authStatus}` → `AuthStatusUpdate::parse_message`(이 메서드만) → `AcpState::set_identity` → `AcpUsage::with_identity` → `emit_session_changed(Usage)` → 계기가 `acp_usage` 로 읽어 `IdentityRow` 렌더.

## 검증

- Rust: `auth_status::tests` 3건(계정 로그인·`kind: none` 은 값·`$/cancel_request`/`_something/else`/`session/update` 는 `matches_method` false + label 없는 모양은 파싱 실패) · `usage::tests` fold 3건. `cargo test --no-fail-fast` 0 failed · clippy `-D warnings` · fmt · `bindings.ts` 재생성(+35).
- 프런트: `acp_identity_row.test.tsx` 3건(보고 없음=줄 없음·계정=이름표/종류/이메일·로그아웃=한도 없이 pill+경고 줄). `typecheck` · `test` 211파일 2682건 · `lint`(design 게이트가 아이콘 14→15 램프 스냅을 잡아 고침) · `build` 전부 exit 0 — main(`1876c7f`) 워크트리에 12파일만 얹어 돌렸다. 주 워크트리의 `bindings.ts` 엔 다른 세션의 WIP 커맨드가 섞여 있어 워크트리에서 재생성한 것을 커밋했다(`bcfb76a`).
- 실기기: 실제 어댑터가 `initialize` 직후 첫 push 를 보내는지, 터미널에서 `claude logout` 하면 다음 프롬프트 시작에 「로그인 필요」로 바뀌는지는 `{#eyes-usage-meter}` 와 같이 본다.