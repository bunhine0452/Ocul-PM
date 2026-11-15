---
schema_version: 1
type: bug
slug: "final-review-words-shapes"
status: done
difficulty: high
created_at: "2026-11-15T11:34:32+09:00"
session_id: "20261115-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/diff.rs"
    op: update
  - path: "src-tauri/src/git/diff.rs"
    op: update
  - path: "src-tauri/src/git/tests.rs"
    op: update
  - path: "src-tauri/src/claude_theme.rs"
    op: update
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/features/settings/ClaudeThemeRow.tsx"
    op: update
  - path: "src/features/theme/claudeTheme.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/components/ShortcutCheatsheet.tsx"
    op: update
  - path: "src/components/palette.css"
    op: update
  - path: "src/features/settings/DataSection.tsx"
    op: update
  - path: "src/features/shell/ProjectRow.tsx"
    op: update
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/features/shell/WindowSwitcher.tsx"
    op: update
  - path: "src/hooks/useConfirm.tsx"
    op: update
  - path: "src/hooks/useGlobalShortcuts.ts"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/components/MachineText.tsx"
    op: create
  - path: "src/components/StaleNote.tsx"
    op: create
  - path: "src/components/VerdictLine.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/DiffNotes.tsx"
    op: update
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/planner/verdictState.ts"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/styles/screens-overflow.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/i18n_shell_words.test.ts"
    op: create
  - path: "src/__tests__/cheatsheet_here.test.tsx"
    op: create
  - path: "src/__tests__/fix_screens_planner.test.tsx"
    op: create
  - path: "src/__tests__/settings_honesty.test.tsx"
    op: create
related:
  - ref: "20261115/Bugs/1134_bug_launch-line-ctrl-c-hidden-chars.md"
    kind: "followup"
tags:
  - "화면"
  - "ui"
  - "quality-round"
  - "mcp-tool"
---
[x] 화면: 최종 검수의 말 · 모양 어긋남을 고쳤다

## 발생 원인

레인 여덟이 따로 만든 화면을 합치자 같은 상태 · 같은 동작이 화면마다 다른 말과 모양으로 섰고, 결함 몇이 레인 사이에 떨어졌다(최종 검수 major 3 + minor 약 30, 반박 검증 2표).

- 단축키 표의 「지금 화면」 이 계획 화면에서만 안 섰다(묶음 id `plan` ≠ 화면 id `planner`). ⌘/ 를 다시 눌러도 표가 안 닫혔다(모달 가드가 먼저 먹음).
- 다 닫힌 계획이 통과 뒤 바뀜 · 다른 OS 통과 · 확인 명령 없음 상태에서도 「확인 명령은 아직 통과하지 않았어요」 라고 썼다. 오류 카드는 이번에 이름이 바뀐 설정 칸 「데이터」 를 가리켰다.
- 「내 차례」 가 ⌘J(기다리는 세션)와 오늘(계획의 사람 몫)에서 다른 것을 가리켰다. 「일지 없는 일을 Claude 에게 일지로」 한 동작에 이름이 셋 · 말투가 둘이었다.
- 압축된 한 줄 파일의 diff 가 비었다(예산보다 긴 한 줄을 통째로 버림). 설정을 못 읽으면 「끄기」 를 무시하고 Claude 테마 파일을 다시 썼고, 못 쓰면 이유가 안 보였다.
- 영수증 규칙: 프로젝트 줄 「새 소식」 의 파란 점 · ⌘O 의 강조색 ✓(규칙 1), 계획 시각만 sans · 검증 상자의 사람 문장까지 mono(규칙 2), 변경 빈 목록 + 남은 메모 · 설정 상태표에 채운 단추 둘(규칙 3).

## 해결 방법

- 계획 묶음 id 를 `planner` 로, ⌘/ 는 모달 가드 앞에서 표 자신일 때만 토글. 판정 문장을 상태별로(통과 뒤 바뀜 · {os} 에서 통과 · 명령 없음 · 실패/미실행) + 세 상태 시험. 오류 카드는 지금 칸 이름.
- ⌘J 는 「기다리는 세션으로」, 터미널 상태 띠도 「기다려요」 — 「내 차례」 는 오늘 · 계획의 사람 몫에만(`i18n_shell_words` 가 keys.* · terminal.* 를 문다). 일지 요청은 한 동사 「…맡기기」 · 한 말투(해요체).
- diff 는 예산보다 긴 한 줄도 앞을 보이고, 공백 무시의 두 번째 git 실행을 시험으로 문다. 설정을 못 읽는 동안은 테마 파일을 쓰지 않고(모르면 안 쓴다) 끄기 단추도 두지 않으며, 못 쓰면 경로 · 이유를 보인다.
- 칩 · 점은 중립, ⌘O · ⌥Tab 의 「지금」 은 같은 모양, 밝은 테마 채운 단추 안 키 표기 대비 4.5:1, 시각은 mono · 사람 문장은 sans(`MachineText`), 「다시 읽다 실패」 한 모양(`StaleNote`), 채운 단추는 화면에 하나. screens-overflow.css 의 죽은 초록 `.btn.ok` 걷음.

## 검증

- 레인마다 독립 리뷰 둘 → 수정. 합류 뒤 `pnpm test` 206 files · 1968 passed · typecheck · lint · build exit 0 · `cargo test` 1227 passed 0 failed.
- 설치본에서 눈으로 보지는 않았다.

## 메모

- 사용자 결정으로 넘긴 것(polish-round): 변경 화면 메모 판정 낱말(「바뀜/그대로」 vs 「반영됨/아직」), 목록 칸 스크롤바 폭. 「검증 없이 완료」 창의 첫 포커스는 확인 단추로 둠(되돌릴 수 있는 보통 질문 규칙).