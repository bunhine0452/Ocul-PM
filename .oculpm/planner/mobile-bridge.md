---
oculpm_plan: v1
id: mobile-bridge
title: "모바일 브리지 — Tailscale 로 폰에서 ocul-pm"
status: active
created: 2026-08-24
updated: 2026-08-24
owner: claude-code
---

목표는 **맥에서 도는 ocul-pm 을 폰에서 읽고 조작하는 것** — 일지 확인, 플랜 체크,
논의 코멘트, AI 질문을 소파·이동 중에. 데이터(`.oculpm/`·git·키체인·SQLite)는 전부
맥에 있으므로 모바일은 어떤 형태든 원격 클라이언트다. 네이티브 앱·Tauri 모바일
빌드는 만들지 않는다 — 근거는 #remote-not-native 에서 잠겼다.

실측 근거 (2026-08-24): 커맨드 251개 · 이벤트 25종 · HTTP 서버 의존성 0 ·
`bindings.ts` 가 `__TAURI_INVOKE` 단일 통로 · 커맨드 파라미터는 `State<>` 262 /
`AppHandle` 57 / `Window` 7 / `Channel` 1(chat_stream 뿐) — 인프로세스 서버가
커맨드 함수를 직접 호출할 수 있는 구조다.

**선행 설계 흡수** (2026-08-24): [three-features-round](three-features-round.md) 구
Phase 3(#p3-mobile, 읽기 전용 안)이 먼저 있었고 사용자 요청으로 이 플랜으로 일원화
— 3조건 바인드·페어링 코드·정적 서빙 가드·검증 게이트를 여기로 흡수했다. 설계
문서 docs/20260811_three-features/02-mobile-tailscale.md 는 참조로 유지.

## 결정

### Decision 1 — 원격 클라이언트, 네이티브 아님 {#remote-not-native}

잠금 2026-08-24 · 사용자.

Tauri 모바일 빌드는 Rust 가 *폰에서* 돌 뿐 폰엔 `.oculpm/` 도 git 도 없어 실익이
없다. 네이티브(Swift/Kotlin)는 UI 두 번째 구현체다. 기존 React 프런트를 재사용하는
**헤드리스 서버 + PWA** 로 간다. 네이티브 껍데기는 PWA 로 부족이 증명될 때만 후속.
Phase 0(SSH 검증)은 생략 — 사용자 결정.

### Decision 2 — 서버는 Tauri 프로세스 안에 임베드 {#inprocess-server}

잠금 2026-08-24 · claude-code.

별도 데몬이 아니라 **axum 을 기존 앱 프로세스에 임베드**한다. 이유: 키체인 시크릿
·워처·DB 커넥션·`OculpmManager` 상태를 그대로 공유하고, `AppHandle` 로
`app.state::<T>()` 를 얻어 기존 `#[tauri::command]` 함수를 **직접 호출**할 수 있다
(매크로가 원본 fn 을 보존한다). 제약을 계약으로 받아들인다: **앱이 꺼지면 모바일도
죽는다.** 설정 토글로 켜고 끈다 (기본 꺼짐).

### Decision 3 — 전송 계약: invoke 미러링 + vite alias 셤 {#invoke-mirror}

잠금 2026-08-24 · claude-code.

`POST /invoke/{command}` (body = args JSON, 응답 = 기존 envelope 그대로) +
`GET /events` (SSE). 프런트는 **vite alias 로 `@tauri-apps/api/core`·`event` 를
`src/lib/transport.ts` 셤으로 치환** — 웹뷰(`__TAURI_INTERNALS__` 존재)면 원본
invoke, 브라우저면 fetch/SSE. 생성물인 `bindings.ts` 는 한 줄도 안 고친다.
`@tauri-apps/*` 직접 임포트는 비테스트 13파일뿐이라 셤 범위가 유한하다.
기각 대안: 02-mobile-tailscale.md 의 mobile.html 별도 Vite 엔트리(Tauri 의존 0)
— 읽기 전용 8종엔 맞지만, 이 플랜은 쓰기 조작+데이터 훅 재사용 범위라 셤이 낫다.
그 설계의 R6(반드시 커맨드/캐시 경유, 디스크 직독 금지)은 invoke 미러링이 자동 충족.

### Decision 4 — 커맨드는 화이트리스트, 자동 노출 금지 {#command-whitelist}

잠금 2026-08-24 · claude-code.

251개 전체 노출은 공격면·유지비 모두 불가. 화면별 실사용 추적으로 **~50개 명시
화이트리스트**만 라우팅한다:

| 화면 | 커맨드 (실측) |
|---|---|
| 공통 | list_projects · project_stats (app_info 는 제외 — 디스크 경로 노출, 버전은 /healthz) |
| Today | oculpm_workday_brief · journal_missing_signals · plan_recent_updates · discussion_list · git_status · git_log · git_graph · git_head_status_brief · oculpm_generate_summary · oculpm_compare_layers · oculpm_list_sessions |
| 일지 | oculpm_list_journal_entries · oculpm_get_journal_entry · oculpm_get_file_changes · oculpm_get_entry_diffs · oculpm_create_manual_entry · oculpm_update_entry_body · oculpm_update_entry_meta · oculpm_set_journal_verified |
| 플래너 | plan_list · plan_get · plan_item_history · plan_apply_edit · plan_create · plan_set_status · plan_rename · plan_dispatch_prompt · plan_ai_refresh · settings_get |
| 논의 | discussion_list · discussion_get · discussion_create · discussion_write · discussion_set_status · discussion_read_raw · discussion_rename · discussion_asset · discussion_promote_to_plan |
| 검색 | search_text · search_chunks · search_symbols · read_file_range |
| AI | chat · conversation_create · conversation_list · chat_message_list · chat_message_append · secret_has (chat_stream 은 전용 SSE — #mb4-chat-sse) |

**제외 원칙**: 창·트레이·터미널·DAP·LSP·외부 에디터·네이티브 다이얼로그
(폰에서 무의미) · 삭제류(plan_delete·discussion_delete·clear_all_data — 파괴적
조작은 맥에서만) · secret_set(키 등록은 맥에서만) · **ACP 21개는 다음 라운드**
(폰에서 에이전트 구동이 최대 매력이지만 권한 응답 UI·프로세스 수명 관리가 무거워
v1 범위 초과).

### Decision 5 — 보안: Tailscale 인터페이스 전용 바인드 + 토큰 {#security-layers}

잠금 2026-08-24 · claude-code.

① **Tailscale 인터페이스 3조건 탐지 후 그 주소에만 바인드** — 대역만 보면 안
된다(100.64/10 은 ISP CGNAT 도 씀): (a) 100.64.0.0/10 소속 AND (b) /32·broadcast
없음(점대점 터널) AND (c) tailscale CLI 교차검증(있을 때만, 불일치면 미기동).
탐지 실패 시 서버를 안 띄우고, `TailscaleBindAddr` newtype(유일 생성자 detect())으로
0.0.0.0/127.0.0.1 폴백이 컴파일 에러가 되게 한다. ② **페어링 코드 → Bearer 토큰**
— 설정 화면 QR/6자리 코드(TTL 5분·1회용)로 폰 등록, 발급 토큰은 blake3 해시로만
저장(평문 저장 금지). 1인 tailnet 에선 Tailscale 신원만으로도 강하지만 맥 안의 다른
프로세스 대비 심층방어로 유지. ③ **Funnel 금지** (공개 인터넷 노출) — 문서에 명기.
`tailscale whois` 신원 확인은 v2. 모든 invoke 는 oculpm.log 에 감사 로그(토큰 제외).

### Decision 6 — 모바일 UI 는 전용 셸, ShellV2 재사용 안 함 {#mobile-shell}

잠금 2026-08-24 · claude-code.

ShellV2 는 사이드바+화면별 Toolbar+⌘단축키 전제의 데스크톱 밀도 — 반응형으로
욱여넣지 않는다. **MobileShell 하단탭 5개(Today·일지·플래너·논의·AI)** 를 신설하되
데이터 훅·API 층은 재사용한다. PWA manifest + 홈 화면 추가로 앱처럼 보이게.
iOS 16.4+ 는 PWA Web Push 도 되므로 알림조차 네이티브 사유가 아니다 (v2 후보).

### Decision 7 — 잠자기: 정직한 한계, 자동 우회 안 함 {#sleep-honest}

잠금 2026-08-24 · 사용자 (호스트 = 지금 쓰는 맥북).

서버 켜짐 동안 `caffeinate` 자식 프로세스로 유휴 잠자기만 막는다 (뚜껑 열림 전제).
**뚜껑 닫힘 잠자기는 앱이 우회하지 않는다** — 전원+외부 디스플레이 또는
`pmset disablesleep`(관리자) 영역이라 설정 화면에 한계·방법 안내만 쓴다.
"서버 켰는데 폰에서 안 붙는다" 1순위 원인이므로 연결 실패 UI 에도 이 안내를 띄운다.

## Phase MB0 — 서버 골격 {#mb0-skeleton}
- [x] axum/tower-http/if-addrs 의존성 + `src-tauri/src/mobile_bridge/` 모듈 + MobileServer 관리 상태 + ExitRequested graceful shutdown — 설정 토글, 기본 꺼짐 {#mb0-axum}
- [x] Tailscale 3조건 탐지(#security-layers ①) + 전용 바인드, 실패 시 미기동+사유 반환 {#mb0-ts-bind}
  - [x] TailscaleBindAddr newtype — private 필드 + 유일 생성자 detect(), serve() 는 SocketAddr 대신 이것만 수용 {#mb0-bind-newtype}
  - [x] 바인딩 후 local_addr() 되읽기 검증(불일치면 리스너 폐기) + axum 미들웨어에서 출발지 IP 100.64/10 밖이면 거부 {#mb0-bind-guard}
  - [x] 경계 단위 테스트 — 대역 경계(100.63/100.128)·ISP CGNAT(/24+bcast 거부)·후보 0/여럿·CLI 부재/불일치 {#mb0-bind-tests}
- [x] 페어링 코드(6자리·TTL 5분·1회용) → Bearer 토큰, blake3 해시만 저장 — 029_mobile_devices.sql + 검증 미들웨어 + 감사 로그 {#mb0-pairing}
- [x] GET /healthz + 프런트 정적 서빙 — resource_dir 기반 ServeDir + 경로 탈출 차단(secure_docs_join 패턴) + dev 폴백 {#mb0-static}
- [x] 설정 화면 "모바일" 탭 — 토글·상태·주소·QR/페어링 코드·연결 기기 목록/해제 {#mb0-settings-ui}

## Phase MB1 — invoke 브리지 {#mb1-invoke}
- [x] POST /invoke/{cmd} 디스패처 — 화이트리스트(#command-whitelist 표) → 커맨드 함수 직접 호출(app.state) {#mb1-dispatch}
- [x] envelope 직렬화 호환 — bindings.ts 기대 형태와 바이트 수준 일치 검증 테스트 {#mb1-envelope}
- [x] 미등재 커맨드 404·인증 실패 401·감사 로그 통합 테스트 {#mb1-tests}

## Phase MB2 — 전송 셤 + 이벤트 {#mb2-transport}
- [x] src/lib/transport.ts — invoke/listen/Channel 셤, vite alias 로 @tauri-apps/api/core·event 치환 {#mb2-shim}
- [x] listen_any → GET /events SSE 재송출 — oculpm 이벤트 화이트리스트(~10종) + 재연결(Last-Event-ID) {#mb2-sse}
- [~] 데스크톱 브라우저 스모크 — 기존 화면이 fetch/SSE 경유로 렌더되는지 {#mb2-smoke}

## Phase MB3 — 모바일 셸 (PWA) {#mb3-shell}
- [x] MobileShell — 하단탭 Today·일지·플래너·논의·AI, 진입 판별(뷰포트/경로) {#mb3-tabs}
- [x] 모바일 화면 5종 — 데이터 훅 재사용, 읽기 우선 + 핵심 조작(플랜 체크·논의 코멘트·일지 수동 작성) {#mb3-screens}
- [x] PWA manifest + 아이콘 + 홈 화면 추가 흐름 {#mb3-pwa}
- [ ] 실기기 검증 — 폰(tailnet) 페어링→일지 열람→플랜 체크→논의 코멘트 E2E AND 같은 LAN 비-tailnet 기기 접속 실패 확인 {#mb3-verify}

## Phase MB4 — AI 스트리밍 + 전원 {#mb4-ai-power}
- [x] POST /chat (SSE) — chat_stream 내부 로직 재사용, Channel 대신 SSE sink {#mb4-chat-sse}
- [x] caffeinate 자식 프로세스 옵션 + 뚜껑 한계 안내(설정·연결 실패 UI) {#mb4-caffeinate}
- [ ] 사용자 실사용 1주 회고 — ACP 원격·푸시·whois 등 v2 범위 판정 {#mb4-retro}

## 보류 (v2 후보)

ACP 원격 구동(권한 응답 UI 포함) · PWA Web Push · tailscale whois 신원 확인 ·
검색/회고 화면 모바일 노출 · 논의 첨부(네이티브 다이얼로그 대체 업로드).

## 리스크

- **웹뷰 전용 가정** — 프런트 어딘가 `window.__TAURI__` 류 전제가 있으면 브라우저에서 깨진다 → MB2 스모크가 게이트.
- **SSE 유실** — 폰 백그라운드 전환 시 이벤트 끊김 → 재연결 + 화면 재진입 시 전체 재조회(기존 패턴과 동일).
- **토큰 유출** — QR 스크린샷 공유 등 → 회전 버튼 제공, 토큰은 로그에 절대 남기지 않음(redact 규칙 준수).

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-24T10:26:00+09:00 | #mb0-skeleton | claude-code | →☐ | .oculpm/journal/20260824/Chores/1026_chore_mobile-bridge-plan.md | 신규 — 플랜 생성, 결정 7건 잠금 |
| 2026-08-24T10:26:01+09:00 | #mb1-invoke | claude-code | →☐ | .oculpm/journal/20260824/Chores/1026_chore_mobile-bridge-plan.md | 신규 |
| 2026-08-24T10:26:02+09:00 | #mb2-transport | claude-code | →☐ | .oculpm/journal/20260824/Chores/1026_chore_mobile-bridge-plan.md | 신규 |
| 2026-08-24T10:26:03+09:00 | #mb3-shell | claude-code | →☐ | .oculpm/journal/20260824/Chores/1026_chore_mobile-bridge-plan.md | 신규 |
| 2026-08-24T10:26:04+09:00 | #mb4-ai-power | claude-code | →☐ | .oculpm/journal/20260824/Chores/1026_chore_mobile-bridge-plan.md | 신규 |
| 2026-08-24T10:47:00+09:00 | #mb0-skeleton | claude-code | ☐→☐ | .oculpm/journal/20260824/Chores/1047_chore_mobile-plan-dedup.md | 선행 설계(three-features #p3-mobile) 흡수 — 3조건 바인드·페어링 코드·정적 가드·검증 게이트. 구 Phase 3 는 삭제 |
| 2026-08-24T11:18:00+09:00 | #mb0-axum | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md | server.rs — 동시 1개·oneshot graceful·ExitRequested 연동 |
| 2026-08-24T11:18:01+09:00 | #mb0-ts-bind | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md | bind.rs — CLI 는 앱번들 경로 우선, 실패 사유 문자열 반환 |
| 2026-08-24T11:18:02+09:00 | #mb0-bind-newtype | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md | private 필드 + detect() 유일 생성자 |
| 2026-08-24T11:18:03+09:00 | #mb0-bind-guard | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md | 되읽기 불일치 시 리스너 폐기 + peer 403 미들웨어 |
| 2026-08-24T11:18:04+09:00 | #mb0-bind-tests | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md | 경계·ISP CGNAT·후보 0/여럿·CLI 부재/불일치 11개 |
| 2026-08-24T11:18:05+09:00 | #mb0-pairing | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md | 6자리·TTL5분·1회용·5회 소진. blake3 해시만 저장, 029 마이그레이션 |
| 2026-08-24T11:18:06+09:00 | #mb0-static | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md | 임베디드 AssetResolver + dev ../dist 폴백 + SPA index |
| 2026-08-24T11:23:00+09:00 | #mb0-settings-ui | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1123_feature_mobile-bridge-settings-tab.md | QR(uqr)+코드+카운트다운, 기기 해제 즉시 실효. Phase MB0 완료 |
| 2026-08-24T13:15:00+09:00 | #mb1-dispatch | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1315_feature_mobile-bridge-mb1-invoke.md | 49 arm 명시 match, 경로는 /api/invoke/{cmd}. app_info 제외·create_manual_entry 내부 호출 |
| 2026-08-24T13:15:01+09:00 | #mb1-envelope | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1315_feature_mobile-bridge-mb1-invoke.md | camelCase 인자 49개 bindings.ts 기계 대조 0 불일치. 422=reject 매핑 |
| 2026-08-24T13:15:02+09:00 | #mb1-tests | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1315_feature_mobile-bridge-mb1-invoke.md | MockRuntime+tower oneshot 통합 4종 — 403/401/페어링 왕복/404/400. cargo 869 |
| 2026-08-24T15:19:00+09:00 | #mb2-shim | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1519_feature_mobile-bridge-mb2-transport.md | vite alias+customResolver(importer 판별), export* 가림 활용. vitest 무영향 |
| 2026-08-24T15:19:01+09:00 | #mb2-sse | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1519_feature_mobile-bridge-mb2-transport.md | EventHub 링버퍼 256+broadcast, 구독→스냅샷+cutoff 로 무유실·무중복. keep-alive 15s |
| 2026-08-24T15:19:02+09:00 | #mb2-smoke | claude-code | ☐→~ | .oculpm/journal/20260824/Features_to_add/1519_feature_mobile-bridge-mb2-transport.md | 부분 — 번들 공존·계약 테스트로 간접 검증. 실브라우저는 Tailscale 연결 후 (토큰 수동 주입) |
| 2026-08-24T16:01:00+09:00 | #mb3-tabs | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1601_feature_mobile-bridge-mb3-shell.md | main.tsx 비웹뷰 분기+?desktop=1 탈출구. AI 탭은 자리만(MB4) |
| 2026-08-24T16:01:01+09:00 | #mb3-screens | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1601_feature_mobile-bridge-mb3-shell.md | 플랜 체크·논의 로그(mdEdit 재사용)·일지 작성 전부 동작. 목록=Summary/상세=fetch |
| 2026-08-24T16:01:02+09:00 | #mb3-pwa | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1601_feature_mobile-bridge-mb3-shell.md | manifest+아이콘 2종+apple 메타. SW 없음(오프라인 무의미) |
| 2026-08-24T16:13:00+09:00 | #mb4-chat-sse | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1613_feature_mobile-bridge-mb4-chat-power.md | run_chat_stream 싱크 일반화 — 데스크톱/모바일 한 코드. AiTab 개방+Mobile 대화 영속 |
| 2026-08-24T16:13:01+09:00 | #mb4-caffeinate | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/1613_feature_mobile-bridge-mb4-chat-power.md | -i 자식, stop/종료 시 kill. 뚜껑은 안내만(D7). PairScreen 3점검 힌트 |
| 2026-08-24T17:53:00+09:00 | #mb3-screens | claude-code | x→x | .oculpm/journal/20260824/Features_to_add/1753_feature_mobile-reskin-desktop-identity.md | 리스킨 재작성 — 사용자 피드백. 테마 축(프리셋·액센트) 이식 + 트리거 색·agentColor·글리프·nav 아이콘 |
<!-- oculpm:plan-log end -->
