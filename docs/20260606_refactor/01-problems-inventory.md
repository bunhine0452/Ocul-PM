<!-- schema_version: 1 -->
# 01. 현재 문제점 인벤토리

> 본 문서의 위상: 2026-06-06 **코드 직접 검증**으로 발견한 미작동/미완성/마찰 지점의 카탈로그.
> 각 항목은 *심각도* · *근거(`file:line`)* · *제안 처리* 를 가진다.
> 처리 진행은 [`02-fix-checklist.md`](./02-fix-checklist.md) 의 PR-R 표에서 추적.

---

## 0. 심각도 기준

| 등급 | 의미 | 1.0 출시 |
|---|---|---|
| 🔴 **P0** | 새 유저가 핵심 가치를 못 얻거나, 명백한 고장으로 인식 | **차단** — 출시 전 필수 |
| 🟠 **P1** | 작동은 하나 혼란/마찰/거짓 약속 | 출시 전 권장 |
| 🟡 **P2** | 품질·부채. 출시엔 무방, 1.0 이후 가능 | 후속 |

검증 환경: branch `main`, 2026-06-06. 게이트 상태 = typecheck ✅ / test 89 pass·3 todo / lint ✅ / build ✅ (직전 라운드 PR-UI 0~8 완료 확인).

---

## A. 죽은 / 미완성 UI 표면 (사용자가 "버그"로 인식)

> 공통 원인: 직전 라운드(시각)에서 "구조는 목업대로 두고 데이터 연결은 후속 PR" 로 미뤘으나, 그 후속이 일부 누락됨.

### A1 🟠 — Today "다음 할 일" 블록이 영구 빈 칸

- **근거**: `src/features/today/NextTasks.tsx` — 컴포넌트가 `onOpenPlanner` 만 받고, 본문은 항상 *"Planner에서 목표와 다음 할 일을 관리하세요."* 빈 힌트만 렌더. 주석에 직접 *"the Planner subtask wiring lands in PR-UI 5 … so this block shows an empty hint"* 라 적혀 있으나, **PR-UI 5(✅ done)에서 실제 연결이 누락됨**. 호출부 `src/features/today/TodayScreenV2.tsx:222` 도 데이터 prop 없이 `<NextTasks onOpenPlanner={…} />` 만.
- **영향**: Today 6-블록 대시보드의 한 블록이 *항상 비어 있음*. 목업이 의도한 "다음 할 일 미리보기" 기능이 죽어 있음.
- **데이터 가용성**: Planner subtask 는 이미 실연동(`PlannerScreenV2` 의 `goalList`/`subtaskList`/`subtaskToggle`). 즉 **데이터는 있고 연결만 안 됨**.
- **제안 처리(R2)**: 상위 N 개(예: 3~5) 미완료 subtask 를 끌어와 표시. 빈 상태일 때만 현재 힌트.

### A2 🟡 — 코드 검색 "심볼" / "정확" 스코프 칩 비활성

- **근거**: `src/features/search/SearchScreenV2.tsx:18-26,143` — 백엔드가 의미 검색(semantic chunk)만 제공. 심볼/정확 칩은 `enabled: false` + `disabled` + `title="1.1 에서 지원 예정"`. (직전 라운드 §0.11 의도적 결정.)
- **영향**: 검색 화면 상단에 *항상 회색 비활성 칩 2 개*. 새 유저는 "이게 왜 안 눌리지?" → 미완성 인상.
- **제안 처리(R3)**: 1.0 엔진이 없으므로 **칩 제거**(단일 "의미 검색"). `searchScope` 영속 키는 유지(1.1 재도입 대비) 또는 정리. 사용자 확인 필요.

### A3 🟡 — AI 패널 "대화 기록" 버튼 비활성

- **근거**: `src/features/chat/AiPanelScreenV2.tsx:274` — `<button className="btn" disabled title="대화 기록 (1.1)">`.
- **영향**: 동작하지 않는 버튼 노출. (provider 칩의 disabled 는 "키 없음" 안내라 정직 — 별개.)
- **제안 처리(R1)**: 1.0 에서 대화 기록 미제공이면 **버튼 제거**, 제공하면 연결. 사용자 확인.

