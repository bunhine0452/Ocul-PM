---
schema_version: 1
type: feature
slug: "vscode-extension-panel"
status: done
difficulty: medium
created_at: "2026-11-03T05:00:41+09:00"
session_id: "20261103-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "6fc3a353-b7f3-424c-8f8a-3203b542643e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/model/panel.ts"
    op: create
  - path: "extension/src/model/panel.spec.ts"
    op: create
  - path: "extension/src/panel.ts"
    op: create
  - path: "extension/src/bridge.ts"
    op: update
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/package.json"
    op: update
  - path: "extension/package.nls.json"
    op: update
  - path: "extension/package.nls.ko.json"
    op: update
  - path: "extension/l10n/bundle.l10n.ko.json"
    op: update
  - path: "extension/media/ocul.svg"
    op: create
  - path: "extension/README.md"
    op: update
  - path: "extension/CHANGELOG.md"
    op: update
  - path: "CLAUDE.md"
    op: update
related: []
tags:
  - "확장"
  - "vscode"
  - "extension"
  - "mcp-tool"
---
[x] 확장: Ocul 패널과 한 칸 상태 표시줄을 낸다

## 추가 기능
사용자 질문(11-03) 「vscode 익스텐션의 디자인은 수준급이야?」 → 아니라고 답하고 고칠 셋을 냈다. 사용자 「1~3 전부 진행해」.
- **Ocul 패널**(활동 표시줄 눈 아이콘, VS Code 기본 트리 — 웹뷰 아님): Claude 가 기다려요 · 지금 볼 것(없으면 「볼 것이 없어요」 한 줄) · 다음 할 일(▶ 터미널에서 이어서, ↗ 앱에서) · 최근 일지 8건. 배지 = 질문 + 기다림 + 실패한 확인 명령. 줄 차례는 순수 모델 `model/panel.ts`.
- **상태 표시줄 한 칸**: Claude 기다림 · 확인 명령 결과 · 기록 없는 변경 수를 한 칸에, 급한 것이 앞. 색은 손댈 때만(실패 빨강, 기다림 노랑). 누르면 패널.
- **알림**: Claude 가 새로 기다리기 시작하면 한 번(`arrivals` — 첫 읽기에는 울리지 않고, 같은 기다림에 두 번 울리지 않음). 설정 `ocul.notifyWhenClaudeWaits`.
- 걷은 것: 「지금 볼 것」 QuickPick(`showExceptions`), 「Claude 기다림」 둘째 상태 표시줄 칸과 그 QuickPick(`showClaude`). 패널이 대신한다.

## 동작 흐름
- 패널은 `ocul.tracked` 문맥 키가 참일 때만 보인다(.oculpm 없는 작업 영역엔 아이콘도 없음).
- 확장은 여전히 `.oculpm/` 에 쓰지 않는다 — 질문 줄은 앱 오늘 화면을 연다.
- 0.3.0 은 아직 게시 전이라 이 변경을 0.3.0 에 접었다.

## 검증
- 확장 vitest 71 passed(패널 줄 차례 · 배지 수 · 알림 첫 읽기/중복/재기다림 4건 추가), tsc --noEmit 통과, esbuild · vsce package 통과(12 files, media/ocul.svg 포함)
- 실제 VS Code 화면 확인은 아직 — 데모 창 띄우기를 사용자가 멈췄다. README 스크린샷도 아직