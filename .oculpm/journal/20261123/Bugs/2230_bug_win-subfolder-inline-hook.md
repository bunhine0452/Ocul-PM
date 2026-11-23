---
schema_version: 1
type: bug
slug: "win-subfolder-inline-hook"
status: done
difficulty: high
created_at: "2026-11-23T22:30:13+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "plugin/oculpm-codex/hooks/hooks.json"
    op: update
  - path: "src-tauri/tests/plugin_hook_subfolder.rs"
    op: update
related:
  - ref: "20261123/Features_to_add/2122_feature_hook-human-owned-items.md"
    kind: "followup"
tags:
  - "플러그인"
  - "love-round"
  - "windows"
  - "mcp-tool"
---
[x] 플러그인: Windows 하위 폴더 인라인 훅을 고친다

## 발생 원인
L2 가 더한 「위로 올라가 .oculpm 찾기」 의 인라인 훅 조각 `${r%[/\\\\]*}`(hooks.json 원문)는 Claude Code(Node · libuv)가 Git Bash(MSYS)에 명령을 넘기는 동안 역슬래시 짝이 반으로 줄어 `[/\]` 가 됐다. 그 패턴은 bash 에서 아무것도 떼지 않아 하위 폴더에서 띄운 claude 의 세션 신호(인박스 한 줄)가 Windows 에서만 사라졌다. 처음엔 시험 장치(Rust 기본 `.arg`)를 의심해 libuv 규칙으로 맞췄지만 그대로 붉었고, 실패 때 `set -x` 추적을 싣게 하자 `u` 가 `r` 와 같아 바로 `break` 하는 것이 보였다. 로컬 bash 에서 `[/\]` 로 같은 결과를 재현했다.

## 해결 방법
인라인 명령에서 역슬래시를 걷었다. Windows(msys · cygwin)에서는 드라이브 문자 경로(`C:` 다음 글자)에서 구분자를 얻어 경로와 USERPROFILE 을 `/` 로 바꾼 뒤 `${r%/*}` 로만 올라간다. Claude 판 hooks.json 6곳 · Codex 판 2곳. 시험(plugin_hook_subfolder)은 libuv 규칙으로 명령을 넘기고, 실패하면 추적을 메시지에 싣는다.

## 검증
main d7e1b022 Portability: Rust — windows-latest 에서 plugin_hook_subfolder 통과(남은 붉음은 11-11 부터의 spawn_count 둘뿐), Rust — ubuntu-22.04 · 번들 · 설치 스모크 · 업데이터 스모크 success. 같은 커밋 CI · E2E success.