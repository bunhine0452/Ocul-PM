---
schema_version: 1
type: chore
slug: release-v2-19-0
status: done
difficulty: low
created_at: "2026-08-25T11:45:00+09:00"
session_id: "manual-20260825-111308"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
related:
  - "20260825/Features_to_add/1113_feature_project-search-replace.md"
  - "20260825/Features_to_add/1130_feature_pty-host-survive-restart.md"
tags: [release]
---

[x] v2.19.0 릴리스 — 전역 검색·치환 + 업데이트에도 안 끊기는 터미널

docs/RELEASE.md 5면 절차: 버전 5파일(2.19.0) · CHANGELOG `## v2.19.0` ·
README ko/en 하이라이트+코드 화면 문단 · landing 버전 6곳 + 변경사항 li +
featureList 2줄 + 새 FAQ(업데이트-터미널, JSON-LD·details 양쪽) + 코드 화면
FAQ 확장(양쪽). 남은 `2.18.0` 문자열 5곳은 전부 "v2.18.0 부터" 류의 역사적
서술로 확인. 기존 FAQ 중 새 기능과 모순되는 문장 없음(터미널 관련 두 답변은
오히려 강화됨).

## 검증

- 커밋 전 게이트 전부 직접 확인: typecheck/test(1303)/lint/build exit 0,
  cargo test 888 passed 0 failed (plugin_manifest 버전 동기 게이트 포함).
- 태그 push → release.yml 빌드 (로컬 빌드 안 함) · landing 은 vercel --prod 수동.

## 메모

- PTY 호스트의 실기기 육안 확인(#pty-manual-verify)은 이 릴리스의 자동
  업데이트가 곧 첫 실전 검증이다 — 구버전(v2.18.0)에서 업데이트하는 사용자는
  구버전에 호스트가 없어 세션이 이번 한 번은 끊기고, **다음** 업데이트부터
  이어진다.
