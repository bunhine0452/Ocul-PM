---
schema_version: 1
type: bug
slug: "lint-scripts-windows-paths"
status: done
difficulty: low
created_at: "2026-11-10T18:02:30+09:00"
session_id: "manual-20261110-180230"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "scripts/check-bindings-imports.mjs"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "scripts/check-file-sizes.mjs"
    op: update
  - path: "scripts/clean-target.mjs"
    op: update
  - path: "scripts/bump-version.mjs"
    op: update
related:
  - ref: "20261110/Features_to_add/1801_feature_windows-app-title-bar.md"
    kind: "context"
tags:
  - "린트"
  - "windows"
  - "cross-platform"
---
[x] 린트: Windows 에서 경로가 깨져 안 돌던 것을 고쳤다

## 발생 원인
- Windows 에서 처음 클론하고 `pnpm lint` 를 돌리자 첫 관문에서 멈췄다. `ENOENT: scandir 'C:\C:\Users\…\Ocul-PM\src'`.
- 스크립트 일곱이 뿌리를 `new URL("../src", import.meta.url).pathname` 으로 만들었다. Windows 에서는 `/C:/Users/…` 가 되고, `join` 이 그 앞에 드라이브를 한 번 더 붙인다.
- 이식성 CI(portability.yml)는 Windows 에서 cargo 와 vitest 만 돌리고 lint 는 안 돌려서 지금까지 몰랐다.
- `check-design-discipline.mjs` 는 하나 더 있었다. `relative()` 결과를 `/` 로 고치지 않아 Windows 의 `styles\shell.css` 가 허용 목록(`styles/shell.css`)에 끝내 안 맞았을 것이다. 나머지 셋은 이미 고치고 있었다.

## 해결 방법
- 뿌리를 `join(import.meta.dirname, "..", "src")` 로 바꿨다. bump-version 은 `ROOT + "파일"` 로 쓰므로 `+ sep` 를 붙였다.
- 처음에는 `fileURLToPath(new URL(…))` 로 고쳤는데 스크립트를 import 하는 vitest 4개 파일이 불러오는 단계에서 죽었다. jsdom 이 전역 `URL` 을 제 것으로 바꿔, 그 객체를 Node 의 `fileURLToPath` 가 「file 스킴이 아니다」 로 거절한다. `import.meta.dirname` 은 Node 와 vitest 둘 다 OS 경로를 그대로 준다(직접 찍어 봤다).
- design 검사의 `rel` 도 `/` 로 고쳤다.

## 검증
- Windows 11 · Node 26: `pnpm lint` → 6관문 ✓ · exit 0 (고치기 전에는 첫 관문 ENOENT 로 exit 1)
- `pnpm vitest run` bump_version · file_size_policy · file_size_ratchet · i18n_lint_scanner → 4 files · 66 passed (fileURLToPath 판에서는 4 files failed). `pnpm test` → 1081 passed
