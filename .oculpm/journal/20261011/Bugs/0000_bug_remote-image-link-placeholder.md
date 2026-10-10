---
schema_version: 1
type: bug
slug: "remote-image-link-placeholder"
status: done
difficulty: low
created_at: "2026-10-11T00:00:36+09:00"
session_id: "mcp-20261011-000036"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "8ea7b9ae-c829-4853-a394-c185809e360d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/MarkdownImpl.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/markdown_remote_image.test.tsx"
    op: create
related:
  - ref: "20261007/Bugs/1048_bug_webview-csp-enabled.md"
    kind: "followup"
tags:
  - "security"
  - "csp"
  - "ui"
  - "mcp-tool"
---
[x] CSP 에 막힌 원격 마크다운 이미지가 깨진 아이콘으로 보이던 것 — 링크 자리표시로

## 발생 원인
v3.8.0 CSP 의 `img-src 'self' data: blob:` 가 일지 · 에이전트 답 · 논의의 `![](https://…)` 를 막는다. 그래서 웹뷰에 깨진 이미지 아이콘이 떴다. CSP 를 풀면 추적 픽셀 송출이 되므로 풀 수 없다.

## 해결 방법
- 앱의 마크다운 렌더러는 `Markdown.tsx` 가 lazy 로 감싼 `MarkdownImpl.tsx` 하나뿐이었다. 소비처는 13곳이고, `img` 를 덮어쓰는 곳은 없었다.
- 거기에 `img` 렌더러를 두었다. http · https · `//` 이미지는 lucide `ImageOff` 와 alt(없으면 호스트명)를 담은 작은 칩 `<a>` 로 그린다. 클릭은 기존 문서 레벨 가드 `lib/externalLinks` 가 `open_url` 로 연다.
- `data:` · `blob:` · 상대 경로는 그대로 `<img>` 로 남긴다.
- 원시 `<img>` 는 rehype-raw 가 없어 애초에 렌더되지 않는다. 모바일 페이지는 웹뷰 CSP 대상이 아니다.
- 병렬 레인(Sonnet 5.5)이 구현했다. PR #83.

## 검증
- vitest 5건 통과: 원격은 링크, alt 없으면 호스트명, `//` 는 https, data: 는 img, 에이전트 답 경로. pnpm test 3328건 · lint · build 통과.
- 실기기 육안은 미확인이다. improvement-round-2026-09-14 #eyes-security 로 넘겼다.