---
schema_version: 1
type: bug
slug: "cmd-shell-quoting-for-windows"
status: done
difficulty: low
created_at: "2026-09-08T18:42:56+09:00"
session_id: "20260908-005"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "faee9c1b-8293-4d9c-8bad-017834dd5425"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
related: []
tags:
  - "security"
  - "windows"
  - "shell"
  - "mcp-tool"
---
[x] 외부 편집기 실행이 cmd 에 POSIX 인용을 넘기고 있었다

## 발생 원인

`sh_quote` 는 하나뿐이었고 POSIX 규칙(작은따옴표)만 알았다. 그런데
`spawn_detached` 의 Windows 분기는 `cmd /C` 이고, **cmd 는 작은따옴표를 인용으로
읽지 않는다** — `'C:\p\a&calc&b.rs'` 는 리터럴 한 덩어리가 아니라 `&` 에서 끊긴 세
명령이 된다. 즉 Windows 에서는 2026-07-30 에 닫았다고 적어 둔 그 구멍이 그대로
열려 있었다.

실제 배포는 macOS 뿐이라 사고는 없었지만 `bundle.targets` 가 `"all"` 이라 형식상
열려 있었고, 무엇보다 **아무도 그 분기를 컴파일한 적이 없었다** — `cfg` 안에 든
코드는 그 플랫폼에서 빌드하기 전까지 컴파일도 테스트도 되지 않는다.

## 해결 방법

`posix_quote` 와 `cmd_quote` 를 **둘 다 항상 컴파일되는 순수 함수**로 갈랐고,
`sh_quote` 가 `cfg!` 로 고른다. 이렇게 두면 두 규칙 모두 **모든 플랫폼의 테스트가**
문다 — cfg 로 가르면 검증되지 않는 반쪽이 다시 생긴다.

`cmd_quote` 는 큰따옴표로 감싼다. cmd 는 인용 안에서 `&`·`|`·`<`·`>`·`(`·`)`·`^` 를
특별하게 보지 않으므로 이것만으로 주입이 닫힌다. `"` 는 지운다(Windows 파일명 예약
문자라 정상 경로에 올 수 없고, 넘어오면 인용이 깨진다 — 엉뚱한 경로로 실패하는 편이
임의 명령을 실행하는 것보다 낫다). `%` 는 남긴다: Windows 에서 합법적인 파일명
문자라 지우면 멀쩡한 파일을 못 열고, 펼쳐지더라도 결과는 여전히 따옴표 안이다.

## 검증

새 단위 5건 (`external_editor::quoting`) — 메타문자가 인용 안에서 리터럴로 남고,
역슬래시가 이스케이프로 읽히지 않고, `"` 로 인용을 못 깨고, `%` 는 살아남고, **두
셸의 인용 규칙이 서로 다르다는 사실 자체**를 문다. POSIX 계약을 문는 기존 14건은
그대로 통과한다.