# 04. list_changelog_by_day 백엔드 커맨드

> **작업 ID**: W2 / G1 커맨드 (마무리)
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §4.1 (커맨드 표), §5.5 (Changelog 화면)

---

## 변경 요약

`DailyChangelogBucket` 구조체를 실제로 채워 반환하는 Tauri 커맨드
`list_changelog_by_day` 를 신설. W2 G1 체크리스트의 마지막 미완 항목 + W2 UI
의 ChangelogScreen 백엔드.

## 변경 파일

### `src-tauri/src/commands/changelog.rs`

새 커맨드 + 보조 함수:

```rust
#[tauri::command]
pub async fn list_changelog_by_day(
    db: State<'_, Db>,
    project_id: u32,
    days: Option<u32>,         // 기본 30
) -> Result<Vec<DailyChangelogBucket>, String>
```

흐름:
1. 현재 unix sec - `days * 86400` 이후의 entries 1000 개를 페치
2. `created_at` 을 86400 으로 floor 해 일별로 묶음 (Vec 순회로 newest-first 보존)
3. 각 버킷 안에서 files/added/removed 합산
4. `format_iso_date(unix_seconds)` 로 ISO yyyy-mm-dd 문자열 생성

### `format_iso_date` 의 구현

`chrono` 를 추가하지 않고 Howard Hinnant 의 *civil_from_days* 알고리즘을
inline 구현. 사용처가 1 곳뿐인데 dep 트리가 커지는 걸 피함.

```rust
fn format_iso_date(unix_seconds: i64) -> String {
    let days = unix_seconds.div_euclid(86400);
    let z = days + 719_468;
    // … era/yoe/doy 계산 …
    format!("{y:04}-{m:02}-{d:02}")
}
```

### `src-tauri/src/lib.rs`

`use` 와 `collect_commands![]` 두 곳에 추가.

### `src/lib/bindings.ts`

수동 추가 (앱 재실행 시 자동 재생성):

```ts
listChangelogByDay: (projectId, days) => typedError<DailyChangelogBucket[], string>(...)

export type DailyChangelogBucket = {
  date: string,
  entries: ChangelogEntry[],
  total_files: number,
  total_lines_added: number,
  total_lines_removed: number,
};
```

## 설계 결정

- **그룹핑을 Rust 에서**: SQL 의 `strftime` 그룹핑은 timezone 처리가 미묘하다.
  현재 모든 timestamps 가 UTC unix sec 이므로 86400-나눗셈으로 충분.
- **`Vec` 누적 + 마지막 원소 비교**: `BTreeMap<i64, Vec<E>>` 보다 단순하고
  newest-first 정렬을 그대로 유지. entries 가 이미 DESC 로 정렬돼 들어오므로
  연속된 같은-날 항목들만 묶이면 충분.
- **`days` 기본 30**: §5.5 의 화면 캡처가 "최근 30일" 을 디폴트로 가정.
  300 일이 넘는 한계가 필요하면 사용자가 `null` 대신 큰 값을 보내면 됨.
- **`limit = 1000` 하드코딩**: 일일 평균 5 entries 가정 시 200 일 분량.
  화면이 그 이상을 한 번에 보여줄 일이 없다. 페이지네이션은 W4 정식 화면 작업에서.

## 검증

`cargo check` → 5 warnings (`DailyChangelogBucket` 더 이상 unused),
errors 0.
