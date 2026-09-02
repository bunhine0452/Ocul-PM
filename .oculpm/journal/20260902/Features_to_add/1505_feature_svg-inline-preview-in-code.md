---
schema_version: 1
type: feature
slug: "svg-inline-preview-in-code"
status: done
difficulty: medium
created_at: "2026-09-02T15:05:18+09:00"
session_id: "20260902-006"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/SvgPreview.tsx"
    op: create
  - path: "src/features/code/previewKind.ts"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_preview.test.tsx"
    op: update
  - path: "src/__tests__/code_screen.test.tsx"
    op: update
related: []
tags:
  - "code"
  - "preview"
  - "svg"
  - "vscode-benchmark"
  - "mcp-tool"
---
[x] 코드 화면 — svg 를 에디터 옆에서 그림으로 보기 (버퍼 기준 실시간)

svg 는 코드 화면에서 텍스트로만 열렸다. 아이콘 하나를 고치면서 결과를 보려면 외부 앱을 열어야 했다.

## 추가 기능

- 브레드크럼 우측에 **그림으로 보기** 토글 (svg 파일에서만 뜬다). 켜면 에디터 오른쪽에 미리보기 칸이 붙는다 — 갈아타는 것이 아니라 **나란히** 둔다.
- 미리보기의 원본은 디스크가 아니라 **버퍼**다. `fill` 을 고치면 저장 없이 250ms 뒤 그림이 바뀐다. 워처 리로드·포맷팅·비교 모드 진입처럼 본문이 통째로 갈리는 순간(`editorEpoch`)에도 따라간다.
- 창에 맞추기 / 실제 크기 토글(이미지 미리보기와 같은 손잡이), 바이트·픽셀 크기 표시, 닫기 버튼.
- 반쯤 지운 태그처럼 아직 못 그리는 본문은 오류가 아니라 "아직 그릴 수 없는 SVG" 로 말한다 — 타자 중에 반드시 지나가는 상태다.

## 동작 흐름

`previewKindFor` 는 그대로 svg 를 **에디터로** 보낸다(코드니까). 새 `isSvgPath` 가 "에디터 옆에 그림을 띄울 수 있는가" 라는 다른 축을 맡는다. `CodePane` 이 토글·본문 동기화를 소유하고, `SvgPreview` 는 받은 텍스트를 `blob:` 로 구워 `<img>` 로 그린다. `<img>` 안의 svg 는 스크립트·외부 참조가 죽는 모드라 프로젝트에서 열어 본 svg 가 웹뷰에서 뭔가를 실행할 길이 없다 (인라인 삽입이었다면 그 반대).

VS Code 벤치마크: `extensions/media-preview` 는 svg 를 이미지 미리보기 커스텀 에디터에 등록하되 텍스트 에디터를 기본으로 두고 제목줄의 `Open Preview` / `Reopen as Text` 로 갈아타게 한다. 여기서는 같은 자리(브레드크럼 액션)에 손잡이를 두되 **갈아타는 대신 붙였다** — 저장 전 버퍼를 그릴 수 있다는 점이 그 대가로 얻은 것이다.

## 검증

`pnpm typecheck` · `pnpm test`(150 파일 1879건, 신규 8건) · `pnpm lint` · `pnpm build` 전부 exit 0. 신규 테스트: `isSvgPath` 경계(대소문자·점 파일·폴더 이름), `SvgPreview` 의 blob 수명(본문 변경 시 이전 판 회수·언마운트 정리)·빈 본문·onError 폴백·닫기 콜백, 그리고 코드 화면 통합(트리에서 svg 를 열면 토글이 뜨고 텍스트 파일에는 없다 · 켜면 에디터가 살아 있는 채로 그림이 붙는다). **육안 확인은 미완** — 설치본 도는 중 dev 빌드 금지 규율.