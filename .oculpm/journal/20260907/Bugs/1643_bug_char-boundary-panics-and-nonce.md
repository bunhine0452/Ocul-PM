---
schema_version: 1
type: bug
slug: "char-boundary-panics-and-nonce"
status: done
difficulty: medium
created_at: "2026-09-07T16:43:17+09:00"
session_id: "20260907-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/text.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/deeplink.rs"
    op: update
  - path: "src-tauri/src/notion.rs"
    op: update
  - path: "src-tauri/src/lsp/registry.rs"
    op: update
  - path: "src-tauri/src/commands/overview.rs"
    op: update
  - path: "src-tauri/src/llm/mod.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/plugins/install.rs"
    op: update
  - path: "src-tauri/capabilities/default.json"
    op: update
related: []
tags:
  - "감사"
  - "패닉"
  - "보안"
  - "utf-8"
  - "딥링크"
  - "mcp-tool"
---
[x] 문자 경계 패닉 4곳과 예측 가능한 OAuth nonce 를 닫는다

2026-09-07 전영역 코드 감사(정적 스캔 + clippy + eslint + 프로덕션 빌드 + 패닉 실증)에서 **확정한 것만** 닫았다. 게이트는 전부 초록이었으므로 이 라운드는 "깨진 것"이 아니라 **"돌아가지만 잘못돼 있는 것"** 을 다룬다.

## 발생 원인

네 결함이 **뿌리 하나**다: `String` 을 바이트 인덱스로 슬라이스하면 그 인덱스가 UTF-8 문자 중간일 때 패닉한다. 한국어가 기본 UI 언어인 앱에서 이건 이론이 아니다 — 3바이트 문자가 기본이라 임의의 바이트 오프셋이 경계일 확률이 1/3 이다.

### ① 퍼센트 디코더 3벌이 `%` + 멀티바이트에서 죽는다

`deeplink.rs` · `notion.rs` · `lsp/registry.rs` 에 **글자까지 같은** 디코더가 세 벌 있었고, 셋 다 `&s[i + 1..i + 3]` 이었다. 떼어 내 실행해 실증:

```
percent_decode("%한x")
→ panicked: end byte index 3 is not a char boundary; it is inside '한'
```

딥링크는 **웹페이지가 링크 한 줄로 유발할 수 있다** — `oculpm://open?project=%한` 이면 `lib.rs` 의 `on_open_url` 콜백에서 터진다. 세 사본 중 가장 바깥에 노출된 자리였다.

### ② `commands/overview.rs` 의 매니페스트 절단이 경계를 안 본다

`&content[..content.len().min(24 * 1024)]`. README.md 가 24KB 를 넘고 24,576 번째가 문자 중간이면 `generate_project_overview` 가 패닉한다.

**이 저장소가 1바이트 차이로 비켜가 있었다.** README.md(97,612 B)의 24,576 번째는 마침 리드 바이트(`0xeb`)다 — 그 앞뒤 24,575·24,577 은 둘 다 연속 바이트다.

### ③ 같은 가드가 세 곳에는 **있었다**

`llm/mod.rs` · `commands/oculpm.rs` · `acp/session.rs` 는 각자 손으로 `is_char_boundary` 루프를 돌고 있었다. 즉 이 저장소는 함정을 이미 알고 있었는데, **아는 것이 코드 한 자리에 모여 있지 않아서** 네 번째 사본이 틀렸다.

### ④ `notion.rs oauth_nonce()` 가 CSPRNG 가 아니다

`blake3(nanos + pid + counter)`. 셋 다 로컬에서 알아낼 수 있다 — pid 는 `ps` 로 보이고, 카운터는 0 에서 시작하며, 나노초는 브라우저가 열리는 순간을 보면 좁혀진다. blake3 는 오프라인 브루트포스가 빠르니 "해시했으니 안전"이 성립하지 않는다. 맞히면 180초 창 안에 **공격자의 Notion 토큰을 사용자 키체인에 주입**할 수 있었다.

## 해결 방법

**새 모듈 `src-tauri/src/text.rs`** — 문자 경계를 지키는 문자열 다루기를 한 자리에 모았다.

- `percent_decode` — `%` 뒤 두 바이트를 **바이트로 직접** hex 파싱한다. 슬라이스가 없으니 경계라는 개념이 등장하지 않는다. `+` 는 공백으로 보지 않는 기존 규약 유지.
- `floor_char_boundary(s, max)` — `max` 를 넘지 않는 가장 큰 경계.
- `truncate_with(s, max, suffix)`.

세 디코더와 **네** 절단 자리(맞던 셋 포함)를 전부 이 모듈로 보냈다. 맞던 셋까지 옮긴 이유는 이번 결함이 "중복이 만든 결함"이라서다 — 다음 사람이 다섯 번째 사본을 쓰지 못하게 하는 것이 실제 수정이다.

곁들여 닫은 것 셋:

- `oauth_nonce()` → `uuid::Uuid::new_v4().simple()`. 같은 저장소 `mobile_bridge/pairing.rs` 가 이미 쓰던 규약에 맞췄다.
- `plugins/install.rs secure_join` — 주석은 "심링크 탈출을 전부 거절한다"인데 구현은 어휘적 검사뿐이었다. 성분을 이어 붙이며 `symlink_metadata` 로 심링크 성분을 거절하게 해 주석을 사실로 만들었다. `canonicalize` 를 못 쓰는 이유는 목적지가 아직 없는 파일이라서다.
- `capabilities/default.json` 의 `opener:allow-open-path {path: "**"}` 제거. 웹뷰 호출자가 **0** 이다 — `@tauri-apps/plugin-opener` 임포트는 `OculpmSettings` 의 `revealItemInDir` 하나뿐이고 나머지는 전부 백엔드 `open_url` 커맨드를 지난다.

## 검증

- 회귀 테스트 4개 추가: `text::tests::multibyte_after_percent_does_not_panic` · `deeplink::tests::a_crafted_query_cannot_panic_the_parser` · `commands::overview::tests::a_korean_readme_does_not_panic_at_any_budget_phase`(예산 잔여 0·1·2 세 위상 전부) · `plugins::install::tests::a_destination_cannot_escape_through_a_symlink`.
- 게이트 전부 초록: `cargo test` 1,373 · `pnpm test` 2,403 · typecheck · lint 6종 · build · `clippy --all-targets -D warnings` 0 · `cargo fmt --check`.
- `tauri.conf.json` 의 `csp: null` 은 **닫지 않았다** — wasm 포매터·xterm webgl·CodeMirror·GitHub 릴리스 fetch 가 전부 걸리는 변경이라 앱을 실제로 띄워 보지 않고는 확인할 수 없다. 플랜에 실기기 확인 항목으로 남겼다.