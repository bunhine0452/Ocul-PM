# v2 — 성능 스펙 (U3·U5·U6·U11·U12)

측정 원칙: 각 유닛 전후로 확인 가능한 지표를 일지 `## 검증` 에 남긴다
(리렌더 횟수는 React Profiler/카운터 테스트, 번들은 `dist/assets` 크기, 쿼리는 EXPLAIN).

## §1. WorkspaceContext 리렌더 수술 (U3) — 최우선

### 현황 (실측 근거)
- provider `value` 가 매 렌더 새 객체 리터럴 (`WorkspaceContext.tsx:828-843`) → 모든 상태 변경이
  전 소비자 리렌더.
- `useEffect([state])` 가 상태 변경마다 전체 blob `JSON.stringify` → localStorage 동기 저장
  (`:596-598`). blob 에 `recentChanges` 최대 1000건 포함.
- watcher `oculpm:file_changed` 이벤트마다 `setState` 로 `recentChanges` push (`:785-805`)
  → **에이전트가 활발히 코딩하는 동안** 이벤트당 [전 화면 리렌더 + 전체 직렬화] 발생.

### 설계
1. `value` 를 `useMemo` 로 감싼다 (deps: state + 안정 콜백들 — 콜백은 이미 `useCallback` 이면 유지,
   아니면 함께 안정화).
2. **`recentChanges` 를 컨텍스트 상태에서 분리** — `src/lib/recentChangesStore.ts`:
   모듈 스코프 ring buffer(cap 1000) + `useSyncExternalStore` 훅 `useRecentChanges()`.
   watcher 이벤트는 스토어에만 push → 구독 컴포넌트(소비처만)만 리렌더.
   localStorage 미persist (세션 휘발 — 기존에도 복원 가치 낮음. persist 대상에서 제외).
3. localStorage 저장을 **300ms 트레일링 디바운스** + `beforeunload` flush.
4. 공개 API(`useWorkspace()` 시그니처) 불변 — `recentChanges`/`pushRecentChange` 만
   deprecated 브리지로 스토어에 위임하고 소비처(grep 기준 소수)를 신규 훅으로 이전.

### 검증
- vitest: 스토어 push 시 컨텍스트 소비자 리렌더 0 (카운터 컴포넌트), 디바운스 저장 1회 병합,
  기존 workspace persistence 테스트 그린.

## §2. 화면별 lazy 분할 (U6)

- `ShellV2.tsx:6-15` 정적 import 10화면 중 **무겁고 진입 빈도 낮은 것**부터 `React.lazy`:
  Terminal(xterm ~300KB), AiPanel, Docs, Retro, Discussion, Settings(이미 패널), Search(포매터는 이미 지연).
  Today/Journal/Planner/Diff 는 핵심 루프라 eager 유지 (첫 화면 깜빡임 방지).
- `components/Markdown.tsx` (react-markdown+rehype-highlight, 141KB 청크) 를
  `React.lazy` 래퍼(`MarkdownLazy`)로 — 7개 소비 화면이 전부 lazy 경계 뒤로 가면 자연 분리되지만,
  eager 화면(EntryDetailView 등)에서도 쓰이므로 래퍼가 안전.
- `vite.config.ts` 에 `manualChunks`: `vendor-react`(react·react-dom), `vendor-markdown`,
  `vendor-xterm` 정도의 명시 경계 (과분할 금지 — 청크 5개 이내 추가).
- Suspense fallback = U2 `<Skeleton variant="block">`.
- 검증: `pnpm build` 후 `dist/assets` 주요 청크 크기 전/후 기록. ShellV2 청크 목표 −40% 이상.

## §3. FTS5 검색 (U11)

- 신규 마이그레이션 `0NN_fts.sql`:
  - `CREATE VIRTUAL TABLE chunk_fts USING fts5(content, content='chunks', content_rowid='id', tokenize='unicode61')`
  - `symbol_fts(name)` 동일 패턴. 백필 `INSERT INTO chunk_fts(rowid, content) SELECT id, content FROM chunks…`.
- 인덱서 쓰기 경로(upsert/delete)에 FTS 동기화 추가 (contentless 아닌 external-content 테이블이라
  triggers 로 처리 가능 — `AFTER INSERT/UPDATE/DELETE` 트리거 3종을 마이그레이션에 포함, Rust 변경 최소화).
- `db.rs search_text/search_symbols` 를 FTS `MATCH` 로 교체:
  - 쿼리 전처리: 사용자 입력을 `"…"*` prefix 토큰으로 (특수문자 이스케이프), 랭킹 `bm25()`.
  - **폴백**: FTS 파싱 실패(특수문자 등) 시 기존 LIKE 경로로 폴백 — 결과 0 이 아니라 에러일 때만.
- sqlite-vec(시맨틱)와 병존 — 하이브리드 랭킹은 비스코프.
- 검증: cargo 테스트 — 백필 후 매치, 증분 upsert 후 매치, 삭제 후 미매치, 한글/특수문자 쿼리.

## §4. workday brief 집계 (U12 = 백로그 N3 축소판)

### 현황
Today 오픈 = `listJournalEntries`×7(요일) + `getJournalEntry`×오늘 엔트리 (`useTodayBrief.ts:126-166`)
+ `planGet`×N (`useNextTasks.ts:27-39`) + 365일 히트맵을 숫자 1개로 축약(`useTodayMonitor.ts:80-82`).
저널 타임라인도 워크데이당 1콜×14 (`useJournalDays.ts:99-102`).

### 설계
`oculpm_workday_brief(project_id, days) -> WorkdayBrief` 단일 커맨드:
- `days: Vec<WorkdayBucket { workday, entries: Vec<EntrySummaryDto>, counts }>` — 기존
  `list_entries` 캐시 쿼리를 workday IN (…) 한 번으로.
- `today_details: Vec<EntryDetailDto>` — 오늘 엔트리 상세(하이라이트용) 동봉 (기존 per-entry
  `getJournalEntry` 루프 제거).
- `plans: Vec<PlanBriefDto { id, title, open_items(글리프별 카운트+상위 K 항목) }>` — `planGet`×N 제거.
- `total_entries: i64` — 365 히트맵 대체 스칼라.
- 프런트: `useTodayBrief`/`useNextTasks`/`useTodayMonitor(total)` 를 brief 1콜 기반으로 재작성,
  `useJournalDays` 윈도우 로드도 같은 커맨드(days=14) 사용.
- 검증: Today 오픈 IPC 콜 수 12+N → **3 이하** (brief + sessions + gitHeadStatusBrief).
  gitLog(50) 은 커밋 그래프가 실제 사용하므로 유지.

## §5. 로그 retention (U5)

- `lib.rs:65` `rolling::daily` → `RollingFileAppender::builder().max_log_files(14)` (2주 보존).
- 검증: builder 파라미터 단위 테스트 불가(파일시스템 시간 의존) — 수동: logs 디렉토리에
  가짜 과거 로그 15개 생성 후 앱 기동 시 오래된 것 삭제 확인, 일지에 기록.
