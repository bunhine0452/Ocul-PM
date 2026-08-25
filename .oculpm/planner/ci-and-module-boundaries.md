---
oculpm_plan: v1
id: ci-and-module-boundaries
title: "CI 게이트 · 모듈 경계 정리 — 외부 코드리뷰 피드백 4건 대응"
status: active
created: 2026-08-25
updated: 2026-08-25
owner: claude-code
---

외부 리뷰 피드백 4건(버전 어긋남 / CI 테스트 부재 / 비대한 Rust 모듈 3종 /
비대한 프런트 컴포넌트)을 실측 검증한 뒤 세운 라운드. **0번은 사실이 아니어서
기각**, 1번은 그대로 수용(최우선), 2·3번은 수용하되 근거 수치를 바로잡아 범위를
조정했다. 2·3번 모두 **동작 변경 없는 순수 구조 작업**이므로, Phase 1 의 CI 가
먼저 서야 안전망 위에서 움직일 수 있다 — 순서를 지킬 것.

## Phase 0 — 피드백 사실 확인 {#p0-triage}
- [x] 0번 **기각** — 버전은 어긋나지 않았다: Cargo.toml·package.json·tauri.conf.json 모두 2.19.0, 최신 공개 릴리스도 v2.19.0(2026-08-25), README ko/en 최상단 섹션도 v2.19.0. v1.8.1 은 2026-06-15 태그로 30여 릴리스 전 — 리뷰어가 묵은 데이터를 봤다. 조치 없음 {#t0-version-claim}
- [x] 1번 **수용** — .github/workflows 에 release.yml 1개뿐, 트리거는 `push: tags: v*`, 스텝은 checkout→node/pnpm/rust→pnpm install→CHANGELOG 추출→tauri-action. cargo test·pnpm test·typecheck·lint 어느 것도 CI 에 없음 {#t1-ci-absent}
- [x] 2번 **수용(수치 조정)** — 줄 수는 정확하나 `#[cfg(test)]` 제외 실코드 기준으로는 순위가 뒤바뀐다: db.rs 3,184줄/pub fn 76 > manager.rs 2,460줄/48 > cache.rs 2,318줄/23. manager.rs 는 45%가 테스트 {#t2-rust-bloat}
- [x] 3번 **부분 수용** — AcpConversation.tsx·SettingsPanel.tsx 는 수용. bindings.ts 도메인 분할은 **기각**: tauri-specta 는 `collect_commands!` 하나에서 단일 파일만 생성해 분할 출력을 지원하지 않는다 {#t3-frontend-bloat}
- [x] 기준선 실측 — vitest 113파일/1,303케이스 10.6초 그린, cargo test exit 0 그린, `cargo test` 후 bindings.ts 무변경(커밋본 최신) {#t4-baseline}

## Phase 1 — CI 게이트 신설 {#p1-ci}
투자 대비 효과 최우선. 저장소가 **public** 이라 macOS 러너 분당 과금이 없다.
- [x] `.github/workflows/ci.yml` 신설 — `pull_request` + `push: branches: [main]` 트리거, 태그 빌드(release.yml)와 역할 분리 {#ci-file}
- [x] 프런트 잡 — ubuntu-latest, pnpm 캐시, `pnpm typecheck` → `pnpm test` → `pnpm lint`(storage+i18n) → `pnpm build`(check-critical-css 포함). Rust 불필요라 1~2분 예상 {#ci-frontend-job}
- [x] Rust 잡 — **macos-latest 고정**(tauri `macos-private-api` feature + `cfg(target_os="macos")` 9개 파일 → ubuntu 는 webkit2gtk 의존에 미검증), swatinem/rust-cache 워밍, `cargo test` {#ci-rust-job}
- [x] bindings 신선도 게이트 — Rust 잡에서 `cargo test` 직후 `git diff --exit-code src/lib/bindings.ts`. 커맨드만 고치고 bindings 재생성을 빠뜨린 커밋을 잡는다(이 저장소 고유의 구조적 실수 경로) {#ci-bindings-drift}
- [x] 문서·배지 — README ko/en 에 CI 배지, docs/RELEASE.md 릴리스 절차에 "태그 푸시 전 CI 그린 확인" 한 줄 {#ci-docs}
- [ ] 스킵 가드 보강 — `tests/lsp_rust_analyzer.rs` 의 `rust_analyzer()` 가 PATH 의 **파일 존재**만 봐서 rustup shim 에 속는다(컴포넌트 없이도 가드 통과 → 실행 시 사망). `--version` 기동 확인으로 바꿔 컴포넌트 없는 로컬에서도 진짜로 건너뛰게 한다 — CI 첫 실행이 잡아낸 잠복 버그 {#ra-guard-hardening}
- [x] 실측·조정 — 콜드/웜 소요시간 기록. Rust 잡 웜이 5분을 넘으면 `cargo test --lib` 와 통합 테스트 분리 검토 {#ci-timing}

## Phase 2 — 백엔드 모듈 경계 {#p2-backend}
48개 메서드가 **단일 `impl OculpmManager` 블록**(manager.rs:129~)에 몰려 있다.
Rust 는 같은 크레이트 안에서 고유 impl 을 여러 파일로 나눌 수 있으므로, 이 작업은
**공개 API·호출부 무변경의 순수 파일 이동**이다. 한 파일씩, 커밋도 한 번씩.
- [x] manager 분할 — `manager/mod.rs`(구조체·new·공유 상태) + `journal.rs`(일지 CRUD/검증/메타·13개) + `indexing.rs`(reindex·backfill·entry_diffs·8개) + `lifecycle.rs`(init/status/config/watcher/lock·15개) + `agents_sync.rs`(sync/upgrade/drift/compare·7개) + `session.rs`(세션·5개) {#mgr-split}
- [x] db.rs 분할 — 실코드 기준 최대(3,184줄/76 fn). 마이그레이션 러너 / 저널·플래너 쿼리 / 인덱스·임베딩(sqlite-vec) / 설정·기타로 분리 {#db-split}
- [x] cache.rs 분할 — 2,318줄/23 fn. 읽기 경로와 쓰기·무효화 경로 기준 {#cache-split}
- [x] 무변경 검증 — 각 분할 후 `pub` 시그니처 집합 diff 가 비어 있음을 확인하고 cargo test 그린. 로직 수정은 이 Phase 에서 **금지**(눈에 띄면 별도 항목으로 적기만) {#backend-no-behavior-change}

## Phase 3 — 프런트 컴포넌트 분해 {#p3-frontend}
AcpConversation.tsx 의 진짜 문제는 파일 3,542줄이 아니라 **본체 컴포넌트 하나가
182~2,104줄(1,922줄)** 이라는 점이다. 그 아래 ~20개 하위 컴포넌트는 이미 경계가
서 있어 옮기기만 하면 된다 — 그쪽부터 걷어내야 본체가 드러난다.
- [x] 하위 컴포넌트 추출 — TurnRow·TraceRow·UserTurn·PermissionCard·SessionPanel·ConfigControl·EffortControl·MarkdownBlock 등을 `features/chat/conversation/` 로 이동(로직 무변경) {#acp-extract-children}
- [ ] 본체 훅 추출 (1/5 — useSessionMaps 완료) — 남은 1,922줄 본체에서 세션 구독·스트리밍 상태·스크롤 스틱(STICK_SLACK_PX)·이미지 첨부·권한 흐름을 커스텀 훅으로 분리, 본체는 조립만 {#acp-extract-hooks}
- [x] SettingsPanel 탭 분리 — Appearance·Llm·Indexing·Graph·Notion·Data·Diagnostics·Update 8개 탭 함수를 `features/settings/tabs/` 로. TABS 레지스트리는 유지 {#settings-split}
- [x] 회귀 방어 — 분해 전 AcpConversation 렌더/상호작용 테스트가 얇으면 먼저 보강(추출은 그 다음). vitest 그린 유지 {#frontend-regression}

## Phase 4 — 커맨드 표면 정리 {#p4-commands}
후순위. `collect_commands!` 262개에 대해 `commands.*` 를 직접 import 하는 파일이
160개, `src/api/` 파사드 경유는 18개뿐 — 실제 신호는 "생성 파일이 크다"가 아니라
"파사드 계층이 oculpm.ts 하나뿐"이다. **bindings.ts 자체는 건드리지 않는다**(생성물).
- [ ] 도메인 파사드 확장 — `src/api/oculpm.ts` 패턴을 code·terminal·git·llm 으로 넓혀 envelope 해제를 한곳에 모음 {#api-facades}
- [ ] 미사용 커맨드 감사 — 262개 중 프런트 호출부가 없는 것을 추려 제거 후보 목록화(제거는 별건) {#dead-command-audit}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-25T19:42:31+09:00 | #t0-version-claim | claude-code | ☐→x | 20260825/Chores/1942_chore_feedback-triage-ci-plan.md | 기각 — 세 버전 파일·최신 릴리스·README ko/en 모두 2.19.0 |
| 2026-08-25T19:42:31+09:00 | #t1-ci-absent | claude-code | ☐→x | 20260825/Chores/1942_chore_feedback-triage-ci-plan.md | 수용 — release.yml 만 존재, 테스트 스텝 0 |
| 2026-08-25T19:42:31+09:00 | #t2-rust-bloat | claude-code | ☐→x | 20260825/Chores/1942_chore_feedback-triage-ci-plan.md | 수용 — 실코드 기준 db.rs > manager.rs > cache.rs 로 재랭킹 |
| 2026-08-25T19:42:31+09:00 | #t3-frontend-bloat | claude-code | ☐→x | 20260825/Chores/1942_chore_feedback-triage-ci-plan.md | 부분수용 — 컴포넌트 O, bindings 분할은 생성기 미지원 |
| 2026-08-25T19:42:31+09:00 | #t4-baseline | claude-code | ☐→x | 20260825/Chores/1942_chore_feedback-triage-ci-plan.md | vitest 1,303 그린 · cargo test exit 0 · bindings 최신 |
| 2026-08-25T19:52:00+09:00 | #ci-file | claude-code | ☐→x | 20260825/Chores/1952_chore_ci-test-gate.md | ci.yml 신설 — pull_request + main push, concurrency 취소 |
| 2026-08-25T19:52:00+09:00 | #ci-frontend-job | claude-code | ☐→x | 20260825/Chores/1952_chore_ci-test-gate.md | ubuntu 잡 — typecheck·test·lint·build |
| 2026-08-25T19:52:00+09:00 | #ci-rust-job | claude-code | ☐→x | 20260825/Chores/1952_chore_ci-test-gate.md | macos 잡 — cargo test --locked + rust-cache |
| 2026-08-25T19:52:00+09:00 | #ci-bindings-drift | claude-code | ☐→x | 20260825/Chores/1952_chore_ci-test-gate.md | cargo test 후 git diff --exit-code src/lib/bindings.ts |
| 2026-08-25T19:52:00+09:00 | #ci-docs | claude-code | ☐→x | 20260825/Chores/1952_chore_ci-test-gate.md | README ko/en CI 배지 + RELEASE.md §0 에 태그 전 그린 확인 |
| 2026-08-25T20:21:00+09:00 | #mgr-split | claude-code | ☐→x | 20260825/Refactors/2021_refactor_manager-module-split.md | manager.rs 4,514줄 → 7파일(구현 최대 571줄). 순수 이동 — 시그니처 56개·테스트 888/0/7 동일 |
| 2026-08-25T20:47:00+09:00 | #db-split | claude-code | ☐→x | 20260825/Refactors/2047_refactor_db-module-split.md | db.rs 3,292줄 → 9파일(최대 690줄). 시그니처 107개·테스트 888/0/7 동일 |
| 2026-08-25T20:47:00+09:00 | #ci-timing | claude-code | ☐→x | 20260825/Refactors/2047_refactor_db-module-split.md | 콜드 실측 프런트 2m36s·Rust 10m31s. cache-on-failure 추가(실패 실행도 캐시 저장) |
| 2026-08-25T21:02:00+09:00 | #cache-split | claude-code | ☐→x | 20260825/Refactors/2102_refactor_cache-module-split.md | cache.rs 3,435줄 → 8파일(최대 642줄). 시그니처 34개·888/0/7 동일 |
| 2026-08-25T21:02:00+09:00 | #backend-no-behavior-change | claude-code | ☐→x | 20260825/Refactors/2102_refactor_cache-module-split.md | 3파일 모두 시그니처 정렬비교 diff 없음(56·107·34) · 테스트수 불변 · bindings 클린 |
| 2026-08-25T20:52:00+09:00 | #acp-extract-children | claude-code | ☐→x | 20260825/Refactors/2052_refactor_acp-conversation-children.md | 하위 29선언 → conversation/ 8파일. 3,542→2,059줄, 선언 42개·테스트 1,303 동일 |
| 2026-08-25T20:56:00+09:00 | #settings-split | claude-code | ☐→x | 20260825/Refactors/2056_refactor_settings-panel-tabs.md | SettingsPanel 1,871→264줄, tabs/ 8파일. 선언 29개·테스트 1,303 동일. NotionSection 재수출로 표면 유지 |
| 2026-08-25T21:00:00+09:00 | #frontend-regression | claude-code | ☐→x | 20260825/Features_to_add/2100_feature_acp-characterization-tests.md | acp_conversation_seams 5건 — 기록·실패·탭·초안 분리를 못 박음. 렌더 커버리지 2→7건 |
| 2026-08-25T21:03:00+09:00 | #acp-extract-hooks | claude-code | ☐→☐ | 20260825/Refactors/2103_refactor_acp-use-session-maps.md | useSessionMaps 추출(1/5). 패턴 검증됨 — 1,308 테스트 그린. 탭은 closeTab 동반 필요 |
<!-- oculpm:plan-log end -->
