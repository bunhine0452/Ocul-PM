---
schema_version: 1
type: feature
slug: discussion-pr3-screen
status: done
difficulty: high
created_at: "2026-06-29T12:34:11+09:00"
session_id: "20260629-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/discussion/DiscussionScreenV2.tsx
    op: create
  - path: src/features/discussion/discussion.css
    op: create
  - path: src/__tests__/discussion_v2.test.tsx
    op: create
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/components/Sidebar.tsx
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
related:
  - ./1234_feature_discussion-pr2-attachments.md
tags: ["discussion-feature", "PR-DISC-3", "ui_v2", "frontend"]
---

[x] 문제 해결(Discussion) PR-DISC 3 — DiscussionScreenV2 (10번째 ui_v2 화면)

## 추가 기능

좌측 목록 + 우측 2-pane 문서 화면. docs/retro 화면 추가 절차 미러.

- 배선: `UiV2View` 에 `"discussion"`, `WorkspaceState.discussionActiveId`(+기본값), ShellV2 라우터 분기, Sidebar MAIN_NAV "문제 해결"(MessageSquare, 작업일지↔플래너 사이).
- `DiscussionScreenV2` — 목록(active/`_archive` 분리, 상태 pill·미리보기·카운트), 새 문제 인라인 생성, 헤더(제목/상태/owner 칩 agentColor), 액션(편집·첨부·이름변경·승격·닫기/다시열기·보관·삭제·승격plan 링크).
- 본문 view: 문제정의/후보안 카드/배경+첨부 레일(이미지 base64 지연로드)/토의 로그 타임라인(작성자 칩)/결론/다음단계 체크리스트.
- 편집: 본문 마크다운 textarea + 라이브 `<Markdown>` 프리뷰 → discussion_write. resolved/archived 는 본문 잠금.
- discussion.css(ui_v2 토큰만).

## 동작 흐름

list 로드 → 첫 항목 자동 선택(discussionActiveId 영속) → discussionGet 상세. 편집 진입 시 discussionReadRaw 로 원본 본문 로드. 저장/상태변경 후 재투영 반영.

## 검증

`discussion_v2.test.tsx` 3건(상세 렌더/빈상태/axe 0) green. typecheck 0, 프론트 test 124 green, build 성공.
