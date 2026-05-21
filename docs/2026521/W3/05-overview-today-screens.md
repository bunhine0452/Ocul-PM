# 05. OverviewScreen + TodayScreen (UI-3)

> **작업 ID**: W3 / UI-3 (Overview + Today)
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.2, §5.3, §7.3

---

## 변경 요약

PM 정체성의 두 표지 화면을 프론트엔드에 신설하고, 좌측 사이드바 최상단에
진입 탭 2 개 추가.

## 신규 파일

### `src/features/overview/OverviewScreen.tsx`

**구조**:
1. **헤더**: 제목 + "새로 고침" / "개요 다시 생성" 버튼
2. **IdentityCard**: 한 줄 정체성을 hero 카드로 강조
3. **StackCard**: stack_json 을 파싱해 chip 으로 표시 (framework / languages /
   ui / data / package_manager / notes)
4. **StatsRow**: 파일 / 청크 / 스택 키 수 — `projectStats` 와 stack_json
   조합
5. **Markdown 본문**: `overview_md` 를 그대로 렌더
6. **footer**: 마지막 생성 시각 + 모델

**상태/사이드 효과**:
- 마운트 시 `getProjectOverview` + `projectStats` 병렬 페치
- `default_provider` / `default_model` 를 settings 에서 한 번 읽음
- "다시 생성" 클릭 시 `generateProjectOverview` (force) 호출

**빈 상태**: `EmptyState` — "지금 생성하기" CTA + provider/model 미설정
경고 안내.

### `src/features/today/TodayScreen.tsx`

**구조** (§5.3 와 1:1 대응):

| 카드 | 컴포넌트 | 데이터 |
|---|---|---|
| 오늘의 포커스 | `FocusCard` | `brief.focus_goals` (P 표시) |
| 오늘의 완료 | `CompletedCard` | goals/files/entry/lines 통계 |
| 오늘의 활동 | `ActivityCard` | `brief.today_entries` (시각·카테고리·제목) |
| 고정된 항목 | `PinnedCard` | `brief.pinned_entries` (있을 때만) |
| AI 추천 | `RecommendationCard` | 데이터 기반 정적 룰 |

**날짜 네비게이션**: ◀ / 오늘 / ▶ 3-버튼. `dayOffset` (0=today) 로 단순 관리,
미래 일자는 비활성.

**CategoryChip**: feature/fix/refactor/docs/test/chore 6 종 색상 매핑.
§6.4 의 컬러 토큰과 정합 (blue/red/purple/emerald/amber/zinc).

**AI 추천 (현 구현)**: §12 열린 결정 #3 미해결로 인해 LLM 호출 안 함.
정적 휴리스틱 4 종:
- focus 가 비었으면 → 목표 추가 권유
- 활동/변경 0 이면 → changelog 기록 권유
- 짧은 제목이 있으면 → 제목 보강 권유
- 모두 통과하면 → 격려 메시지

진짜 LLM 추천은 후속 PR.

## 수정 파일

### `src/lib/bindings.ts`

W2 의 changelog 7 종, W3 의 overview/daily_brief 5 종 커맨드를 수동 추가.
`commands` 객체와 `Types` 섹션 둘 다.

수동 추가가 필요한 이유: `bindings.ts` 는 `pub fn run()` 안에서
`builder.export()` 로 생성되므로, **앱을 한 번 실행해야** 자동 재생성된다.
프론트가 컴파일되도록 임시로 손으로 채워 두고, 다음 dev 런에 정식 재생성.

추가된 타입: `ChangelogEntry`, `ChangelogFileEntry`, `ProjectOverview`,
`DailyBrief`.

### `src/App.tsx`

- import 에 `OverviewScreen`, `TodayScreen`, `Flame` 추가
- `activeTab` union 에 `"overview" | "today"` 두 멤버 추가, 기본값을
  `"overview"` 로 변경
- 좌측 사이드바 최상단에 두 진입 버튼 (LayoutDashboard / Flame 아이콘)
- main 영역에 두 mount 블록 추가

UI-2 (IA 5단 통합) 가 아직 W2 에서 백엔드만 진행됐기에 사이드바는 *기존 9 탭
+ 신규 2 탭* 의 과도기 상태. 이는 UI-2 프론트 작업 시 정리될 예정.

### `src/components/TitleBar.tsx`

W1 작업에서 남은 미사용 `commands` import 제거 (TS6133 해결).

## 검증

```
$ npx tsc --noEmit
(no output → 0 errors)
```

수동 동작 검증 (다음 dev 런에서):
1. 프로젝트 선택 → Overview 탭 → "지금 생성하기" 클릭
2. 인덱싱 후 자동 백그라운드 생성 (default provider/model 설정 시)
3. Today 탭 → 오늘/어제 토글 → 데이터 채움 확인

## 알려진 제한

- **사이드바 IA 미정리**: 11 개 탭 상태 (기존 9 + 새 2). UI-2 에서 5 단으로
  축약 예정.
- **AI 추천 정적**: §12 열린 결정 #3 (Today AI 추천 호출 빈도) 해소 전 보류.
- **디렉터리 가이드 inline 편집 미구현**: 마스터 가이드 §5.2 의 inline 편집
  체크리스트 항목은 후속 PR. 현재는 LLM 생성 결과를 read-only 로 표시.
- **bindings.ts 수동 편집**: 다음 dev 런이 덮어쓴다. 그 시점에 자동 정렬되며
  수동 추가분이 정식 자동 생성으로 대체됨.
