---
schema_version: 1
type: feature
slug: lsp-phase2-and-git-gutter
status: done
difficulty: superhigh
created_at: "2026-08-23T20:45:00+09:00"
session_id: "manual-20260823-204500"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lsp/spec.rs"
    op: update
  - path: "src-tauri/src/lsp/state.rs"
    op: update
  - path: "src-tauri/src/lsp/edit.rs"
    op: update
  - path: "src-tauri/src/commands/lsp.rs"
    op: update
  - path: "src-tauri/src/git.rs"
    op: update
  - path: "src-tauri/src/commands/git.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeOutline.tsx"
    op: create
  - path: "src/features/code/CodeReferences.tsx"
    op: create
  - path: "src/features/code/signatureTooltip.ts"
    op: create
  - path: "src/features/code/gitGutter.ts"
    op: create
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/settings/CodeSettings.tsx"
    op: create
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_gutter_outline.test.ts"
    op: create
  - path: "src/__tests__/code_screen_tabs.test.tsx"
    op: update
related:
  - ".oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md"
tags: [code-screen, ide, lsp, git]
---

[x] LSP 나머지 창구 7종 + git 거터 — IDE Phase 2

## 추가 기능

- **참조 찾기** (⇧F12) — 편집 영역 아래 전체 폭 패널. 파일별로 접히고, 각 줄의
  **원문 미리보기**가 붙는다. 프로젝트 밖(의존성)은 목록에 남기되 못 연다고 밝힌다.
- **아웃라인** — 사이드바 아래 접이식. 커서가 든 심볼을 표시하고 눌러서 점프.
- **워크스페이스 심볼** — ⌘K 팔레트에 「심볼」 그룹으로 합류.
- **시그니처 힌트** — 인자를 치는 동안 툴팁, 지금 인자만 굵게.
- **포맷팅** (⇧⌥F) + **저장 시 포맷** 옵션(기본 꺼짐).
- **설정 → 코드 탭** — 저장 시 포맷·들여쓰기, 언어 서버 4종의 상태·켜기/끄기·
  실행 경로 오버라이드·미설치 안내.
- **git 거터** — HEAD 대비 추가/수정/삭제를 줄 옆 색막대로. LSP 가 아니다.

## 동작 흐름

**참조·아웃라인·심볼은 서버 응답의 모양이 제각각이라 변환을 백엔드 한 곳에 모았다**
(`lsp/spec.rs`). `documentSymbol` 은 계층형(`DocumentSymbol`)과 평면형
(`SymbolInformation`) 둘 다 오는데, IPC 경계로 재귀 타입을 보내지 않으려고
**문서 순서의 평면 목록 + `depth`** 로 통일했다 — 아웃라인은 어차피 들여쓴
목록이라 렌더도 같이 단순해진다.

**시그니처 인자 구간은 UTF-16 오프셋으로 준다.** 서버는 인자 라벨을 문자열로
주기도 하고 `[start, end]` 오프셋으로 주기도 하는데, 문자열이면 백엔드가 라벨
안에서 찾아 구간으로 바꾼다. 이 변환을 프런트에도 두면 곧 어긋나고, 바이트로
주면 한글 라벨에서 강조가 밀린다 (설계 SSOT §위치 인코딩과 같은 이유).

**포맷팅은 디스크가 아니라 버퍼를 다듬어 돌려준다** — 이름 바꾸기·코드 액션과
정반대다. 그것들은 열려 있지 않은 파일까지 고치므로 디스크에 적용하고 미저장을
금지했지만, 포맷은 편집 중인 한 파일이 대상이라 저장을 강요할 이유가 없다.
대신 호출 전에 디바운스를 건너뛰고 버퍼를 서버에 밀어 넣는다(`flushText`) —
서버가 아는 문서가 뒤처져 있으면 편집 오프셋이 엉뚱한 자리를 가리킨다.

**워크스페이스 심볼은 이미 떠 있는 서버에만 묻는다** (`running_clients`).
파일에 매이지 않은 요청이라 `ensure_for_file` 을 쓸 수 없는데, 그렇다고 새로
띄우면 팔레트에 글자를 칠 때마다 rust-analyzer 가 기동한다.

**거터는 `git diff` 가 아니다.** 그건 디스크를 보는데, 거터는 **저장하기 전에**
무엇을 고쳤는지 보여야 쓸모가 있다. HEAD 블롭만 git 에서 가져오고 비교는
`similar` 로 직접 한다. 지움+삽입이 붙어 있으면 "수정" 한 덩어리로 접는다 —
표식 두 개를 겹쳐 그리면 무슨 일이 났는지 안 보인다. 지워진 줄은 화면에 없으므로
남은 앞 줄에 표식을 붙인다.

**언어별 끄기·경로 오버라이드는 동적 설정 키**(`code_lsp_off_<lang>` /
`code_lsp_cmd_<lang>`)다. 타입 있는 `Settings` 객체에 넣으면 지원 언어가 늘
때마다 필드를 늘려야 하고, 그건 레지스트리(`SERVERS`)와 두 벌의 진실이 된다.
설정을 바꾸면 떠 있던 서버를 정리한다 — 안 그러면 다음 재시작까지 조용히 어긋난다.

## 검증

- 게이트 5종 전부 exit 0 직접 확인: `pnpm typecheck` · `pnpm test`(106파일 1235개)
  · `pnpm lint` · `pnpm build` · `cd src-tauri && cargo test`(744 + 통합).
- 새 테스트 24개. 백엔드 17(참조 묶기·미리보기·계층/평면 심볼·UTF-16 인자 구간·
  거터 8종), 프런트 6(거터 마커 접기 우선순위·아웃라인 커서 위치), 회귀 1.
- **회귀 하나를 이 라운드에서 만들고 잡았다** — 아래 메모.

## 메모

- **재읽기 루프.** 화면이 창에 넘기는 `onBuffersChanged` 를 인라인 화살표로
  두었더니 매 렌더 새 신원이 되고, 그것에 매달린 `CodePane.loadFile` 이
  재생성되면서 effect 가 파일을 다시 읽었다. 그 읽기가 또 상태를 바꿔 렌더를
  불러 **끝나지 않는 루프**가 됐다 (편집기가 "불러오는 중" 에서 못 빠져나온다).
  기존 `code_screen` 테스트가 잡았고, `useCallback` 으로 승격해 고쳤다.
  회귀 테스트는 `code_read` **호출 횟수**를 센다 — 처음에 "미저장 편집이
  사라진다" 로 단언했다가 버그를 재현해 보니 통과해서(버퍼 캐시가 편집을
  지켜 준다) 단언을 실제 증상으로 고쳤다.
- **인앱 육안 확인은 아직**(`verified_by_user: false`). 시그니처 툴팁 위치,
  거터 색, 참조 패널 높이, 아웃라인이 트리 자리를 나눠 갖는 비율은 jsdom 밖이다.
- 같은 파일이 양쪽 창에 열리면 오른쪽 창은 서버를 안 붙인다(Phase 1 결정) —
  그 창에는 시그니처 힌트도 안 뜬다. 거터는 LSP 와 무관해서 양쪽 다 뜬다.
