---
schema_version: 1
type: feature
slug: mobile-bridge-mb0-backend
status: done
difficulty: medium
created_at: "2026-08-24T11:18:00+09:00"
session_id: "manual-20260824-111800"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/migrations/029_mobile_devices.sql"
    op: create
  - path: "src-tauri/src/db.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/mobile_bridge/mod.rs"
    op: create
  - path: "src-tauri/src/mobile_bridge/bind.rs"
    op: create
  - path: "src-tauri/src/mobile_bridge/pairing.rs"
    op: create
  - path: "src-tauri/src/mobile_bridge/server.rs"
    op: create
  - path: "src-tauri/src/commands/mobile.rs"
    op: create
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - "20260824/Chores/1026_chore_mobile-bridge-plan.md"
  - "20260824/Chores/1047_chore_mobile-plan-dedup.md"
tags: [mobile, tailscale, axum, security]
---

[x] 모바일 브리지 MB0 백엔드 — axum 인프로세스 서버·3조건 바인드·페어링·정적 서빙

## 추가 기능

- **Tailscale 3조건 탐지** (`mobile_bridge/bind.rs`): (a) 100.64.0.0/10 AND
  (b) /32+broadcast 없음(점대점 — ISP CGNAT 배제) AND (c) tailscale CLI 교차검증
  (앱번들 경로 우선, 부재 시 (a)+(b)). `TailscaleBindAddr` newtype 은 private
  필드 + 유일 생성자 `detect()` 라 0.0.0.0 폴백이 컴파일 에러. 순수 판정
  `select_candidate` 에 경계 테스트 11개.
- **MobileBridgeState** (`server.rs`): axum 서버 동시 1개, oneshot graceful
  shutdown, ExitRequested 에서 중지. 바인딩 후 local_addr 되읽기 검증 + 출발지
  IP 100.64/10 밖 403 미들웨어. 기본 꺼짐 — 커맨드로만 기동.
- **페어링** (`pairing.rs` + `/pair`): 6자리 코드·TTL 5분·1회용·오입력 5회 소진.
  토큰은 uuid v4 ×2 (hex 64자), DB 에는 blake3 해시만 (029_mobile_devices).
  인증 미들웨어는 기동 시 적재한 메모리 해시집합 대조, 통과 시 last_seen 갱신.
  해제는 DB+메모리 동시 제거 (DELETE RETURNING).
- **정적 서빙**: 패키징 빌드는 임베디드 AssetResolver(경로 탈출 무성립),
  dev 는 ../dist ServeDir 폴백(.. 세그먼트 거부) + SPA index.html 폴백.
- 커맨드 6개: start/stop/status/pairing_begin/devices/revoke_device.

## 동작 흐름

설정(추후 UI)에서 start → 3조건 탐지 실패 시 사유 문자열 반환·미기동 / 성공 시
100.x:42815 바인드 → pairing_begin 이 코드·URL 발급 → 폰이 POST /pair {code}
→ 토큰 1회 수신 → 이후 Bearer 로 /api/* 접근. 앱 종료 시 graceful 중지.

## 검증

- cargo test 865 통과 (신규: bind 11 + pairing 6). specta i64 금지에 걸려
  MobileDevice.id 를 u32 로; db 힐링 테스트의 user_version 28 하드코딩을
  MIGRATIONS.last() 파생으로 교정.
- pnpm typecheck / test 1278 / lint 전부 exit 0. bindings.ts 재생성 확인.

## 메모

- 이 맥은 Tailscale.app 설치됨·미접속 상태 — detect() 실패 경로가 실전 기본값.
  실기기 검증은 #mb3-verify 에서.
