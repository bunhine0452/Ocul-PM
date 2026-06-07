<!-- schema_version: 1 -->
# 02 — 구현 체크리스트 + 검증 가이드

> 살아있는 진척표. 본 라운드는 5개 PR 배치 전부 ✅. 게이트는 커밋 직전 직접 확인.

---

## 1. PR 배치 DoD / 상태

### PR-FIX — 빠른 버그/CSS ✅
- [x] D1 삭제 파일 diff: `snapshot_diff` NotFound→전삭제 patch + 프론트 "삭제됨" 안내
- [x] D2 `!` 임시파일 억제(`is_self_suppressed` + 테스트) + redacted 항목 recentChanges 제외
- [x] D4 "모두 검토 완료" 버튼
- [x] B4 단일행 diff (`white-space:pre` + `min-width:max-content` 그리드)

### PR-SB — 사이드바 접기 ✅
- [x] `sidebarCollapsed` 영속 상태
- [x] 접기 버튼(`PanelLeft`) + 호버 노출 오버레이 + 재고정

### PR-JR — 카드 정리 + 풍부한 모달 ✅
- [x] B1 카드 파일 칩 제거, 클릭 → `EntryDiffModal`
- [x] B2 모달 좌 pane 서술(`body_markdown`) + 변경파일 op 목록
- [x] B3 큰 파일 상단 잘림 해소(pane별 단일 스크롤러)
- [x] B5 동일이름 경로 구분(`disambiguateLabels`)
- [x] B6 (#4) 조사 후 코드 변경 없음으로 결론

### PR-PLN6 — Planner 완료·잠금 ✅
- [x] `set_plan_status`(순수) + 단위테스트
- [x] `plan_set_status` 커맨드 + `lib.rs` 등록
- [x] `plan_apply_edit`/`plan_ai_refresh` 잠금 가드
- [x] AGENTS.md(master_ko) 잠금 규칙
- [x] 프론트 잠금 UI(버튼/배지/비활성) + plan 칩 정렬·🔒

### PR-DF-GROUP — 변경 파일 일지/plan 그룹화 ✅
- [x] `JournalCache::group_changes` 역인덱스(일지 + plan join)
- [x] `oculpm_group_changes` 커맨드 + `lib.rs` 등록
- [x] `DiffScreenV2` 그룹 UI + 평면 fallback + 일지 점프

---

## 2. 게이트 결과 (2026-06-07, 커밋 직전)

| 게이트 | 명령 | 결과 |
|---|---|---|
| 타입 | `pnpm typecheck` | ✅ exit 0 |
| 테스트(FE) | `pnpm test` | ✅ 113 pass / 3 todo |
| 린트 | `pnpm lint` | ✅ no direct localStorage |
| 빌드 | `pnpm build` | ✅ (청크>500kB 경고는 기존 advisory) |
| 테스트(BE) | `cargo test --lib` | ✅ 260 pass / 1 ignored |

신규 Rust 테스트: `is_self_suppressed`(`!` 케이스), `set_plan_status`(잠금·삽입).

---

## 3. 수동 검증 가이드 (앱/DMG)

1. **사이드바** — 접기 버튼 → 사이드바 사라짐, 본문 전체폭. 좌측 끝에 커서 → 오버레이로 떠오름. 버튼 다시 → 고정. 재시작 후 상태 유지.
2. **작업 일지** — 카드에 `+0` 칩 없음. 카드 클릭 → 2-pane 모달(좌 서술/파일목록, 우 diff). **큰 파일**에서 상단 안 잘림, **긴 줄**은 한 줄 + 가로 스크롤. 동일 basename 파일이 경로로 구분되는지(`config.py` 2개 케이스).
3. **Planner** — "완료·잠금" → 🔒 + 편집/AI 비활성. 잠긴 상태에서 외부 에이전트가 plan 수정 시도해도 무시(AGENTS.md). "잠금 해제" 복귀. 여러 plan 칩 전환(잠긴 건 뒤·🔒).
4. **변경 diff** — 삭제된 파일 선택 시 "삭제됨" 안내(에러 X). `!`/캐시·redacted 파일이 목록에 안 뜸. 우상단 "모두 검토 완료". 파일이 **일지 제목 + plan 칩** 아래로 묶여 표시(일지 제목 클릭 → 작업 일지로 이동), 미귀속은 "미기록 변경".

> 그룹화(#3)는 캐시(`oculpm_journal_files`/`oculpm_plan_item_updates`)에 데이터가 있어야 보임 — 일지/plan 이 일부 파일을 touched 한 프로젝트에서 확인.

---

## 4. 후속 / 한계

- 그룹화는 파일별 **최신 일지 1개**에만 귀속(다대다 단순화). 한 파일을 여러 일지가 건드린 이력은 모달/일지 화면에서.
- plan 잠금 상태 = `done`(아카이브 분리 안 함). 추후 `archived` 별도 노출 가능.
- DMG 미서명 — 첫 실행 "손상됨" 시 우클릭→열기.
