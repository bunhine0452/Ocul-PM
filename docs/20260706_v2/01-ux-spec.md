# v2 — UX 스펙 (U1·U2·U7·U8·U9·U13)

## §1. 내비게이션 단일 소스 + go-to-anything (U1, U7)

### 문제
- 팔레트(`CommandPalette.tsx:79-98`)가 today/journal/diff/planner/search/terminal/ai/graph 8개만 알고
  **discussion·retro·docs 가 빠짐** — 사이드바(`Sidebar.tsx:43-58`)와 이중 정의라 생긴 드리프트.
- `useGlobalShortcuts.ts:22-30` 의 ⌘1~7 이 사이드바 시각 순서와 불일치 (⌘3=diff 인데 3번째 표시 항목은 discussion).
- 사이드바 프로젝트 스위처가 "⌘P" 를 광고하지만 핸들러 없음 (`Sidebar.tsx:177`).
- 팔레트는 화면 전환+고정 액션만 — 일지/플랜/토의/문서 **제목으로 점프 불가**.

### 설계
1. **`src/lib/navRegistry.ts` 신설** — `NAV_ITEMS: { view, label, icon, group }[]` 단일 배열.
   사이드바·팔레트·단축키가 전부 이 배열에서 파생. ⌘1~9 는 배열 순서 자동 부여 —
   순서 불일치가 **구조적으로 재발 불가**.
2. **⌘P = 프로젝트 스위처**: 전역 단축키로 사이드바 팝오버 열기 (기존 팝오버 재사용,
   `open` 상태 끌어올리기). 죽은 힌트가 실제 기능이 된다.
3. **엔티티 점프 (U7)**: 팔레트 입력이 있으면 화면 내비 아래 "바로가기" 섹션에 백엔드
   `search_entities(project_id, query, limit)` 결과를 표시.
   - 대상: journal 제목(`title`/slug), planner 항목·플랜 제목, discussion 제목, docs 파일명.
   - 반환: `{ kind, id, title, subtitle(워크데이/경로), score }` — SQLite 캐시에서 LIKE
     prefix+substring 랭킹 (U11 FTS 도입 시 FTS 로 승격).
   - 선택 시 라우팅: journal→`uiV2View=journal`+`focusPath`, plan→planner+plan id,
     discussion→discussion+doc id, docs→docs+상대경로. 기존 크로스링크 라우팅(`ShellV2.tsx:120-130`) 재사용.
   - 디바운스 120ms, 최대 12건, 키보드 ↑↓/Enter 는 기존 팔레트 리스트 로직 공유.

## §2. 로딩·피드백 일관화 (U2)

- **Toaster**: `Toaster.tsx:31-35` 의 `bg-zinc-900`/`amber-950`/`red-950` 하드코딩을 CSS 토큰
  (`var(--panel)`, `var(--text)`, semantic accent) 기반으로 교체 — 라이트/다크/프리셋 전 테마 대응.
- **`<Skeleton>` 공용 컴포넌트** (`src/components/ui/Skeleton.tsx`): 이미 정의된
  `skelShimmer`(`screens.css:117-124`) 활용. `variant: line|card|block`, `reduced-motion` 시 정적.
- 적용 우선순위: Today(카드 그리드) · Journal(타임라인 행) · Planner(항목 리스트) 3화면의
  "불러오는 중…" 텍스트를 콘텐츠 형태 스켈레톤으로. 나머지 화면은 OculSpinner 유지 (일괄 교체는 비스코프).
- U6 lazy 분할의 Suspense fallback 도 동일 스켈레톤 사용.

## §3. 키보드 diff 검토 (U8 = 백로그 P1 축소판)

`DiffScreenV2.tsx` 에 키보드 레이어 추가 (화면 포커스 시에만, 입력 필드 포커스 중엔 무시):
- `j`/`k` — 파일 리스트에서 다음/이전 파일 선택 (선택 항목 스크롤 인투 뷰).
- `Enter` 또는 `o` — 선택 파일 diff 펼침/포커스.
- `/` — in-diff 검색 인풋 포커스 (신규 소형 인풋, 현재 파일 patch 내 매치 하이라이트), `n`/`N` 매치 이동, Esc 해제.
- 시각적 단서: 리스트 상단에 `j/k 이동 · o 열기 · / 검색` kbd 힌트 1줄.
- 검토 토글(x)·hunk 확장은 P2 검토 세션으로 이월 (백엔드 상태 필요).

## §4. 낙관적 업데이트 (U9)

`PlannerScreenV2.tsx` 상태 토글(`191-207` busy→await→`refreshPlans()`):
- 로컬 plans 상태를 즉시 갱신 (글리프/상태 변경), 백그라운드로 `planApplyEdit` 실행.
- 실패 시: 이전 상태 롤백 + `toast.destructive`.
- 성공 시: refetch 를 **하지 않는다** — 응답의 정규화된 plan 으로 해당 plan 만 치환
  (기존 커맨드가 plan 을 반환하지 않으면 대상 plan 만 `planGet` 1회).
- 추가/삭제/이름변경은 기존 경로 유지 (스코프 아웃 — 토글이 빈도 최다 경로).

## §5. 공유 Dialog 프리미티브 (U13)

### 문제
8곳이 각자 `fixed inset-0` 오버레이 구현 (팔레트, 설정 오버레이, App Dialog, AiOverlay,
ManualEntryModal, ConversationHistoryModal, ClarifyDialog, GreenfieldWizard, Discussion 모달).
공통 결함: **포커스 트랩 없음, 닫힐 때 트리거로 포커스 복원 없음**, 스크롤락/애니메이션 제각각.

### 설계
`src/components/ui/AppDialog.tsx` — 의존성 추가 없이 자체 구현 (Tab 순환 트랩 + 복원):
- props: `open, onClose, title?, width?, children, initialFocusRef?`.
- 동작: 열릴 때 `document.activeElement` 저장→내부 첫 포커서블(또는 initialFocusRef) 포커스,
  Tab/Shift+Tab 을 다이얼로그 내부에서 순환, Esc/백드롭 클릭 닫기, 닫힐 때 저장한 요소로 복원,
  body 스크롤락, `role="dialog" aria-modal="true" aria-label(ledby)`.
- 마이그레이션 범위(이번 유닛): **ManualEntryModalV2 · ConversationHistoryModal · Discussion 생성/이름변경 모달**
  3곳 (폼형 모달 — 트랩 부재 체감 최대). 팔레트/AiOverlay 는 자체 키 핸들링이 커스텀이라 유지,
  나머지는 후속 라운드에서 순차 이전.
- vitest: 열림→포커스 이동, Tab 순환, Esc 복원 3 케이스 + axe.