### A4 🟠 — 작업 일지 ⌘N (수동 일지 작성) 미연결

- **근거**: `JournalScreenV2.tsx` 에 ManualEntry / ⌘N 핸들러 grep 0. 직전 라운드 §0.9 에서 *보류*("ManualEntryModal 이 레거시 shadcn 이라 ui_v2 토큰 셸에 못 끼움"). 그러나 단축키 매트릭스([05-impl §1.2])에는 *작업 일지 = ⌘N(수동 entry)* 로 **공식 명시**됨.
- **영향**: 문서·단축키표가 약속한 기능이 동작하지 않음. ui_v2 모달 패턴은 PR-UI 6 에서 이미 정립됨(`.set-modal` 패턴) — 더 이상 "패턴 부재"가 핑계 아님.
- **제안 처리(R1)**: PR-UI 6 의 ui_v2 모달 패턴으로 수동 일지 모달 신규 + ⌘N 연결, 또는 단축키표에서 ⌘N 삭제(정직). 전자 권장.

---

## B. 핵심 데이터 루프 견고성 (프로젝트 → AGENTS.md → 에이전트 → UI → diff)

### B1 🟠 — entry-diff: 비-git·커밋 후 작성 시 빈 patch → 조용히 미기록 (+ main 미머지)

- **근거**: `feat/entry-diff-history` 브랜치 `src-tauri/src/oculpm/entry_diffs.rs`. diff 캡처가 `git diff HEAD -- path` 기반 → **비 git 프로젝트, 또는 에이전트가 커밋까지 마친 뒤 작성된 일지**는 patch 가 비어 미기록. snapshot fallback(`compute_diff` 의 snapshot 경로)은 *의도적 미구현* (설계 한계로 기록됨).
- **상태**: 커밋 `5d6cd90` **main 미머지** (현재 feat 브랜치에만).
- **영향**: "변경 diff 영구 기록" 이 케이스에 따라 *조용히* 비어 있음 → 사용자는 "왜 어떤 일지는 diff 가 없지?" 혼란.
- **제안 처리(R5)**: PR-R3 에서 (1) snapshot fallback 구현, 또는 (2) 빈 patch 시 카드에 *"이 일지는 변경 diff 가 캡처되지 않았습니다(커밋 후 작성/비-git)"* 명시 안내. 둘 중 하나 + main 머지.

### B2 🟡 — 과거 일지 백필 불가

- **근거**: entry-diff 는 *인덱싱 시점* 캡처. 기능 도입 이전 일지는 diff sidecar 없음(백필 경로 없음).
- **영향**: 기존 사용자의 과거 일지는 영구히 diff 없음. (신규 배포 유저는 무영향 — 처음부터 적용.)
- **제안 처리**: 1.0 신규 유저엔 무영향이라 **P2**. 안내 문구로 충분.

### B3 🟡 — session 종료 탐지가 fs idle 기반만

- **근거**: 외부 LLM 과 통신 채널 없음 → 4 trigger(InactivityTimeout/WorkdayBoundary/Manual/AppQuit) + resume grace 15 분. ([memory: dogfooding-w4-findings-2026-05-27] 발견 15)
- **영향**: 구조적 한계. 짧은 idle 후 재진입은 resume 으로 흡수되나, 경계 케이스에서 session 분리/병합이 직관과 다를 수 있음.
- **제안 처리**: 측정 후 결정. 1.0 차단 아님 — **P2**. journal-write 시그널을 추가 trigger 로 쓸지 dogfood 에서 판단.

### B4 🟠 — opener scope 재발 패턴 (임의 파일 열기)

- **근거**: [memory: opener-scope-recurring] — Tauri v2 `tauri-plugin-opener` scope 가 fs glob AND program 매칭을 동시 요구. 과거 2 회 재발(1차 권한추가 무효 → 2차 객체형식+`allow:[{path:"**"}]`). journal 파일 열기는 백엔드 우회(`oculpmApi.openEntryInEditor`)로 회피 중. **diff 화면의 "외부 에디터 열기"** 는 `commands.openInEditor` 사용(§0.10).
- **영향**: 배포 빌드의 capabilities scope 가 사용자의 *임의 프로젝트 경로* 를 커버하는지 재확인 필요. 누락 시 "외부 에디터 열기" 가 조용히 실패.
- **제안 처리(R3)**: `src-tauri/capabilities/default.json` scope 가 `**` 인지 점검 + 비-홈 경로/외장 디스크 케이스 dogfood. opener 직접 호출 잔존 grep.

---

## C. 첫 실행 / 온보딩 (배포 실용성의 핵심)

### C1 🔴 — StartScreen 에 핵심 가치 루프 안내 부재

- **근거**: `src/features/onboarding/StartScreen.tsx` (284줄) — 프로젝트 목록 + "새 프로젝트 시작하기"(Greenfield Wizard) 버튼 위주. *"이 앱이 무엇을 하는가 / 외부 에이전트가 AGENTS.md 로 일지를 남긴다 / 그래서 너는 평소처럼 에이전트로 코딩만 하면 된다"* 라는 **핵심 멘탈 모델 안내가 없음**.
- **영향**: 🔴 처음 받은 유저가 프로젝트를 추가해도 *빈 Today* 만 보고 "그래서 뭘 하라는 거지?" 에서 이탈. 이 앱은 *직접 뭘 입력하는* 도구가 아니라 *에이전트 작업을 수동(passively) 기록*하는 도구라, 그 수동성 자체가 설명 없이는 "고장"으로 보임.
- **dogfooding 증거**: 사용자조차 "AGENTS.md 재동기화" 버튼을 *LLM 채팅에 프롬프트 재주입* 으로 오인([dogfooding-w4-findings-2026-05-26] 발견 3). 만든 사람도 오인했으면 처음 받는 사람은 더 모름.
- **제안 처리(R4)**: StartScreen 에 *핵심 루프 3 단계 카드*(① 프로젝트 추가 → ② ai-pm 이 AGENTS.md 규칙을 에이전트에 심음 → ③ 평소처럼 에이전트로 코딩하면 일지가 쌓임) + "프롬프트 복사"/"AGENTS.md 재동기화" 의 의미 툴팁.

### C2 🟠 — 빈 상태(empty state) 가 "다음 행동"을 가리키지 않음

- **근거**: 프로젝트 추가 직후 ~ 첫 일지 생성 전까지 Today/작업 일지가 비어 있음. 빈 힌트는 있으나(예: NextTasks) *행동 유도*(CTA)로 이어지지 않음.
- **영향**: C1 의 연장. "프로젝트는 추가했는데 아무것도 안 보인다 → 외부 에이전트를 *지금 실행하면 된다*" 라는 다음 행동이 화면에 없음.
- **제안 처리(R4)**: 첫 일지 0 건일 때 Today 에 *"터미널을 열어 평소 쓰던 에이전트를 실행해보세요"* + ⌘6 터미널 링크 / "프롬프트 복사" CTA.

### C3 🟡 — API 키 / 외부 에디터 미설정 시 마찰

- **근거**: AI 패널 provider 칩은 키 없으면 "키 없음" + "설정(⌘,)에서 추가" 안내(정직, OK). 단 *최초 진입 동선*에서 키 설정으로의 유도는 약함. 외부 에디터 명령 기본값(`code "%path"`)이 `code` 미설치 시 조용히 실패 가능.
- **제안 처리**: P2. AI 패널 첫 진입 시 키 설정 CTA, 외부 에디터 실패 시 토스트.

---

## D. 시각 일관성 잔재 (직전 라운드 PR-UI 8 이월)

### D1 🟠 — StartScreen / 전역 오버레이가 shadcn 구조 (톤 미스매치)

- **근거**: 직전 라운드 [05-impl §0.13 Decision J + §8b] — ui_v2 8 화면은 token-pure 하나, **StartScreen(대시보드) + 전역 오버레이(Settings 모달 잔여·CommandPalette·rename/delete dialog·MigrationModal)** 는 shadcn 레이아웃 유지(8b 에서 변수 *값* 만 ui_v2 팔레트로 remap). 체크리스트 8b 의 ⚠: *"dashboard accent=gray / in-project 오버레이=green 미스매치, dogfood 후 조정"*.
- **영향**: 앱 진입 첫 화면(StartScreen)과 in-project 셸의 톤이 미묘하게 다름. 첫인상 일관성 저하.
- **제안 처리(R6)**: PR-UI 8b 의 "Option 2 변수 remap" 패턴으로 accent/hover 미스매치 튜닝. 새 mockup 없음 → dogfood 비교.

