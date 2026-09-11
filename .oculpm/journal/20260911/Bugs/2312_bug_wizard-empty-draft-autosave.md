---
schema_version: 1
type: bug
slug: "wizard-empty-draft-autosave"
status: done
difficulty: low
created_at: "2026-09-11T23:12:23+09:00"
session_id: "20260911-013"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "e844171e-1cc7-43d6-92e2-254120fb4e99"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/features/onboarding/home/rows.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/greenfield_empty_draft.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "onboarding"
  - "start-tab"
  - "eyes"
  - "regression"
  - "mcp-tool"
---
[x] 빈 마법사가 「새 프로젝트」 초안을 남겨 시작 탭에 명령과 둘로 보이던 것 — autosave 내용 문턱 + 초안 배지

육안 확인 원장 `{#eyes-wizard}` 에서 사용자가 잡은 유일한 「문제」: 「메인 탭에서 새 프로젝트(아이디어 단계에서 멈춤) 추가하는 버튼이 중복으로 보임. 새 프로젝트 시작하기 버튼과 무슨 차이인지 모르겠음.」

## 발생 원인

`GreenfieldWizard` 의 자동 저장 효과(`useEffect([wizState, step, autoSave])`)가 **마운트 직후에도** 2초 타이머를 건다. 마법사를 열고 아무것도 안 적은 채 2초만 지나면 `saveBlueprint(null, "새 프로젝트", null, …, step 0)` 이 돈다 — 이름은 `gf.defaultName` 폴백. `handleClose` 에는 「아이디어나 폴더 이름이 있을 때만」 문턱이 있었지만 autosave 에는 없었다. 그 빈 초안이 시작 탭 바닥 `DraftRow` 에 「새 프로젝트 · 아이디어 단계에서 멈춤」 으로 서고, 바로 아래 `CommandRow` 가 「새 프로젝트 시작하기」 라 같은 것이 둘로 보였다.

## 해결 방법

- `autoSave` 에 `handleClose` 와 같은 문턱: `ideaText.trim()` 이나 `folderName` 이 없으면 타이머를 걸지 않는다(`handleClose` 도 `trim()` 으로 맞춤). 내용이 생기는 순간부터 초안.
- `DraftRow` 첫 낱말에 `.tbadge` 「초안」(en "Draft") — 이름만으로는 명령과 구별이 안 되니 행의 성격을 배지가 먼저 말한다.
- 회귀 테스트 `greenfield_empty_draft.test.tsx`: 5초 방치해도 `saveBlueprint` 0회 / 아이디어 한 줄 적으면 2.5초 뒤 1회(수정 전 첫 케이스 실패 확인). `GreenfieldWizard.tsx` 가 800 래칫에 붙어(794→802) 주석을 3줄로 줄여 796.

## 검증

- main(`cf0aad2`) 워크트리에 6파일만 얹어 `typecheck` · `test` 216파일 2708건 · `lint` 6게이트 · `build` 전부 exit 0. 커밋 `e55eba9`.
- 처음 diff 로 i18n 을 옮겼더니 다른 세션이 main 에 넣은 `op.vscode.*` 키가 지워져 typecheck 9건 — 파일 diff 가 아니라 **줄 삽입**으로 다시 얹었다. 병렬 세션에서 공유 파일(i18n)은 항상 main 의 현재 파일에 줄을 더하는 식으로.
- 이미 저장된 빈 초안은 시작 탭에서 「버리기」로 지우면 된다 — 마이그레이션은 안 했다(초안이 사용자 데이터라 지우지 않는다).