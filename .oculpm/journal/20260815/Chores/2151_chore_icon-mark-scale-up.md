---
schema_version: 1
type: chore
slug: "icon-mark-scale-up"
status: done
difficulty: verylow
created_at: "2026-08-15T21:51:36+09:00"
session_id: "mcp-20260815-215136"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "public/icon.svg"
    op: update
  - path: "landing/icon.svg"
    op: update
  - path: "landing/og.svg"
    op: update
  - path: "landing/social-preview.svg"
    op: update
  - path: "src-tauri/icons/icon.png"
    op: update
  - path: "src-tauri/icons/icon.icns"
    op: update
  - path: "src-tauri/icons/icon.ico"
    op: update
  - path: "src/components/BootSplash.tsx"
    op: update
related: []
tags:
  - "brand"
  - "icon"
  - "assets"
  - "mcp-tool"
---
[x] 앱 아이콘 — 타일 여백을 줄이려 동심 아크를 1.4배로

## 동기

동심 아크 마크가 라운드 사각 타일 안에서 지름 420 / 타일 864 = **48.6%** 밖에 차지하지 않아 여백이 과했다. 32px 도크·트레이 크기에서 특히 마크가 작아 보였다.

## 변경 요약

마크를 중심 기준 **1.4배 균일 확대**했다 — 지름 420 → 588, 타일 대비 48.6% → **68%**.

반지름(190/132/74)·대시배열·회전각·선폭은 **원본 그대로 두고 그룹 변환만 얹었다**:

```
<g transform="translate(512 512) scale(1.4) translate(-512 -512)">
```

숫자를 다시 타이핑하면 대시배열을 새 원주에 맞춰 재계산해야 하고(970·224 는 r=190 원주 1194 에 맞춘 값) 아크 간격·선폭 비례가 틀어지기 쉽다. 균일 변환은 그 위험이 0이다.

같은 마크가 들어 있는 파일 4개를 모두 맞췄다 — 브랜드가 갈라지지 않게:

- `public/icon.svg` — 앱 파비콘 · `BrandMark`
- `landing/icon.svg` — 위와 동일 사본
- `landing/og.svg`, `landing/social-preview.svg` — 마크가 축소 그룹 안에 중첩돼 있으나 변환이 정상 합성됨을 렌더로 확인

`pnpm tauri icon public/icon.svg` 로 `src-tauri/icons/*` 17개(png·icns·ico)를 재생성했다. CLI 가 iOS·Android 세트도 같이 뱉는데 이 앱은 데스크톱 전용이라 두 디렉터리는 지웠다.

## 주의

- `filter="url(#ar-sh)"` 의 영역(`filterUnits="userSpaceOnUse"`, 200,200 624×640)은 확대된 좌표계 기준으로 해석된다. 마크 bbox 는 그 좌표계에서 여전히 302..722 라 영역 안에 들어간다 — 그래서 필터를 건 `<g>` 자체가 아니라 **바깥에** 변환 그룹을 감쌌다.
- `BootSplash` 는 같은 아크 지오메트리를 하드코딩하지만 타일이 없다. 균일 확대는 아크 간 비례를 바꾸지 않으므로 재현하지 않았고, 그 근거를 주석에 남겼다 (마크 크기는 CSS `.boot-mark` 폭이 정한다).
- 랜딩은 git 연동이 없다 — 반영하려면 `cd landing && vercel --prod` 필요.

## 검증

- 4개 SVG 전부 XML 파싱 통과.
- 재생성된 `128x128@2x.png` / `32x32.png` 를 직접 확인 — 마크가 타일을 채우고 32px 에서도 아크·초점이 분리돼 읽힌다. 변경 전 아이콘(`git show HEAD:...`)과 나란히 비교했다.
- `landing/og.svg` 를 래스터화해 중첩 그룹 안에서도 확대가 정상 합성됨을 확인.
- `pnpm typecheck` — 부트 스플래시 관련 오류 0개(나머지는 병렬 세션 터미널 WIP).