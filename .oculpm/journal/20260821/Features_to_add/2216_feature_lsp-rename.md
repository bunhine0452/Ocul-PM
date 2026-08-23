---
schema_version: 1
type: feature
slug: lsp-rename
status: done
difficulty: high
created_at: "2026-08-21T22:16:00+09:00"
session_id: "manual-20260821-221600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "docs/lsp/00-master-plan.md"
    op: update
  - path: "src-tauri/src/lsp/edit.rs"
    op: create
  - path: "src-tauri/src/lsp/mod.rs"
    op: update
  - path: "src-tauri/src/lsp/spec.rs"
    op: update
  - path: "src-tauri/src/commands/lsp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/lsp_rust_analyzer.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/lspBridge.ts"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/__tests__/lsp_bridge.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ".oculpm/journal/20260821/Features_to_add/2201_feature_lsp-hover-and-definition.md"
tags: [lsp, rename, workspace-edit, utf16, code-editor, ide]
---

[x] PR-LSP2 — 이름 바꾸기 (F2). 여러 파일을 전부-아니면-전무로 고친다

## 추가 기능

`F2` → 새 이름 → 그 심볼을 쓰는 **모든 곳**이 함께 바뀐다. 사용자가 앱에서
Phase 0~1 을 육안 확인해 준 뒤 이어간 라운드다.

지금까지의 LSP 기능은 전부 읽기라 틀려도 화면만 이상했다. 이름 바꾸기는
**파일을 고친다** — 그것도 여러 개를 동시에. 그래서 설계를 먼저 적고
(`docs/lsp/00-master-plan.md` §이름 바꾸기) 그대로 구현했다.

## 동작 흐름

### 여기서만 위치를 변환한다

PR-LSP0~1 은 위치를 프런트(JS, UTF-16)에 맡겨 변환 지점을 아예 없앴다. 이름
바꾸기는 **열려 있지 않은 파일까지** 고치므로 편집을 Rust 에서 적용해야 하고,
그러려면 UTF-16 `(line, character)` → UTF-8 바이트 오프셋 변환이 불가피하다.

그래서 변환을 `lsp/edit.rs` **한 곳**에 가두고 테스트로 잠갔다. 실제로 값을 한
경계들:

- **한글은 UTF-16 1유닛 · UTF-8 3바이트.** 유닛을 바이트로 착각하면 한글이 든
  줄의 편집이 전부 어긋난다. 테스트가 `at != 11 && at == 15` 로 못 박는다.
- **이모지는 서로게이트 쌍(2유닛) · 4바이트.**
- **CRLF** 의 `\r` 은 그 줄의 마지막 문자로 남는다 (LSP 도 같은 셈법).
- **`character` 가 줄 길이를 넘으면 줄 끝으로 접는다** — 서버가 줄 전체 치환을
  `character: u32::MAX` 로 표현하는 경우가 있다.
- **`line` 이 문서를 넘으면 `None`.** 이건 접어서 될 일이 아니라 오래된 편집이고,
  조용히 문서 끝에 붙이면 엉뚱한 곳을 덮어쓴다.

### 안전장치가 곧 순서다

1. **뒤에서부터 적용.** 한 파일 안의 편집을 시작 위치 **내림차순**으로 적용해야
   앞선 오프셋이 유효하게 남는다. 앞에서부터 하면 첫 치환이 뒤쪽을 전부 어긋나게 한다.
2. **겹치는 편집은 거부.** 서버가 보낼 일은 없지만 오면 결과가 조용히 망가진다.
   맞닿는 것(`end == start`)은 정상이라 허용한다.
3. **전부 아니면 전무.** 모든 파일의 새 내용을 메모리에서 먼저 만들고, 하나라도
   실패하면 **아무것도 쓰지 않는다.** 부분 적용은 코드를 깨진 채로 남긴다.
