---
schema_version: 1
type: chore
slug: "tauri-log-node-script"
status: done
difficulty: verylow
created_at: "2026-11-10T19:20:30+09:00"
session_id: "manual-20261110-192030"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/tauri-log.mjs"
    op: create
  - path: "package.json"
    op: update
related:
  - ref: "20260720/Chores/1542_chore_reload-diagnostics-scaffold.md"
    kind: "followup"
tags:
  - "개발"
  - "windows"
---
[x] 개발: tauri:log 를 Windows 에서도 돌린다

`pnpm tauri:log` 는 package.json 한 줄의 셸 문법이었다(`$(date …)` · `tee` · `/tmp`). pnpm 은 Windows 에서 스크립트를 cmd.exe 로 돌리므로 거기서는 첫 글자부터 깨졌다.

- `scripts/tauri-log.mjs` 가 같은 일을 한다. 세션 머리줄을 쓰고, `pnpm tauri dev` 의 출력을 화면과 파일에 함께 낸다.
- 띄운 pnpm 을 셸 없이 그대로 쓴다(`npm_execpath`). 뒤에 붙인 인자는 넘긴다.
- 로그 자리: macOS · Linux 는 그대로 `/tmp/oculpm-tauri-dev.log`, Windows 는 `%TEMP%\oculpm-tauri-dev.log`.

## 검증
- Windows 11: `pnpm tauri:log --help` → exit 0, `%TEMP%\oculpm-tauri-dev.log` 끝에 tauri dev 도움말이 쌓였다. macOS 에서는 안 돌려 봤다.
