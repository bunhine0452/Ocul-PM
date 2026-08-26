---
schema_version: 1
type: feature
slug: code-image-pdf-preview
status: done
difficulty: medium
created_at: "2026-08-26T08:50:00+09:00"
session_id: "manual-20260826-085000"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src-tauri/src/commands/docs.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/previewKind.ts"
    op: create
  - path: "src/features/code/CodePreview.tsx"
    op: create
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/errors.ts"
    op: update
  - path: "src/__tests__/code_preview.test.tsx"
    op: create
related: []
tags: [code-screen, preview, webview]
---

[x] 코드 화면에서 이미지·PDF 미리보기

## 추가 기능

코드 화면에서 `png/jpg/jpeg/gif/webp/avif/bmp/ico` 와 `pdf` 를 열면 "미리볼 수 없는
파일입니다" 대신 **그림과 문서가 그대로 뜬다**. 이미지는 창 맞춤 ↔ 실제 크기 전환과
원본 해상도(`1024 × 1024`) 표기를, PDF 는 웹뷰 내장 뷰어를 쓴다.

`svg` 는 일부러 뺐다 — 텍스트이자 곧 코드라 편집 대상이다. 여기로 가져가면 프로젝트
아이콘 하나를 이 화면에서 못 고치게 된다 (VS Code 도 svg 는 에디터로 연다).

## 동작 흐름

1. `previewKindFor(path)` — 확장자만 보는 순수 함수. **`code_read` 보다 앞서** 갈린다.
   백엔드의 바이너리 판정(선두 8KB 의 NUL)은 "텍스트가 아니다" 까지만 말해 주고,
   무엇으로 그릴지는 거기서 안 나온다. 게다가 2MB 편집 상한(`MAX_EDIT_BYTES`)에 먼저
   걸려 **스크린샷 한 장은 열어 보기도 전에 "너무 큼"** 이 된다.
2. `code_asset` (신설) — `code_read` 와 같은 경로 가드(`secure_join` +
   `canonical_within_root`)를 쓰되 자기 상한 `MAX_PREVIEW_BYTES = 16MB` 를 갖고,
   해시·바이너리 판정 없이 base64 + MIME 으로 싣는다. 편집 대상이 아니라 저장 창구가
   없고, 그래서 낙관적 잠금 토큰도 필요 없다.
3. `CodePreview` — base64 → `Blob` → `blob:` URL → `<img>` / `<iframe>`.
   `data:` URI 가 아닌 이유는 크기다: 16MB 파일이면 21MB 짜리 **문자열**이 DOM 속성에
   그대로 박힌다. URL 은 파일 전환·언마운트에서 반드시 `revokeObjectURL` 한다.
4. 워처 연동 — 열어 둔 미리보기 파일이 디스크에서 바뀌면 `previewEpoch` 를 올려 자산만
   다시 읽는다 (에이전트가 스크린샷을 갈아 끼우면 화면도 따라가야 한다).

곁들여 고친 것: 편집 불가 파일로 넘어갈 때 **앞 파일의 버퍼를 놓게** 했다
(`showUneditable`). 전에는 `a.ts` → `b.png` 로 옮겨도 `bufferRef` 가 남아, 그 상태의
⌘S 가 `a.ts` 본문을 `b.png` 경로에 쓰려 들었다 — 해시가 안 맞아 애먼 "충돌" 배너로
위장되고, 거기서 "덮어쓰기" 를 누르면 실제로 깨졌다. binary·tooLarge 분기도 같이 닫았다.

## 검증

- **WKWebView 실측**: `blob:` PDF 가 정말 그려지는지가 이 기능의 유일한 미지수였다.
  Safari 스크린샷은 화면 캡처 권한이 없어 막혀서, Tauri 가 실제로 쓰는 WKWebView 를
  Swift 로 띄워 `takeSnapshot` 을 떴다 — `<embed>`/`<iframe>`/`<object>` 셋 다 렌더됨.
  덕분에 `pdfjs-dist` 의존을 안 들였다. 같은 방법으로 실제 `code.css` 를 물린 레이아웃
  스냅샷도 확인(체커보드·창 맞춤·실제 크기).
- **잘리는 함정 하나**: 실제 크기 모드의 가운데 정렬을 `align-items: center` 로 두면
  넘치는 그림의 **위쪽에 스크롤로 닿을 수 없다**. flex 항목의 `margin: auto` 로 바꿔
  넘칠 때 0 으로 접히게 했고, 창보다 큰/작은 두 경우를 스냅샷으로 확인했다.
- 게이트 전부 exit 0: `pnpm typecheck` · `pnpm test`(115파일 1,319케이스, 미리보기
  8건 신규) · `pnpm lint` · `pnpm build` · `cargo test`(823 + docs mime 에 pdf 단언).

## 메모

`code_asset` 은 `docs::mime_for` 를 함께 쓴다 (`pub(crate)` 로 열고 `pdf` 추가).
MIME 이 틀리면 iframe 이 빈 채로 뜨고 이유가 화면 어디에도 안 남아서, 그 한 줄을
docs 테스트에 못박아 뒀다. `discussion.rs` 에도 같은 함수의 사본이 있으나 이번 변경과
무관해 건드리지 않았다.
