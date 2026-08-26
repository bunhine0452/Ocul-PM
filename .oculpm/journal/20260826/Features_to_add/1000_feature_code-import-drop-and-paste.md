---
schema_version: 1
type: feature
slug: code-import-drop-and-paste
status: done
difficulty: high
created_at: "2026-08-26T10:00:00+09:00"
session_id: "manual-20260826-100000"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/importTarget.ts"
    op: create
  - path: "src/features/code/useCodeImport.ts"
    op: create
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_import.test.tsx"
    op: create
  - path: "src/__tests__/code_tree_lazy.test.tsx"
    op: update
related:
  - "20260826/Features_to_add/0850_feature_code-image-pdf-preview.md"
tags: [code-screen, drag-drop, clipboard, macos]
---

[x] Finder 에서 끌어다 놓기 · ⌘V 로 코드 트리에 파일 넣기

## 추가 기능

VS Code 처럼 **Finder 에서 파일·폴더를 코드 트리로 끌어다 놓으면** 그 폴더로
복사되고, **⌘V 로도** 같은 일이 된다. 끌고 다니는 동안 들어갈 폴더가 밝게 표시되고,
놓고 나면 그 폴더가 펼쳐지며 토스트가 목적지를 이름으로 말한다.

이름이 겹치면 **덮어쓰지 않고** `note-2.txt` 로 붙는다 — 드롭 한 번이 같은 이름의
원본을 지우는 일은 되돌릴 수 없다. 폴더는 재귀로 들어오고, 심볼릭 링크는 따라가지
않는다(트리·검색과 같은 정책).

## 동작 흐름

두 입력은 겉보기에 다르지만 **결국 OS 절대경로 목록**으로 같아져 `code_import`
하나로 합류한다.

1. **드롭** — HTML 드롭 이벤트는 Tauri 가 가로채므로 웹뷰의 `DataTransfer` 에는
   경로가 없다. `onDragDropEvent` 로만 오고, 대신 커서 좌표가 함께 온다. 그 좌표를
   CSS 픽셀로 되돌려(`/ devicePixelRatio`) `elementFromPoint` → 트리 행의
   `data-tree-path` 를 읽는다. 행이 없으면 **받지 않는다** — 어디로 갈지 모르는
   파일을 조용히 어딘가로 복사하는 것이 더 나쁘다.
2. **⌘V** — 웹뷰의 paste 로는 안 된다: 파일 하나는 `File` 로 실려도 **폴더는 아무것도
   실리지 않고**, 실려 온 바이트를 base64 로 IPC 에 태우면 큰 파일에서 그대로 비용이
   된다. macOS pasteboard 의 `public.file-url` 을 백엔드가 직접 읽는다
   (`code_clipboard_files`). URL 퍼센트 디코딩은 손대지 않고 `NSURL` 에 맡긴다 —
   `My%20File.txt` 를 손으로 풀면 반드시 틀린다.
3. `code_import(dest_dir, sources)` — `code_read` 와 같은 경로 가드. 파일 위에
   떨어뜨리면 그 **부모 폴더**로 접는다(VS Code 와 같다). 예산(2,000개 · 512MB)에
   닿으면 거기까지 복사된 채 멈추고 `truncated` 로 알린다 — 되돌리면 오래 걸린
   복사가 통째로 사라져 더 나쁘다.

**⌘V 의 목적지가 어긋나던 자리 하나**를 함께 메웠다: 폴더는 눌러도 "선택"이 되지
않고 펼쳐지기만 한다(탭이 열리는 것은 파일뿐). 그대로 두면 `assets/` 를 누르고 ⌘V 를
쳐도 열려 있던 파일의 폴더로 들어간다. 화면이 **트리에서 마지막으로 손댄 자리**를
따로 기억해 넘기고, 토스트가 목적지 이름을 말해 결과가 눈에 남게 했다.

## 검증

- Rust 5건 — 겹치는 이름은 `-2`(그다음은 `-3`) · 폴더 재귀 + 심볼릭 링크 제외 ·
  예산 소진 시 중단과 `truncated` · 폴더를 자기 안으로 넣기 거부 · 없는 원본은
  오류가 아니라 건너뜀(나머지는 계속 들어온다).
- vitest 8건 — 목적지 규칙(폴더/파일/커서 없음/커서 우선), 드롭이 그 폴더로 가고
  끌고 다니는 동안 표시되는지, 트리 밖 드롭은 무시, ⌘V 가 클립보드 파일을 트리에서
  누른 폴더로, 글자만 복사한 ⌘V 는 무동작.
- 게이트 전부 exit 0: typecheck · test(116파일 1,327) · lint · build · cargo test(828).
- **남은 확인**: Tauri 가 주는 드롭 좌표가 웹뷰 기준인지(타이틀바 포함 여부)는
  실제 드래그로만 확정된다. 어긋나도 조용히 틀리지 않게 만들어 뒀다 — 끌고 다니는
  동안 들어갈 폴더가 밝게 표시되므로 어긋남이 눈에 먼저 보인다.

## 메모

macOS 전용 의존성 3개(`objc2` · `objc2-app-kit` · `objc2-foundation`)를 직접
의존으로 올렸다. 셋 다 이미 tao/wry 를 통해 그래프에 있어 새로 받는 것은 없다.
`clipboard_file_paths()` 는 macOS 밖에서 빈 목록을 돌려주므로 커맨드 계약은 모든
플랫폼에서 유지된다 — 프런트가 갈라지지 않는다.

`.svg` 미리보기 판정과 마찬가지로, 드롭은 **트리에만** 받는다. 에디터 영역 드롭
(VS Code 는 그 파일을 연다)은 이번 범위 밖이다.
