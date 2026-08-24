---
schema_version: 1
type: feature
slug: mobile-bridge-mb2-transport
status: done
difficulty: high
created_at: "2026-08-24T15:19:00+09:00"
session_id: "manual-20260824-151900"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/mobile_bridge/events.rs"
    op: create
  - path: "src-tauri/src/mobile_bridge/server.rs"
    op: update
  - path: "src-tauri/src/mobile_bridge/mod.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src/lib/transport/http.ts"
    op: create
  - path: "src/lib/transport/sse.ts"
    op: create
  - path: "src/lib/transport/core.ts"
    op: create
  - path: "src/lib/transport/event.ts"
    op: create
  - path: "vite.config.ts"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "src/__tests__/mobile_transport.test.ts"
    op: create
related:
  - "20260824/Features_to_add/1315_feature_mobile-bridge-mb1-invoke.md"
tags: [mobile, sse, transport, vite]
---

[x] 모바일 브리지 MB2 — 전송 셤(vite alias) + 이벤트 SSE 재송출

## 추가 기능

- **EventHub** (`events.rs`): 화이트리스트 13종(oculpm 12 + settings-changed)만
  listen_any 로 수집 — 링 버퍼 256 + broadcast. Last-Event-ID 재접속 시 버퍼
  안이면 놓친 것부터 재전송, 밖이면 있는 것부터(+화면 재조회 정책). 포워더는
  최초 기동 때 1회 등록 — 껐다 켜도 중복 없음.
- **GET /api/events** (보호): axum SSE — 구독→스냅샷 순서 + cutoff 필터로
  유실·중복 모두 차단. keep-alive 주석 15초. EventSource 는 헤더를 못 실으므로
  클라이언트는 fetch 스트리밍.
- **전송 셤 4파일** (`src/lib/transport/`): http(토큰·httpInvoke — reject 는
  에러 문자열, 네이티브 계약) / sse(SseParser 증분 파서 + 지수 백오프 재접속)
  / core(invoke·Channel·convertFileSrc 치환, 나머지는 `export *` 원본 통과 —
  명시 export 가 star 를 가리는 ESM 규칙 활용) / event(listen·once=SSE 구독,
  emit=no-op 경고).
- **vite alias**: `@tauri-apps/api/core·event` → 셤. customResolver 가
  importer 를 보고 transport/ 안의 임포트만 진짜 모듈로 — 셤이 웹뷰에서 원본
  위임 가능. 플러그인 패키지의 임포트도 셤을 타서 브라우저에서 404 로 우아히
  실패. vitest 는 별도 설정(alias 없음)이라 기존 1278 테스트 무영향.
- Channel 인자는 toJSON 이 거부 — 스트리밍(chat_stream)은 MB4 전까지 명시 에러.

## 동작 흐름

폰 브라우저 → 정적 서빙된 앱 로드 → alias 된 invoke 가 fetch POST
/api/invoke/{cmd} → bindings envelope 그대로. listen 은 /api/events SSE 구독
→ 일지 추가/플랜 화해 등이 실시간 반영. 절단 시 Last-Event-ID 백오프 재접속.

## 검증

- cargo test 874 (신규 5: 허브 단조 id·since·버퍼 축출·live 구독 + emit→
  listen_any→SSE 재전송 통합 — 비화이트리스트 이벤트 미유입까지 단언).
- vitest 1289 (신규 11: invoke 계약 6·토큰 왕복·SseParser 4 — 청크 쪼개짐 포함).
- pnpm build: 번들에 셤(/api/invoke/)과 실모듈(__TAURI_INTERNALS__) 공존 확인
  — alias 순환 없이 웹뷰 위임 성립. lint(스토리지·한글) / typecheck 0.

## 메모

- 실브라우저 스모크(#mb2-smoke)는 Tailscale 연결이 필요해 미실행 — 앱에서
  서버 켜고 같은 맥 브라우저에서 http://100.x:42815 접속, 토큰은 devtools
  localStorage("oculpm:mobile:token") 수동 주입(페어링 UI 는 MB3).
- 다음 tauri dev 첫 실행에서 웹뷰 위임(isTauri 경로) 눈확인 권장.
