# W1-PR4 — `config.rs` 기본값 + 검증

> **목표**: `OculpmConfig` 의 default / load / save / validate. `forbid_journal_for_paths` 의 보수적 디폴트 박기.
> **선행**: W1-PR1, W1-PR2, W1-PR3 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR4, [`../phases/README.md`](../phases/README.md) §0.2, [`../00-spec.md`](../00-spec.md) §5.

---

## 1. 구현

```rust
impl OculpmConfig {
    pub fn default_for_new_project() -> Self;
    pub fn load(path: &Path) -> Result<Self, OculpmError>;
    pub fn save(&self, path: &Path) -> Result<(), OculpmError>;
    pub fn validate(&self) -> Result<(), OculpmError>;
}
```

`load` 는 `toml::from_str`. 알 수 없는 키 무시 (`#[serde(deny_unknown_fields)]` X — forward-compat).
`save` 는 `toml::to_string_pretty` + `atomic_io::write_atomic` (W1-PR5 이후). 본 PR 시점에서는 일시적으로 `std::fs::write`, W1-PR5 머지 후 `write_atomic` 으로 교체하는 후속 1줄 PR.

---

## 2. `default_for_new_project` 의 정확한 값

`forbid_journal_for_paths` 는 [`phases/README.md`](../phases/README.md) §0.2 의 30+ 패턴 그대로.

그 외 디폴트:
- `workday.timezone = "Asia/Seoul"` (사용자 1차 타깃이 KST)
- `workday.day_starts_at = "00:00"`
- `session.inactivity_timeout_minutes = 30`
- `session.auto_close_on_workday_boundary = true`
- `session.auto_close_on_app_quit = true`
- `session.crash_recovery_grace_minutes = 5`
- `git.journal_committed = true`
- `git.auto_redact_patterns = [AWS, OpenAI/Anthropic, GitHub PAT, Slack]` — 4 패턴
- `watcher.ignore = [.oculpm/index/, .oculpm/.lock, .git/, node_modules/, target/, dist/, .next/, build/, *.log, .DS_Store]`
- `watcher.respect_gitignore = true`
- `watcher.debounce_ms = 500`
- `watcher.batch_max_events = 200`
- `agents.active = []` (디폴트는 빈 배열 — 사용자가 onboarding 또는 settings 에서 선택)
- `agents.auto_detect_on_open = true`
- `agents.auto_sync_adapters = true`

---

## 3. `validate` 체크

- [ ] `timezone` 이 `chrono_tz::TZ_VARIANTS` (또는 동등한 enumeration) 에 존재
- [ ] `day_starts_at` 이 `^([01]\d|2[0-3]):([0-5]\d)$` 매치
- [ ] `inactivity_timeout_minutes ≥ 1`
- [ ] `debounce_ms` 1~10000
- [ ] `batch_max_events ≥ 1`
- [ ] `agents.active` 의 모든 ID 가 `["claude-code","cursor","antigravity","gemini-cli"]` 부분집합

---

## 4. error.rs 에 추가할 variant

```rust
#[error("config parse error: {0}")]
ConfigParse(#[from] toml::de::Error),

#[error("config serialize error: {0}")]
ConfigSerialize(#[from] toml::ser::Error),

#[error("invalid config: {0}")]
InvalidConfig(String),
```

---

## 5. 단위 테스트 (6개)

- [ ] 라운드트립: default → save → load → 같은 값
- [ ] 잘못된 tz → `Err(InvalidConfig)`
- [ ] 잘못된 hhmm → `Err(InvalidConfig)`
- [ ] timeout 0 → `Err`
- [ ] active 에 알 수 없는 agent id (`["foo"]`) → `Err`
- [ ] 알 수 없는 키 (`foo = 1`) 가 있어도 load 성공

---

## 6. DoD

- [ ] 6개 테스트 통과
- [ ] 한국어 값/주석을 TOML 에 넣어도 라운드트립 (UTF-8)
- [ ] `default_for_new_project()` 가 `validate()` 를 통과
- [ ] 생성된 `config.toml` 이 사람이 읽기에도 깔끔 (toml::to_string**_pretty**)

---

## 7. 실행 노트
- (작업 중 채움)
