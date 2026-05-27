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
| W5-PR4 | Frontend `MigrationModal` 5-step 흐름 | ⬜ | [`PR4-migration-modal.md`](./PR4-migration-modal.md) |
| W5-PR5 | Frontend `OverviewScreen` 재포지셔닝 + 4 위젯 | ⬜ | [`PR5-overview-widgets.md`](./PR5-overview-widgets.md) |
| W5-PR6 | Today 의 agent 필터 확장 (W4 보완) | ⬜ | [`PR6-today-agent-filter.md`](./PR6-today-agent-filter.md) |
| W5-PR7 | "구 SQLite changelog 데이터 삭제" 안전 액션 | ⬜ | [`PR7-legacy-delete.md`](./PR7-legacy-delete.md) |
| W5-PR8 | 통합 + 회귀 점검 + ChangelogScreen deprecated 배너 | ⬜ | [`PR8-integration-regression.md`](./PR8-integration-regression.md) |

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
| 1 | 신규 프로젝트 (SQLite changelog 0개) → 마이그레이션 모달 안 뜸 | ⬜ | PR4 |
| 2 | 기존 프로젝트 (SQLite changelog 10+ 개) → onboarding 후 마이그레이션 모달 | ⬜ | PR4 |
| 3 | dry_run 결과 카운트 = SQLite 카운트 | 🟡 PR1 백엔드 unit ✅ / 모달 검증 PR4 | PR1 + PR4 |
| 4 | 충돌 케이스 (의도적 시드) → suffix 자동 추가 표시 | 🟡 PR1 unit ✅ / 모달 검증 PR4 | PR1 |
| 5 | forbidden 매치 entries 자동 unchecked | 🟡 PR1 unit ✅ / 모달 검증 PR4 | PR1 + PR4 |
| 6 | 마이그레이션 실행 → 진행률 표시 → 완료 → 결과 화면 | ⬜ | PR4 |
| 7 | journal 디스크에 변환된 .md 파일 카운트 = success_count | 🟡 PR1 unit ✅ / 수동 검증 PR8 | PR1 |
| 8 | cache 가 자동 reindex 되어 Today 에 모든 entries 표시 | 🟡 PR1 unit ✅ / 수동 검증 PR8 | PR1 → W3 cache |
| 9 | 백업 폴더 (`.oculpm.backup-pre-migration-...`) 존재 확인 | 🟡 PR1 unit ✅ / 수동 검증 PR8 | PR1 |
| 10 | 마이그레이션 중간에 강제 종료 → 재시작 → rollback 자동 + 토스트 | 🟡 PR2 unit ✅ / 토스트 PR3+PR4 / 강제종료 시나리오 PR8 | PR2 |
| 11 | Overview 의 ActivityHeatmap 90일 셀 표시 | ⬜ | PR5 |
| 12 | DifficultyMix 도넛 슬라이스 클릭 → Today 의 difficulty 필터 | ⬜ | PR5 + W3 filter |
| 13 | AgentBreakdown 막대 클릭 → Today 의 agent 필터 | ⬜ | PR5 + PR6 |
| 14 | UnfinishedChecklist 50개 표시 + 클릭 → Today 의 entry 선택 | ⬜ | PR5 |
| 15 | 구 데이터 삭제: 슬러그 타이핑 미입력 → 버튼 disabled | ⬜ | PR7 |
| 16 | 구 데이터 삭제: 마이그레이션 이력 없으면 메뉴 자체 hidden | ⬜ | PR7 |
| 17 | 구 데이터 삭제 성공 → ChangelogScreen 빈 상태 | ⬜ | PR7 + PR8 |
| 18 | 회귀: 기존 화면들 모두 정상 | ⬜ | PR8 |

---

## §6 Definition of Done (W5 전체 — 페이즈 가이드 §6 기준)

| 항목 | 상태 | 근거 |
|---|---|---|
| 모든 PR 의 DoD ✅ | ⬜ | PR1~PR8 워킹 doc 의 DoD 체크박스 |
| §4 의 수동 QA 18개 ✅ | ⬜ | 위 §4 표 |
| 통합 테스트 `tests/oculpm_migration.rs` 6 시나리오 green | ⬜ | PR1~PR3 통합. 단 W4 에서 `tests/oculpm_agents_compare.rs` 가 미생성으로 끝났던 점 감안 — 본 W5 에서 `src-tauri/tests/` 디렉터리 첫 도입 |
| 자동 dogfooding 데이터에 W5 작업의 자동 기록이 ≥ 80% 작성률 | ⬜ | `_dogfooding-w4.md` 의 W5 일자 entries (W4 §7 핸드오프 1번의 정량 충족) |
| 실제 마이그레이션 1회 수행 (본 ai-pm 프로젝트 meta dogfooding) | ⬜ | PR4 결과 화면에서 success_count 확인 |
| `cargo test`, `cargo clippy`, `pnpm test`, `pnpm tauri build` 모두 green | ⬜ | CI / 로컬 확인 |

---

## §7 W6 핸드오프 (페이즈 가이드 §7 기준 — 4개)

| 항목 | 상태 | 위치 |
|---|---|---|
| 마이그레이션이 검증됨 — 실제 데이터로 1회 이상 무손실 변환 | ⬜ | PR4 결과 + dry_run 카운트 vs success_count 일치 |
| Overview 가 자기 역할로 자리잡음 | ⬜ | PR5 |
| 자동 dogfooding 4일치 데이터 누적 (W3 + W4 + W5 = 약 2주) | ⬜ | `_dogfooding-w*` 시리즈 |
| 모든 핵심 흐름 (W1~W5) 이 동작. W6 는 안정화만 | ⬜ | PR8 회귀 점검 |

---

## 페이즈 회고

> W5 마지막 PR 종료 시 채울 자리. 다음 항목을 최소 다룰 것 (W1~W4 회고 양식과 동일).

- **예상 대비 실제 소요**:
- **발견된 함정 vs 가이드 예측**:
- **실제 마이그레이션 1회 결과 (entries 카운트 / 실패 / forbidden skip)**:
- **W5 작업의 자동 기록 작성률 (W4 핸드오프 1번 정량)**:
- **W6 로 넘기는 결정/주의 (특히 stabilize 백로그)**:
