# W5 — Manual QA Checklist

> W3/W4 와 동일 방식의 사용자-실측 체크리스트. 자동 테스트는 `cargo test` +
> `pnpm tsc --noEmit` 가 커버 (lib 210/210 + integration 11/11 + tsc clean
> @ 2026-05-28). 본 문서는 **실제 데이터/UI 동작** 검증.
>
> 실행 순서 권장: `pnpm tauri dev` 로 띄운 후 본 ai-pm 프로젝트 자체를
> 마이그레이션 대상으로 사용 (meta dogfooding).

---

## 마이그레이션 흐름 (1~10)

| # | 항목 | 결과 | 노트 |
|---|---|---|---|
| 1 | 신규 프로젝트 (SQLite changelog 0개) → 마이그레이션 모달 안 뜸 | ⬜ | `useShouldOfferMigration` 가 `"no"` 반환 |
| 2 | 기존 프로젝트 (SQLite changelog 10+ 개) → onboarding 후 마이그레이션 모달 | ⬜ | dismiss 클릭 후 재진입 → `localStorage[oculpm.migration.dismissed.${projectId}]` 제거 시 다시 표시 |
| 3 | dry_run 결과 카운트 = SQLite 카운트 | ⬜ | step 1 의 "전체 entries" 수 |
| 4 | 충돌 케이스 (동일 시각 + 동일 제목 2건 시드) → suffix 자동 추가 표시 | ⬜ | step 1 의 "충돌 N개 발견" 정보 카드 |
| 5 | forbidden 매치 entries 자동 unchecked | ⬜ | step 2 의 체크박스가 unchecked + "민감 경로" 빨간 강조 |
| 6 | 마이그레이션 실행 → 진행률 표시 → 완료 → 결과 화면 | ⬜ | step 4 progress bar 갱신 + step 5 성공 카드 |
| 7 | journal 디스크에 변환된 .md 파일 카운트 = success_count | ⬜ | `ls .oculpm/journal/*/*/*.md \| wc -l` |
| 8 | cache 가 자동 reindex 되어 Today 에 모든 entries 표시 | ⬜ | step 5 후 Today 진입, TimelineView 의 entries 수 |
| 9 | 백업 폴더 (`.oculpm.backup-pre-migration-...`) 존재 확인 | ⬜ | `ls -la .oculpm.backup-*` |
| 10 | 마이그레이션 중간에 강제 종료 → 재시작 → rollback 자동 + 토스트 | ⬜ | execute 중 `pnpm tauri dev` 강제 종료 → 재시작 시 PartialFailure 분기 |

## Overview 위젯 (11~14)

| # | 항목 | 결과 | 노트 |
|---|---|---|---|
| 11 | Overview 의 ActivityHeatmap 90일 셀 표시 | ⬜ | 7-row × 13-week grid, 빈 셀 회색 / 활동 셀 emerald scale |
| 12 | DifficultyMix 슬라이스 클릭 → Today 의 difficulty 필터 | ⬜ | TimelineView 의 entries 가 그 difficulty 만 표시 |
| 13 | AgentBreakdown 막대 클릭 → Today 의 agent 필터 | ⬜ | CategoryFilterBar 의 "에이전트 (1)" 표시 + 해당 agent 의 entries 만 |
| 14 | UnfinishedChecklist 50개 표시 + 클릭 → Today 의 entry 선택 | ⬜ | 클릭 후 워크데이 + entry 자동 선택 (PR8 의 anchor-date 미구현; 사용자가 timeline 으로 이동) |

## 구 데이터 삭제 (15~17)

| # | 항목 | 결과 | 노트 |
|---|---|---|---|
| 15 | 구 데이터 삭제: 슬러그 타이핑 미입력 → 버튼 disabled | ⬜ | `delete-legacy-changelog` 정확 입력 전엔 영구 삭제 disabled |
| 16 | 구 데이터 삭제: 마이그레이션 이력 없으면 메뉴 자체 hidden | ⬜ | LegacyDeleteModal 의 "삭제 가능한 마이그레이션 이력이 없습니다" 분기 |
| 17 | 구 데이터 삭제 성공 → ChangelogScreen 빈 상태 | ⬜ | "이 프로젝트에는 구 changelog 데이터가 없습니다" empty state |

## 회귀 — 기존 화면 (18)

| # | 항목 | 결과 | 노트 |
|---|---|---|---|
| 18 | **회귀**: 기존 화면들 모두 정상 (Today / Code / Plan / Overview / Changelog) | ⬜ | 각 탭 1분씩 클릭, 콘솔 오류 없는지 확인 |

추가 회귀 항목 (PR1~PR7 의 부수 효과 확인):

- ⬜ ChangelogScreen 상단 amber deprecation 배너 표시 + X 클릭으로 dismiss + `localStorage[changelog.deprecated_dismissed] = "1"` 영속
- ⬜ Today CategoryFilterBar 의 "에이전트 ▾" dropdown 토글 → KNOWN_AGENT_IDS + observed 합집합 표시
- ⬜ Today CategoryFilterBar 의 "에이전트 (N)" 칩 카운트가 선택 수와 일치
- ⬜ Overview ProjectMetaHeader 의 ▼ 클릭 → expanding panel + localStorage 영속
- ⬜ MigrationModal step 5 의 "백업 폴더 열기" → OS file manager 가 열림 (opener plugin 우회)
- ⬜ MigrationModal step 5 의 "구 데이터 삭제하기" → LegacyDeleteModal 진입

---

## meta dogfooding (실 데이터)

1. **본 ai-pm 의 changelog 카운트**: `sqlite3 ~/Library/Application\ Support/com.ai-pm.dev/ai-pm.db 'SELECT COUNT(*) FROM changelog_entries WHERE project_id = ?'`
2. `pnpm tauri dev` 후 마이그레이션 모달 자동 트리거 확인
3. dry_run 결과 → ☐ N entries 일치 확인 (1번의 값과)
4. 실행 → 결과 화면 → success_count 기록: ___
5. Today 화면 진입 → workday 별 합성 세션 표시 확인
6. `_dogfooding-w4.md` (또는 신설 `_dogfooding-w5.md`) 에 결과 entry 작성:
   - 변환 시간: __ ms
   - 충돌 N: __
   - forbidden 매치 N: __
   - 백업 폴더 크기: __ MB
   - 사용자가 발견한 어색함 (type 추론 오류, slug 너무 김, 빈 워크데이 등)

---

## 진행 상황 추적

각 ⬜ → ✅ 로 갱신. 종료 게이트는 18개 모두 ✅ + meta dogfooding 1회.
