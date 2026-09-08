---
schema_version: 1
type: bug
slug: "config-save-strips-hand-written-comments"
status: done
difficulty: low
created_at: "2026-09-08T16:12:09+09:00"
session_id: "20260908-004"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/config.rs"
    op: update
related: []
tags:
  - "config"
  - "toml"
  - "toml-edit"
  - "regression-guard"
  - "mcp-tool"
---
[x] 설정을 저장할 때마다 config.toml 의 손으로 쓴 주석이 날아갔다

오늘 병렬 세션 작업을 수습하다 잡았다. `.oculpm/config.toml` 이 modified 인데 **규칙 값은 하나도 안 바뀌고 주석 16줄만 사라져** 있었다 — `forbid_journal_for_paths` 의 `{#token-glob-false-positive}` 근거 블록, 즉 왜 `!**/*.rs` 같은 되돌림 규칙이 그 순서에 있어야 하는지를 설명하는 유일한 자리였다.

## 발생 원인

`OculpmConfig::save` 의 멱등 검사가 **바이트 비교**였다.

```rust
let text = toml::to_string_pretty(self)?;
if let Ok(existing) = std::fs::read(path) {
    if existing == text.as_bytes() { return Ok(()); }   // 절대 참이 안 된다
}
write_atomic(path, text.as_bytes())
```

생성본에는 주석이 없으므로 주석이 있는 파일은 이 비교에서 **영원히 다르다**. 즉 문이 늘 열려 있었고, 값이 하나도 안 바뀐 저장에서도 전체 직렬화 결과를 덮어썼다. 설정 화면을 열었다 닫는 것만으로도 재발한다.

증상이 고약한 이유는 값이 안 바뀐다는 데 있다. diff 가 "설정 안 건드렸네"로 읽히고, 그대로 `git add` 하면 문서화된 결정 근거가 조용히 지워진다.

## 해결 방법

두 층으로 막았다.

**① 판정을 바이트에서 값으로.** 기존 파일을 파싱해 `self` 와 같으면 디스크를 아예 건드리지 않는다 (`OculpmConfig` 는 이미 `PartialEq` 를 파생한다). 2026-07-20 에 이 멱등 검사를 넣은 원래 목적(같은-내용 재작성이 watcher 재시작 경고와 dev 웹뷰 전체 리로드를 유발)도 이제야 실제로 달성된다.

**② 값이 진짜 바뀐 경우는 toml_edit 으로 제자리 병합.** `merge_preserving_decor` 가 생성본의 값만 기존 문서에 얹는다. 핵심은 `merge_table` 안의 한 줄 — **값이 같으면 아예 손대지 않는다.** 이것이 배열 *안쪽* 주석을 살린다(우리 피해자가 정확히 거기 있었다). 표는 통째로 갈아끼우지 않고 파고들며, 구조체에서 사라진 키는 지운다. `same_value` 는 양쪽을 `toml` 파서에 한 번 통과시켜 비교하므로 "줄바꿈만 다른 같은 배열"에 속지 않는다.

**값이 우선이다.** 병합 결과가 `self` 를 그대로 되읽지 못하면 주석을 포기하고 생성본을 쓴다 — 설정 파일이 실제 설정과 어긋나는 쪽이 훨씬 나쁘다. 새 스칼라 키가 표 뒤에 삽입되어 소속이 바뀌는 경우가 이 그물에 걸린다.

`mcp/codex.rs` 가 남의 MCP 서버 정의에 쓰는 것과 같은 규율이고, `toml_edit` 은 이미 직접 의존성이라 새로 붙인 것이 없다.

## 검증

회귀 테스트 3건을 붙이고 **옛 코드에서 셋 다 빨개지는 것을 실제로 확인했다** (`save()` 본문만 임시로 되돌려 실행 → 3 failed, 되돌린 뒤 → 14 passed).

- `save_without_changes_leaves_the_file_untouched` — 주석 단 파일에 같은 값으로 저장 → 한 바이트도 안 바뀐다
- `save_with_changes_keeps_untouched_comments` — `debounce_ms` 만 바꿔도 다른 절의 주석이 산다
- `save_keeps_comments_inside_an_untouched_array` — `forbid_journal_for_paths` **배열 안쪽** 주석이 살고, 병합 결과가 값을 그대로 되읽는다 (사고 현장 그대로의 모양)

게이트 7종 전부 exit 0 — `pnpm typecheck·test·lint·build` + `cargo fmt --check`·`clippy --all-targets -D warnings`·`test`.