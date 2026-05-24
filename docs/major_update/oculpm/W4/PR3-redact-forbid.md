# W4-PR3 — `redact.rs` + `forbid_journal_for_paths` 강제

> **목표**: 워처가 캡처하는 file_changes 의 path / content 에서 secret 패턴을 마스킹하고, 민감 경로는 journal 작성 자체를 차단. 보안 + 사용자 신뢰의 핵심.
> **선행**: W1-PR4 (`OculpmConfig.git.{auto_redact_patterns, forbid_journal_for_paths}`), W2-PR3 (watcher hook 지점).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR3 + §2.6 (false positive 분리), [`../00-spec.md`](../00-spec.md) §5.
> **상태**: ⬜

---

## 1. 시그니처 (계획)

```rust
// src-tauri/src/oculpm/redact.rs

pub struct RedactHit {
    pub pattern_name: String,    // "aws_access_key" 등 (로깅용)
    pub start: usize,
    pub end: usize,
}

pub fn redact_text(
    text: &str,
    patterns: &[regex::Regex],
) -> (String, Vec<RedactHit>);

pub fn is_forbidden_path(
    path: &str,
    patterns: &[glob::Pattern],
) -> bool;
```

**중요 (페이즈 §2.6)**: `redact_text` 와 `is_forbidden_path` 의 적용 범위가 다름.

| 함수 | 적용 대상 | 이유 |
|---|---|---|
| `redact_text` | **file content** (만약 우리가 그것을 보고 있다면 — 현재 W4 범위에서는 미사용, W5 의 journal 본문 검사에서 사용) | 변수명 false-positive (`sk_initialize_module` 등) 가 path 에 매치되면 사용자 혼란 |
| `is_forbidden_path` | **path 그 자체** | 명시적 glob (`**/.env*`, `**/secrets/**`) 만 사용 — 변수명 매치 불가 |

워처가 file_change 캡처 시 적용 순서:
1. `is_forbidden_path(ev.path, &cfg.git.forbid_journal_for_paths)` 가 true → `ev.path` 를 `**redacted/sensitive**:<sha256_first_8>` 로 마스킹 후 ndjson 에 기록 (path 가 노출되지 않으면서도 path 별 변경 횟수는 유지 가능).
2. `redact_text` 는 본 PR 에서는 wire 만, content 적용은 W5 의 journal frontmatter `files_touched` 검사 시점.

---

## 2. 디폴트 정규식 / glob 패턴 (계획)

`OculpmConfig.default_for_new_project()` 가 갖는 디폴트:

```toml
[git]
forbid_journal_for_paths = [
    "**/.env*",
    "**/secrets/**",
    "**/credentials.json",
    "**/*.pem",
    "**/.aws/**",
]
auto_redact_patterns = [
    # AWS
    "AKIA[0-9A-Z]{16}",
    # GitHub
    "ghp_[A-Za-z0-9]{36}",
    "gho_[A-Za-z0-9]{36}",
    # OpenAI
    "sk-[A-Za-z0-9]{20,}",   # 단, content 적용 시만 (W5)
    # Generic 32~64 hex
    "(?i)(api[_-]?key|secret|token)[\\s=:]+['\"]?[a-f0-9]{32,64}['\"]?",
]
```

사용자가 Settings (PR7) 에서 추가/제거 가능.

---

## 3. 테스트 (계획)

페이즈 §3: `redact_text` 5 + `is_forbidden_path` 6 = 11개.

### `redact_text`

- [ ] `AKIA1234567890ABCDEF` → `[REDACTED]`.
- [ ] `ghp_` 토큰 매치.
- [ ] 한국어 본문 안에 영문 키 → UTF-8 경계 안전 매치 (정규식 byte index 가 char 경계가 아니어서 panic 가능 — `regex` crate 는 안전하지만 substring 슬라이싱 시 주의).
- [ ] 변수명 `sk_initialize_module_v1_token` 은 false positive → 정확한 정규식이 변수명에 매치되지 않아야 함 (`sk-` vs `sk_` 구분).
- [ ] 다중 매치 → 모든 위치가 `RedactHit` 에 기록.

### `is_forbidden_path`

- [ ] `src/.env.local` 가 `**/.env*` 매치.
- [ ] `secrets/aws.json` 가 `**/secrets/**` 매치.
- [ ] `./.aws/credentials` 가 `**/.aws/**` 매치 (선행 `./` 정규화).
- [ ] `not_secrets/foo.txt` 는 매치 X.
- [ ] 절대 경로 `/Users/x/repo/.env` 도 매치.
- [ ] Windows-style `src\\.env.local` 도 매치 (glob crate 의 separator 옵션).

---

## 4. 워처 통합 지점 (계획)

`src-tauri/src/oculpm/watcher.rs` 의 file_change 캡처 콜백 안:

```rust
let path = ev.path.to_string_lossy();
let ev_path = if is_forbidden_path(&path, &cfg.git.forbid_journal_for_paths) {
    let hash = sha256_hex(&path)[..8].to_string();
    format!("**redacted/sensitive**:{hash}")
} else {
    path.into_owned()
};
let event = FileChangeEvent { path: ev_path, .. };
index_writer.append_file_change(&event).await?;
```

- redacted path 는 hash 8자만 보여 같은 secret 파일의 반복 수정 가능성은 알 수 있지만 어떤 파일인지는 노출 안 됨.
- DiffVsNarrative (PR5/PR6) 도 redacted path 는 양쪽에서 제외 (페이즈 §3 W4-PR5 의 규칙).

---

## 5. DoD

- [ ] 11개 단위 테스트 통과.
- [ ] redact 정규식 디폴트 5종이 의도대로 (false positive 없이) 동작.
- [ ] glob 디폴트 5종이 절대/상대/Windows 경로 모두 매치.
- [ ] 워처가 forbid 매치 시 ndjson 의 path 가 `**redacted/sensitive**:...` 로만 기록.

---

## 6. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **redact 적용 범위 분리 (페이즈 §2.6)** — 본 PR 의 핵심 결정. path 와 content 의 정책이 다름.
2. **정규식 라이브러리** — `regex` (이미 의존성) 으로 충분. `fancy_regex` (lookbehind) 는 필요 시 W6.
3. **glob 라이브러리** — `globset` vs `glob`. `globset` 가 다중 패턴 빌드 + 매치 O(1) 제공해 더 빠름. 단, API 가 살짝 무거움.
4. **redacted hash 길이** — sha256 의 첫 8자. 충돌 가능성 < 2^-32 per project, 충분.
5. **Settings (PR7) 에서 패턴 편집 시 잘못된 정규식 검증** — `Regex::new` 결과를 에러 메시지로 inline 표시.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- W5 의 journal 작성 시도 시 frontmatter `files_touched` 의 모든 path 를 `is_forbidden_path` 로 검사 — 매치되면 거부 (페이즈 §1 W4-PR3 의 미래 적용 지점).
- PR5 (`compare_layers`) 가 redacted path 를 양쪽에서 빼고 비교 — 안 그러면 항상 mismatch.
- PR7 의 Settings 가 정규식/glob 편집 시 본 PR 의 validate 헬퍼 노출.
