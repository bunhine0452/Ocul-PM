# W3-PR1 — `frontmatter.rs` + `markdown.rs`

> **목표**: `.oculpm/journal/**/*.md` 파일의 YAML frontmatter + body 를 fail-soft 로 파싱한다. **깨진 frontmatter 도 panic 없이** body 는 항상 보존. 이후 PR2 (cache) / PR6 (Card) / PR7 (Detail) 의 입력.
> **선행**: W1 전체 ✅ (특히 PR2 `spec.rs` 의 `JournalFrontmatter` / `JournalEntry` 타입, PR5 `atomic_io`).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR1, [`../00-spec.md`](../00-spec.md) §3 (frontmatter 스키마), [`../01-backend.md`](../01-backend.md) §4.
> **상태**: ✅ 완료 (2026-05-24)

---

## 1. 시그니처 (실제 구현)

### `oculpm/frontmatter.rs`

```rust
pub const REQUIRED_FIELDS: &[&str] = &[
    "schema_version", "type", "slug", "status",
    "created_at", "session_id", "language",
];  // agent.id 는 nested — coerce_frontmatter 에서 별도 처리.

pub struct ParsedFrontmatter {
    pub raw_yaml: String,                // 파싱 실패해도 보존
    pub parsed: Option<JournalFrontmatter>,
    pub parse_warnings: Vec<String>,
}

pub fn parse_frontmatter_and_body(markdown: &str) -> (ParsedFrontmatter, String /* body */);
pub fn write_frontmatter_and_body(fm: &JournalFrontmatter, body: &str) -> String;
```

### `oculpm/markdown.rs`

```rust
pub struct ParsedBody {
    pub title: String,            // 첫 비공백 줄에서 추출
    pub checkbox: Option<bool>,   // None / Some(true) / Some(false)
    pub headers: Vec<String>,     // ## 이하 헤더, H1 제외, fenced 안 제외
    pub raw: String,              // body 원본 보존
}

pub fn parse_body(body: &str) -> ParsedBody;
```

### 구현 결정 (가이드 대비 변경)

| 항목 | 가이드 후보 | 결정 | 이유 |
|---|---|---|---|
| YAML 라이브러리 | `serde_yaml` vs `gray_matter` vs `yaml-rust2` | **`serde_yaml`** (이미 의존성에 있음) | `gray_matter` 도 같이 있지만 raw_yaml 보존 + 부분 누락 fallback 정책 제어가 generic `Value` 파싱 + 수동 coerce 가 더 직관적. 별도 의존성 추가 0. |
| frontmatter 누락 필드 정책 | (a) 전체 reject (b) 관대 fill | **혼합**: required 8 중 enum 같은 deterministic-default 불가 필드 (`type`/`slug`/`agent.id`) 는 reject, 나머지는 warn+default | 페이즈 §2 의 "fail-soft" 와 `00-spec.md §3.3` 의 "type 미정 → chore 분류" 를 절충. type 누락은 데이터 의미가 추정 불가능하므로 reject. |
| `write_frontmatter_and_body` key 순서 | serde derive vs IndexMap vs 수동 | **수동 `String` 빌드** (`render_frontmatter_yaml`) | serde_yaml 0.9 는 BTreeMap 순서가 강제 → diff 친화적이지 않음. `00-spec.md §3.1` 의 8 필드 순서를 hard-code. 모든 값은 double-quoted (slug/timestamps/paths 안전). |
| `agent` 필드 형태 | 항상 mapping 강제 | **mapping OR bare string** 둘 다 수용 | LLM 이 `agent: claude-code` 처럼 단축 쓰는 케이스가 dogfooding 에서 흔할 것으로 예상 — fail-soft 정신과 정합. `version` 필드는 mapping 형태에서만. |
| `files_touched[].op` enum 매핑 | `00-spec.md §3.1` 는 `update`, W3-PR3 plan 은 `modify` | **둘 다 → `FileOp::Update` 로 수용** | 양쪽 문서 표기 불일치 (PR3 plan 추후 정리). 사용자/LLM 양쪽 입력에 robust. |

