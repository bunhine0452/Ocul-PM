---
schema_version: 1
type: feature
slug: "harness-in-repo-packaging"
status: done
difficulty: medium
created_at: "2026-11-23T21:25:57+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Sonnet 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".gitignore"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "package.json"
    op: update
  - path: "packaging/homebrew/ocul-pm.rb"
    op: create
  - path: "packaging/winget/KimHyunbin.Ocul.installer.yaml"
    op: create
  - path: "packaging/winget/KimHyunbin.Ocul.locale.en-US.yaml"
    op: create
  - path: "packaging/winget/KimHyunbin.Ocul.yaml"
    op: create
  - path: "scripts/harness/README.md"
    op: create
  - path: "scripts/harness/audit.js"
    op: create
  - path: "scripts/harness/derive.ts"
    op: create
  - path: "scripts/harness/entry.ts"
    op: create
  - path: "scripts/harness/fixtures.mjs"
    op: create
  - path: "scripts/harness/handlers.ts"
    op: create
  - path: "scripts/harness/harness.html"
    op: create
  - path: "scripts/harness/plan.mjs"
    op: create
  - path: "scripts/harness/shots.mjs"
    op: create
  - path: "scripts/harness/types.ts"
    op: create
  - path: "scripts/packaging/update-manifests.mjs"
    op: create
  - path: "src/__tests__/harness_kit.test.ts"
    op: create
  - path: "src/__tests__/packaging_manifests.test.ts"
    op: create
  - path: "tsconfig.json"
    op: update
related: []
tags:
  - "하네스"
  - "love-round"
  - "devx"
  - "mcp-tool"
---
[x] 하네스: 화면 하네스를 저장소에 둔다

## 추가 기능
- **화면 하네스 저장소화**(사용자 결정 11-23): 세 번 세션 scratchpad 에서 사라져 매번 30분씩 다시 만들던 키트를 `scripts/harness/` 에 뒀다. `pnpm harness`(브라우저에서 보기) · `pnpm harness:shots`(CDP 로 42장 + 잘림 · 작은 표적 · 대비 보고서). harness.html 은 dev 전용 Vite 진입점이라 dist 에 들어가지 않고, 픽스처는 실행 때 이 저장소의 `.oculpm` 에서 만들어 git 에 남지 않는다. 핸들러 응답 모양은 bindings 타입이 문다.
- **brew · winget 설치 채널 원본**(사용자 결정 11-23): `packaging/homebrew/ocul-pm.rb` · `packaging/winget/` 매니페스트 3종, 릴리스 자산에서 version · sha256 을 채우는 `scripts/packaging/update-manifests.mjs`, RELEASE.md §9. 바깥 저장소 제출은 사용자 확인 뒤라 아직 실제로 깔리지 않는다.

## 동작 흐름
앱 번들 · 송출에 닿지 않는다(원장 영향 없음). 최종 검수 F2 가 README 그대로 돌려 42장 · IPC 누락 0 · 예외 0 을 확인했고, 설정 통째 두 장을 더해 44장이 됐다.

## 검증
vitest `harness_kit` · `packaging_manifests` 초록, `pnpm harness:shots --port 1435` 44장 · 문제 장 0(F2). 매니페스트 sha256 은 자리표시자(네트워크 미사용) — 릴리스 뒤 스크립트로 채운다.