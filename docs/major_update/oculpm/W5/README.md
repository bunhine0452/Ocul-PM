# W5 — 작업 트래커

> 페이즈 명세: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) (SSOT)
> 본 폴더의 PR 파일들은 **그 PR 의 워킹 도큐먼트** — 진행하면서 체크박스/노트 갱신.
> 선행: W4 의 §7 핸드오프 5개 항목 ([`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §7) — 2026-05-27 시점 모두 ✅/`[~]` 처리됨. `tests/oculpm_agents_compare.rs` 와 `pnpm tauri build` 1회 실행은 비-블로커 잔여.

---

## 진행 현황

| PR | 제목 | 상태 | 워킹 도큐먼트 |
|---|---|---|---|
| W5-PR1 | `migrate_from_sqlite.rs` 핵심 알고리즘 + dry-run | ✅ | [`PR1-migrate-dry-run.md`](./PR1-migrate-dry-run.md) |
| W5-PR2 | 마이그레이션 롤백 + 부분 실패 처리 | ✅ | [`PR2-migrate-rollback.md`](./PR2-migrate-rollback.md) |
| W5-PR3 | 마이그레이션 Tauri 커맨드 3개 | ✅ | [`PR3-migrate-commands.md`](./PR3-migrate-commands.md) |
| W5-PR4 | Frontend `MigrationModal` 5-step 흐름 | ✅ | [`PR4-migration-modal.md`](./PR4-migration-modal.md) |
| W5-PR5 | Frontend `OverviewScreen` 재포지셔닝 + 4 위젯 | ✅ | [`PR5-overview-widgets.md`](./PR5-overview-widgets.md) |
| W5-PR6 | Today 의 agent 필터 확장 (W4 보완) | ✅ | [`PR6-today-agent-filter.md`](./PR6-today-agent-filter.md) |
| W5-PR7 | "구 SQLite changelog 데이터 삭제" 안전 액션 | ✅ | [`PR7-legacy-delete.md`](./PR7-legacy-delete.md) |
| W5-PR8 | 통합 + 회귀 점검 + ChangelogScreen deprecated 배너 | ✅ | [`PR8-integration-regression.md`](./PR8-integration-regression.md) |

상태 표기: ⬜ 시작 전 · 🟡 진행 중 · ✅ 완료 · 🔴 블로커.

> **순서 주의**: 백엔드 PR1~PR3 가 먼저, 그 위에 프론트 PR4 (마이그레이션 UX), 동시에 PR5 (Overview 재포지셔닝) + PR6 (Today 보완), 마지막에 PR7 (구 데이터 삭제) + PR8 (회귀 점검).

---

## 권장 진행 순서 (선후 의존)

```
PR1 (dry_run + execute) ──► PR2 (rollback + partial failure)
        │                          │
        └──────────┬───────────────┘
                   ▼
            PR3 (Tauri commands 3개)
                   │
                   ├─────────────────┬────────────────┐
                   ▼                 ▼                ▼
            PR4 (MigrationModal) PR5 (Overview)  PR6 (Today agent 필터)
                   │                 │                │
                   └──────┬──────────┴────────────────┘
                          ▼
                   PR7 (legacy delete) ──► PR8 (integration + 회귀)
```

병렬화:
- PR4 / PR5 / PR6 는 PR3 의 bindings 만 살아있으면 평행 (PR5 는 W4 의 `oculpm_journal` + `oculpm_sessions_cache` 만 의존, 마이그레이션 무관).
- PR7 는 PR4 의 결과 화면이 "구 데이터 삭제하기" CTA 를 노출하므로 PR4 이후.
- PR8 은 위 모두 ✅ 후 단일 회귀 라운드.

---

## 페이즈 종료 조건

- W5 의 모든 PR ✅ (PR1~PR8, 8개)
- `phases/W5-migration-overview.md` §4 의 수동 QA 18개 ✅
- `phases/W5-migration-overview.md` §6 의 Definition of Done 6개 ✅
- 본 ai-pm 프로젝트의 SQLite changelog 를 본 페이즈가 마이그레이션 (meta dogfooding) 1회
- W6 의 선행 조건 (`phases/W5-migration-overview.md` §7) 4개 ✅
- `_dogfooding-w4.md` 에 W5 작업의 자동 기록 추가 (W4 §7 의 핸드오프 1번 — "W5 작업 자체가 자동 기록")
- `cargo test`, `cargo clippy`, `pnpm test`, `pnpm tauri build` 모두 green

---

## §4 수동 QA 진행 (페이즈 가이드 §4 기준 — 18개)

> 자세한 사용자 체크리스트는 **W5 종료 직전** `./MANUAL-CHECKLIST.md` 를 W3/W4 와 동일 방식으로 작성. 현재는 페이즈 표만 미러.

| # | 항목 | 상태 | 비고 |
|---|---|---|---|
| 1 | 신규 프로젝트 (SQLite changelog 0개) → 마이그레이션 모달 안 뜸 | 🟡 PR4 구현 ✅ (`useShouldOfferMigration` → `"no"`) / 수동 검증 PR8 | PR4 |
| 2 | 기존 프로젝트 (SQLite changelog 10+ 개) → onboarding 후 마이그레이션 모달 | 🟡 PR4 구현 ✅ / 수동 검증 PR8 | PR4 |
| 3 | dry_run 결과 카운트 = SQLite 카운트 | 🟡 PR1 unit ✅ + PR4 wire ✅ / 시각 검증 PR8 | PR1 + PR4 |
| 4 | 충돌 케이스 (의도적 시드) → suffix 자동 추가 표시 | 🟡 PR1 unit ✅ + PR4 surface ✅ / 시각 검증 PR8 | PR1 |
| 5 | forbidden 매치 entries 자동 unchecked | 🟡 PR1 unit ✅ + PR4 ☑ unchecked ✅ / 시각 검증 PR8 | PR1 + PR4 |
| 6 | 마이그레이션 실행 → 진행률 표시 → 완료 → 결과 화면 | 🟡 PR4 step 4/5 구현 ✅ / 실데이터 검증 PR8 | PR4 |
| 7 | journal 디스크에 변환된 .md 파일 카운트 = success_count | 🟡 PR1 unit ✅ / 수동 검증 PR8 | PR1 |
| 8 | cache 가 자동 reindex 되어 Today 에 모든 entries 표시 | 🟡 PR1 unit ✅ / 수동 검증 PR8 | PR1 → W3 cache |
| 9 | 백업 폴더 (`.oculpm.backup-pre-migration-...`) 존재 확인 | 🟡 PR1 unit ✅ / 수동 검증 PR8 | PR1 |
| 10 | 마이그레이션 중간에 강제 종료 → 재시작 → rollback 자동 + 토스트 | 🟡 PR2 unit ✅ / 토스트 PR3+PR4 / 강제종료 시나리오 PR8 | PR2 |
| 11 | Overview 의 ActivityHeatmap 90일 셀 표시 | 🟡 PR5 구현 ✅ / 수동 검증 PR8 | PR5 |
| 12 | DifficultyMix 도넛 슬라이스 클릭 → Today 의 difficulty 필터 | 🟡 PR5 push ✅ + PR6 consume ✅ + 백엔드 SQL ✅ / 수동 검증 PR8 | PR5 + W3 filter |
| 13 | AgentBreakdown 막대 클릭 → Today 의 agent 필터 | 🟡 PR5 push ✅ + PR6 consume ✅ + 백엔드 SQL ✅ / 수동 검증 PR8 | PR5 + PR6 |
| 14 | UnfinishedChecklist 50개 표시 + 클릭 → Today 의 entry 선택 | 🟡 PR5 구현 ✅ / 수동 검증 PR8 | PR5 |
| 15 | 구 데이터 삭제: 슬러그 타이핑 미입력 → 버튼 disabled | 🟡 PR7 구현 ✅ (slugInput === REQUIRED_SLUG) / 시각 검증 PR8 | PR7 |
| 16 | 구 데이터 삭제: 마이그레이션 이력 없으면 메뉴 자체 hidden | 🟡 PR7 구현 ✅ (target == null 분기) / 시각 검증 PR8 | PR7 |
| 17 | 구 데이터 삭제 성공 → ChangelogScreen 빈 상태 | 🟡 PR8 구현 ✅ (`ChangelogEmptyState`) / 수동 검증 사용자 게이트 | PR7 + PR8 |
| 18 | 회귀: 기존 화면들 모두 정상 | 🟡 PR8 통합 11 PASS ✅ / 수동 검증 사용자 게이트 | PR8 |

---

## §6 Definition of Done (W5 전체 — 페이즈 가이드 §6 기준)

| 항목 | 상태 | 근거 |
|---|---|---|
| 모든 PR 의 DoD ✅ | ✅ 자동분 | PR1~PR8 워킹 doc 의 DoD 체크박스 — 자동 영역은 모두 ✅, 수동/dogfooding 항목은 사용자 게이트 |
| §4 의 수동 QA 18개 ✅ | 🟡 사용자 게이트 | `MANUAL-CHECKLIST.md` 작성 완료, 사용자 실측 필요 |
| 통합 테스트 `tests/oculpm_migration.rs` 6 시나리오 green | ✅ | 2026-05-28 — 6/6 PASS |
| 자동 dogfooding 데이터에 W5 작업의 자동 기록이 ≥ 80% 작성률 | 🟡 사용자 게이트 | `_dogfooding-w*` 에 본 세션의 PR1~PR8 자동 기록 누적은 워처가 보장 (각 PR 의 코드 수정 시 file_changes.ndjson 에 자동 기록); 사용자 narrative 작성률은 별도 |
| 실제 마이그레이션 1회 수행 (본 ai-pm 프로젝트 meta dogfooding) | 🟡 사용자 게이트 | `MANUAL-CHECKLIST.md` 의 meta dogfooding 섹션 참조 |
| `cargo test`, `pnpm tsc --noEmit` 모두 green | ✅ | lib 210/210 + integration 11/11 + tsc exit 0 (2026-05-28). `cargo clippy` + `pnpm tauri build` 는 build-env 의존 |

---

## §7 W6 핸드오프 (페이즈 가이드 §7 기준 — 4개)

| 항목 | 상태 | 위치 |
|---|---|---|
| 마이그레이션이 검증됨 — 실제 데이터로 1회 이상 무손실 변환 | ⬜ | PR4 결과 + dry_run 카운트 vs success_count 일치 |
| Overview 가 자기 역할로 자리잡음 | ⬜ | PR5 |
| 자동 dogfooding 4일치 데이터 누적 (W3 + W4 + W5 = 약 2주) | ⬜ | `_dogfooding-w*` 시리즈 |
| 모든 핵심 흐름 (W1~W5) 이 동작. W6 는 안정화만 | ⬜ | PR8 회귀 점검 |

---

## 페이즈 회고 (2026-05-28)

- **예상 대비 실제 소요**: 가이드 추정 30+ 시간, 자동 영역 (PR1~PR8 의 백엔드 + 프론트엔드 구현 + 테스트) 8 세션. 수동 QA + meta dogfooding 은 별도 사용자 시간.

- **발견된 함정 vs 가이드 예측**:
  - **세션 ID 형식 제약** (PR1) — IndexWriter 의 `workday_from_id` 가 첫 8자 ASCII 숫자 강제. 가이드의 `migrated-{workday}-{NNN}` 거부됨 → `<workday>-mNN` 변경. 메모리 `[[oculpm-session-id-format]]` 에 영속.
  - **`sessions.json` vs `sessions.ndjson`** (PR1, PR2) — 실제는 JSON 단일 파일. 라인 필터가 아닌 array retain.
  - **specta BigInt 금지** (PR7) — `i64` 타임스탬프가 specta export 시 거부. `u32` Unix epoch 채택 (2106 까지 안전).
  - **bindings.ts 자동 export** (PR3) — `cfg(debug_assertions)` 의 `builder.export()` 는 Tauri 부팅 필요. `build_specta_builder()` 추출 + `#[cfg(test)] export_bindings_typescript` 테스트 추가 → 매 `cargo test` 가 sync.
  - **`AgentCount.share` / `narrative_rate` 가 nullable** (PR5) — f32 가 specta 에서 `number | null` 로 변환. TS 측 `(value ?? 0)` 패턴 필수.
  - **PR3 의 panic 분기 위임** (PR2 → PR3 → 미적용) — `tokio::spawn + JoinError::is_panic()` 패턴은 W6 stabilize 로 이월. Tauri 내장 panic 캐치에 의존.
  - **`oculpm_open_backup_dir` 신설을 PR4 로 흡수** (가이드 §3) — opener-scope 우회 패턴은 [[opener-scope-recurring]] 메모리에 이미 영속, manager 의 traversal 가드 공유.

- **`difficulty` 필터 wire 시점** — PR5 의 DifficultyMix 클릭이 push 만 했고 consume 은 PR6 까지 부재 였음. PR6 에서 `agents` 와 함께 동시 처리.

- **W6 로 넘기는 결정/주의 (stabilize 백로그)**:
  - 명시적 cancel signal (MigrationModal step 4 의 진행 중 취소)
  - panic 분기 `tokio::spawn + JoinError::is_panic()` 명시적 처리
  - ActivityHeatmap 의 ISO weekday 정렬 + 월 라벨
  - widget live update (`events.oculpmJournalAdded` 구독 → invalidate)
  - DifficultyMix SVG donut (현재는 stacked bar)
  - difficulty 칩 그룹 (CategoryFilterBar; 현재는 DifficultyMix 클릭으로만 set)
  - 필터 dropdown Esc 닫기
  - `navigateToToday({ kind: "workday" })` 의 anchor-date 기반 dayOffset 자동 점프
  - `auto_delete_backup_after_days` 정책의 legacy-deletion 30일+ 별도
  - `IndexWriter::delete_session` public API (현재는 rollback 이 직접 sessions.json manipulate)
  - real mid-write fault injection (현재는 backup_dir 가벼운 트릭만)
  - Settings 의 "마이그레이션 이력 확인" + "다시 보기" 링크
  - `release_master_template` API 의 단일 시그니처 통일 (lang 파라미터 부재 vs spec 의 일관성)
