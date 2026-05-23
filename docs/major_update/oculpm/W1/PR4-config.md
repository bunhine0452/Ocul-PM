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

- [x] `timezone` — `WorkdayResolver::new` 가 `tz_name.parse::<chrono_tz::Tz>()` 로 검증 (drift 방지 위해 PR3 의 코드 재사용)
- [x] `day_starts_at` — `WorkdayResolver::new` 가 `NaiveTime::parse_from_str(..., "%H:%M")` 로 검증 (정규식 대신 chrono 의 strict parser)
- [x] `inactivity_timeout_minutes ≥ 1` — `if self.session.inactivity_timeout_minutes < 1 { Err(InvalidConfig) }`
- [x] `debounce_ms` 1~10000 — `if !(1..=10_000).contains(&self.watcher.debounce_ms) { Err(InvalidConfig) }`
- [x] `batch_max_events ≥ 1` — `if self.watcher.batch_max_events < 1 { Err(InvalidConfig) }`
- [x] `agents.active` ⊆ `KNOWN_AGENT_IDS` (`["claude-code","cursor","antigravity","gemini-cli"]`)

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

## 5. 단위 테스트 (실제 8개)

- [x] 라운드트립: default → save → load → 같은 값 (`roundtrip_default`)
- [x] 잘못된 tz → `Err(InvalidTimezone)` — `WorkdayResolver::new` 에서 발생 (`validate_rejects_invalid_timezone`)
- [x] 잘못된 hhmm → `Err(InvalidHHMM)` — `WorkdayResolver::new` 에서 발생 (`validate_rejects_invalid_hhmm`)
- [x] timeout 0 → `Err(InvalidConfig)` (`validate_rejects_zero_timeout`)
- [x] active 에 알 수 없는 agent id → `Err(InvalidConfig)` (`validate_rejects_unknown_agent`)
- [x] 알 수 없는 키 (`foo_unknown_key = 42`) 가 있어도 load 성공 (`load_ignores_unknown_keys`)
- [x] **보너스**: debounce_ms 범위 (0, 20000) + batch_max_events 0 거부 (`validate_rejects_bad_debounce_and_batch`)
- [x] **보너스**: 디폴트 forbid 패턴이 비어있지 않고 25개 이상 (`default_forbid_patterns_nonempty`)

---

## 6. DoD

- [x] **8개 테스트 통과** (6 spec + 2 보너스). `cargo test --lib oculpm::config` 0.00s 실행, 6.00s 컴파일
- [x] 모든 oculpm 테스트 통과 — 21/21 (W1-PR3 의 13 + 본 PR 의 8)
- [x] 한국어 값/주석 round-trip (UTF-8) — TOML 0.8 이 UTF-8 보장
- [x] `default_for_new_project()` 가 `validate()` 통과 — `roundtrip_default` 안에서 명시 검증
- [x] 생성된 `config.toml` 이 사람이 읽기 깔끔 — `to_string_pretty` 사용
- [x] oculpm 격리 clippy lint 0건

---

## 7. 실행 노트

### 발견된 함정 / 변경

1. **`tempfile` dev-dependency 추가** — 라운드트립 테스트가 임시 파일을 쓰므로 필요. `Cargo.toml` 끝에 새 `[dev-dependencies]` 섹션 추가 (기존에 없었음). 향후 다른 모듈 (W1-PR5 lock, W1-PR8 gitignore) 도 같은 dep 재사용.

2. **검증 로직 재사용** — `validate` 의 tz + day_starts_at 검사는 `WorkdayResolver::new` 를 직접 호출해서 통과시킨다. 두 코드 경로가 drift 할 일이 원천적으로 없도록 — `phases/W1-foundation.md` 의 W1-PR3 "다음 PR 로 넘기는 메모" 항목 반영.

3. **`from_toml_str` 추가 helper** — `load` 는 disk-bound 이라 테스트하기 번거로움. 같은 내부 로직을 `from_toml_str(text)` 로 분리해서 "알 수 없는 키 무시" 테스트가 inline 으로 가능. 향후 UI 의 surface-level 검증에도 재사용 예정.

4. **`save` 가 atomic 이 아님 (W1-PR5 까지)** — 현재는 `std::fs::write` 사용. W1-PR5 의 `atomic_io::write_atomic` 가 들어오면 1줄 교체. doc-comment 에 명시.

5. **에러 자동 변환** — `OculpmError::ConfigParse(#[from] toml::de::Error)` 와 `ConfigSerialize(#[from] toml::ser::Error)` 덕분에 `toml::from_str(text)?` 와 `toml::to_string_pretty(self)?` 가 `?` 한 번으로 끝남. `OculpmError::Io` 는 struct variant (path + source) 라 `#[from]` 못 박아서 `.map_err(|source| Io { path, source })` 로 명시 처리.

### 빌드/테스트 시간
- `cargo test --lib oculpm::config` 컴파일 (`test` profile, tempfile 추가): **6.00s**
- 8개 테스트 실행: **0.00s**
- 전체 oculpm 테스트 (21개) 실행: **0.00s**
- `cargo clippy --all-targets` oculpm 격리: 신규 lint **0건**

### 다음 PR 로 넘기는 메모

- **W1-PR5 (atomic_io)**: `save` 안의 `std::fs::write` 를 `atomic_io::write_atomic(path, text.as_bytes()).await` 로 교체. async 전환이라 `save` 자체도 `async fn` 으로. W1-PR5 머지 직후 짧은 cleanup PR.
- **W1-PR6 (커맨드)**: `oculpm_set_config` 가 받은 새 config 에 `validate()` 를 먼저 돌리고, 실패 시 `Err` 반환 → 디스크 변경 X.
- **W1-PR8 (.gitignore)**: `OculpmInitReport.wrote_config` 는 `default_for_new_project` 를 처음 save 한 경우만 true. 기존 `config.toml` 이 있어 그대로 load 한 경우 false.
