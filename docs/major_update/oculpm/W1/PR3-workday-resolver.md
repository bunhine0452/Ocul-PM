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

- [x] **13개 테스트 통과** (12 spec + 1 path helper). `cargo test --lib oculpm::paths` finished in **0.00s** (test 실행), 컴파일 5.74s
- [x] `journal_dir(root, "20260522", EntryType::Bug)` → `root/.oculpm/journal/20260522/Bugs`
- [x] `journal_dir` 의 5개 EntryType 모두 올바른 폴더명 — Bugs, Features_to_add, Errors, Refactors, Chores
- [x] DST 경계 케이스 (America/New_York 2026-03-08T07:00:00Z) 통과 — `hhmm = 0300` (EDT 측, spring-forward 후)
- [x] oculpm 격리 clippy lint 0건

---

## 5. 실행 노트

### W1-foundation.md §1 의 테스트 표 정정 (case 8)

원래 표 의 "**기대 hhmm = 0200 (skip 1h)**" 은 실제로 **`0300`** 이 정답. 이유:

- US DST 2026 시작은 2026-03-08 02:00 local. 그 시점에 시계가 02:00 EST → 03:00 EDT 로 점프.
- UTC `07:00:00`:
  - DST 시작 직전 (06:59:59 UTC) = 01:59:59 EST
  - DST 시작 시점 (07:00:00 UTC) = 03:00:00 EDT (점프 후)
- 02:00 시각은 *존재하지 않는 시간*. chrono-tz 가 자동으로 EDT 측에 매핑.

`hhmm_of` 가 반환하는 값은 chrono-tz 의 `with_timezone(&Tz)` 결과를 그대로 따른다 → `0300`.

회고: foundation 명세 표를 작성할 때 "(skip 1h)" 가 *결과* 의 일부인 줄 알고 `0200` 으로 적었으나, 실제로는 "이 케이스에서 1시간 점프가 발생한다" 는 *주석* 이었고 hhmm 자체는 `0300` 이어야. 본 PR 에서 실제 코드로 검증하고 테스트 코드의 expected 값을 `0300` 으로 박음. ([phases/W1-foundation.md W1-PR3](../phases/W1-foundation.md) 테스트 표는 후속 cleanup 시 수정 또는 그대로 둘 수 있음 — 본 PR 코드가 SSOT.)

### DST gap 처리 (`local_boundary_utc`)

`next_boundary` 가 사용하는 헬퍼는 spring-forward gap (예: day_starts_at=02:30 + US DST 시작일) 에 대비해 **분단위 advance loop** 로 첫 유효 instant 를 찾는다. 1인 도구 + 디폴트 `00:00`/`03:00` 이라 거의 hit 안 되지만 panic 방지 차원.

DST fall-back ambiguity (한 시각이 두 번 발생) 은 `LocalResult::earliest()` 로 pre-fold 측 instant 사용 — 워크데이 *시작* 의 자연 해석.

### dead_code 패턴

WorkdayResolver struct + impl 에 `#[allow(dead_code)]` 부착. W1-PR4 의 config validate 와 W1-PR7 의 OculpmManager 가 첫 사용처. attribute 들은 그 시점에 제거 가능.

### 빌드/테스트 시간 (개인 노트북)
- `cargo test --lib oculpm::paths` 컴파일 (`test` profile): **5.74s**
- 테스트 13개 실행: **0.00s**
- `cargo clippy --all-targets`: oculpm 신규 lint 0건

### 다음 PR 로 넘기는 메모

- `OculpmConfig` (W1-PR4) 가 `WorkdayResolver::new(tz, day_starts_at)` 으로 검증하면 좋겠음 — 이미 validate 로직이 같은 IANA + HH:MM 체크라 중복 회피 가능.
- `EntryType` import 가 `crate::oculpm::spec` 에서 잘 됨 — W1-PR2 의 specta export 와는 별개의 use path.
- `chrono::Duration::minutes(1)` 의 `overflowing_add_signed` 는 deprecated 가능성 — 향후 chrono major 시 `checked_add_signed` 로 마이그레이션 검토.
