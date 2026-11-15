---
schema_version: 1
type: feature
slug: "terminal-input-keys-paste"
status: done
difficulty: high
created_at: "2026-11-15T07:27:57+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/model/journal.ts"
    op: update
  - path: "src-tauri/src/git/receipt_cases.json"
    op: update
  - path: "src-tauri/src/oculpm/markdown.rs"
    op: update
  - path: "src/__tests__/ime_cases.test.ts"
    op: create
  - path: "src/__tests__/ime_trace_redact.test.ts"
    op: create
  - path: "src/__tests__/paste_safe.test.ts"
    op: create
  - path: "src/__tests__/send_terminal_selection.test.ts"
    op: create
  - path: "src/__tests__/term_copy.test.ts"
    op: create
  - path: "src/__tests__/term_keys.test.ts"
    op: create
  - path: "src/__tests__/terminal_drop_files.test.tsx"
    op: update
  - path: "src/__tests__/terminal_drop_quote.test.ts"
    op: create
  - path: "src/__tests__/xtermHarness.ts"
    op: create
  - path: "src/features/terminal/dropFiles.ts"
    op: update
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/features/terminal/imeTrace.ts"
    op: update
  - path: "src/features/terminal/pasteSafe.ts"
    op: create
  - path: "src/features/terminal/runPrompt.ts"
    op: update
  - path: "src/features/terminal/sendToClaude.ts"
    op: update
  - path: "src/features/terminal/termCopy.ts"
    op: create
  - path: "src/features/terminal/termKeys.ts"
    op: create
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
related: []
tags:
  - "터미널"
  - "terminal"
  - "ime"
  - "quality-round"
  - "mcp-tool"
---
[x] 터미널: Shift+Enter 줄바꿈과 붙여넣기 정화를 넣었다

## 추가 기능

업그레이드 라운드 레인 「터미널 입력」(계획 quality-round-20261115).

- **Shift+Enter 줄바꿈(TI-01)**: xterm 5.5 는 Enter 에 Alt 만 봐서 Shift+Enter 도 CR 이었다 — 반쯤 쓴 프롬프트가 제출되는 가장 흔한 사고. 새 키 층 `termKeys.translateKey` 가 대체 화면(Claude · Codex TUI)에서 ESC CR(⌥Enter 와 같은 바이트)을 보낸다. 셸은 그대로 CR.
- **맥 줄 편집(TI-02)**: ⌘⌫ · ⌘← · ⌘→ · ⌥← · ⌥→ · ⌃/ 가 줄 편집 바이트로. 두벌식에서도 code 로 찾는다.
- **Windows · Linux 복사/붙여넣기(TI-03)**: Ctrl+Shift+C/V · 선택이 있을 때 Ctrl+C 는 복사, PowerShell 드롭은 작은따옴표.
- **정화기 하나(TI-04)**: 「Claude 에게 보내기」 · 「끝까지」(/goal) · 손 ⌘V · 드롭이 모두 `pasteSafe.sanitizePaste` 를 지난다 — CSI · OSC 를 걷고 남은 ESC 는 ␛ 로 보이게. 동료가 커밋한 제목에 `ESC[201~` 를 심어 대괄호 붙여넣기를 일찍 닫고 `!명령` 을 돌리는 길을 막았다. 그림만 든 클립보드의 ⌘V 는 Claude 가 그림을 읽는 ⌃V 로. 대괄호 붙여넣기를 안 켠 셸에 여러 줄은 경고(한 번 더 붙이면 그대로).
- **IME(TI-05 · TI-06)**: 진단 덤프에는 한글 · 빈칸 · 키 이름만 남고 나머지 글자는 「·」. Orca 의 한국어 경계 사례 여섯을 진짜 xterm 위 시험표로(wkwebview · webview2 두 모델 12개), Windows keyCode 229 뒤 이중 입력 막음.
- **복사 정리(TI-07)**: 이어진 줄을 붙이고 넓은 글자 줄바꿈이 남긴 빈칸 · 줄 끝 공백 · 공통 왼쪽 여백을 걷는다.
- **고른 출력을 Claude 에게(TI-08)**: ⌘L(비-mac Ctrl+Shift+L) — 코드 울타리에 넣어 보내기 대화상자로.

## 동작 흐름

imeBridge 의 키 처리기 → 조합 판정 → `translateKey` → 결과가 있으면 `term.input(seq)` 후 전파를 막는다(전역 단축키로 새지 않게). host 캡처 paste 리스너가 정화 · 그림 · 여러 줄 경고를 맡는다. 일지 제목 추출(markdown.rs)도 제어 문자를 걷어 모든 화면이 같은 값을 본다 — VS Code 확장과 공유 사례표(receipt_cases.json)도 같은 규칙.

## 검증

- 레인 게이트: vitest 116 files passed · typecheck · lint · build exit 0 · `cargo test` 1009 passed(레인 시점) · clippy · fmt. 리뷰 둘(major 7) 반영. 헤드리스 Chrome 의 실제 CDP 키로 ESC CR · ^U · ^A · ESC f 를 확인.
- 합류 뒤: `pnpm test` 1652 passed · `cargo test` 1202 passed 0 failed. 설치본 · Windows 실기기에서는 눌러 보지 않았다.

## 메모

- vim · nano 같은 다른 대체 화면 프로그램에도 Shift+Enter 가 ESC CR 로 간다 — 이음 레인이 에이전트 상태 신호가 있는 칸에서만 바꾸게 고친다.
- Linux 의 Ctrl+Shift+V 는 WebKitGTK 설치본이 없어 확인 못 했다(Shift+Insert 는 확실).