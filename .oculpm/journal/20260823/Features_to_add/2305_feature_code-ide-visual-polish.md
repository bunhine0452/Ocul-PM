---
schema_version: 1
type: feature
slug: code-ide-visual-polish
status: done
difficulty: medium
created_at: "2026-08-23T23:05:00+09:00"
session_id: "manual-20260823-230500"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/features/code/FileIcon.tsx"
    op: create
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/CodeTabsBar.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeReferences.tsx"
    op: update
  - path: "src/features/code/useDebug.ts"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_file_icons.test.ts"
    op: create
related:
  - ".oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md"
tags: [code-screen, ide, design, ux]
---

[x] 코드 화면 프로덕션급 다듬기 — 파일 아이콘 + 아마추어 티 제거

## 추가 기능

- **확장자별 파일 아이콘** (`FileIcon.tsx`) — 트리·탭·참조 패널·브레드크럼 공유.
  언어는 브랜드색 모노그램 배지(TS·RS·GO·PY…), jsx/tsx 는 리액트 원자,
  성질 파일은 lucide 아이콘 + 색(이미지·잠금·git·설정·터미널·DB·.env 열쇠).
- **브레드크럼** — 탭 아래 `src › features › code › CodePane.tsx`. 폴더 조각을
  누르면 트리에서 그 자리를 펼친다.
- **들여쓰기 가이드** — VS Code 식 세로선. 깊은 트리에서 소속이 눈으로 보인다.
- **상태줄 세그먼트화** — LSP 상태 **색점**(초록/호박 펄스/빨강) + **EOL 표시**
  (LF/CRLF) 추가.
- **빈 상태 치트시트** — ⌘K·F12·⇧F12·⇧⌥F 단축키 표.
- 필터 지우기(×) 버튼.

## 동작 흐름

고친 아마추어 티의 목록이 곧 이 라운드다:

- **파일·폴더 라벨 정렬이 어긋나 있었다.** 폴더 행은 캐럿(13px)이 있고 파일
  행은 없어서, 같은 깊이의 파일 라벨이 폴더 라벨보다 왼쪽에 섰다 — 깊이가
  다른 것처럼 보인다. 파일 행에 캐럿 폭의 자리를 확보해 맞췄다.
- **모든 파일이 같은 아이콘이었다.** 파일 종류가 이름을 읽어야만 갈렸다.
- **활성 탭이 떠 있었다.** 하단 안쪽 선(inset box-shadow)이라 탭과 편집면이
  분리돼 보였다. 편집면과 같은 바탕(`--bg-content`) + 상단 액센트선 + 아래
  경계선을 제 색으로 덮어 **탭이 편집면에 붙은** 모양으로.
- **미저장 점과 닫기 ×가 자리 다툼을 했다** (절대배치 겹침). 한 슬롯으로 묶어
  CSS 가 상태별로 갈아끼운다: dirty=점, 호버=×, 활성=×.
- **툴바 버튼 여섯 개가 전부 테두리 상자였다** — 같은 무게로 소리친다.
  고스트로 바꿔 호버·활성만 말하게.
- **기본 스크롤바**가 트리·패널에 그대로 떠 있었다. 가는 오버레이형으로.
- 폴더 아이콘은 액센트 40% 혼합 무채색 — 파일 배지의 브랜드색과 싸우지 않으며
  테마를 따라간다. 비활성 탭의 배지는 채도·투명도를 죽여 활성이 먼저 읽히게.

**아이콘 판정은 순수 함수**(`iconSpecFor`)다: 정확한 파일명(pnpm-lock.yaml →
잠금)이 확장자(yaml → 설정)보다 먼저고, 모르는 점 파일은 도구 설정, 그 밖은
문서로 접는다. 색은 의도적으로 테마 토큰이 아니라 **고정 브랜드색** — TS 는
어느 테마에서든 파란색이어야 파일 종류가 한눈에 갈린다.

곁가지 수정: `useDebug` 의 `dapAllBreakpoints` 응답에 배열 가드가 없어 비-Tauri
환경(테스트 목)에서 unhandled rejection 이 났다 — 경계 가드 추가.

## 검증

- 게이트 5종 전부 exit 0 직접 확인: typecheck · test(108파일 1251개) · lint ·
  build · cargo test(779 + 통합).
- 새 테스트 6개 — 아이콘 판정 규칙(파일명>확장자, .env 열쇠, 점 파일 접기).
- 기존 트리·탭·화면 테스트 25개가 구조 변화(가이드·슬롯·아이콘) 위에서 그대로
  통과 — 클래스 계약(`.code-tree-label`·`.code-tab-name` 등)을 지켰다.

## 메모

- **인앱 육안 확인 필요**(`verified_by_user: false`) — 배지 색이 라이트/다크
  양쪽에서 읽히는지, 가이드 선 정렬, 활성 탭의 "붙은" 모양은 눈이 판정한다.
- 패널 드래그 리사이즈(참조·디버그 높이 조절)는 이번에 안 넣었다 — 프로덕션
  에디터라면 있어야 할 다음 후보.