---

## 2. 불변식 (실제 검증됨)

- `parse_frontmatter_and_body` 는 **어떤 입력에도 panic 안 함** — `fuzz_random_bytes_never_panic` (256 × 1 KiB deterministic LCG) ✅
- frontmatter 없음 → body 가 입력 전체와 byte-identical (`no_frontmatter_returns_full_body`) ✅
- opening fence 만 있고 closing 없음 → 전체 입력을 body 로 보존 + 경고 1건 (`unterminated_opening_fence_preserves_full_input_as_body`) ✅
- YAML 깨짐 → `parsed: None`, `raw_yaml` 보존, `parse_warnings` 에 `"yaml parse error: ..."` (`broken_yaml_preserves_raw_and_yields_none`) ✅
- 빈 frontmatter (`---\n---\n`) → `parsed: None`, body 보존 (`empty_frontmatter_block_warns_and_returns_none`) ✅
- `write → parse` 라운드트립 — 14 필드 모두 의미 보존 (`round_trip_write_then_parse_preserves_fields`) ✅
- body 가 `---` 로 시작하는 경우 — closing fence 1회 매치 후 본문 그대로 (`round_trip_with_body_starting_with_triple_dash_is_preserved`) ✅
- `write` 의 key 순서는 spec §3.1 순서 (`write_emits_stable_key_order` — 14 필드 인덱스 비교) ✅
- 모든 값은 double-quoted — slug/path/timestamp 의 특수문자 (`:`, `#`, `-`) 안전 ✅

---

## 3. 디스크 / 입출력 계약

- `parse_frontmatter_and_body` 는 디스크 IO 안 함 — 호출자(W3-PR2 cache, W3-PR3 manual entry 커맨드)가 read.
- `write_frontmatter_and_body` 는 순수 string 변환 — atomic 실제 쓰기는 호출자가 `atomic_io::write_atomic` 로 수행.
- `markdown::parse_body` 도 순수 함수 — 디스크 IO 없음.

---

## 4. 테스트 (실제 — 27개 모두 통과)

### `frontmatter::tests` — 14개

- [x] `parses_well_formed_frontmatter_with_no_warnings` — 14 필드 전부 정상 + warnings 0
- [x] `no_frontmatter_returns_full_body` — frontmatter 없을 때 body=입력 전체
- [x] `unterminated_opening_fence_preserves_full_input_as_body` — opening만 있고 closing 없으면 전체 보존 + warning 1
- [x] `korean_values_round_trip_through_yaml` — 한국어 본문/slug/title 정상
- [x] `unknown_type_fails_soft_with_warning` — `type: weird` → `parsed: None` + raw_yaml 보존 + warning
- [x] `missing_required_field_yields_none_with_warning` — slug 누락 → `parsed: None` + warning
- [x] `optional_fields_default_to_empty_collections` — files_touched/related/tags/verified_by_user/difficulty 모두 default 채움
- [x] `broken_yaml_preserves_raw_and_yields_none` — `[unclosed` 같은 YAML 오류 → fail-soft
- [x] `empty_frontmatter_block_warns_and_returns_none` — `---\n---\nbody\n` 안전 처리
- [x] `agent_as_bare_string_is_accepted` — `agent: manual` (bare string) → `agent.id = "manual"`
- [x] `round_trip_write_then_parse_preserves_fields` — 14 필드 의미 보존
- [x] `round_trip_with_body_starting_with_triple_dash_is_preserved` — body 의 horizontal rule 안전
- [x] `write_emits_stable_key_order` — spec §3.1 순서 강제 (8개 + 5개 인덱스 비교)
- [x] `fuzz_random_bytes_never_panic` — 256k 무작위 바이트 panic 0

### `markdown::tests` — 13개

