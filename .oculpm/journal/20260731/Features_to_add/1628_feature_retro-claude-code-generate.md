---
schema_version: 1
type: feature
slug: "retro-claude-code-generate"
status: done
difficulty: medium
created_at: "2026-07-31T16:28:03+09:00"
session_id: "mcp-20260731-162803"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/retro_file.rs"
    op: create
  - path: "src-tauri/src/commands/retro.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
related: []
tags:
  - "retro"
  - "dispatch"
  - "claude-code"
  - "review-hardened"
  - "mcp-tool"
---
[x] 회고를 Claude Code 로 생성 — 디스패치 + .oculpm/retro 파일 규격 + 병합

## 추가 기능

회고 생성에 두 번째 경로를 추가 — API 키·과금 없이 터미널의 Claude Code 세션이 회고를 쓴다:

- `retro_dispatch_prompt` 커맨드: 결정적 신호(fmt_signals)를 redact 해 프롬프트로 조립, `.oculpm/index/dispatch/retro-<range_key>.md` 저장 후 `claude "$(cat …)"` 프리필 명령 반환 (플래너 IN2 와 같은 결)
- `.oculpm/retro/<range_key>.md` 파일 규격 신설(retro_file.rs): `oculpm_retro: v1` frontmatter 에 range_key·signature·generated_by — 프롬프트가 signature 를 미리 채워 "오래됨" 배지가 파일 경로에서도 동작
- `get_retro` 가 DB 캐시와 파일을 병합 — 더 최신 쪽이 이김(동률은 파일 우선)
- 회고 화면 "Claude Code 로" 버튼(툴바+빈 상태) → 터미널 프리필 → Enter

## 동작 흐름

회고 화면 → [Claude Code 로] → 터미널에 프롬프트 프리필 → Enter → 세션이 신호만 근거로 회고 작성 → 규격 파일 저장 → 회고 화면 복귀 시 표시 (진행 과정은 터미널에 그대로 보임).

적대 리뷰(rust) 반영: **(HIGH)** since/until 미검증 경로 탈출 — range_key `YYYYMMDD..YYYYMMDD` 검증을 쓰기 경로에도 추가, **(MED)** redact 를 신호 본문에만 적용해 사용자 hex 패턴이 signature 계약을 파괴하는 경로 차단, 동률 mtime 파일 우선, CRLF 정규화 + SYSTEM_PROMPT "머리말 금지"와 frontmatter 계약의 모순 명시 해소.

## 검증

rust 신규 테스트 6 (파일 파싱/CRLF/경로 검증/mismatch 무시/프롬프트 계약·redact 분리) 포함 `cargo test --lib` 465 통과, typecheck/test/build/lint 전부 exit 0.