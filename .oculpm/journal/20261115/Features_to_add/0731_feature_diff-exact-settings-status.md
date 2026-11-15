---
schema_version: 1
type: feature
slug: "diff-exact-settings-status"
status: done
difficulty: high
created_at: "2026-11-15T07:31:21+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "src-tauri/src/commands/diff.rs"
    op: update
  - path: "src-tauri/src/git/diff.rs"
    op: update
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/git/tests.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/__tests__/a11y_screens.test.tsx"
    op: update
  - path: "src/__tests__/app_icon_picker.test.tsx"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
  - path: "src/__tests__/diff_basics.test.ts"
    op: create
  - path: "src/__tests__/diff_contrast.test.ts"
    op: create
  - path: "src/__tests__/diff_exact.test.ts"
    op: create
  - path: "src/__tests__/diff_keys_handoff.test.tsx"
    op: create
  - path: "src/__tests__/diff_perf.test.tsx"
    op: create
  - path: "src/__tests__/diff_primary.test.tsx"
    op: create
  - path: "src/__tests__/diff_receipt_lines.test.tsx"
    op: create
  - path: "src/__tests__/diff_refresh.test.tsx"
    op: create
  - path: "src/__tests__/diff_v2.test.tsx"
    op: update
  - path: "src/__tests__/diff_viewed.test.tsx"
    op: create
  - path: "src/__tests__/helpers/diffFx.ts"
    op: create
  - path: "src/__tests__/helpers/diffScreenFx.tsx"
    op: create
  - path: "src/__tests__/i18n_english_render.test.tsx"
    op: update
  - path: "src/__tests__/settings_editor_row.test.tsx"
    op: update
  - path: "src/__tests__/settings_page.test.tsx"
    op: update
  - path: "src/__tests__/settings_status.test.tsx"
    op: create
  - path: "src/api/diff.ts"
    op: update
  - path: "src/components/RadioSeg.tsx"
    op: create
  - path: "src/components/copyCommand.css"
    op: update
  - path: "src/features/diff/ChangeFileList.tsx"
    op: update
  - path: "src/features/diff/DiffBody.tsx"
    op: update
  - path: "src/features/diff/DiffEntryFooter.tsx"
    op: update
  - path: "src/features/diff/DiffFileHead.tsx"
    op: create
  - path: "src/features/diff/DiffNotes.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/PatchView.tsx"
    op: update
  - path: "src/features/diff/UnrecordedBanner.tsx"
    op: update
  - path: "src/features/diff/changeGroups.ts"
    op: update
  - path: "src/features/diff/changeList.ts"
    op: update
  - path: "src/features/diff/changes.css"
    op: update
  - path: "src/features/diff/diffHighlight.ts"
    op: create
  - path: "src/features/diff/diffNoteStore.ts"
    op: update
  - path: "src/features/diff/diffParse.ts"
    op: update
  - path: "src/features/diff/diffSessionStore.ts"
    op: create
  - path: "src/features/diff/diffWords.ts"
    op: create
  - path: "src/features/diff/patchModel.ts"
    op: create
  - path: "src/features/diff/useDiffChanges.ts"
    op: update
  - path: "src/features/diff/useDiffFile.ts"
    op: update
  - path: "src/features/diff/useDiffHandoff.ts"
    op: create
  - path: "src/features/diff/useDiffKeys.ts"
    op: create
  - path: "src/features/diff/useGroupEntries.ts"
    op: update
  - path: "src/features/settings/AgentsSection.tsx"
    op: update
  - path: "src/features/settings/AppIconPicker.tsx"
    op: update
  - path: "src/features/settings/DataSection.tsx"
    op: update
  - path: "src/features/settings/DisplaySection.tsx"
    op: update
  - path: "src/features/settings/EditorRow.tsx"
    op: update
  - path: "src/features/settings/ProjectSection.tsx"
    op: update
  - path: "src/features/settings/SettingsPage.tsx"
    op: update
  - path: "src/features/settings/prefs.css"
    op: update
  - path: "src/features/settings/prefsUi.tsx"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/tokens.css"
    op: update
related: []
tags:
  - "변경-·-설정"
  - "변경-화면"
  - "diff"
  - "settings"
  - "quality-round"
  - "mcp-tool"
---
[x] 변경 · 설정: 정확한 diff 와 상태표로 바꿨다

## 추가 기능

업그레이드 라운드 레인 「변경과 설정」(계획 quality-round-20261115). 「믿지 말고 보라」 화면이 거짓말을 안 하게.

- **정확한 사본(DF-01)**: diff 렌더러가 `-- ` · `++ ` 로 시작하는 바뀐 줄을 헤더로 오인해 지우던 결함 — 줄 분류를 위치 상태 기계(diff 머리 → @@ 덩이 → 덩이 안 첫 글자)로. 「파일 끝 줄바꿈 없음」 은 작은 회색 줄.
- **일지에서 넘어오면 그 일지 묶음(DF-02)**: 일지 → 변경 핸드오프가 그 일지의 묶음을 펼치고 첫 파일로, 없으면 이유를 말한다. 화면에 적힌 키 = 실제로 듣는 키.
- **채운 단추 하나 · 동사 하나(DF-03)**: 메모가 있으면 「메모 N개 맡기기」, 없으면 띠의 「Claude 에게 맡기기」 하나.
- **diff 기본기(DF-04)**: 바뀐 단어 칠(단어 LCS), 공백 무시(같은 git 실행 자리에 -w 인자만), 생성 파일 접기, 줄로 열기.
- **봤음 · 본 뒤 바뀜(DF-05)**: 파일마다 봤음(v), 본 뒤 패치가 바뀌면 회색 점. 검증 없는 묶음이 먼저.
- **대비 · 속도(DF-06)**: 라이트 코드 색이 카드 · 추가 · 삭제 바탕 위 4.5:1, 다크 거터 한 단 구분.
- **잘린 것을 숫자로(DF-07)**: `compute_diff` 가 truncated {shown,total} — 「64 KB / 212 KB 만 보여요 · 편집기에서 열기」 영수증 줄. 새 파일은 앞 64KB 만 읽는다.
- **설정은 상태표(ST-01)**: 맨 위 「고칠 것 N」, 칸 넷(에이전트 · 이 프로젝트 · 모양 · 앱), 한 세로선 동작, 다시 확인.

## 동작 흐름

`patchModel` · `diffWords` · `diffHighlight` 가 파싱 · 단어 짝 · 칠을 나눠 쥐고, 봤음 상태는 `diffSessionStore`(프로젝트별, 앱 켜 있는 동안). 변경 · 설정이 새 `RadioSeg` 한 벌을 같이 쓴다.

## 검증

- 레인 게이트: `cargo test` 모든 바이너리 1173 passed 0 failed(레인 시점) · clippy · fmt · vitest 119 files passed · typecheck · lint · build exit 0. 리뷰 둘(major 6 등) 반영 — 다시 묻기 한 번 실패로 Claude 답을 덮지 않고, 메모 쓰는 중엔 다시 읽기를 미룬다.
- 합류 뒤: `pnpm test` 1652 passed · `cargo test` 1202 passed 0 failed. 설치본에서 눈으로 보지는 않았다.

## 메모

- 세그먼트 고른 칸 사본 규칙(screens.css 의 aria-checked)과 좁은 창 바닥줄 옛 규칙(screens-overflow.css)은 이음 레인이 걷는다.
- 해시로 아는 「본 뒤 바뀜」 은 그 파일을 보는 동안만 선다(다른 파일은 패치를 모른다 — 설계 한계).