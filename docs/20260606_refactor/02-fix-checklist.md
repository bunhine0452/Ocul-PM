<!-- schema_version: 1 -->
# 02. 수정사항 기록부 — PR-R DoD · 진행 상태 · 변경 기록

> 본 문서의 위상: 배포-실용성 라운드의 *진행 추적표 + 변경 로그*.
> 각 PR-R 의 머지 시점에 해당 행을 ✅ 로 갱신 + §9 변경 기록에 한 줄 추가.
> 직전 라운드 [`../Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md`](../Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md) 와 같은 형식.

---

## 0. 잠금 결정 (진행 중 추가)

> 본 라운드 진행 중 확정되는 결정을 여기 기록. (직전 라운드 §0 의 Decision A~J 형식.)
> 작성 시점(2026-06-06)엔 [`00-refactor-master-plan.md`](./00-refactor-master-plan.md) §4 의 R1~R6 이 *제안* 상태 — 사용자 확인 시 아래로 승격.

| 결정 | 상태 | 잠금값 |
|---|---|---|
| R1 — 죽은 컨트롤은 연결 or 제거 (비활성 유지 금지) | ✅ 잠금 | 사용자 결정(2026-06-06): **셋 다 실제로 동작하게 구현** (제거 아님). A4=수동일지 모달 ✅ / A2=심볼·정확 검색 실연동 / A3=AI 대화 기록 실연동 |
| R2 — Today "다음 할 일" 은 연결 | ✅ 잠금 | 상위 5개 미완료 subtask, in_progress goal 우선 (`useNextTasks`) — A1 구현 완료 |
| R3 — ~~코드 검색 심볼/정확 칩 제거~~ → **실연동** (reversal) | ✅ 잠금 | 사용자 결정: 칩 제거 대신 심볼/정확 검색을 실제 구현. 심볼/정확 검색 command 가 없어 **신규 백엔드 필요** (§3.5 허용). 별도 PR-R1b 로 분리 검토 |
| R4 — 온보딩 = StartScreen 인라인 가이드 | ⬜ 제안 | — |
| R5 — entry-diff PR-R3 머지 + fallback/안내 | ⬜ 제안 | — |
| R6 — 시각 마감 = PR-UI 8b 변수 remap 패턴 계승 | ⬜ 제안 | — |

### 0.x (진행 중 추가될 결정 — 작성 슬롯)

> 예: `- **Decision R-A — …** 근거 …` 형식으로 PR 진행 중 추가.

---

## 1. Phase A — Foundation

### PR-R0 — 회귀 보호망 확인 + 베이스라인

| 체크 | 항목 |
|---|---|
| ☑ | 현 게이트 green 재확인: `pnpm typecheck` / `pnpm test`(90 pass) / `pnpm lint` / `pnpm build` |
| ☑ | 시각 잠금 invariant 재확인 (grep): `dark:` 0 · `classList.toggle("dark")` 0 · `from "lucide-react"`(Icons 제외) 0 · 토큰 격리(ShellV2 청크 분리) |
| ☑ | `pre-refactor` annotated git tag (`2990b19`) — 롤백 보존 |
| 🔄 | [`01-problems-inventory.md`](./01-problems-inventory.md) 의 P0/P1 항목을 사용자와 확인 → §0 결정 잠금 (R2 잠금, R1/R3/R5 대기) |

---

## 2. Phase B — 정직성

### PR-R1 — 죽은 / 미완성 UI 표면 정리

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☑ | Today "다음 할 일" → Planner 미완료 subtask 상위 N 개 연결 (빈 상태만 힌트) — `useNextTasks` + `.next-item` 버튼, +2 test | A1 |
| ☑ | 작업 일지 ⌘N → ui_v2 수동 일지 모달 신규 (`ManualEntryModalV2`, `.set-modal--wide`) + Toolbar "새 일지" 버튼, `oculpmCreateManualEntry`(기존 backend), +3 test | A4 |
| ☐ | 코드 검색 심볼/정확 검색 **실연동** (reversal — 제거 아님). 신규 백엔드 command 필요 → PR-R1b 분리 검토 | A2 |
| ☐ | AI 패널 "대화 기록" **실연동** (기존 `conversationList`/`chatMessageList`/`conversationDelete`) | A3 |
| ☑ | 시각 잠금 유지 (grep 게이트 §8) — A1/A4 변경 줄 `dark:`/lucide직접/localStorage 0 |
| ☑ | `pnpm typecheck` / `pnpm test`(93 pass) / `pnpm lint` / `pnpm build` green (A1/A4 백엔드 무변경) |

