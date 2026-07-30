---
schema_version: 1
type: bug
slug: "write-to-pty-silent-success"
status: done
difficulty: medium
created_at: "2026-07-31T04:06:51+09:00"
session_id: "mcp-20260731-040651"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
related: []
tags:
  - "terminal"
  - "pty"
  - "dispatch"
  - "a0d-finding"
  - "mcp-tool"
---
[x] 디스패치 프리필 증발 — write_to_pty 가 미지의 세션에도 조용히 성공하던 문제

## 발생 원인

빈 화면(webgl) 수정 후에도 ▶실행 프리필이 안 뜸. 백엔드는 정상(`.oculpm/index/dispatch/` 에 프롬프트 파일 실생성 확인) — 문제는 PTY 쓰기 계약:

`write_to_pty` 가 `if let Some(session)` 밖으로 떨어지는 **미지의 세션 id 에도 `Ok(())`** 를 반환했다. 프리필 루프는 "성공 시 소비" 설계인데, 세션 기동 전 첫 틱에서 백엔드가 성공이라 답하니 명령을 소비하고 종료 — 아무 데도 쓰이지 않은 채 증발. (1차 프리필 수명 수정이 "성공 후 소비"로 올바르게 바꿨지만, 성공 신호 자체가 거짓이었다.)

## 해결 방법

미지의 세션 → `Err("unknown pty session: <id>")` 명시 반환. 호출측 영향: 프리필 루프는 에러를 받고 정상 재시도(설계 의도), 키 입력 경로(`term.onData`)는 envelope 를 무시하므로 무해.

## 검증

- cargo 전체 FAILED 0 · typecheck/vitest 339/build 그린.
- 실기기 재확인: ▶실행 → 터미널에서 세션 프롬프트가 뜬 뒤 `claude "$(cat …)"` 프리필 표시 → Enter.

## 메모

관련: 20260731/Bugs/0401(webgl 근본), 0346(프리필 수명). "조용한 성공"은 A0b 의 조용한 create_dir_all 과 같은 계열 — 계약이 거짓말하면 상위 설계가 전부 무효가 된다.