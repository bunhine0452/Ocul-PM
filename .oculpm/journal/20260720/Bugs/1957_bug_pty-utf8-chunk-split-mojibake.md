---
schema_version: 1
type: bug
slug: "pty-utf8-chunk-split-mojibake"
status: done
difficulty: medium
created_at: "2026-07-20T19:57:13+09:00"
session_id: "mcp-20260720-195713"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
related: []
tags:
  - "terminal"
  - "utf8"
  - "pty"
  - "korean"
  - "dogfooding"
  - "mcp-tool"
---
[x] 터미널 한글·박스문자 깨짐 — PTY 출력 UTF-8 청크 경계 분할 디코드 버그

## 발생 원인

도그푸딩 스크린샷에서 Claude Code 의 수평선(`─` U+2500) 한가운데 `��`(U+FFFD×2)가 박혀 있었고, 한글 에코도 간헐적으로 깨졌다("자모 안 합쳐짐"으로 체감). 원인은 `src-tauri/src/commands/terminal.rs` 의 PTY 읽기 루프: 4096바이트 `read(2)` 청크마다 `String::from_utf8_lossy` 를 **독립 호출**해서, 한글(3B)·박스문자(3B)·이모지(4B)가 청크 경계에 걸리면 앞뒤 청크 각각에서 잘린 바이트가 U+FFFD 로 치환됐다. 출력량이 많은 TUI(Claude Code 등)에서 특히 잘 재현된다. (기존 2026-07-16 의 LANG 로케일 fix 는 입력 측이라 이 출력 측 버그를 못 잡았다.)

## 해결 방법

- `drain_utf8(pending: &mut Vec<u8>) -> String` 스트리밍 디코더 추가: 디코딩 가능한 최장 prefix 만 뽑고, 경계에 걸린 **미완성 시퀀스(≤3바이트)는 다음 read 로 이월**. 진짜 잘못된 바이트만 U+FFFD 치환 후 계속 진행(교착 없음), EOF 시 잔여분 lossy 마감.
- 재현 테스트 6건 고정: 한글 3B 분할, 스크린샷 재현(박스문자 분할), 이모지 4B 분할, invalid+한글+미완성 tail 혼합, ASCII 통과, 링버퍼 seq.
- 부수: `COLORTERM=truecolor` 광고(xterm.js 5.x 트루컬러), 읽기 버퍼 8192 로.

## 검증

- `cargo test` 390건 전부 통과 (신규 terminal 6건 포함, bindings.ts 재생성 정상).
- `pnpm typecheck / test(194) / lint / build` exit 0.
- 실기기에서 Claude Code 수평선·한글 타이핑 체감 확인은 사용자 몫.