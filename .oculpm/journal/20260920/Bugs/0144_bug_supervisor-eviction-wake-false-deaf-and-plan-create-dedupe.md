---
schema_version: 1
type: bug
slug: "supervisor-eviction-wake-false-deaf-and-plan-create-dedupe"
status: done
created_at: "2026-09-20T01:44:56+09:00"
session_id: "20260920-002"
agent:
  id: "claude-code"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "mcp-tool"
---
[x] 로그 집계가 낸 감독관 오탐 — 락 인계 웨이크가 멀쩡한 워처 52개를 끊었다 · plan_create 재사용 권고 · 이월 2건

## 요약

"앱을 더 완벽하게" 라는 열린 요청을 지난 라운드들과 같은 방식으로 받았다 — 2주치 `oculpm.log` 를 모양별로 집계해 확정 결함을 찾고, 살아 있는 플랜의 이월 항목 중 코드로 닫히는 것을 함께 처리했다. 확정 결함 1건, 이월 2건, 잘못된 이월 1건 정리. 커밋 `09244a6a`.

## 원인

**감독관 오탐.** `supervisor::spawn` 은 정기 틱(60초) 외에 `evicted.notified()` 로도 깨어나는데, 깨어나면 **전체 틱(판정 포함)** 을 돌렸다. 2026-09-15 02:13 에 개발 빌드가 설치본에게서 16개 프로젝트의 락을 연달아 가져가자 틱이 0.5초 간격으로 돌았고, 직전 틱이 심은 프로브가 아직 처리 루프에 닿기 전이라 "카운터 그대로 = 먹통" 으로 읽어 멀쩡한 워처를 끊고 되살렸다 (`응답 없는 워처를 끊는다` 52회 / 2분, 무장 0.5초 뒤 절단). 판정은 60초 간격을 전제한 비교인데, 신호 웨이크가 그 전제를 깼다.

**plan_create 중복.** 유사 플랜 검사가 없어 라운드마다 새 플랜이 생겼다 — 잠긴 플랜 20개에 미완 63건이 쌓인 경로.

## 변경

- `supervisor.rs`: 인계 웨이크는 `yield_evicted` 만 하고 `continue`. `Probe { baseline, planted_at }` 로 기준값에 시각을 붙이고, `verdict` 에 `MIN_PROBE_AGE` 20초 미만이면 `Verdict::TooEarly` (판정도 다시 심기도 안 함). 워처가 아예 없으면 나이와 무관하게 재무장.
- `mcp/tools/plan_create.rs` (mod.rs 에서 분리 — 래칫 1425줄): `similar_active_plans` 가 제목·id 토큰(소문자, 숫자만/한 글자 제외) 자카드 ≥ 0.5 인 **활성** 플랜을 찾으면 파일을 만들지 않고 `id 「제목」 (hash)` 후보를 에러로 돌려준다. `allow_similar: true` 가 문. 잠긴 플랜은 후보가 아니다 (라운드 끝내고 같은 이름으로 다음 라운드를 여는 정상 경로). 도구 description·landing plugin.html ko/en 갱신.
- `tests/lsp_rust_analyzer.rs`: `is_file()` 은 `~/.cargo/bin/rust-analyzer` rustup 프록시에 속는다 → `--version` 기동 성공으로 판정 ({#ra-guard-hardening}).
- `lib.rs`: 디버그 빌드의 `bindings.ts` 내보내기 실패(CWD 읽기 전용, 로그 패닉 2회)를 패닉 대신 경고로.
- `redact.rs` `CALL_SITE_FILES` 23→24 (파일 분리로 호출 파일 수 증가, egress_inventory 가 잡았다).
- 플랜: `a2a-enforce-app` 은 원본 `a2a-session-grouping #enforce-app` 이 2026-09-03 에 이미 폐기(D7 — 앱 쪽 쓰기는 수락·거절뿐, 메시지 경로 없음)된 항목이라 같은 사유로 닫음.

## 검증

- `cargo test` 34 스위트 ok · `cargo clippy --all-targets -- -D warnings` 0 · `cargo fmt --check` 0
- `pnpm typecheck` / `test` / `lint` / `build` 각 exit 0 (lint 는 처음에 파일 크기 래칫으로 붉었다 → 분리로 해소)
- 새 테스트: `a_young_probe_is_not_judged` · `a_missing_watcher_is_rearmed_regardless_of_probe_age` · `probe_age_guard_fits_inside_a_tick` · `back_to_back_ticks_do_not_cut_a_live_watcher`(진짜 매니저에서 틱 연속 2회) · `plan_create_refuses_a_lookalike_of_an_active_plan_unless_allowed` · `plan_create_matches_on_title_and_ignores_unrelated_plans` · `plan_create_ignores_locked_lookalikes`
- `bindings.ts` 무변경 (커맨드 시그니처 변경 없음)

## 남은 것

- 로그 집계의 나머지: `NotAllowedError` 409·`Canceled` 408 은 9/10~11 에만 있어 이미 고친 Monaco 클립보드 건, `oculpmInit [object Object]` 는 9/18 에 고쳐짐, settings 크래시는 9/11 옛 빌드 스택. `confirm not allowed by ACL` 1건·`close_tab 레지스트리에 없는 탭` 4건은 재현 불가라 남긴다.
- 릴리스는 하지 않았다 — 다음 릴리스에 랜딩 `plugin.html` 재배포가 따라가야 한다.