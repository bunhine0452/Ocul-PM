---
schema_version: 1
type: bug
slug: "deny-zip-advisory-updater-2141"
status: done
difficulty: low
created_at: "2026-11-02T19:08:33+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "deny.toml"
    op: update
related: []
tags:
  - "의존성"
  - "deps"
  - "ci"
  - "security"
  - "mcp-tool"
---
[x] 의존성: 업데이터 zip 공지를 판 올림으로 닫았다

## 발생 원인
2026-11-02 에 새 공지 RUSTSEC-2026-0429 가 나왔다. zip 의 `ZipArchive::extract()` 가 심링크 대상 버퍼를 중앙 디렉터리에 선언된 크기로 잡아서, 거대 할당이 날 수 있다는 내용이다. 이 공지 때문에 CI 의 cargo-deny 잡이 붉었다. PR #146(문구만 바꾼 PR)에서 처음 드러났고, 같은 Cargo.lock 을 쓰는 main 도 같은 상태였다.
- 걸린 것은 zip 4.6.1 하나다. `cargo tree -i zip --target all` 로 보면 tauri-plugin-updater 2.14.0 의 Windows 전용 의존이다.
- 같은 크레이트의 0367/0368/0369 는 10-18 부터 deny.toml ignore 에 있었다. 잠재운 이유는 「서명 검증 뒤에만 extract」였다.

## 해결 방법
- tauri-plugin-updater 2.14.1 이 zip ^9 를 문다(crates.io 의존 목록으로 확인). `cargo update -p tauri-plugin-updater` 로 2.14.0 → 2.14.1, zip 4.6.1 → 9.2.2 가 됐고, typed-path 0.13.0 이 새로 들어왔다.
- ignore 의 해제 조건(「updater 가 zip>=9 를 물면」)이 채워졌다. 그래서 ignore 를 비우고 경위를 주석으로 남겼다.

## 검증
- `cargo deny --manifest-path src-tauri/Cargo.toml --config deny.toml check`(CI 와 같은 인자): advisories ok, bans ok, licenses ok, sources ok.
- `cargo test --locked`: 1074 passed, 0 failed.