---
schema_version: 1
type: chore
slug: reload-diagnostics-scaffold
status: done
difficulty: low
created_at: "2026-07-20T15:42:59+09:00"
session_id: "manual-20260720-153740"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/main.tsx
    op: update
  - path: package.json
    op: update
related:
  - 20260720/Bugs/1519_bug_settings-entry-page-reload.md
tags: ["diagnostics", "vite", "dev-only", "reload"]
---

[x] 웹뷰 리로드 원인 자가-판정 로그 스캐폴드 (dev 전용)

미규명 리로드(ai-pm 선택 직후)의 원인을 사용자 터미널 복붙 없이 로그 파일로 판정하기
위한 2겹 계측:

1. `main.tsx` — `import.meta.hot` 이벤트 훅: `vite:beforeFullReload`(payload 에 트리거
   경로!)·invalidate·error·ws-disconnect/connect 를 `[vite-diag]` 접두사로 console.warn →
   콘솔 브리지가 oculpm.log/앱데이터 로그로 전달. **판정 규칙**: 리로드 직전
   beforeFullReload 가 있으면 Vite 원인(트리거 파일 명시), 없이 App mounted 만 다시
   찍히면 웹뷰 프로세스 크래시. `import.meta.hot` 은 프로덕션에서 undefined — 번들 제외.
2. `package.json` — `pnpm tauri:log`: 터미널 전체(vite+cargo)를
   `/tmp/oculpm-tauri-dev.log` 에 tee (세션 구분 헤더 포함).

## 검증

typecheck / vitest 143 / lint / build 그린. 실판정은 사용자가 `pnpm tauri:log` 로 재현한
뒤 두 로그를 직접 읽는 다음 라운드에서.
