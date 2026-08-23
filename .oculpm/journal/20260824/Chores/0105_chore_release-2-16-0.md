---
schema_version: 1
type: chore
slug: release-2-16-0
status: done
created_at: "2026-08-24T01:05:00+09:00"
session_id: "manual-20260824-010500"
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
  - ".oculpm/journal/20260824/Features_to_add/0020_feature_ide-finishing-round.md"
tags: [release]
---

[x] v2.16.0 릴리스 — IDE 완성(탭·분할·파일조작·LSP 잔여·디버거·에이전트 diff) + 논의 편집기 개편

## 검증

- 다섯 면 전부: 버전 5파일(2.16.0) · CHANGELOG(릴리스 노트 소스) · README ko/en
  (하이라이트 + 코드 화면 서술 갱신 + v2.15.0 의 "무시 파일은 숨김" 문장 교정) ·
  landing 6곳 버전 + featureList 3줄 + FAQ 2곳(JSON-LD·details 동일 문장) 확장 +
  변경사항 li + 벤토 c-span2 ×3 한 줄.
- 게이트 5종 exit 0 (플래키 acp_parallel_sessions 1건 재실행 통과 — 알려진 문제).
  `plugin_manifest` 가 버전 동기 5파일과 landing/plugin.html 를 검증.
- 릴리스 범위에 **다른 에이전트의 커밋 포함**: 문제 해결 편집기 개편(2f34c09) ·
  한글 제목 slug 충돌 fix(579e659) · 플래너 좁은 폭/인라인 마크다운(1ce7169).
  그 세션의 **미커밋 WIP**(watcher 인수/양보)는 이번 릴리스에 없다 — 다음 릴리스.

## 메모

- 태그 push → release.yml 이 빌드·서명·릴리스 (로컬 빌드 금지 규율).
- 랜딩은 git 연동이 없어 `cd landing && vercel --prod` 수동 배포.
- 릴리스 후 `cargo clean` 으로 target/ 정리 (사용자 요청 — 게이트가 끝난 뒤에).
