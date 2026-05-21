# 04. daily_brief 커맨드

> **작업 ID**: W3 / UI-3 (Today 화면 백엔드)
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.3 (Today 화면), §7.3 (W3 체크리스트)

---

## 변경 요약

Today 화면을 한 번의 IPC 로 채우기 위한 통합 커맨드 `daily_brief` 추가.
Planner 의 goals 와 Changelog 의 entries 를 한 응답으로 묶어 반환.

## 위치

`src-tauri/src/commands/overview.rs` 하단 (`// ---------- daily_brief ----------`).

Overview 와 같은 모듈에 둔 이유:
- 둘 다 "PM 정체성" 의 화면 데이터를 만든다 (Overview / Today)
- 별도 모듈 새로 파는 것보다 응집도 면에서 한 모듈 안에 두는 편이 자연스럽다
- 사이즈가 작아서 분리 부담이 더 크다

## 응답 타입

```rust
pub struct DailyBrief {
    pub date_unix: i64,                       // 요청한 day 의 00:00 (local)
    pub focus_goals: Vec<Goal>,               // 진행 중 top 3
    pub completed_today: Vec<Goal>,           // 오늘 완료된 goals
    pub today_entries: Vec<ChangelogEntry>,   // 오늘의 changelog (newest first)
    pub files_touched: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub pinned_entries: Vec<ChangelogEntry>,  // 날짜 무관 — 항상 sticky
}
```

## 시그니처

```rust
#[tauri::command]
pub async fn daily_brief(
    db: State<'_, Db>,
    project_id: u32,
    date_unix: Option<i64>,   // 없으면 today
) -> Result<DailyBrief, String>
```

## 구현 요약

```rust
let day_start = match date_unix {
    Some(ts) => ts - ts.rem_euclid(86400),
    None     => now_unix - now_unix.rem_euclid(86400),
};
let day_end = day_start + 86400;

// 1) 활성 goals 페치 후 in-memory slice
let active_goals = db.list_goals(Some(project_id), None).await?;
let focus_goals     = active_goals.iter().filter(|g| g.status != "completed").take(3).cloned().collect();
let completed_today = active_goals.iter().filter(|g| g.status == "completed"
    && g.updated_at as i64 >= day_start
    && g.updated_at as i64 <  day_end).cloned().collect();

// 2) 오늘 changelog
let raw = db.list_changelog_entries(project_id, Some(day_start), 200).await?;
let today_entries = raw.into_iter().filter(|e| (e.created_at as i64) < day_end).collect();

// 3) 통계 — entries 에서 fold
let files_touched = today_entries.iter().map(|e| e.files_changed).sum();
...

// 4) 핀 — 90일 윈도우에서 필터 (실용적 양)
let recent = db.list_changelog_entries(project_id, Some(day_start - 86400 * 90), 500).await?;
let pinned_entries = recent.into_iter().filter(|e| e.pinned).collect();
```

## 설계 결정

- **In-memory slice vs 전용 SQL**: `list_goals` 가 이미 priority/due_date 정렬을
  해서 돌려준다. top 3 만 떼면 되니 새로 SQL 필요 없다. completed_today 도 같은
  배열을 한 번 더 훑는 비용은 무시 가능 (goals 수는 보통 < 50).
- **Pinned 윈도우 90일**: 핀이 1년 전 entry 라면 일상 PM 사용에서 거의 의미
  없다. 90일 컷이 실용적이고, 너무 큰 결과셋을 막는다.
- **`date_unix` 의 의미**: 사용자 입력은 *그 날짜 안 어떤 unix sec 든 OK*.
  내부에서 `rem_euclid` 로 00:00 정렬. 프론트가 ±86400 sec 만 더하면 어제/내일.
- **AI 추천은 응답에 포함 안 함**: 추천 텍스트는 클라이언트가 정적 룰로 생성
  (TodayScreen 의 `RecommendationCard`). 진짜 LLM 추천은 §12 열린 결정 #3 해소
  전까지 보류.
- **빈 응답 처리**: 모든 필드가 빈 vec 이어도 정상 반환 — Today 화면이 빈 상태
  UI 를 책임진다.

## 비용

전부 sqlite 쿼리 3 회. LLM 호출 없음. < 5ms 예상.

## 검증

`cargo check` 통과. 빌드 후 frontend 에서 `commands.dailyBrief(projectId, null)`
호출 시 즉시 반환.