### D2 🟡 — legacy 36 파일 잔존 (dead)

- **근거**: `src/legacy/` 36 ts/tsx. live(68)는 이들을 import 안 함(직전 라운드 PR-UI 7/8a 에서 이동). 번들 영향 0(`tsconfig` exclude).
- **영향**: 유지보수 부채. 출시 무관.
- **제안 처리**: P2. 1.0 이후 정리 또는 영구 보존(롤백 자료).

---

## E. 배포 체감 — 성능 / 번들 / 빌드 위생

### E1 🟡 — 번들에 8.4MB 폰트 + 500kB 초과 청크

- **근거**: `pnpm build` 출력 — `D2Coding-*.ttc` **8,410 kB** 단일 파일, `index-*.js` 768 kB, `ShellV2-*.js` 356 kB. Vite 가 chunk > 500kB 경고.
- **영향**: 데스크톱 Tauri 라 *네트워크* 다운로드는 아니나(번들 내장), 앱 바이너리 크기·초기 로드 체감에 영향. D2Coding 전체 ttc 가 가장 큼.
- **제안 처리(R7)**: D2Coding subset(필요 글리프만) 또는 woff2 변환, manualChunks 분할 검토. 측정 후 결정.

### E2 🟡 — `pnpm lint` 가 storage 검사만 (ESLint 부재)

- **근거**: `package.json` — `"lint": "pnpm lint:storage"` (= `check-no-localstorage.mjs` 만). UI-MASTER-PROMPT §8 은 *"ESLint + lint:storage"* 라 적었으나 실제 ESLint 스텝 없음.
- **영향**: 미사용 import/var, hook 규칙 위반 등이 게이트를 빠져나감. 코드 품질 안전망 약함.
- **제안 처리(R7)**: ESLint(typescript-eslint + react-hooks) 추가하여 `lint` 에 합류. 또는 문서를 실제와 일치하게 정정. 사용자 확인.

---

## F. 요약 표 (심각도순)

| ID | 심각도 | 한 줄 | 제안 PR |
|---|---|---|---|
| C1 | 🔴 P0 | StartScreen 핵심 가치 루프 안내 부재 | PR-R2 |
| A1 | 🟠 P1 | Today "다음 할 일" 영구 빈 칸 (Planner 미연결) | PR-R1 |
| A4 | 🟠 P1 | 작업 일지 ⌘N 수동 일지 미연결 (단축키표는 약속) | PR-R1 |
| B1 | 🟠 P1 | entry-diff 비-git·커밋후 미기록 + main 미머지 | PR-R3 |
| B4 | 🟠 P1 | opener scope 재발 — 임의 파일 열기 점검 | PR-R3 |
| C2 | 🟠 P1 | 빈 상태가 다음 행동을 안 가리킴 | PR-R2 |
| D1 | 🟠 P1 | StartScreen/오버레이 shadcn 톤 미스매치 | PR-R4 |
| A2 | 🟡 P2 | 코드 검색 심볼/정확 칩 비활성 | PR-R1 |
| A3 | 🟡 P2 | AI "대화 기록" 버튼 비활성 | PR-R1 |
| B2 | 🟡 P2 | 과거 일지 diff 백필 불가 (신규 유저 무관) | (안내) |
| B3 | 🟡 P2 | session 종료 탐지 fs idle 의존 | (측정) |
| C3 | 🟡 P2 | API 키/외부 에디터 미설정 마찰 | PR-R2 |
| D2 | 🟡 P2 | legacy 36파일 dead | (후속) |
| E1 | 🟡 P2 | 8.4MB 폰트 + 500kB+ 청크 | PR-R5 |
| E2 | 🟡 P2 | lint=storage만 (ESLint 부재) | PR-R5 |

**P0 1 건 · P1 6 건 · P2 8 건.** P0 + P1 이 1.0 출시 게이트.
