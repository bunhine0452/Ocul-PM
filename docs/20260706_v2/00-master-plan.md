# v2.0.0 대규모 업데이트 — 마스터 플랜

- 날짜: 2026-07-06
- 브랜치: `feat/v2-round-20260706`
- 플래너: `.oculpm/planner/v2-release.md`
- 상태: **이 폴더가 v2 라운드의 SSOT** (진척은 플래너, 결정·범위는 이 문서)

## 1. 배경과 목표

1.x 시리즈(1.12~1.20)는 기록·정합성 축을 완성했다: redaction, 자동 화해(F1), 정직성 감사(F2),
무한 타임라인(F3), 회고(F4), git 백필(F5), frontmatter 자동보정(F7a), 토의 문서.
2.0.0 은 세 축으로 도약한다:

| 축 | 목표 | 한 줄 정의 |
|---|---|---|
| **UX** | 키보드 퍼스트 + 일관 프리미티브 | 마우스 없이 모든 곳에 도달하고, 모든 오버레이가 같은 규칙으로 동작한다 |
| **기능** | "기록하는 앱"→"되돌려주는 앱" | 쌓인 일지가 스탠드업·PR 본문·검색 가능한 지식으로 돌아온다 |
| **성능** | 상주 앱다운 자원 규율 | 에이전트가 코딩 중일 때(=핵심 시나리오) UI 가 프레임을 잃지 않는다 |

**2.0.0 인 이유**: 사용자 대면 인터랙션 모델(팔레트·단축키 체계)이 바뀌고, 제품 서사가
"기록"에서 "활용"으로 확장되며, 번들/캐시 구조 변경(화면 lazy 분할, FTS 테이블 추가)이
동반되는 마케팅+구조적 메이저. 온디스크 `.oculpm` 스키마는 **불변** (`schema_version: 1` 유지)
— 기존 프로젝트는 마이그레이션 없이 그대로 열린다. SQLite 캐시만 신규 마이그레이션이 추가된다
(캐시는 파생물이므로 재구축 가능).

## 2. 유닛 구성 (구현 순서)

각 유닛 = 1 커밋 = 1 일지. 게이트: `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm build`
(+Rust 변경 시 `cargo test`) 전부 exit 0 확인 후 커밋.

### Round 1 — 빠른 승리 (저위험·즉효)

| # | 유닛 | 요약 | 근거 (현황) | 문서 |
|---|---|---|---|---|
| U1 | 단축키·팔레트 정비 | 사이드바 배열을 내비 단일 소스로 승격, 팔레트 누락 3화면(문제 해결·회고·문서) 해소, ⌘번호=사이드바 순서 일치, ⌘P 프로젝트 전환 구현 | `CommandPalette.tsx:79-98` 누락, `useGlobalShortcuts.ts:22-30` 순서 불일치, `Sidebar.tsx:177` 죽은 ⌘P 힌트 | 01 §1 |
| U2 | Toaster 테마 + 스켈레톤 | 라이트 모드에서 다크 하드코딩(`bg-zinc-900`) 제거→토큰화, 미사용 `skelShimmer` 를 공용 `<Skeleton>` 으로 승격해 주요 화면 로딩에 적용 | `Toaster.tsx:31-35`, `screens.css:117-124` 정의만 존재 | 01 §2 |
| U3 | WorkspaceContext 리렌더 수술 | provider `value` useMemo, `recentChanges` 를 별도 구독 스토어로 분리, localStorage 저장 디바운스 | `WorkspaceContext.tsx:828-843` 매 렌더 새 객체, `:596-598` 전체 직렬화, `:785-805` watcher 이벤트마다 setState | 03 §1 |
| U4 | 에이전트 감지 확대 (A1) | Windsurf / Copilot / Codex CLI / aider / Cline / Zed 어댑터 행 추가 | `agents/mod.rs known_adapters()` | 02 §4 |
| U5 | 로그 retention | `tracing_appender` 일별 로그 무한 누적 → 보존 상한 | `lib.rs:65` rotation 상한 없음 | 03 §5 |

### Round 2 — 키보드 & 되돌려주기

