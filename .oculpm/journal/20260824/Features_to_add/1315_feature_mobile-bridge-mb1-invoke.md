---
schema_version: 1
type: feature
slug: mobile-bridge-mb1-invoke
status: done
difficulty: medium
created_at: "2026-08-24T13:15:00+09:00"
session_id: "manual-20260824-131500"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/mobile_bridge/dispatch.rs"
    op: create
  - path: "src-tauri/src/mobile_bridge/server.rs"
    op: update
  - path: "src-tauri/src/mobile_bridge/mod.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
related:
  - "20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md"
tags: [mobile, axum, dispatch, security]
---

[x] 모바일 브리지 MB1 — POST /api/invoke/{cmd} 화이트리스트 디스패처

## 추가 기능

- **dispatch.rs**: 49개 커맨드 명시 match — 화이트리스트가 곧 코드라 자동 노출
  경로가 없다. 인자는 bindings.ts 의 camelCase 그대로(`take()` 는 키 부재를
  null 취급 — Option 파라미터의 tauri 관용 동일), 응답은 커맨드 Ok 값 직렬화
  그대로. 인자명 49개 전부 bindings.ts 와 기계 대조로 검증(불일치 0).
- **상태 매핑**: 404 미등재 / 400 인자 오류 / 422 커맨드 Err — MB2 셤이 422 를
  네이티브 invoke reject 로 되돌린다.
- **감사 로그**: 커맨드명·소요ms·결과만 기록, 인자·응답 본문은 남기지 않음
  (일지 본문·시크릿 유출 방지).
- **런타임 제네릭화**: 라우터·미들웨어·디스패처가 R: tauri::Runtime — 프로덕션
  Wry, 테스트 MockRuntime(tauri test 피처, dev-dep)으로 같은 라우터를 tower
  oneshot 으로 검증.
- 계획 대비 조정 2건: `app_info` 화이트리스트 제외(디스크 경로 노출·폰에 무용,
  버전은 /healthz), `oculpm_create_manual_entry` 는 커맨드 대신 내부
  `create_manual_journal_entry` 직접 호출(AppHandle 의존은 데스크톱 토스트뿐).

## 동작 흐름

폰 → POST /api/invoke/plan_list {"projectId":1} (Bearer) → peer 가드 → 토큰
검증(+last_seen) → dispatch match → 커맨드 함수 직접 호출(app.state 주입) →
Ok JSON / {error}.

## 검증

- cargo test 869 통과 — 신규 통합 테스트 4: healthz 200 / 비-tailnet peer 전
  라우트 403 / 무토큰·오토큰 401 / 페어링 왕복(오코드 403→발급→재사용 404→
  ping 200→invoke [] · settings_get null · 미등재 404 · 인자오류 400).
- pnpm typecheck exit 0. bindings.ts 변화 없음(신규 커맨드 없음).
