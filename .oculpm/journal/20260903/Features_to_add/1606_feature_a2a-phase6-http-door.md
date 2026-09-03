---
schema_version: 1
type: feature
slug: "a2a-phase6-http-door"
status: done
difficulty: high
created_at: "2026-09-03T16:06:28+09:00"
session_id: "20260903-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/a2a/http.rs"
    op: create
  - path: "src-tauri/src/oculpm/a2a/mod.rs"
    op: update
  - path: "src-tauri/src/commands/a2a.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: ".gitignore"
    op: update
  - path: "src/features/settings/A2aEndpointBlock.tsx"
    op: create
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1532_feature_a2a-phase5-ui.md"
    kind: "followup"
tags:
  - "a2a"
  - "http"
  - "mcp-tool"
---
[x] A2A Phase 6 — 외부로 난 문, 기본은 잠겨 있고

## 추가 기능

로컬 프로세스가 아닌 것들(클라우드 세션·다른 기계·외부 에이전트)이 같은 원장에
참여하는 문. `/.well-known/agent-card.json` 과 JSON-RPC 2.0 `/a2a`,
커맨드 3종(status/start/stop)과 설정 화면 블록.

**새 의존성은 없다** — `axum` 0.8 이 모바일 브리지 때문에 이미 있어서 그 서버
관용구(바인딩 되읽기 검증·graceful shutdown·심층 방어)를 그대로 따랐다.

## 동작 흐름

안전 장치가 셋이다.

1. **기본 꺼짐.** 사용자가 눌러야 뜬다. 자동 기동 경로는 없다.
2. **루프백 전용.** `LoopbackAddr` 뉴타입이라 `0.0.0.0` 바인딩은 **컴파일이 안
   된다**(모바일 브리지의 `TailscaleBindAddr` 와 같은 규율). 바인딩 뒤 되읽어
   확인하고, 요청마다 출발지도 다시 본다.
3. **매 기동 새 토큰, 디스크에 안 남김.** 저장하지 않는 비밀은 새지 않는다.
   화면에 뜬 그 순간이 유일한 전달 경로라 "다시 볼 수 없다"고 미리 말한다.

문 하나는 **프로젝트 하나**만 섬긴다 — 카드 하나가 에이전트 하나를 가리킨다는
것이 A2A 의 전제라, 한 문이 두 프로젝트를 섬기면 카드가 거짓이 된다. 프로젝트를
바꾸면 닫고 다시 연다.

`message/send` 는 `metadata.to` 로 **받는 이를 반드시 짚어야** 한다. 우리 카드가
가리키는 것은 에이전트 하나가 아니라 여럿이 붙어 있는 원장이라 그것 없이는 배달할
곳이 없다 — `agents/list`(확장)가 그 목록이다.

## 안 되는 것을 안 된다고 말한다

v1 은 카드 발견 · `agents/list` · `message/send` · `tasks/get` 까지다.
`message/stream`(SSE)·푸시 알림·`tasks/cancel`·`tasks/resubscribe` 는
`-32004 UnsupportedOperation` 으로 **명시적으로 거부**한다. 조용히 성공한 척하면
상대가 오지 않을 답을 기다린다 — A2A 가 "종료 이벤트를 반드시 내라"고 경고하는
것과 같은 자리다.

감사 로그는 `.oculpm/agents/audit/` 에 남기되 **본문은 안 적는다**(메시지에는
사용자 내용이 실린다). 그 경로가 워처의 AGENTS 캐스케이드를 타지 않도록
`is_agents_noise` 로 먼저 끊었다 — 호출 한 번마다 모든 어댑터의 규칙 파일을
다시 쓸 이유가 없다.

## 걸린 함정

라우터만 태우는 테스트에는 `ConnectInfo` 가 없어 추출기가 500 을 냈다(401 을
기대했다). 실제 서비스에서는 axum 이 실어 주는 값이라, 테스트가 그 확장을
직접 넣어 준다.

## 검증

`cargo fmt --check` 0 · `clippy -D warnings` 0 · `cargo test` **1284 passed /
0 failed**(신설 5: 루프백 뉴타입 · 카드는 공개·RPC 는 토큰 · 받는 이 없는 메시지
거절과 배달 · 미지원 메서드의 명시 거부 · tasks/get) · `pnpm typecheck` 0 ·
`pnpm test` 160 files 2077 passed · `pnpm lint` 0.