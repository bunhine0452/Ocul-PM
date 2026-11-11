---
schema_version: 1
type: chore
slug: "ime-trace-pty-write"
status: done
difficulty: low
created_at: "2026-11-11T23:10:00+09:00"
session_id: "manual-20261111-231000"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/termStore.ts"
    op: update
related: []
tags:
  - "터미널"
  - "한글"
  - "windows"
---
[x] 터미널: 입력 기록에 PTY 로 보낸 키를 남긴다

Windows 앱 터미널의 Claude 에서 한글이 간헐적으로 두 번 찍힌다(사용자 보고 2026-11-11). 22:58 자동 덤프를 보면 이 입력기는 조합 이벤트 없이 완성 음절마다 `insertText` 를 한 번씩 올리고, 브리지 규칙대로라면 「디」 를 PTY 로 한 번만 보낸다. 그런데 사용자는 「디 」 → Backspace 두 번 → 다시 치기를 되풀이했다 — 화면에서는 겹쳤다는 뜻이다. 앱이 두 번 보냈는지, 그 뒤(ConPTY · claude)에서 겹쳤는지는 덤프에 실제로 보낸 바이트가 없어 가를 수 없었다.

`term.onData` 에서 8자 이하의 입력을 `pty-write` 로 입력 기록 링에 남긴다. 붙여넣기 · 프롬프트 본문은 길이로 걸러 남기지 않는다. 다음 재현의 ⌃⌥⇧I 덤프로 원인을 가린다 (tech-backlog `#ime-double-windows`).

## 검증
- `tsc --noEmit` → exit 0 · `pnpm lint` → 0 errors
- `vitest run -t "term|ime"` → Tests 125 passed
