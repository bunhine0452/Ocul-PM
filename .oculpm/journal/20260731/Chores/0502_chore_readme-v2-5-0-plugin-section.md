---
schema_version: 1
type: chore
slug: "readme-v2-5-0-plugin-section"
status: done
difficulty: low
created_at: "2026-07-31T05:02:53+09:00"
session_id: "mcp-20260731-050253"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related: []
tags:
  - "docs"
  - "readme"
  - "plugin"
  - "v2.5.0"
  - "mcp-tool"
---
[x] README(한/영) v2.5.0 특화 기능 + 플러그인 설치 안내 섹션

기존 "🚀 v2.3.1 — 메뉴바 상주" 섹션을 "🚀 v2.5.0 — Claude Code 플러그인, 그리고 계획이 구현을 끌고 갑니다"로 교체:

- `/plugin marketplace add` → `/plugin install` 두 줄 설치 코드블록
- 플러그인 구성 요소(훅 브리지·MCP 도구 4종·스킬 5종+standup), 추적 프로젝트 한정 동작, 계약 문서 링크, 앱 등록과의 택일 경고
- ▶실행 디스패치 · 3-depth 계획 · project-inception(인터뷰→웹 리서치) · 토큰 60% 다이어트
- 설치 섹션에 "앱 없이 플러그인으로 먼저 시작" 대안 경로 추가
- README.en.md 에 동일 내용의 영문 섹션 삽입(## Screens 앞)

## 검증

두 파일 모두 v2.5.0 섹션 렌더 확인(마크다운 문법·링크 경로 docs/claude-integration/06-plugin-contract.md 존재 확인). 빌드 게이트와 무관한 문서 변경.