- [x] `checkbox_x_extracts_checked_title` — `[x] 제목` + 한국어 OK + headers
- [x] `checkbox_space_extracts_unchecked_title` — `[ ] Pending` → checkbox=false
- [x] `capital_x_is_checked` — `[X]` 도 checked
- [x] `heading_form_extracts_title_with_no_checkbox` — `# Title` → checkbox=None
- [x] `raw_first_line_when_no_marker` — 일반 문장 → 그대로 title
- [x] `empty_body_yields_empty_title` — `""` 입력 panic 없이 empty title
- [x] `leading_blank_lines_are_skipped` — 빈 줄/공백 줄 후의 첫 비공백 줄을 title 로
- [x] `fenced_code_block_headers_are_excluded` — \`\`\` 안의 `## fake` 무시
- [x] `h1_is_excluded_from_headers_to_avoid_duplicating_title` — H1 은 title 과 중복 → headers 에 안 들어감
- [x] `bracket_no_space_after_does_not_match_checkbox` — `[x]NoSpace` (공백 없음) → raw form fallback
- [x] `deep_heading_levels_extract_text` — H3/H4 도 수집
- [x] `headers_with_inline_code_are_preserved` — `## fix \`db.rs\`` → "fix db.rs"
- [x] `raw_is_preserved_verbatim` — `ParsedBody.raw` 가 입력과 byte-identical

---

## 5. DoD

- [x] 핵심 8+ frontmatter 케이스 통과 (실제 14개)
- [x] 본문 첫 줄 3 형태 + 코드블록 헤더 제외 (실제 13개 markdown 테스트)
- [x] 깨진 frontmatter 입력에 panic 0 (fuzz 256 × 1 KiB)
- [x] `oculpm/frontmatter.rs`, `oculpm/markdown.rs` 신규 clippy lint **0건** (35 warnings 잔존은 pre-existing main, W1 회고대로 W6 책임)
- [x] `///` doc — `ParsedFrontmatter`, `ParsedBody`, public 함수 전수 + 모듈 doc 에 SSOT cross-reference
- [x] `00-spec.md §3` 의 필수 8 필드와 `REQUIRED_FIELDS` const 가 cross-reference (코드 + spec 양방향)
- [x] 전체 oculpm 테스트 **106 passed / 0 failed** (W2 종료 79 + 본 PR 27)
- [x] `cargo test --lib` green
- [x] `cargo clippy --lib` — 신규 모듈 warning 0

---

## 6. 실행 노트

### 변경된 파일 (3개)

| 파일 | 변경 |
|------|------|
| `src-tauri/src/oculpm/frontmatter.rs` | **신규** 717 줄 (impl ~535 + tests ~182) |
| `src-tauri/src/oculpm/markdown.rs` | **신규** 224 줄 (impl ~131 + tests ~93) |
| `src-tauri/src/oculpm/mod.rs` | `pub mod frontmatter;` + `pub mod markdown;` 추가 (2 줄) |

### 발견된 함정 / 변경