| # | 유닛 | 요약 | 근거 | 문서 |
|---|---|---|---|---|
| U6 | 화면별 lazy 분할 | ShellV2 정적 import 10화면 → React.lazy(터미널·마크다운 계열 우선), manualChunks 정리 | `ShellV2.tsx:6-15`, 597KB 청크에 xterm·react-markdown 동승 | 03 §2 |
| U7 | 팔레트 엔티티 점프 | `search_entities` 커맨드(일지·플랜·토의·docs 제목) + 팔레트 통합 — "go to anything" | `CommandPalette.tsx` 화면 전환만 가능 | 01 §1 |
| U8 | 키보드 diff 검토 (P1) | j/k 파일 이동, Enter/o 로 펼침, `/` in-diff 검색 + n/N 이동 | `DiffScreenV2.tsx` 클릭 전용 | 01 §3 |
| U9 | 플래너 낙관적 업데이트 | 상태 토글 즉시 반영→실패 롤백, refetch 제거 | `PlannerScreenV2.tsx:191-207` busy→await→전체 refetch | 01 §4 |
| U10 | 스탠드업·PR 생성 (C1) | `generate_summary(range, style)` — standup/pr_description/weekly — 클립보드 복사, 회고 화면 진입점 | 03-next-features C1 | 02 §1 |

### Round 3 — 깊이 & 성능

| # | 유닛 | 요약 | 근거 | 문서 |
|---|---|---|---|---|
| U11 | FTS5 검색 | 텍스트/심볼 검색을 FTS5 가상 테이블로 — `LIKE '%…%'` 풀스캔 제거 | `db.rs:469-518` | 03 §3 |
| U12 | workday brief 집계 (N3 일부) | Today 화면 12+N IPC → 단일 `oculpm_workday_brief`; 저널 14콜도 흡수 | `useTodayBrief.ts:126-166`, `useNextTasks.ts:39`, `useJournalDays.ts:99-102` | 03 §4 |
| U13 | 공유 Dialog 프리미티브 | 포커스 트랩+복원+Esc+스크롤락을 가진 `<AppDialog>`, 기존 수동 모달 마이그레이션 | 8곳 각자 `fixed inset-0` 구현, 포커스 트랩 전무 | 01 §5 |

### 이월 (2.0.0 비스코프 — 03-next-features 백로그 유지)

- **F6 히스토리 Q&A** (L): 2.1 선두 후보. U7(엔티티 점프)·U11(FTS)이 기반을 깐다.
- **P2 검토 세션** (L): U8 키보드 diff 가 선행 조건. 2.1.
- **N1 무결성 닥터, N2 증분 그래프, A2 자동커밋/CI, C3 팀 머지, C4 암호화 백업**: 백로그 유지.
- **C2 HTML variant**: .md 번들은 1.18 에 출시됨. self-contained HTML 은 U10 결과를 보고 후속.
- **폰트 서브셋**: SUITE otf 7종(≈2.2MB) → woff2 변환은 로컬 툴체인 확보 시 chore 로 별도 처리
  (한글 글리프 서브셋은 위험해 변환만; 실패해도 v2 블로커 아님).
- 반응형(좁은 폭) 규칙: U13 과 함께 가면 좋으나 CSS 광역 수정이라 별도 라운드로 이월.

## 3. 리스크와 완화

| 리스크 | 완화 |
|---|---|
| U3 이 전 화면에 파급 (컨텍스트 소비자 전부) | 동작 불변 리팩토링으로 한정 — API 시그니처 유지, 스토어 분리는 `recentChanges` 소비처(2곳)만 마이그레이션. 기존 vitest 스위트가 회귀망 |
| U11 FTS 마이그레이션이 기존 캐시와 충돌 | 신규 `0NN_*.sql` 로 가상 테이블+백필, 인덱서 upsert 경로에 동기화 추가. 실패 시 LIKE 폴백 유지 |
| U6 lazy 분할이 화면 첫 진입 체감 지연 | Suspense fallback 을 U2 스켈레톤으로; 사이드바 hover 시 preload 훅 |
| U10 LLM 의존 | 기존 planner LLM 경로(provider 추상화) 재사용, 키 없음/실패 시 결정적 마크다운 폴백 |
| bindings.ts 재생성 누락 | Rust 커맨드 추가 유닛(U7·U10·U11·U12)은 `cargo test` 로 재생성 후 typecheck |

## 4. 릴리스 절차 (구현 완료 후)

1. 전 게이트 재확인 (`typecheck`/`test`/`lint`/`build` + `cargo test`).
2. `package.json`·`src-tauri/tauri.conf.json`·`Cargo.toml` 버전 → `2.0.0`, CHANGELOG 갱신.
3. main 머지·태그 푸시는 **사용자 확인 후** (release.yml 이 태그로 빌드).