### PR-R2 — 첫 실행 / 온보딩 / 빈 상태

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☐ | StartScreen 핵심 루프 3 단계 가이드 카드 (프로젝트 추가 → AGENTS.md 규칙 주입 → 평소처럼 에이전트 코딩 → 일지 자동 기록) | C1 |
| ☐ | "프롬프트 복사" / "AGENTS.md 재동기화" 의미 툴팁 (동작 차이 명시) | C1 |
| ☐ | 첫 일지 0 건 시 Today 빈 상태 CTA (터미널 ⌘6 / 프롬프트 복사 유도) | C2 |
| ☐ | AI 패널 첫 진입 시 키 미설정 CTA / 외부 에디터 실패 토스트 | C3 |
| ☐ | 시각: 추가 UI 가 ui_v2 토큰 사용 (StartScreen 은 §PR-R4 와 조율) |
| ☐ | `pnpm typecheck` / `pnpm test` / `pnpm lint` green |

---

## 3. Phase C — 견고성

### PR-R3 — 핵심 데이터 루프 (백엔드 격리 PR)

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☐ | `feat/entry-diff-history` (`5d6cd90`) main 머지 | B1 |
| ☐ | entry-diff 빈 patch 처리: snapshot fallback 구현 **또는** 카드에 "diff 미캡처(커밋후/비-git)" 명시 안내 | B1 |
| ☐ | opener scope 점검: `capabilities/default.json` 가 임의 경로 커버 (`allow:[{path:"**"}]`) + opener 직접 호출 grep | B4 |
| ☐ | (백엔드 변경 시) `tauri-specta` 바인딩 재생성 + `cargo test` green |
| ☐ | watcher `is_self_suppressed` / journal cache 무효화 경로 무변경 또는 테스트 보호 |
| ☐ | `WorkspaceContext` schema 변경 시 additive/deletion-only + migrate 단위 테스트 |
| ☐ | `pnpm typecheck` / `pnpm test` / `cargo test` / `pnpm build` green |

---

## 4. Phase D — 마감

### PR-R4 — 시각 일관성 (PR-UI 8 이월분)

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☐ | StartScreen accent/hover 미스매치 튜닝 (대시보드=gray vs in-project=green) — PR-UI 8b Option 2 변수 remap 계승 | D1 |
| ☐ | 전역 오버레이(CommandPalette/dialog/MigrationModal) 톤 일관성 점검 | D1 |
| ☐ | grep `dark:` 0 · `classList.toggle("dark")` 0 유지 |
| ☐ | 라이트+다크 양쪽 dogfood 시각 비교 (mockup 없음 → 톤 정렬) |
| ☐ | `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` green |

### PR-R5 — 배포 위생 + 최종 dogfood + 1.0 태그

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☐ | D2Coding 폰트 subset/woff2 또는 manualChunks 분할 (번들 측정 전후 기록) | E1 |
| ☐ | ESLint(typescript-eslint + react-hooks) 추가 → `pnpm lint` 합류 **또는** 문서 정정 | E2 |
| ☐ | 2 일 dogfood — 새 유저 시나리오(설치→프로젝트→에이전트 1회→첫 일지) 무막힘 확인 |
| ☐ | [`00-refactor-master-plan.md`](./00-refactor-master-plan.md) §6 성공 기준 6 항목 전부 ☑ |
| ☐ | 치명 회귀 0 확인 후 `v1.0.0-rc` (또는 합의된) annotated tag |
| ☐ | 게이트 전부 green |

---

## 5. 운영 — 진행 중 새 결정의 흐름

본 라운드 진행 중 새 결정 발생 시:
1. [`02-fix-checklist.md`](./02-fix-checklist.md) §0 에 새 항목 추가 (Decision R-x).
2. 영향 받는 [`00-refactor-master-plan.md`](./00-refactor-master-plan.md) / [`01-problems-inventory.md`](./01-problems-inventory.md) 동기화.
3. §9 변경 기록에 한 줄.