4. **프로젝트 밖 URI 는 버리지 않고 오류.** 조용히 건너뛰면 이름이 반쪽만 바뀐 채
   컴파일이 깨진다.
5. **파일 생성·삭제 연산은 거부** (`documentChanges` 의 `kind`). 이름 바꾸기가
   파일을 만들거나 지우면 그건 다른 종류의 작업이다.
6. **미저장 버퍼가 있으면 프런트가 막는다.** 서버는 `didChange` 로 받은 **버퍼**
   내용을 보고 편집을 계산하는데 우리는 **디스크**에 적용한다. 둘이 다르면
   오프셋이 어긋나 엉뚱한 자리를 덮어쓴다 — 저장을 먼저 요구한다.

되돌리기는 만들지 않았다. 다중 파일 undo 스택 대신 git 에 맡긴다(변경 diff 화면이
이미 있다). 대신 무엇을 바꿨는지 "N개 파일에서 M곳" 으로 보고하고, 입력창 아래에
되돌리기가 없다는 사실을 적어 둔다.

### 프런트

`F2` 는 커서 위 식별자를 입력창 초깃값으로 채운다 — 빈 칸에서 시작하면 사용자가
옛 이름을 다시 타이핑해야 한다. 커서가 식별자 **바로 뒤**(`foo|`)여도 잡는데,
F2 를 누르는 가장 흔한 자리라서다. 이 판별도 순수 함수로 떼어 테스트했다.

적용 후에는 열려 있던 파일을 **버퍼를 버리고** 디스크에서 다시 읽는다 (그 파일도
디스크에서 바뀌었으므로).

## 검증

- **실제 rust-analyzer 왕복** (`rename_applies_a_real_workspace_edit`) — `greet` →
  `hello` 로 정의 1 + 호출 2 = **3곳**이 바뀌고, **한글 리터럴
  `"안녕하세요, {name}"` 이 온전한지**까지 단언한다. 오프셋 변환이 어긋났다면
  여기서 깨진다. 옛 이름이 하나도 안 남는 것도 확인.
- `cargo test` 701 + 통합 5 그린 (직전 682+4 → 신규 20). `lsp/edit.rs` 단위 19개:
  위치 변환 6(한글·이모지·CRLF·과대 character·문서 밖·기본), 편집 적용 8(순서·
  길이 다름·여러 줄·범위 치환·겹침 거부·인접 허용·파일 밖·빈 목록),
  WorkspaceEdit 파싱 5(두 모양·파일별 묶기·프로젝트 밖 거부·파일 연산 거부·빈 편집).
- `pnpm test` 1116 그린 (신규 4 — 커서 위 식별자).
- `pnpm typecheck` · `pnpm lint` · `pnpm build` 각각 exit 0.

**앱에서 F2 를 눌러 본 육안 확인은 아직이다.** 백엔드는 실제 서버로 파일까지
고쳐 봤지만, 다이얼로그가 뜨고 미저장 게이트가 실제로 막는지는 확인하지 않았다.
파괴적 기능이라 이번엔 특히 한 번 눌러 보시길 권한다 — 되돌리기가 없으니 git 이
깨끗한 상태에서.

## 메모

`#lsp-code-action`(quick fix)은 이번에 안 했다. 이름 바꾸기 하나가 이미 한 라운드
분량이었고, 코드 액션은 같은 `WorkspaceEdit` 적용 경로를 재사용하므로 다음 번에
얹으면 된다 — 이 라운드가 그 기반을 깔아 둔 셈이다.

`textDocument/rename` 전에 `prepareRename` 을 부르지 않는다. 부르면 "이 자리에서
이름을 바꿀 수 있는가" 를 미리 알 수 있지만 왕복이 한 번 더 늘고, 못 바꾸는 자리는
`rename` 자체가 빈 편집을 돌려줘서 "바꿀 곳을 찾지 못했습니다" 로 끝난다. 지금은
그 정도면 충분하다고 봤다.
