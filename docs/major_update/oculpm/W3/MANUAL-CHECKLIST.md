# W3 — 사용자 직접 확인 체크리스트

> **누가 이걸 보나**: 이 프로젝트 owner (= 너) 가 W3 종료를 선언하기 전, `pnpm tauri dev` 한 번 돌리면서 손으로 검증해야 하는 모든 항목을 한 곳에 모은 문서.
> **왜 한 곳에 모았나**: PR1~PR10 의 워킹 문서 각자에 흩어져 있는 "수동 QA" 항목 + phase 의 §5/§7/§8 + PR9 dogfooding 5+ entry 작성 요구를 한 줄짜리 체크리스트로 묶으면 한 번의 dev 실행으로 한 번에 처리 가능.
> **소요 시간 가이드**: 약 60~90 분 (시드 entry 5개 작성 포함). dogfooding 회고는 별도 작성.
> **소스**: [`phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §5/§7/§8, 본 폴더의 PR9-dogfooding-bootstrap.md, PR1~PR10 각자의 §5/§7 수동 QA 매핑.

---

## 0. 사전 준비 (10 분)

- [ ] working tree 가 clean (`git status` 깨끗). 미커밋 W3 작업이 있으면 먼저 커밋.
- [ ] `pnpm install` — 새 의존성 없음, lockfile 만 확인.
- [ ] `pnpm exec tsc --noEmit` — 0 errors (PR4~PR10 마지막 상태에서 확인됨).
- [ ] `pnpm build` — green.
- [ ] `pnpm lint:storage` — green (W3 의 4개 ocul-pm 파일이 ALLOWLIST 에 등록되어 있어야 함).
- [ ] `cd src-tauri && cargo check` — 0 errors.
- [ ] `cd src-tauri && cargo test --lib oculpm` — 130+ test green (PR2 이후 baseline).
- [ ] `pnpm tauri dev` 띄우고 빈 화면이 정상 진입하는지 확인.
- [ ] **워처 수동 시작 (W3 한정 우회)** — 프로젝트 선택 후 devtools 콘솔 (⌥⌘I) 에서 1회 실행:
  ```js
  await window.__TAURI__.core.invoke("oculpm_watcher_start", { projectId: <확인한 projectId> })
  ```
  → `ls .oculpm/index/<오늘>/` 에 `file_changes.ndjson` 이 생기면 정상.
  > **왜 수동인가**: W3 시점에 frontend 가 프로젝트 open 시 `oculpmInit` 만 자동 호출하고 `watcherStart` 는 호출 안 함 (실제 dogfooding 으로 발견된 누락). 별 PR 분량이라 W3 안에서는 수동 우회. 본 checklist §1.6 #11 / §3 #2 / §1.10 모두 이 단계가 선행되어야 검증 가능.

### 검증용 프로젝트 두 개

| 프로젝트 | 용도 |
|---|---|
| **A — 신규** | Greenfield 위저드 (PR10) + Onboarding (PR5) + EmptyToday V1/V2 (PR5) 확인. 검증 끝나면 폴더째 삭제 가능. |
| **B — 기존** | 본인 작업용 프로젝트 (= ai-pm 자체 또는 다른 repo). EmptyToday V3 / Timeline / Detail / Filter / 시드 entry 작성에 사용. |

---

## 1. Phase §5 — 수동 QA 15 항목 (페이즈 가이드 §5 기준)

> 각 항목 옆 PR 번호는 충족 책임 위치. 실패 시 해당 PR 문서로 돌아가서 §5 매핑 표 확인.

### 1.1 Cache + 파일시스템 (PR2 / PR6)

- [ ] **#1** 손으로 `.oculpm/journal/<오늘>/Bugs/0900_bug_test.md` 생성 (frontmatter 최소셋 + 본문 1줄) → **1초 안에 Today 카드로 표시**.
- [ ] **#2** 그 파일 삭제 → **1초 안에 카드 사라짐**.
- [ ] **#3** 파일 내용만 수정 (frontmatter 의 title 변경) → **카드 제목이 갱신** (페이지 새로고침 없이).

### 1.2 데이터 무결성 (PR1 / PR7)

- [ ] **#4** frontmatter 일부러 깨뜨림 (예: `type: ` 빈 값) → **카드에 노란 ⚠ dot** + **JournalEntryDetail 우측에 destructive 카드 ("frontmatter 파싱 실패")** + `[원본 열기]` 버튼은 그대로 동작.

### 1.3 필터 (PR8)

- [ ] **#5** 5개 type chip 모두 토글 OK — `bug`/`feature`/`error`/`refactor`/`chore` 각각 활성화 시 해당 type 만 표시, "전체" chip 클릭 시 전체 표시.
- [ ] **#6** 검색 input 에 "export" (또는 본인 entry 의 한국어/영어 substring) 입력 → 매 키스트로크에 fetch 가 트리거되지 않고 **200ms 후 1회만** backend 호출, 매치된 카드만 표시.

### 1.4 검증 토글 (PR3 / PR6 / PR7)

- [ ] **#7** entry 카드 hover → `[✓]` 버튼 노출 → 클릭 → 카드/디테일 양쪽 동시에 "검증됨" 으로 전환 → 터미널에서 `cat .oculpm/journal/<오늘>/.../해당파일.md | grep verified_by_user` 확인 → **`verified_by_user: true`**.
- [ ] 다시 클릭 → 미검증으로 되돌아가고 frontmatter 도 `false`.
- [ ] 다음 검증: JournalEntryDetail 우측 액션 버튼 (`검증됨 ✓ — 되돌리기` / `검증됨으로 표시`) 으로도 같은 동작.

### 1.5 키보드 (PR6)

- [ ] **#8** Today 화면에서 `j` / `k` → 다음/이전 entry 로 선택 이동.
- [ ] `space` → 선택된 카드의 verify 토글.
- [ ] `Esc` → 선택 해제.
- [ ] input/textarea 안에서는 모두 통과 (Manual entry modal 의 title 필드에서 `j` 가 그대로 입력됨).

### 1.6 EmptyToday 3 변형 (PR5)

> **신규 프로젝트 A** 에서 진행.

- [ ] **#9 — V1** `.oculpm/` 없는 새 프로젝트 진입 → "활성화" CTA 가 primary tone (border-primary/30). `[활성화]` 와 `[나중에]` 버튼.
- [ ] **#10 — V2** init 했는데 오늘 0개, file_changes 도 0개 → neutral tone (border-border bg-card). `[수동 entry 작성]` + `[어떻게 동작하나요?]` popover.
- [ ] **#11 — V3** init 했고 오늘 file_changes 있지만 journal 0개 → amber tone (border-amber-500/40). `[수동 entry 작성]` + `[⚖ index 비교 보기]` (disabled, tooltip "W4 페이즈").
  > **선행 조건**: §0 의 "워처 수동 시작" 을 했어야 file_changes 가 캡처됨. 안 했으면 file_changes=0 → V3 대신 V2 가 뜨는 게 정상 — 버그 아님. V3 강제 트리거: 워처 시작 후 코드 파일 1개 수정 → 새로고침.

### 1.7 Onboarding 흐름 (PR5)

- [ ] **#12** EmptyToday V1 의 `[활성화]` → OculpmOnboardingModal 3 step 완주 → activation 성공 → V2/V3 자동 전환 + `.oculpm/config.toml` / `.oculpm/journal/` 디렉토리 생성 확인 (`ls -la .oculpm/`).
- [ ] **#13** 활성화 거부 ([나중에] 클릭) → modal close → 상단 status bar 에 "ocul-pm 비활성화 — 활성화" 인라인 링크 표시 → Today 페이지 새로고침 시 modal **다시 안 뜸** (`localStorage["oculpm_dismissed_${projectId}"]` 확인 가능). 상단 링크는 그대로 유지.

### 1.8 라우팅 + 마이그레이션 (PR4)

- [ ] **#14** 앱 첫 실행 시 디폴트 탭이 **Today** (Code/Plan 등이 아님). 사용자가 명시적으로 다른 탭 선택 시 그 선택이 영속.
- [ ] **#15** 기존 사용자 (v1 storage) → devtools 의 `localStorage` 에서 `aipm:workspace:v1` 의 `schemaVersion: 2` + `activeView: "today"` (단, 사용자 override 없는 경우). 기존 12개 별도 키 (`selectedProjectId`, `activeTab` 등) 가 삭제되어 있어야 함.

### 1.9 보너스 (PR3)

- [ ] **#보너스** Manual entry modal 로 entry 작성 → 파일이 `.oculpm/journal/<오늘>/<TypeFolder>/<HHMM>_<type>_<slug>.md` 로 생성 + frontmatter 의 `agent.id == "manual"` 확인.

### 1.10 외부 에이전트 자동 narrative — **의도적 누락 (W4 검증)**

> Cursor / Claude Code / Antigravity / Gemini CLI 같은 외부 LLM 이 작업 후 자동으로 `.oculpm/journal/<오늘>/.../*.md` 를 생성하는 시나리오는 **W3 에서는 동작 안 함**. 이유 = 어댑터 규칙 파일 (`.agent/rules/ocul-pm.md` 등) 을 설치하는 W4-PR1/PR2 가 아직 안 들어옴.
>
> **W3 에서 확인 가능한 것**:
> - [ ] §0 의 워처 수동 시작 후 외부 에이전트 (예: Antigravity) 로 코드 파일 1개 수정 → `cat .oculpm/index/<오늘>/file_changes.ndjson` 에 줄 추가됨 (= 워처가 변경 캡처하는지).
> - [ ] 단, 그 변경은 Today UI 의 카드로는 보이지 않음 (카드는 journal entry 단위, file_changes 는 내부 데이터).
>
> **W3 에서 확인 불가 (W4 게이트)**:
> - 외부 LLM 이 자동 narrative `.md` 작성 → W4-PR9 의 게이트.
> - DiffVsNarrative 모달 (index ↔ journal 비교) → W4-PR5/PR6.
> - drift 토스트 → W4-PR4/PR8.

---

## 2. Phase §7 — Definition of Done (W3 전체)

| 항목 | 충족 위치 | 체크 |
|---|---|---|
| 모든 PR 의 DoD ✅ | PR1~PR10 각 워킹 doc 의 DoD 표 | [ ] |
| §5 의 수동 QA 15개 ✅ | 위 §1 | [ ] |
| 통합 테스트 `tests/oculpm_journal_indexing.rs` 5 시나리오 green | `cd src-tauri && cargo test --test oculpm_journal_indexing` | [ ] (deferred — W6 통합 테스트 PR 후보, 본 PR 들에는 미생성) |
| dogfooding 시드 entry 5+ 개 + 회고 `_dogfooding-w3.md` | 본 문서 §4 | [ ] |
| 시안 (§3) 과 실제 UI 80%+ 일치 | PR6/PR7/PR8 디자인 검수 | [ ] |
| `cargo test`, `cargo clippy`, `pnpm test`, `pnpm tauri build` 모두 green | 위 §0 사전 준비 + `cargo clippy` 1회 추가 | [ ] (Vitest `pnpm test` 는 W6 인프라 도입 위임) |

---

## 3. Phase §8 — W4 핸드오프 (5개)

W4 진입 직전 확인. 4개는 위 §1 항목과 겹치며, 마지막은 PR9 의 출력물.

- [ ] 손으로 작성한 journal 이 Today UI 에서 보임 (= §1.1 의 #1).
- [ ] cache 가 실시간 증분 갱신 — `oculpm:journal_path_changed` 이벤트가 watcher 에서 emit (devtools console 에서 listen 확인 또는 #1 동작으로 간접 확인).
- [ ] EmptyToday V3 가 살아있음 (= §1.6 의 #11).
- [ ] dogfooding 회고가 어댑터 템플릿 (`agents/_template.md`) 의 첫 draft 에 인용 가능한 형태 — = 본 문서 §4 의 회고 작성.
- [ ] 수동 entry 작성 모달이 동작 (= §1.9 의 #보너스). W4 의 자동화 실패 시 fallback.

---

## 4. PR9 — Dogfooding 시드 entries + 회고 (사용자 직접)

> 자세한 요구사항: [`./PR9-dogfooding-bootstrap.md`](./PR9-dogfooding-bootstrap.md).

### 4.1 5+ 시드 entry 작성

작성 방법 2가지 — **둘 다 시도** (각자의 마찰을 따로 채집):
1. **손으로 디스크에 .md 떨굼** (PR2 cache 가 1초 안에 인식) — 첫 entry 추천.
2. **`⌘+Shift+J` Manual entry modal** (PR6) — 나머지 4 entry 추천.

| # | type | 추천 주제 | 파일 | 작성 시간 | 비고 |
|---|---|---|---|---|---|
| 1 | feature | **(의무)** "Greenfield 위저드 → Today 자동 진입 흐름" | `.oculpm/journal/<오늘>/Features_to_add/...` | __분 | PR10 흐름 1회 수동 검증 + 그 경험 기록 |
| 2 | bug | **(권장)** "워처 자동 시작 wire-up 누락 — 외부 에이전트 파일 변경 미캡처" | `.oculpm/journal/<오늘>/Bugs/...` | __분 | 2026-05-24 실제 dogfooding 으로 발견 (본 checklist §0 참조). status 는 `planned` (W4 시작 직후 수정 예정). |
| 3 | bug | (자유 — W3 작업 중 실제 발견한 버그 1건) | | __분 | |
| 4 | feature | (자유 — W3 작업 중 본인이 추가한 기능) | | __분 | |
| 5 | refactor | (자유 — W3 작업 중 본인이 정리한 것) | | __분 | |

### 4.2 회고 파일 작성

위치: `docs/major_update/oculpm/phases/_dogfooding-w3.md` (페이즈 §5 와 동일 위치 — 페이즈가 SSOT).

각 entry 별 기록:
- 작성에 걸린 시간 (분).
- frontmatter 작성 시 헷갈렸던 필드 (예: `created_at` tz 형식, `slug` 길이, `files_touched.op` 의 enum, `agent` 가 mapping 인지 string 인지).
- 본문 강제 섹션이 자연스러웠는지 (예: `## 발생 원인` / `## 해결 방법` / `## 검증` 같은 헤더가 강제될 수 있는가? — W4-PR1 어댑터 템플릿의 강제 섹션 정책 입력).
- UI 가 잘못 표시한 케이스 (Card / Detail / Filter 어디서).

전체 회고:
- 가장 마찰이 큰 필드 top 3 → **W4-PR1 어댑터 템플릿에서 예시 강조 또는 default 자동 채움** 항목으로 직접 인용.
- 가장 마찰이 작은 패턴 → W4 어댑터의 권장 패턴.
- W3 의 UI 가 시안 (페이즈 §3) 과 얼마나 일치했는가 → **W4-PR6 의 DiffVsNarrative 디자인 입력**.
- PR10 의 Greenfield 흐름이 의도대로 동작했는가 → refactor-integration §3.1 의 R-13 / R-14 완화책 검증.

### 4.3 W4 진입 게이트

- [ ] `_dogfooding-w3.md` 파일 존재 + 시드 entry 5+ 개 + 각 entry 의 작성 시간/헷갈린 필드/UI 이슈 기록 완료.
- [ ] 전체 회고 섹션 (가장 큰 마찰 top 3, UI ↔ 시안 일치도, PR10 흐름 검증) 작성 완료.
- [ ] W4-PR1 의 PR 본문 작성 시 **본 회고를 최소 1건 인용** 하기로 메모 (W4 진입 시 검증).

---

## 5. 발견된 이슈 기록 양식

위 1~4 진행 중 발견한 모든 이슈를 여기에 한 줄씩 채운 뒤 PR / 이슈로 분기.

| 발견 | 영향 | 어디 보고? |
|---|---|---|
| 예) PR7 검증 토글 클릭 직후 카드의 미검증 ⚠ 가 한 박자 늦게 사라짐 | UX 마찰 (저) | W6 cleanup 후보로 적어두기 |
| | | |
| | | |
| | | |

---

## 6. 완료 선언 절차

위 §1, §2, §3, §4 의 모든 체크박스가 ✅ 인 경우만 다음 단계 진행:

1. `docs/major_update/oculpm/W3/README.md` 의 §5 / §7 / §8 표 갱신 (현재 ⬜ 인 항목들을 ✅ 로).
2. 페이즈 회고 채우기 (W3/README.md §페이즈 회고 — "예상 대비 실제 소요" / "발견된 함정 vs 가이드 예측" / "W4 로 넘기는 결정/주의" 3 항목).
3. W4 진입 — `docs/major_update/oculpm/W4/README.md` 의 PR1 부터.

미해결 항목이 있으면 **본 문서를 갱신해서** 무엇이 남았는지 명시한 뒤 W3 종료 보류.
