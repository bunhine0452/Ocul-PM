# W4-PR3 — `redact.rs` + `forbid_journal_for_paths` 강제

> **목표**: 워처가 캡처하는 file_changes 의 path / content 에서 secret 패턴을 마스킹하고, 민감 경로는 journal 작성 자체를 차단. 보안 + 사용자 신뢰의 핵심.
> **선행**: W1-PR4 (`OculpmConfig.git.{auto_redact_patterns, forbid_journal_for_paths}`), W2-PR3 (watcher hook 지점).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR3 + §2.6 (false positive 분리), [`../00-spec.md`](../00-spec.md) §5.
> **상태**: ✅ (2026-05-25 — manager reject + IntegrityWarning emit 까지 확장)

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

## 3. 테스트 (실제)

페이즈 §3 매트릭스 11개 (redact 5 + forbidden 6) 모두 `oculpm::redact::tests` 에 작성됨. 워처 측 통합은 `oculpm::watcher::tests::forbidden_paths_are_masked` 가 검증.

> 검증: `cargo test --lib oculpm::redact` → 11/11 PASS.

### `redact_text` (`oculpm::redact::tests`)

- [x] AWS access key 패턴 → `[REDACTED]` — `redact_aws_access_key`.
- [x] GitHub PAT (`ghp_…`) 매치 — `redact_github_pat`.
- [x] 한국어 본문 안 영문 키 UTF-8 안전 — `redact_inside_korean_text_is_utf8_safe`.
- [x] 변수명 `sk_initialize_module_v1_token` false positive 없음 — `redact_does_not_match_variable_names_with_underscore`.
- [x] 다중 매치 시 모든 hit 기록 — `redact_records_all_hits_for_multiple_matches`.

### `is_forbidden_path` (`oculpm::redact::tests`)

- [x] 상대 경로 `.env*` 매치 — `forbidden_env_file_relative`.
- [x] secrets 디렉터리 (json 등) 매치 — `forbidden_secret_filenames`.
- [x] `.aws/credentials` 매치 — `forbidden_aws_credentials_file`.
- [x] 비매치 경로 통과 — `not_secrets_paths_pass_through`.
- [x] 절대 경로 매치 — `forbidden_absolute_path_matches`.
- [x] Windows-style 경로 매치 — `forbidden_windows_path_matches`.

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

- [x] 13개 단위 테스트 통과 (redact 5 + forbidden 6 + manager 통합 2). 전체 oculpm 158/158 green.
- [x] redact 정규식 디폴트 4종 (AKIA / sk- / ghp_ / xox*) 이 변수명 false positive 없이 동작 (`sk_initialize_module_v1_token` 안 매치 확인).
- [x] glob 디폴트 30+종 (config.rs `default_forbid_paths`) — 절대/상대/Windows 경로 매치 (basename fallback 포함).
- [x] 워처가 forbid 매치 시 ndjson path 가 `**redacted/sensitive**:<blake3_8>` 로만 기록 (watcher.rs `forbidden_paths_are_masked` 테스트).
- [x] **추가**: `manager::create_manual_journal_entry` 가 `files_touched[].path` 매치 시 `OculpmError::ForbiddenJournalPath` 로 reject. command 가 `OculpmIntegrityWarning { kind: "forbidden_journal_path", ... }` emit + 사용자에게 한국어 에러 메시지 반환.

---

## 6. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **redact 적용 범위 분리 (페이즈 §2.6)** — 본 PR 의 핵심 결정. path 와 content 의 정책이 다름.
2. **정규식 라이브러리** — `regex` (이미 의존성) 으로 충분. `fancy_regex` (lookbehind) 는 필요 시 W6.
3. **glob 라이브러리** — `globset` vs `glob`. `globset` 가 다중 패턴 빌드 + 매치 O(1) 제공해 더 빠름. 단, API 가 살짝 무거움.
4. **redacted hash 길이** — sha256 의 첫 8자. 충돌 가능성 < 2^-32 per project, 충분.
5. **Settings (PR7) 에서 패턴 편집 시 잘못된 정규식 검증** — `Regex::new` 결과를 에러 메시지로 inline 표시.