이 3 단이 *한 PR 내* 에서 끝나지 않으면 결정은 *잠금 안 됨*.

---

## 6. 비상 — 회귀 발생 시

| 단계 | 처리 |
|---|---|
| PR-R0~R2 회귀 (UI/온보딩) | 해당 PR revert. ui_v2 셸 무영향 (additive 표면). |
| PR-R3 회귀 (백엔드) | `pre-refactor` 태그 기준 백엔드만 cherry-revert. entry-diff 는 다시 feat 브랜치로 격리. |
| PR-R4 회귀 (시각) | App.css 변수 remap 만 revert (레이아웃 무변경이라 격리 쉬움). |

---

## 7. 진행 상태 (2026-06-06 작성 시점)

| PR-R | 상태 | 머지 해시 |
|---|---|---|
| R0 — Foundation (보호망+태그) | ✅ done | `pre-refactor` 태그 (2990b19) |
| R1 — 죽은/미완성 UI 정리 | 🔄 진행중 (A1 ✅ A4 ✅ · A3 다음 · A2→PR-R1b) | — |
| R2 — 첫 실행/온보딩 | ⬜ todo | — |
| R3 — 데이터 루프 견고성 | ⬜ todo | — |
| R4 — 시각 일관성 마감 | ⬜ todo | — |
| R5 — 배포 위생 + 1.0 | ⬜ todo | — |

각 PR 머지 시 상태(`⬜`→`✅`) + 해시 갱신.

---

## 8. PR 제출 직전 공통 체크리스트

머지 제안 전 *반드시* green:

```bash
pnpm typecheck   # TypeScript 오류 0
pnpm test        # vitest green
pnpm lint        # check-no-localstorage (R5 후 ESLint 합류)
cargo test       # 백엔드 변경 PR 만 — 시그니처/specta 변경 시 필수
pnpm build       # 토큰 격리 + 청크 확인
```

시각 잠금 grep (본인 변경 줄 0):
```bash
grep -rn "dark:" src/ --include="*.tsx" --include="*.ts" | grep -v "/legacy/" | grep -v "\.test\."   # 0
grep -rn 'classList.toggle("dark")' src/ | grep -v "/legacy/"                                          # 0
grep -rn 'from "lucide-react"' src/ | grep -v "Icons.tsx" | grep -v "/legacy/"                         # 0
```

수동 점검:
- [ ] 추가/수정 UI 가 ui_v2 토큰(`--bg-*`/`--text-*`/`--accent`/`--t-*`) + `@/components/Icons` + `useTheme`/`useWorkspace` 만 사용.
- [ ] 라이트+다크 양쪽 시각 정상.
- [ ] 백엔드 변경 시 호출부 전수 + specta 재생성 확인.
- [ ] 본 §7 진행표 + §9 변경 기록 갱신.

---

## 9. 변경 기록 (Changelog) — 머지마다 한 줄 추가

> 형식: `- YYYY-MM-DD · PR-Rn · <해시> · <한 줄 요약> (문제 ID 들)`

<!-- 여기에 fix 가 머지될 때마다 한 줄씩 추가 -->
- 2026-06-06 · PR-R0 · `2990b19`(tag `pre-refactor`) · 베이스라인 태그 + 게이트/시각잠금 재확인
- 2026-06-06 · PR-R1 · A1: Today "다음 할 일" → Planner 미완료 subtask 연결 (`useNextTasks` + `.next-item` 버튼 리셋 + today_v2 테스트 2건) (A1)
- 2026-06-06 · PR-R1 · A4: 작업 일지 ⌘N 수동 일지 모달 (`ManualEntryModalV2` ui_v2 토큰 + `.set-modal--wide` + "새 일지" 버튼, 기존 `oculpmCreateManualEntry`, journal_v2 테스트 3건) (A4)
- 2026-06-06 · 결정 · 사용자: A2(검색 심볼/정확)·A3(AI 대화기록)을 **제거 대신 실연동**. R3 reversal. A2 는 신규 백엔드 필요 → PR-R1b.
