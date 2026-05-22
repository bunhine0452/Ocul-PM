# W1-PR3 — `paths.rs` (`WorkdayResolver`) + 단위 테스트

> **목표**: 워크데이 계산 + 경로 계산 의 단일 진입점. KST/UTC/DST 경계 케이스를 모두 픽스.
> **선행**: W1-PR1 ✅, W1-PR2 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR3, [`../00-spec.md`](../00-spec.md) §7.

---

## 1. 구현할 함수

```rust
pub struct WorkdayResolver {
    pub tz: chrono_tz::Tz,
    pub day_starts_at: chrono::NaiveTime,
}

impl WorkdayResolver {
    pub fn new(tz_name: &str, day_starts_at_hhmm: &str) -> Result<Self, OculpmError>;
    pub fn workday_of(&self, instant_utc: chrono::DateTime<chrono::Utc>) -> String;
    pub fn next_boundary(&self, instant_utc: chrono::DateTime<chrono::Utc>) -> chrono::DateTime<chrono::Utc>;
    pub fn hhmm_of(&self, instant_utc: chrono::DateTime<chrono::Utc>) -> String;

    pub fn project_oculpm_dir(&self, project_root: &Path) -> PathBuf;
    pub fn index_dir(&self, project_root: &Path, workday: &str) -> PathBuf;
    pub fn journal_dir(&self, project_root: &Path, workday: &str, kind: EntryType) -> PathBuf;
    pub fn lock_path(&self, project_root: &Path) -> PathBuf;
    pub fn schema_version_path(&self, project_root: &Path) -> PathBuf;
    pub fn config_path(&self, project_root: &Path) -> PathBuf;
}
```

---

## 2. error.rs 에 추가할 variant

```rust
#[error("invalid timezone: {0}")]
InvalidTimezone(String),

#[error("invalid HH:MM '{0}' (expected 00:00 - 23:59)")]
InvalidHHMM(String),
```

---

## 3. 단위 테스트 (12 케이스 — 모두 작성)

상세 매트릭스는 [`../phases/W1-foundation.md`](../phases/W1-foundation.md#w1-pr3) W1-PR3 의 테스트 표 참조.

`#[cfg(test)] mod tests` 안에 12 케이스. 모두 `#[test]`.

---

## 4. DoD

- [ ] 12개 단위 테스트 통과
- [ ] `cargo test --lib oculpm::paths` < 1초
- [ ] `journal_dir(root, "20260522", EntryType::Bug)` → `root/.oculpm/journal/20260522/Bugs`
- [ ] `journal_dir` 의 5개 EntryType 모두 올바른 폴더명 (Bugs, Features_to_add, Errors, Refactors, Chores)
- [ ] DST 경계 케이스 (예: America/New_York 2026-03-08) 통과

---

## 5. 실행 노트
- (작업 중 채움)