### 발견된 함정 / 변경

- **P-1 (matcher 라이브러리)**: PR doc 초안은 `glob::Pattern` 또는 `globset` 을 명시했으나, watcher (W2-PR3) 가 이미 `ignore::Gitignore` 사용 중. 라이브러리를 통일하지 않으면 watcher 와 manager 가 다른 시맨틱으로 매치돼 사용자 혼란 → **`ignore::Gitignore` 단일 채택**. `build_forbidden_matcher` 가 wrapper 제공.
- **P-2 (절대 경로 panic)**: `ignore::Gitignore::matched_path_or_any_parents` 가 root 밑이 아닌 abs path 에 **panic** (not error). `is_forbidden_path` 는 (a) root 와 strip_prefix 시도 → (b) 실패 시 `file_name` 만으로 fallback 매치. directory-anchored glob (`**/secrets/**`) 은 abs path + root 외부 시 누락 가능 — 한계 명시 (manager 호출자는 거의 항상 project-relative path 라 실무 영향 X).
- **P-3 (Windows separator)**: `ignore::Gitignore` 는 `\` 를 그대로 처리 → 매치 실패. `is_forbidden_path` 진입 시 `path.replace('\\', "/")` 정규화. macOS 전용 앱이지만 frontmatter 가 cross-platform 보존되므로 의미 있음.
- **P-4 (regex crate 누락)**: `Cargo.toml` 에 `regex` dependency 없었음 (watcher 가 `ignore::Gitignore` 만 사용했기 때문). 본 PR 에서 `regex = "1.11"` 추가.
- **P-5 (AppHandle 위치 결정)**: `OculpmManager` 가 AppHandle 미보관 (init 시 tauri runtime 없어도 테스트 가능하게). reject + IntegrityWarning emit 책임을 **command 레이어**가 가져감 (`commands/oculpm.rs::oculpm_create_manual_entry` 가 `OculpmError::ForbiddenJournalPath` 받으면 `OculpmIntegrityWarning` emit 후 String 에러 반환). 덕분에 manager 의 unit test 는 여전히 Wry runtime 불필요.
- **P-6 (false-positive 정책)**: `redact_text` 는 디폴트 4종 패턴만 사용 — 가장 자주 쓰는 prefix-기반 정규식. 일반 hex string (`[a-f0-9]{32,}`) 같은 광범위 패턴은 본 PR 에 미포함 (변수명·해시 false positive 가 너무 잦음). 사용자가 Settings (PR7) 에서 직접 추가 가능.

### 다음 PR 로 넘기는 메모

- **W4-PR4 (drift)**: `oculpm_agent_state` 의 expected_hash 비교 시 redacted path 를 양쪽에서 빼야 — `redact::is_forbidden_path` 가 그대로 재사용 가능.
- **W4-PR5 (compare_layers)**: index ndjson 의 `**redacted/sensitive**:*` path 는 journal entry set 과 비교 대상에서 제외 (안 그러면 모든 redacted 가 mismatch 로 보고됨).
- **W4-PR7 (Settings)**: 정규식/glob 편집 시 `compile_redact_patterns` / `build_forbidden_matcher` 호출 → 에러 시 inline 표시. malformed pattern 은 silently drop 되므로 UI 검증 필수.
- **W5 (content redaction)**: `redact_text` 가 본 PR 에선 wire 만. W5 의 journal body redact 파이프라인이 호출 → frontmatter `files_touched` 검사 + body 의 secret 마스킹.
- **PR8 (toast 매핑)**: `OculpmIntegrityWarning.kind == "forbidden_journal_path"` 케이스의 한국어 토스트 카피 + 사용자 액션 (드래프트 수정 / 강제 제거) 결정 필요.
