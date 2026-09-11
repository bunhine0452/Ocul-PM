---
schema_version: 1
type: feature
slug: "editor-design-upgrade"
status: done
difficulty: medium
created_at: "2026-09-11T00:26:27+09:00"
session_id: "20260911-001"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "6329180c-f6fb-4b0f-8ecc-6f01664958e4"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/code-frame.css"
    op: create
  - path: "src/features/code/CodeSidebarHead.tsx"
    op: create
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/monaco/theme.ts"
    op: update
  - path: "src/features/code/monaco/options.ts"
    op: update
  - path: "src/__tests__/monaco_options.test.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "code"
  - "design"
  - "monaco"
  - "mcp-tool"
---
[x] 편집기 디자인 라운드 — 검은 미니맵을 고치고, 크롬과 종이를 갈랐다

- [x] 편집기 화면 디자인 공격적 업그레이드 (사용자 스크린샷 기준)

## 추가 기능

사용자가 준 라이트 테마 스크린샷에서 확정한 결함과 그 답:

1. **미니맵이 검은 띠였다.** `editor.background` 를 `#00000000` 으로 비워 둔 것(편집면은 `.code-pane` 이 그린다)을 미니맵이 그대로 물려받아, 알파 0 의 검정 위에 글자를 섞었다. `minimap.background` 를 `--bg-content` 로 명시하고, 손잡이 3단·선택·검색·진단 색을 액센트/상태색으로 채웠다. 글자 대신 덩어리(`renderCharacters: false`)로, 손잡이는 늘 보이게.
2. **크롬과 종이가 같은 아이보리였다.** 트리·탭 바·사이드바 머리·상태줄이 편집면과 같은 색이라 경계가 머리카락선 하나였다. 크롬은 `--bg-sidebar`(`--code-chrome`), 편집면만 `--bg-content` — 활성 탭이 그 밝기를 이어받아 편집면에 붙는다.
3. **띠 높이가 34·22·26 으로 제각각.** 두 단으로 접었다: 머리띠 `--code-band` 36 (탭 바 = 사이드바 머리 = 검색 패널 머리), 아랫띠 `--code-strip` 24 (브레드크럼 = 상태줄 = 트리 루트 행). 일지 팝오버 오프셋도 `calc()` 로 따라간다.
4. **거터가 본문과 같은 층.** `--code-gutter`(inset 55% 혼합) 띠 + 현재 줄 강조를 거터까지(`renderLineHighlight: "all"`) + 현재 줄번호는 액센트 글자 + base 의 회색 테두리 상자 제거.
5. **커서가 본문색이라 글자 사이에서 사라졌다.** 2px 액센트 커서, 부드러운 이동·스크롤. 터미널 커서와 같은 색.
6. **`.md` 에서 굵게가 굵지 않았다.** 내장 markdown 토큰(`keyword.md`·`strong.md`·`emphasis.md`·`string.link.md`…)에 테마 규칙이 없었다. 굵기·기울임은 색이 아니라 구조라 프리셋과 무관하게 항상 켠다.
7. **트리가 어느 저장소인지 말하지 않았다.** 루트 행(저장소 이름 캡스 + 올리면 드러나는 「모두 접기」)을 스크롤 밖에 고정. 「모두 접기」는 펼친 폴더가 없으면 `blocked()` 로 이유를 말한다.
8. 잔손: 미저장 탭 이름은 액센트 글자, 브레드크럼 셈은 알약, 상태줄 미저장은 액센트 알약(탭 점·이름·상태줄 세 자리가 같은 색), Monaco 스크롤바 10px, 괄호 쌍 가이드는 활성 쌍만.

## 동작 흐름

- 파일 크기 래칫 때문에 `code.css`(2,697줄)와 `CodeScreenV2.tsx`(1,491줄)는 **늘릴 수 없었다.** 크롬 다섯 절을 `code-frame.css` 로 떼어내고(2,697→2,292), 사이드바 머리를 `CodeSidebarHead.tsx` 로 떼어낸 뒤 그 자리에 루트 행을 얹었다(1,491→1,443).
- 색은 전부 토큰이라 다크·프리셋 5종·액센트 6종을 자동으로 따른다. 테마 다리(`theme.ts`)는 이미 `data-theme`/`data-preset` 변경에 재정의된다.

## 검증

- typecheck · vitest 203 파일 2,623 통과 · lint 6게이트 통과(디자인 `--ctl-1` 한 번 걸려 고침, `blocked.test` 래칫 한 번 걸려 이유 붙임) · `pnpm build` 통과.
- **육안 확인은 못 했다.** dev 빌드를 띄웠으나 `screencapture` 가 화면 녹화 권한이 없어 실패했고, 그 사이 설치본이 돌고 있어 dev 인스턴스가 프로젝트 워처 락을 가져갔다(즉시 종료). 라이트/다크 × 프리셋 격자는 `monaco-editor-round {#fin-eyes}` 에 그대로 남는다.