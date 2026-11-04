---
schema_version: 1
type: feature
slug: "app-icon-nine-variants"
status: done
difficulty: low
created_at: "2026-11-04T18:43:51+09:00"
session_id: "20261104-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2d22bf7f-6405-4d02-807b-8e7aa8da8901"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/appIconArt.ts"
    op: create
  - path: "src/features/settings/AppIconPicker.tsx"
    op: create
  - path: "scripts/build-app-icons.mjs"
    op: create
  - path: "src-tauri/icons/variants"
    op: create
  - path: "src-tauri/src/app_icon.rs"
    op: update
  - path: "src/features/settings/DisplaySection.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
related:
  - ref: "20261104/Features_to_add/1824_feature_start-window-tile-choices-mono-icon.md"
    kind: "followup"
tags:
  - "설정"
  - "ui"
  - "settings"
  - "design"
  - "mcp-tool"
---
[x] 설정: 앱 아이콘을 아홉 가지로 고른다

## 추가 기능

사용자 요청(11-04): 「다크 모드도 있으면 좋겠고, 더 많은 색을 선택할 수 있게」. 앞 작업의 컬러 / 흑백 두 가지를 아홉으로 넓혔다.

- **고르는 것:** 초록(기본) · 다크 · 라이트 · 흑백 · 파랑 · 보라 · 분홍 · 주황 · 청록. 설정 「표시 › 앱 아이콘」 에 실제 아이콘 모양 미리보기로 서고(`AppIconPicker`), 방향키로 옮기는 라디오 묶음이다.
- **그림:** `features/settings/appIconArt.ts` 한 곳에서 나온다. `landing/icon.svg` 의 모양 그대로 색 벌만 바꾸는 `appIconSvg()` 다.
  - 미리보기도 이 함수로 그린다.
  - Dock PNG 는 `scripts/build-app-icons.mjs` 가 이 함수로 구운 `icons/variants/<id>.png` 다(헤드리스 Chrome, 512px, Node 의 TS 타입 지우기). 그래서 둘이 어긋나지 않는다.
- **백엔드:** `app_icon::variant_png(id)` 표를 쓴다. 기본과 모르는 값은 `None`, 곧 번들 아이콘이다.
  - 설정을 바꿀 때(`force`)는 변형끼리 오가므로 번들 아이콘을 늘 다시 쓴다.
  - 기동 때는 `Icon\r` 이 이미 그 꼴이면 건너뛴다.
  - 앞 판의 `has_custom` 비교만으로는 흑백에서 파랑으로 바꿀 때 번들이 안 바뀌었을 것이다.
- **테스트:** 프런트 id 목록과 백엔드 표가 어긋나면 `ids_match_the_frontend_list` 가 빨개진다.

## 검증
- `pnpm typecheck` · `pnpm lint` · `pnpm build`: 0. `pnpm test`: 1062 passed. `cargo test --locked`: 34 묶음 ok. clippy clean.
- 하네스: 설정 화면 밝게 / 어둡게에서 아홉 미리보기와 고른 고리를 봤다. 다크를 누르면 고른 것이 옮겨 간다.