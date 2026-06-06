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
| R3 — ~~코드 검색 심볼/정확 칩 제거~~ → **실연동** (reversal) | ✅ 완료 | 신규 백엔드 `search_text`/`search_symbols` + SearchScreenV2 3-scope. 심볼=AST 인덱스, 정확=chunk content LIKE (의미검색과 동일 커버리지) |
| R4 — 온보딩 = StartScreen 인라인 가이드 | ✅ 완료 | 별도 풀스크린 마법사 아님. 프로젝트 0개일 때 "이렇게 동작해요" 3단계 카드 (StartScreen) + Today 빈 상태 터미널 CTA |
| R5 — entry-diff PR-R3 머지 + fallback/안내 | ✅ 완료 | 사용자 결정: **snapshot fallback 구현**(안내만 아님). git 빈 → file_snapshots baseline↔disk diff. 라이브 diff baseline 은 미advance(읽기전용) |
| R6 — 시각 마감 = ~~remap~~ → **변수 rename 으로 근본 해소** | ✅ 완료 | 8b 가 미룬 `--accent` 이름충돌을 raw shadcn 변수 개명(`--accent-surface`)으로 제거. remap 보다 깔끔 — in-project 오버레이가 ui_v2 와 동일 중립 hover |

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
| ☑ | 코드 검색 심볼/정확 검색 **실연동** (reversal — 제거 아님). 신규 백엔드 `search_text`(chunks LIKE)/`search_symbols`(symbol_definitions LIKE) + `SymbolSearchResult` 타입 + specta 재생성. SearchScreenV2 3-scope 분기, tools_v2 테스트 +2 | A2 |
| ☑ | AI 패널 "대화 기록" **실연동** — `ConversationHistoryModal`(목록/전환/새 대화/삭제), 기존 `conversationList`/`chatMessageList`/`conversationCreate`/`conversationDelete`, +6 test | A3 |
| ☑ | 시각 잠금 유지 (grep 게이트 §8) — A1/A4 변경 줄 `dark:`/lucide직접/localStorage 0 |
| ☑ | `pnpm typecheck` / `pnpm test`(93 pass) / `pnpm lint` / `pnpm build` green (A1/A4 백엔드 무변경) |

### PR-R2 — 첫 실행 / 온보딩 / 빈 상태

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☑ | StartScreen 핵심 루프 3 단계 가이드 카드 (폴더 추가 → AGENTS.md 규칙 주입 → 평소처럼 에이전트 코딩 → 자동 기록). *프로젝트 0개일 때만* 표시 — 신규 유저 정조준. "직접 기록 안 해도 된다" 수동 모델 명시 | C1 |
| ☐→이연 | "프롬프트 복사" / "AGENTS.md 재동기화" 툴팁 — 해당 버튼은 legacy OculpmSettings(shadcn deep) 표면. PR-R4(레거시 re-skin) 와 함께 | C1 |
| ☑ | 첫 일지 0 건 시 Today 빈 상태 CTA — "터미널에서 에이전트 실행" → ⌘6 terminal nav | C2 |
| 🔵 | AI 패널 키 미설정 CTA = *기존에 이미 구현됨*(`keysResolved && !anyKey` → "설정에서 키 추가 →"). 외부 에디터 실패 토스트는 P2 이연 | C3 |
| ☑ | 시각: StartScreen 가이드는 shadcn 시맨틱 토큰 양식(일관) · Today CTA 는 ui_v2 토큰. `dark:`/arbitrary 색 0 | |
| ☑ | `pnpm typecheck` / `pnpm test`(104 pass) / `pnpm lint` / `pnpm build` green |

---

## 3. Phase C — 견고성

### PR-R3 — 핵심 데이터 루프 (백엔드 격리 PR)

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☑ | `feat/entry-diff-history` 머지 (라운드 브랜치로 `d765fd0` — main 은 라운드 머지 시. 충돌 1: journal_v2 mock 양쪽 유지) | B1 |
| ☑ | entry-diff 빈 patch 처리 = **snapshot fallback 구현** (사용자 결정). git diff 빈/비-git → `file_snapshots` baseline↔disk 를 `render_unified_diff` 로 캡처. watcher 가 async 로 스냅샷 prefetch→blocking capture 전달. entry_diffs 테스트 +2 | B1 |
| ☑ | opener scope 점검 = `capabilities/default.json` 이미 `opener:allow-open-path`/`allow-reveal-item-in-dir` 둘 다 `allow:[{path:"**"}]` (정상). journal 열기는 백엔드 우회 유지 | B4 |
| ☑ | `tauri-specta` 바인딩 재생성 (search + entry-diff 통합) + `cargo test`(229 lib pass) green |
| ☑ | watcher `is_self_suppressed`/journal cache 경로 무변경 (스냅샷 prefetch 만 추가, `file_snapshots` 는 *읽기 전용* — baseline advance 안 함 → 라이브 diff 무영향) |
| 🔵 | `WorkspaceContext` schema 무변경 (해당 없음) |
| ☑ | `pnpm typecheck` / `pnpm test`(105) / `cargo test`(229) / `pnpm build` green |

---

## 4. Phase D — 마감

