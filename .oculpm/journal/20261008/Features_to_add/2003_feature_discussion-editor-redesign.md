---
schema_version: 1
type: feature
slug: "discussion-editor-redesign"
status: done
difficulty: high
created_at: "2026-10-08T20:03:18+09:00"
session_id: "20261008-007"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/discussion/DiscussionEditor.tsx"
    op: update
  - path: "src/features/discussion/proseEditor.ts"
    op: create
  - path: "src/features/discussion/outline.ts"
    op: create
  - path: "src/features/discussion/DiscussionOutline.tsx"
    op: create
  - path: "src/features/discussion/draftStore.ts"
    op: create
  - path: "src/features/discussion/DiscussionMoreMenu.tsx"
    op: create
  - path: "src/features/discussion/discussion-editor.css"
    op: create
  - path: "src/features/discussion/DiscussionScreenV2.tsx"
    op: update
  - path: "src/features/discussion/discussion.css"
    op: update
  - path: "src/features/code/monaco/langProse.ts"
    op: update
  - path: "src/__tests__/discussion_outline.test.ts"
    op: create
  - path: "src/__tests__/discussion_editor.test.tsx"
    op: update
related: []
tags:
  - "discussion"
  - "ui"
  - "monaco"
  - "design"
  - "mcp-tool"
---
[x] 논의 편집기 개편 — 자동완성 끄기 · 잘림 수정 · 한 줄 툴바 · 개요 · 상태줄 · 초안 보존

## 추가 기능
사용자 보고("논의를 직접 쓸 때 자동완성이 계속 떠 불편하다, 완성도 있게 + UI 새로")를 받아 하네스로 재현하며 고쳤다.
- **자동완성 끄기**: prose 언어엔 제안 제공자가 없는데도 Monaco 기본값(wordBasedSuggestions + quickSuggestions)이 문서 단어를 타자마다 띄웠다. 제안 · 트리거 문자 · 인라인 · 호버 · 유니코드 강조를 껐다(`proseEditor.ts`).
- **잘림 수정**: CSS 가 `.view-lines` 를 78ch 에 묶었는데 Monaco 는 판 끝에서 줄을 바꿔, 넓은 창 원문 모드에서 문장 가운데가 안 보였다. 이제 칼럼 폭을 Monaco 에 직접 알린다(`lineDecorationsWidth` 여백 + `bounded` `wordWrapColumn`, `keepProseCentered`).
- **초안 보존**: 셸은 지금 화면만 그려, 편집 중 다른 화면에 다녀오면 초안이 말없이 사라졌다. `draftStore`(창 메모리)에 붙들고, 돌아오면 이어서 연다. 저장 · 취소 · 충돌 시 「다시 읽기」가 놓는다.
- **괄호 색칠**: 산문의 `(…)` · `{#id}` 가 파랗게 떴다. 독립판 Monaco 는 `bracketPairColorization` 을 설정 키로 등록하지 않아 옵션이 모델에 닿지 않고, 전역으로 끄면 코드 화면까지 꺼진다(소스로 확인). 그래서 prose 언어의 `brackets` 를 비웠다.
- **디자인**: 크롬 세 줄(135px)을 두 줄로 줄였다(제목은 툴바 부제). 본문 글꼴 15/1.8 의 680px 가운데 칼럼, 개요 레일(현재 섹션 · 모르는 제목 경고 · 이동), 상태줄(섹션 · 분량 · 경로 · 단축키), 나란히 보기의 섹션 닻 스크롤 동기화, 미리보기에서 `{#id}` · 로그 주석 숨김을 넣었다. 저장 버튼은 바뀌었을 때만 강조색이다. 좁으면 컨테이너 쿼리로 접힌다.

## 동작 흐름
`DiscussionScreenV2.startEdit` 가 `peekDraft` 를 먼저 보고, 있으면 그 초안 · 기준 본문 · 해시로 연다(CAS 는 그대로). 편집기는 `baseText` 와 비교해 「저장 안 됨」 을 판정하고, 변경마다 `onTextChange` 로 초안을 붙든다. 개요 · 상태줄 · 스크롤 동기화는 `outline.ts` 의 같은 판독(코드 펜스 제외, `###` 는 섹션 종류 상속)을 쓴다. 미리보기 모드의 현재 섹션은 스크롤 위치로 정하고, 개요로 이동하면 그 항목을 고정한다(끝까지 내려 맨 위로 못 오는 마지막 제목들 때문).

## 검증
- vitest 256파일 3,294건, typecheck · lint · build 모두 0. 새 테스트는 `discussion_outline.test.ts`(순수 판독 · 칼럼 계산 · 제안 꺼짐 · 초안 저장소)와 편집기 배선 4건이다.
- 하네스 실측: 대조군(옛 기본값)에선 " Cla" 입력에 제안 창이 뜨고 개편 후엔 안 뜬다. 괄호 색칠 span 8 → 0, 개요 이동 4곳이 일치, 나란히 동기화 오차 16~47px.
- PR #77 CI 초록 → 4d854d9c.

## 메모
- 하네스 레시피: 루트 `harness-*.html` 에 Tauri IPC 스텁(`settings_get_all` 만 응답)과 SettingsProvider 를 넣고 `pnpm vite --port 1430` 으로 띄운다. Node 내장 WebSocket 으로 CDP 를 직접 불러 콘솔 오류 · eval · 스크린샷을 얻는다. 커밋하지 않는다.
- `DiscussionScreenV2` 800줄 상한 때문에 넘침 메뉴를 `DiscussionMoreMenu.tsx` 로 뺐다(797 → 754).
- 실기기 확인 남음: 설치본에서 한글 IME 입력 · 화면 이동 후 초안 복원 · 다크 프리셋.