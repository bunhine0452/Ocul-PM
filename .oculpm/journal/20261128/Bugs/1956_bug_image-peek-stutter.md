---
schema_version: 1
type: bug
slug: "image-peek-stutter"
status: done
difficulty: low
created_at: "2026-11-28T19:56:07+09:00"
session_id: "20261128-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "6fe2b56e-24f4-4ecc-9cdf-cb61ec923378"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/imagePeek.ts"
    op: update
  - path: "src/features/terminal/TermImagePeek.tsx"
    op: update
  - path: "src/__tests__/terminal_image_peek.test.tsx"
    op: update
related:
  - ref: "20261115/Bugs/0826_bug_glue-cross-lane-gaps.md"
    kind: "followup"
tags:
  - "터미널"
  - "최적화"
  - "mcp-tool"
---
[x] 터미널: 그림 미리보기가 버벅이지 않는다

## 발생 원인

사용자 보고: 터미널의 이미지 경로에 마우스를 올려 그림을 볼 때 계속 버벅인다.

- xterm 은 링크가 있는 줄이 다시 그려질 때마다 「벗어남」 을 보내고 곧바로 「올림」 을 다시 보낸다(`@xterm/xterm` `Linkifier.ts` 의 `onRenderedViewportChange` → `_clearCurrentLink` → `_askForLink`). `imagePeek.ts` 는 벗어남에 카드를 곧장 내리고 120ms 뒤 다시 띄웠다. Claude 가 일하는 동안에는 화면이 계속 다시 그려지므로 올려 둔 내내 카드가 내려갔다 다시 떴다.
- 카드는 원본 파일 전체를 base64 `data:` 주소로 `<img>` 에 넣었다. 카드는 344×240 안인데 뜰 때마다 원본 해상도를 통째로 풀었다. 읽은 그림 넷을 기억하지만 문자열뿐이라 푸는 일은 매번 새로였다.

## 해결 방법

- 벗어남 뒤 150ms(`LEAVE_GRACE_MS`)는 카드를 그대로 둔다. 같은 경로에 그 안에 다시 올라오면 내리려던 것을 거두고 다시 그리지도 않는다.
- 원본을 한 번만 풀어 크기를 재고, 카드보다 크면 688×480 안의 줄인 PNG 를 만들어 카드에 쓴다(`makeThumb`). 크게 볼 때만 원본을 쓴다. gif 와 풀기(`decode`)가 없는 환경은 예전처럼 원본.
- CSP(`img-src 'self' data:`)는 그대로다. Blob 주소를 쓰지 않았다.

## 검증

- `pnpm exec vitest run` → 처음에 새 시험 1건 실패(앞 시험과 같은 경로라 모듈 캐시에 걸림), 경로를 바꾼 뒤 `pnpm exec vitest run src/__tests__/terminal_image_peek.test.tsx …(미리보기 시험 4파일)` → `Tests 21 passed (21)`. 전체 실행의 나머지 2275건은 통과였다.
- `pnpm typecheck` exit 0 · `pnpm lint` 6 게이트 통과.
- 못 한 것: 줄인 그림을 만드는 길은 jsdom 에 `decode` 가 없어 시험이 지나지 않는다. 실제 앱에서 눈으로 보지 않았고 버벅임을 시간으로 재지도 않았다.