### PR-R4 — 시각 일관성 (PR-UI 8 이월분)

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☑ | StartScreen accent/hover 미스매치 = **근본 해소(rename)**. App.css 의 raw shadcn `--accent`(중립) → `--accent-surface`, `--color-accent` 매핑만 repoint. ui_v2 의 녹색 `--accent`(tokens.css :root)와 *이름 충돌 제거* — 8b ⚠ 의 "dashboard=gray/in-project=green" 미스매치가 구조적으로 사라짐 | D1 |
| ☑ | 전역 오버레이(CommandPalette/dialog/MigrationModal/Select 등) — 모두 `bg-accent`→`--color-accent`→`--accent-surface`(중립) 경유라 일괄 일관. ui_v2 자체 hover(`--bg-hover`)와도 일치 | D1 |
| ☑ | grep `dark:` 0 · `classList.toggle("dark")` 0 유지. tokens.css↔App.css 충돌 변수 = `--accent` 단 1개였음(확인), 그 외 충돌 0 |
| 🔄→사용자 | 라이트+다크 dogfood 시각 비교 — 일관성은 CSS 아키텍처로 보장(픽셀 무관). 최종 눈 확인은 dogfood |
| ☑ | `pnpm typecheck` / `pnpm test`(105) / `pnpm lint` / `pnpm build` green |

### PR-R5 — 배포 위생 + 최종 dogfood + 1.0 태그

| 체크 | 항목 | 문제 ID |
|---|---|---|
| ☑ | D2Coding 폰트 subset+woff2 — **8.4 MB .ttc → 440 KB woff2** (Latin+한글+박스드로잉+CJK구두점 유지, pyftsubset). dist/assets 12.7M→4.3M. .ttc 번들 제거 | E1 |
| ☐→보류 | ESLint 추가 = **의식적 보류**. 출시 직전 전면 lint 도입은 레거시 포함 대량 위반 노출 → 회귀 위험. 현 `lint=check-no-localstorage` 가 의도된 상태이며 REFACTOR-MASTER-PROMPT §8 에 정확히 기술됨. ESLint 는 1.1 | E2 |
| ☐→사용자 | 2 일 dogfood — 새 유저 시나리오(설치→프로젝트→에이전트 1회→첫 일지) 무막힘 확인 |
| 🔄 | [`00-refactor-master-plan.md`](./00-refactor-master-plan.md) §6 성공 기준 — 코드 항목 ☑, dogfood/태그 사용자 |
| ☐→사용자 | 치명 회귀 0 확인 후 `v1.0.0-rc` (또는 합의된) annotated tag |
| ☑ | 게이트 전부 green (typecheck/test 105/lint/build, cargo 229) |

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
| R1 — 죽은/미완성 UI 정리 | ✅ done | A1·A4·A3·A2 전부 실연동 (비활성 컨트롤 0) |
| R2 — 첫 실행/온보딩 | ✅ done (C1·C2 / C3 P2 이연) | — |
| R3 — 데이터 루프 견고성 | ✅ done | entry-diff 머지 `d765fd0` + snapshot fallback + opener 검증 |
| R4 — 시각 일관성 마감 | ✅ done | D1 근본 해소: shadcn raw `--accent`→`--accent-surface` 개명으로 ui_v2 녹색 `--accent` 와 충돌 제거. 최종 눈 확인은 dogfood |
| R5 — 배포 위생 + 1.0 | 🔄 E1 ✅ (폰트 8.4MB→440KB) · E2 보류(ESLint 1.1) · dogfood+1.0 태그 = 사용자 | — |

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
- 2026-06-06 · PR-R1 · A3: AI 패널 "대화 기록" 실연동 (`ConversationHistoryModal` — 목록/전환/새 대화/삭제, 기존 conversation_* backend, ai_history 테스트 6건) (A3)
- 2026-06-06 · PR-R1b · A2: 코드 검색 심볼/정확 실연동 — 신규 backend `search_text`/`search_symbols` + `SymbolSearchResult`(db.rs/project.rs/lib.rs, specta 재생성, cargo test green) + SearchScreenV2 3-scope + tools_v2 테스트 2건 (A2). **PR-R1 완결 — 비활성 컨트롤 0**
- 2026-06-06 · PR-R2 · C1: StartScreen 온보딩 가이드(프로젝트 0개 시 "이렇게 동작해요" 3단계 + 수동모델 명시) + start_screen 테스트 4건. C2: Today 빈 상태 "터미널에서 에이전트 실행" CTA + today_v2 테스트. (C3 AI키 CTA 는 기존 구현, 외부에디터 토스트 P2 이연)
- 2026-06-06 · PR-R3 · entry-diff 머지(`d765fd0`) + **snapshot fallback**(B1, 사용자 결정): git diff 빈/비-git 시 `file_snapshots` baseline↔disk 를 `render_unified_diff`(pub(crate))로 캡처. watcher async 스냅샷 prefetch→blocking capture. entry_diffs 테스트 +2, cargo 229 pass. opener scope(B4) 검증 OK(변경 불필요)
- 2026-06-06 · PR-R5 · E1: D2Coding 폰트 8.4MB .ttc → 440KB woff2 서브셋(한글+박스드로잉 유지). dist/assets 12.7M→4.3M. E2(ESLint) 1.1 보류.
- 2026-06-06 · PR-R4 · D1: App.css 의 shadcn raw `--accent`(중립) → `--accent-surface` 개명 + `--color-accent` repoint. ui_v2 녹색 `--accent`(tokens.css :root)와의 *이름 충돌* 근본 제거(8b ⚠ 해소) — in-project 오버레이가 대시보드·ui_v2 와 동일 중립 hover. 충돌 변수는 `--accent` 단 1개였음(검증). gates green, 시각잠금 0.
- 2026-06-06 · 릴리즈 준비 · 업데이트 알림(notifier — github_releases 재사용, app_info 버전 비교, 새 버전 시 우하단 배너+openUrl, 서명키 없음) + capabilities `opener:allow-open-url` + 버전 1.0.0(package/tauri.conf/Cargo) + README 설치/업데이트 섹션. update_banner 테스트 5건(test 110). 사용자 결정: notifier(자동설치 X) / 1.0.0 / draft 릴리즈. **남은 것: dogfood + 1.0 태그(사용자), E2 ESLint(1.1)**
