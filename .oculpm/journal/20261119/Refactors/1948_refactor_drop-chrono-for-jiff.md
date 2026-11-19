---
schema_version: 1
type: refactor
slug: "drop-chrono-for-jiff"
status: done
difficulty: high
created_at: "2026-11-19T19:48:12+09:00"
session_id: "manual-20261119-194812"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/clock.rs"
    op: create
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/commands/hotspot.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/commands/race.rs"
    op: update
  - path: "src-tauri/src/commands/scorecard.rs"
    op: update
  - path: "src-tauri/src/commands/window/attention.rs"
    op: update
  - path: "src-tauri/src/db/scorecard.rs"
    op: update
  - path: "src-tauri/src/db/velocity.rs"
    op: update
  - path: "src-tauri/src/git/spawn_count_tests.rs"
    op: update
  - path: "src-tauri/src/home.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/conv.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/write.rs"
    op: update
  - path: "src-tauri/src/oculpm/cas.rs"
    op: update
  - path: "src-tauri/src/oculpm/config/timezone.rs"
    op: update
  - path: "src-tauri/src/oculpm/entry_diffs.rs"
    op: update
  - path: "src-tauri/src/oculpm/entry_diffs_tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/file_guard.rs"
    op: update
  - path: "src-tauri/src/oculpm/frontmatter/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/frontmatter/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/lock.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/indexing.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/session_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/tags.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/hook_tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/ask.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_create.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/paths.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/stale.rs"
    op: update
  - path: "src-tauri/src/oculpm/refix.rs"
    op: update
  - path: "src-tauri/src/oculpm/refix_tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/session/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/session/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/session_id.rs"
    op: update
  - path: "src-tauri/src/oculpm/supervisor.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/cli.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/collect.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/ledger.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/hooks.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/tests.rs"
    op: update
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_output.rs"
    op: update
  - path: "src-tauri/tests/home_brief.rs"
    op: update
  - path: "src-tauri/tests/lite_w6_safety_net.rs"
    op: update
  - path: "src-tauri/tests/oculpm_lock_scope.rs"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: update
related:
  - ".oculpm/journal/20261119/Bugs/1622_bug_windows-install-update-polish.md"
tags:
  - "의존성"
  - "시각"
  - "보안"
---
[x] 의존성: chrono 를 걷고 jiff 로 옮겼다

## 동기
v4.11.1 태그의 CI 가 cargo-deny 에서 붉어 릴리스가 게이트에서 멈췄다. RustSec 이 그 나흘 사이 chrono(RUSTSEC-2026-0543)와 chrono-tz(RUSTSEC-2026-0555)를 「관리 중단」 으로 올렸다. 4일 전 main 은 초록이었다. 취약점은 아니고 고칠 판도 없다(「No safe upgrade」). 공지를 ignore 에 적는 길은 사용자가 고르지 않았고, 「chrono 를 먼저 걷고 릴리스」 로 정했다(2026-11-19).

## 변경 요약
- `src/clock.rs`(새 모듈, `pub mod clock`): jiff 0.2(이미 그래프에 있던 판) 위에서 시각을 한 곳에 모았다. 디스크 · DB · 원장에 적힌 글자는 읽는 쪽이 문자열로도 비교하므로, chrono 가 내던 꼴을 그대로 낸다. `to_rfc3339()` 는 `rfc3339`(소수 초 0·3·6·9자리, 끝 `+00:00`), `to_rfc3339_opts(Secs/Millis, true)` 는 `rfc3339_z` · `rfc3339_millis_z`, 일지 `created_at` 은 `zoned_rfc3339` · `zoned_rfc3339_secs` 가 맡는다. 시간대는 `zone` · `earliest`(가을 겹침은 앞의 것, 봄 틈은 None) · `single`, 날짜는 `local_today` · `add_days` · `days_between` · `ymd` 다.
- 시간대 데이터는 chrono-tz 처럼 실행 파일에 굽는다(`tzdb-bundle-always`). zoneinfo 가 없는 리눅스에서도 `Asia/Seoul` 이 풀려야 일지 날짜 칸이 선다.
- `WorkdayResolver`(`tz: TimeZone`, `day_starts_at: civil::Time`) · 세션 · 캐시 오프셋 보정 · 워처 · MCP 도구 · 원장 · 락 · 속도/점수표 · 재수정 경고를 옮겼다. `SessionId::manual` 류는 `civil::Time` 을 받는다.
- 기계적 치환(`Utc::now` · `to_rfc3339` · `parse_from_rfc3339` · `Duration::days`)은 스크립트로 하고, 남은 자리는 컴파일러가 짚은 대로 손으로 고쳤다. chrono · chrono-tz 를 Cargo.toml 에서 뺐다. Cargo.lock 에는 serde_with 의 꺼진 선택 의존으로만 남고 빌드되지 않는다(`cargo tree -i chrono --target all` 빈 출력).

## 검증
- 걷기 전 chrono 와 나란히 돌린 임시 시험: 여섯 순간 × 네 꼴(UTC · 서울 · 뉴욕 · strftime)이 글자 단위로 같았다. chrono-tz 의 모든 IANA 이름이 jiff 에서 풀렸다. 오프셋이 다른 것은 11곳이고 전부 tzdata 판 차이다. jiff 쪽이 새 규칙을 담았다(캐나다 서부 · 중부 2026 · 모로코). 기대 글자는 `clock::tests` 에 고정했다.
- `cargo test --locked` → passed 1217 failed 0 (전 1210 + clock 7) · `cargo clippy --all-targets --locked -- -D warnings` 통과 · `cargo fmt --check` exit 0
- cargo-deny 는 이 PC 에 없다 — main push 의 CI 가 판정한다(`deny.toml` `all-features = false`).

## 메모
v4.11.1 태그는 원격에 남아 있지만 릴리스는 만들어지지 않았다(게이트에서 멈춤). 규칙대로 태그를 옮기지 않고 같은 내용을 v4.11.2 로 낸다.