1. **`pulldown-cmark 0.10` 의 `Tag::Heading` API 변경** ⚠ — 가이드 예시는 `Tag::Heading(level, _, _)` (튜플 variant) 이었으나 0.10 은 struct variant 로 변경됨. `Tag::Heading { level, .. }` + `TagEnd::Heading(_)` 로 수정. 컴파일 에러 1회로 즉시 발견.
2. **`---\n---\nbody\n` 빈 frontmatter 처리** ⚠ — 초기 구현은 `\n---` 검색만 했더니 opening fence 바로 다음 행의 closing fence 를 못 잡음. `split_closing_fence` 에 "rest 가 `---\n` 으로 시작하면 즉시 empty yaml + body" 분기 추가. 테스트 1개 실패 → 1줄 수정으로 해결.
3. **`OculpmError::Frontmatter` 미사용 결정** — `01-backend.md §13` 의 에러 enum 후보에 `Frontmatter { path, message }` 가 있었으나, **본 PR 의 파서는 `Result` 가 아니라 `ParsedFrontmatter`(infallible)** 를 반환하는 fail-soft 설계라 별도 variant 불필요. PR2 (cache) 가 디스크 read 실패시 기존 `OculpmError::Io` 만 사용하면 충분.
4. **`gray_matter` 의존성 미사용** — `Cargo.toml` 에 의존성은 남아있으나 본 PR 은 `serde_yaml` 직접 호출만 사용. W4 의 어댑터 sync 가 별도 frontmatter 처리를 한다면 그때 재평가 — 현재는 제거 안 함 (의존성 cleanup 은 W6 stabilize 후보).
5. **`FileOp::Update` vs `FileOp::Modify`** — `00-spec.md §3.1` 와 `01-backend.md §4` 는 `update`, W3-PR3 워킹 doc 의 `EntryFilters` 예시는 `modify` 라고 적혀있었음. 본 PR 의 파서는 **둘 다 `FileOp::Update` 로 매핑**해서 외부 LLM/사용자 양쪽 입력에 robust. W3-PR3 doc 의 `modify` 표기는 PR3 진입 시 정리 권장.
6. **YAML scalar stringify 정책** — `created_at`, `updated_at`, `session_id` 등은 spec 상 string 이지만 LLM 이 quote 없이 쓰면 YAML 이 다른 타입으로 해석. `stringify_scalar` 가 String / Number / Bool 을 모두 String 으로 코어스. Null / Sequence / Mapping 은 `None` 반환 (=필드 누락 처리).

### 의도된 누락 (PR2/PR3 에 위임)

- **on-disk read/write** — PR2 의 `JournalCache::apply_path_change` 가 `std::fs::read_to_string` + `atomic_io::write_atomic` 으로 호출자 책임.
- **`OculpmError` integrity event** — `OculpmIntegrityWarning` (kind=`frontmatter_parse`) emit 은 PR2 의 cache layer 가 `parse_warnings` 보고 trigger.
- **slug 정규식 검증** — `^[a-z0-9_-]{1,60}$` 검증은 PR3 의 `oculpm_create_manual_entry` 커맨드 책임. 파서는 frontmatter slug 값을 검증 없이 수용 (기존 디스크 파일도 fail-soft 로 indexing 되어야 함).

### 빌드/테스트 시간

- `cargo test --lib oculpm::` — **4.18s** (106 tests, oculpm 전체)
- `cargo clippy --lib -p ai-pm` — **1.74s** (캐시 hit)
- 신규 모듈 clippy warnings **0건**

### W3-PR2 / PR3 로 넘기는 메모

- **PR2 (`cache.rs`)** —
  - `ParsedFrontmatter.parsed.is_none()` 인 entry 의 cache 정책: `parse_ok=0` + `parse_warnings` JSON 컬럼 채움. title 은 `parse_body` 의 fallback (첫 비공백 줄). 카드의 "노란 dot" 분기는 `parse_ok=0 || !parse_warnings.is_empty()`.
  - `apply_path_change` 가 `set_journal_verified` 의 write 를 다시 감지하지 않도록, PR3 의 `set_journal_verified` 가 **write-through** 패턴으로 cache 를 직접 upsert + watcher 이벤트는 skip 마커로 식별. (PR3 워킹 doc §7 메모와 동일.)
  - `body_md_hash` 의 입력은 `ParsedBody.raw` (체크박스 prefix 포함된 원본). frontmatter 만 바뀌고 body 동일 → hash 동일 → mtime-only update.

- **PR3 (commands)** —
  - `create_manual_entry` 가 frontmatter 채울 때 본 PR 의 `write_frontmatter_and_body` 호출. `JournalFrontmatter` 의 14 필드 모두 채우거나 None 으로 명시 (writer 가 None 을 자동 omit).
  - `set_journal_verified` 가 frontmatter 만 토글: `(pf, body) = parse_frontmatter_and_body(text); pf.parsed?.verified_by_user = !; write(...)`. `parsed.is_none()` 이면 `Err("cannot verify entry with broken frontmatter")` — PR3 워킹 doc 의 §3 규약과 일치.

- **PR1 자체의 미해결 항목 없음** — 다음 PR 진입 가능.
