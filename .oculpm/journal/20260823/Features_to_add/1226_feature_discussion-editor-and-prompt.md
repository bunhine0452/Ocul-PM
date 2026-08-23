---
schema_version: 1
type: feature
slug: discussion-editor-and-prompt
status: done
difficulty: high
created_at: "2026-08-23T12:26:00+09:00"
session_id: "manual-20260823-122600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/features/discussion/mdEdit.ts"
    op: create
  - path: "src/features/discussion/discussionPrompt.ts"
    op: create
  - path: "src/features/discussion/discussionTemplates.ts"
    op: create
  - path: "src/features/discussion/DiscussionEditor.tsx"
    op: create
  - path: "src/features/discussion/DiscussionView.tsx"
    op: create
  - path: "src/features/discussion/discussionFormat.ts"
    op: create
  - path: "src/features/discussion/DiscussionScreenV2.tsx"
    op: update
  - path: "src/features/discussion/discussion.css"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/discussion_edit.test.ts"
    op: create
  - path: "src/__tests__/discussion_editor.test.tsx"
    op: create
  - path: "src/__tests__/discussion_v2.test.tsx"
    op: update
related: []
tags: [discussion, editor, codemirror, prompt, i18n]
---

[x] 문제 해결 화면 개편 — CodeMirror 편집기·시작 템플릿·"프롬프트 복사"

## 추가 기능

문제 해결 문서의 쓰임을 "에이전트에게 할 말을 적어 두는 곳"에서 **초기 계획·복잡한 문제·대규모 변경을 에이전트와 실제로 논의하는 자리**로 옮기는 라운드. 백엔드는 한 줄도 건드리지 않았다 (기존 `discussion_*` 커맨드로 전부 성립).

1. **편집기 전면 교체** — 60vh textarea + 프리뷰 2단 → 전체 높이 `DiscussionEditor` (CodeMirror 6 마크다운: 소프트랩·검색·히스토리·⌘S). 편집에 들어가면 좌측 목록을 접어 폭을 문서에 준다.
2. **서식 툴바 + 삽입 메뉴** — 굵게/기울임/코드/링크(⌘B·I·K)·소제목·인용·목록·체크박스, 그리고 규격 블록 삽입: **후보 방안(`{#opt-x}` 자동)**·**다음 단계(`{#next-N}` 자동)**·**토의 로그 한 줄**(ISO+offset 자동, 기존 행 불변)·코드 블록. 손으로 id 를 세던 일이 사라진다.
3. **보기 모드 3종** — 원문 / 나란히 / 미리보기. `WorkspaceState.discussionEditorMode` 로 영속 (사람마다 고정된 습관이라 문서 단위가 아니라 화면 단위).
4. **인식 못 하는 `## ` 제목 경고** — 파서(`parse.rs::section_of`)가 아는 제목은 여섯 종뿐이고 그 밖의 제목 **아래 본문은 읽기 화면 투영에서 버려진다**. 편집 중에 경고 띠로 미리 알린다.
5. **프롬프트 복사** — 문서 경로와 규격 경로(`.oculpm/agents/discussion-spec.md`)를 담은 지시문을 클립보드로. 문서 단계에 따라 자동으로 갈린다: 문제 정의가 비었으면 *같이 채우기*, 열려 있으면 *논의*, 닫혔으면 *결론 실행*. 경로만 주고 **본문은 싣지 않는다** — 에이전트가 직접 읽으면 항상 최신이고 붙여넣기가 짧다.
6. **시작 템플릿 4종** — 빈 문서 / 기술 결정 / 초기 계획 / 대규모 변경. 새 문제 만들기가 사이드바 인라인 입력에서 제목 + 템플릿 대화상자로 바뀌고, 만들면 곧바로 편집기가 열린다.
7. **메모 한 줄 입력** — 읽기 화면에서 편집기를 열지 않고 토의 로그 managed block 에 한 줄 append.
8. **헤더 정리** — 회색 버튼 일곱 개가 늘어서 있던 자리를 [프롬프트 복사]·[편집]·[승격] + `···` 넘침 메뉴로. 경로 칩(클릭 시 복사)도 추가.

## 동작 흐름

- 마크다운 수술은 전부 **순수 모듈** `mdEdit.ts` 로 뺐다 — `EditOp{from,to,insert,selFrom,selTo}` 를 돌려주고 CodeMirror 는 트랜잭션 하나로 반영만 한다. 에디터 인스턴스를 모르는 함수라 단위 테스트가 그대로 계약서가 된다.
- 섹션 판별 키워드 표는 `parse.rs::section_of` 와 **판정 순서까지** 맞췄다. 두 벌이 갈리면 경고가 틀려질 뿐 데이터는 안 깨진다(파서가 진실).
- 프롬프트 본문은 `t()` 가 아니라 **`tc()`** — 이 지시문을 읽은 에이전트가 그 언어로 문서를 이어 쓰므로 축이 UI 언어가 아니라 작성 언어다 (03-i18n.md §4.5 가 `plan_dispatch_prompt` 를 예로 집어 지목한 예외).
- 템플릿 본문·섹션 제목·자리표시자는 디스크에 그대로 기록되는 내용이라 사전이 아니라 `discussionTemplates.ts` 에 ko/en 두 벌로 두고 한글 게이트의 DISK_CONTENT 에 등록했다 (`rulesModel.ts` 와 같은 부류). 템플릿의 하위 구조는 `## ` 를 더 만들지 않고 `####` 로 판다 — 파서가 `####` 는 본문 줄로 흘려보내므로 안전하다.
- `DiscussionEditor` 는 `lazy()` — CodeMirror 를 읽기만 하러 들어온 사람이 치르지 않게 [편집] 을 누를 때 내려받는다. 화면 청크 33.4kB → 26.3kB + 편집기 8.6kB 로 갈렸다.
- 화면 파일이 983줄까지 부풀어 읽기 모드 서브트리를 `DiscussionView.tsx`(218줄) 로, 상태 pill·날짜 표기를 `discussionFormat.ts` 로 갈랐다 (화면 747줄 — 800줄 상한 아래).

## 검증

- `pnpm typecheck` / `pnpm lint` / `pnpm test`(100 파일 1148 테스트) / `pnpm build` 전부 exit 0 직접 확인.
- 신규 테스트 25개: `discussion_edit.test.ts`(섹션 판별 ko/en·미인식 제목·id 자동 부여·서식 토글·섹션 삽입 위치·로그 append 3종), `discussion_editor.test.tsx`(툴바→CM 트랜잭션→onSave 배선, 경고 띠), `discussion_v2.test.tsx` +2(프롬프트에 문서·규격 경로가 담기는지, 메모가 managed block 안쪽에 들어가는지). axe 0 violations 유지.

## 메모

- **실행 중인 앱에서의 육안 확인은 하지 않았다** — 게이트 4종과 jsdom 배선 테스트까지다. CSS 가 큰 라운드라 실제 창에서 한 번 봐야 한다.
- 파서가 모르는 `## ` 제목 아래 본문이 조용히 사라지는 것은 **백엔드 쪽 설계 한계**다. 이번엔 편집기 경고로 덮었고, 투영 자체를 고치려면 DTO·bindings·테스트가 함께 움직여야 해서 이번 범위 밖으로 뒀다.
- 프롬프트는 클립보드 복사만 한다. 플래너의 터미널 프리필(`dispatchBus`)도 검토했지만, 여러 줄 지시문을 셸 한 줄로 밀어 넣는 경로가 깨지기 쉬워(따옴표·개행) 넣지 않았다.
