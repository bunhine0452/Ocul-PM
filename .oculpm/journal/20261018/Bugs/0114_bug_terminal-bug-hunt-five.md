---
schema_version: 1
type: bug
slug: "terminal-bug-hunt-five"
status: done
difficulty: medium
created_at: "2026-10-18T01:14:23+09:00"
session_id: "20261018-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f2a896a3-7a54-47ca-9267-32f3b36af4fc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src/features/terminal/ptyWrite.ts"
    op: update
  - path: "src/features/terminal/dispatchTarget.ts"
    op: update
  - path: "src/features/terminal/terminalSurface/useSplitDrag.ts"
    op: update
  - path: "src/features/terminal/TerminalDock.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
related:
  - ref: "20261009/Bugs/0502_bug_seeded-event-runtime-lifecycle.md"
    kind: "followup"
tags:
  - "terminal"
  - "ptyhost"
  - "lifecycle"
  - "mcp-tool"
---
[x] 터미널 결함 5건 — 종료 패닉 · 거절된 입력 무소식 · 드래그 취소 · 채우기 대상 · 닫기 포커스

병렬 레인 B (Opus 5.5 medium, worktree). oculpm.log 10/04~10/17 를 모양별로 집계했다. 터미널 경로에서 반복되는 경고는 없었고, 종료 패닉 1종만 확정됐다. 나머지 4건은 코드 리뷰로 찾아 실패하는 테스트로 먼저 재현했다.

## 발생 원인
1. **종료 패닉**: `stop_code_servers_blocking`(`lifecycle.rs:335`)이 `block_on(tokio::time::timeout(..))` 의 인자 자리에서 타이머를 만들었다. 그 시점은 런타임 밖이라 "there is no reactor running" 으로 패닉했다(10-10·10-14 로그). 언어 서버·디버거가 고아로 남고 모바일 브리지 stop 도 건너뛰었다.
2. **거절된 입력이 조용히 사라짐**: `createPtyInputGate` 가 `void write(...)` 로 호스트의 거절 오류를 버렸다.
3. **드래그 취소 무시**: 분할 손잡이와 도크 손잡이가 pointerup 만 듣고 pointercancel 을 몰랐다. 손을 뗀 뒤에도 리스너가 남았다.
4. **채우기 대상 오류**: 명령 블록 「채우기」가 캡슐이 있는 페인이 아니라 포커스 페인에 썼다(`focusOfTab`).
5. **닫기 포커스 탈취**: `closePane` 이 닫는 페인이 포커스 페인인지 보지 않고 항상 형제로 포커스를 옮겼다.

## 해결 방법
1. 타이머를 block_on 안에서 만드는 `block_on_within` 을 두었다. 레인 C 도 같은 결함을 따로 고쳤는데, 합류 때 테스트가 더 많은 B 쪽을 남겼다.
2. `onError` 를 추가했다. 실패하면 oculpm.log warn 과 페인별 dedup 토스트(`term.inputFailed`)를 낸다.
3. pointercancel 이면 커밋 없이 끝낸다.
4. 블록 메뉴 상태에 페인 sid 를 실어 그쪽에 쓴다.
5. 닫는 페인이 포커스일 때만 형제로 옮긴다.

## 검증
- 결함마다 수정 전 실패하던 테스트(vitest 4·cargo 3)가 이제 통과한다. 합류 브랜치 전 게이트 exit 0.
- **실기기 미확인**: 종료 뒤 로그에 패닉이 없는지, 고아 rust-analyzer 가 없는지, 입력 거절 토스트가 뜨는지, 분할 화면 채우기·닫기를 봐야 한다.
- 보류한 의심 7건(ptyhost 사망 무신호, 트레이 상주 중 분리창만 남은 채 닫으면 종료, 심 디렉터리 미정리 등)은 플랜으로 넘겼다.