---
schema_version: 1
type: chore
slug: "release-v2-8-5"
status: done
difficulty: low
created_at: "2026-08-12T18:11:20+09:00"
session_id: "mcp-20260812-181120"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags:
  - "release"
  - "i18n"
  - "mcp-tool"
---
[x] v2.8.5 릴리스 — 영어 지원

i18n Phase 2 라운드를 v2.8.5 로 묶어 릴리스.

## 작업 요약

3면 전부 갱신 (릴리스 체크리스트):

- **버전 3파일** — `package.json` · `Cargo.toml` · `tauri.conf.json` = 2.8.5
- **CHANGELOG.md** — `## v2.8.5` 섹션. release.yml 이 태그와 같은 헤더를 릴리스 노트로 뽑으므로 이게 정본이다
- **landing/index.html 5곳** — softwareVersion · NEW 배지 · 릴리스 목록(새 `d2` 항목 추가, 기존 v2.8.4 는 `d3` 로) · 받기 버튼 · 다운로드 eyebrow

## 카피 방침

내부 용어를 쓰지 않고 **사용자가 겪는 것**으로 적었다 — "12개 화면", "실패했을 때 뜨는 오류 메시지", "이미 기록된 문서는 절대 다시 쓰지 않습니다". 한국어 사용자에게도 의미 있는 항목(사이드바 라벨·설정 제목·슬라이더 접근성)을 별도 문단으로 분리했다. 영어 지원만 있는 릴리스로 읽히면 한국어 사용자가 건너뛴다.

## 검증

게이트 5종 exit 0 직접 확인 — typecheck / vitest 678 / cargo test 529 / lint(남은 0) / build.

로컬 빌드는 하지 않는다 — 태그 푸시가 release.yml 에서 빌드·서명·릴리스한다. 랜딩은 git 연동이 없어 `landing/` 에서 `vercel --prod` 수동 배포.