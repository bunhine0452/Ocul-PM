---
schema_version: 1
type: feature
slug: real-icons-and-agent-diff
status: done
difficulty: high
created_at: "2026-08-23T23:35:00+09:00"
session_id: "manual-20260823-233500"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/features/code/FileIcon.tsx"
    op: update
  - path: "src/features/code/patchReverse.ts"
    op: create
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src-tauri/src/db.rs"
    op: update
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/code_file_journal.rs"
    op: create
  - path: "src/lib/bindings.ts"
    op: update
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_file_icons.test.ts"
    op: update
  - path: "src/__tests__/code_patch_reverse.test.ts"
    op: create
  - path: "src/__tests__/code_screen_tabs.test.tsx"
    op: update
related:
  - ".oculpm/journal/20260823/Features_to_add/2305_feature_code-ide-visual-polish.md"
tags: [code-screen, ide, design, oculpm, diff]
---

[x] 진짜 로고 아이콘 + 에이전트 변경 가시화 (일지 연동 인라인 diff)

## 추가 기능

**아이콘 v2** — 사용자 피드백 "별로야". 균일한 색상자 모노그램을 버리고 세 층으로:
1. **공식 로고가 사각형인 것만 사각형** — TS·JS 는 실제 로고가 모서리 글자
   사각형이다. 그대로 그린다 (#3178C6 · #F7DF1E, 글자 오른쪽 아래).
2. **도형 로고** — 파이썬 두 마리 뱀(공식 로고가 180° 회전 대칭이라 위쪽 뱀
   하나 그리고 돌림), 리액트 원자, 러스트 기어(원+이빨 8개), Vue 겹친 V,
   마크다운 M↓ 상자.
3. 나머지는 **상자 없는 색 글자**(Seti 방식) 또는 성질 아이콘. 폴더는 채운
   도형(열림 = 앞판 젖힘).

**에이전트 변경 가시화 (#agent-diff)** — Cursor/antigravity 식, ocul-pm 답게
**일지와 엮어서**:
- **일지 칩** — 브레드크럼 오른쪽 `📓 N`. 이 파일을 `files_touched` 로 만진
  일지들(SQLite 역조회, 최신순·타입색·에이전트·시각·op). 클릭 → 일지 화면 점프.
- **인라인 비교** (`@codemirror/merge` unifiedMergeView) — 원본 둘:
  - **HEAD 와 비교**: 마지막 커밋 이후 = 지금 에이전트가 한 일 전부. 지워진
    줄이 본문 사이 빨간 블록으로 끼고, 청크마다 되돌리기.
  - **일지별 비교**: 그 작업 단위가 바꾼 것만 — 사이드카 패치를 현재 내용에서
    **거꾸로 물려**(reverseApplyPatch) "그 일지 이전" 을 만든다.
- 비교 중 배너(무엇과 비교 중인지 + 일지 열기 + 나가기).

## 동작 흐름

**역적용은 엄격하게 실패한다.** 파일이 그 일지 이후로 더 바뀌면 헝크 문맥이
현재 내용과 안 맞는다 — 대충 맞는 자리에 물리면 엉뚱한 줄이 "에이전트가 바꾼
것" 으로 표시된다. 전 헝크의 위치를 정확 일치로 먼저 확정하고(±200줄 탐색,
겹침 거부), 하나라도 못 찾으면 null → "일지를 열면 기록된 diff 를 볼 수 있다"
로 안내한다. 거짓 비교보다 정직한 후퇴.

**일지 점프는 전역 버스** (`NAV_BUS.openEntity`) — 팔레트가 쓰는 것과 같은
CustomEvent 라 코드 화면이 일지 화면에 결합하지 않는다.

**백엔드는 조인 하나** — `oculpm_journal_files × oculpm_journal` (이미 있던
캐시 테이블들). `code_head_content` 는 기존 `git::show_file_bytes` 재사용.

**비교 모드는 마운트 시점 고정** — LSP 확장과 같은 규칙. 모드 전환은 key
재마운트고, 보던 줄은 점프로 복원한다.

## 검증

- 게이트 5종 전부 exit 0: typecheck · test(109파일 1266개) · lint · build ·
  cargo test(779 + 통합, 신규 code_file_journal 3 포함).
- 새 테스트 19개 — 역적용 8(추가 걷기·삭제 되살리기·다중 헝크 역순·밀린
  문맥 탐색·불일치 null·No-newline), 역조회 3(최신순·프로젝트 격리·limit),
  화면 5(칩 표시/부재·팝오버·점프 이벤트·배너 on/off·HEAD 없음), 아이콘 갱신.

## 메모

- **인앱 육안 확인 필요** — 로고 판독성(특히 파이썬 뱀 16px), merge 뷰 색이
  다크에서 읽히는지, 청크 버튼 위치.
- unifiedMergeView 의 되돌리기 버튼 문구는 CM 기본(영어)이다 — CM phrases 키를
  확인해 한글화하는 것은 후속.
- 플래너 연동은 일지까지 — 일지 상세가 플랜 링크를 이미 보여 주므로 코드
  화면에서 플랜까지 직접 잇는 것은 과했다.
