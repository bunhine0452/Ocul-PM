---
schema_version: 1
type: chore
slug: "vite8-rolldown-vitest5"
status: done
difficulty: medium
created_at: "2026-10-24T23:25:05+09:00"
session_id: "20261024-007"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "vite.config.ts"
    op: update
  - path: "vitest.config.ts"
    op: update
related: []
tags:
  - "deps"
  - "build"
  - "perf"
  - "mcp-tool"
---
[x] Vite 8(rolldown) · plugin-react 6 · Vitest 5 — 번들 7.38s → 1.85s

## 변경 요약

다음 후보 5(플랜 `optimize-round-20261024` #next-vite8). 공식 마이그레이션 문서(vite.dev/guide/migration 8.3.4 · vitest.dev/guide/migration 5.0.5)로 대조.

- vite 7.3.7 → 8.3.5, @vitejs/plugin-react 4.7 → 6.1.2(peer vite ^8), vitest 4.1.12 → 5.0.5(Node ≥ 22.12 — CI 는 22.x). @tailwindcss/vite 4.3.3 은 ^8 까지 지원.
- `resolve.alias[].customResolver` 폐기 예정 → 이벤트 셤을 `enforce: "pre"` · `resolveId` 플러그인 `tauriEventShim()` 으로. 셤 안의 임포트만 진짜 모듈.
- Vite 8 기본 빌드 타깃이 Safari 16.4 — 최소 macOS 13.0 의 초기 WKWebView 는 16.1 대라 Vite 7 기본값(chrome107·edge107·firefox104·safari16)을 `build.target` 으로 고정.
- Vitest 5 의 `clearMocks` 기본 true → v4 동작 유지(`clearMocks: false`). 함수·describe 안 `vi.mock` 은 0건(새로 오류가 되는 것).

## 검증

- vitest 254/3256 · typecheck · lint · build 통과.
- 셤 적용: 앱 코드는 `@tauri-apps/api/event` 만 임포트(셤 직접 임포트는 테스트뿐)인데 번들에 셤의 `setTimeout(()=>{…unregisterCallback(o)…},p)` 가 있다.
- 실측(같은 기기): Vite 7 번들 7.38s · 전체 16s → Vite 8 1.85s · 9s. 진입 청크 gzip 88 → 78KB, dist 16MB 동일.