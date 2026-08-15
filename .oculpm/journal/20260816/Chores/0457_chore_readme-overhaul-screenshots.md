---
schema_version: 1
type: chore
slug: "readme-overhaul-screenshots"
status: done
difficulty: low
created_at: "2026-08-16T04:57:14+09:00"
session_id: "mcp-20260816-045714"
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
  - "promo"
  - "mcp-tool"
---
[x] 리드미 전면 개편 — 실기기 스크린샷 6장 · 버전 9단 압축 · 플러그인 상설 섹션 (ko/en)

## 작업 내용

리드미에 스크린샷이 로고뿐이었고 버전 하이라이트가 v2.5~v2.11 아홉 단으로 쌓여 있었다. 프로페셔널 구조로 재편 (ko/en 동일):

- **스크린샷 6장** — 히어로(편집 diff+턴 영수증 실샷) + 3기둥(기록장=일지 타임라인 / 검증대=변경 diff / 콘솔=승인 카드) + 코드맵·⌘J 터미널 2-up 표. 전부 `landing/shots/` 상대경로 재사용이라 별도 자산 없음 — 랜딩 캡처를 갈면 리드미도 따라온다.
- **버전 압축** — v2.5~v2.10.3 아홉 섹션을 `<details>` 한 줄 요약 리스트로 (RELEASE.md §3 "오래된 것은 묶어 압축" 이행). 최상단 `## 🚀 vX.Y` 계약은 유지 — 다음 릴리스 때 직전 🚀 내용을 details 로 내리면 된다.
- **플러그인 상설 섹션** — v2.5 히스토리 안에 묻혀 있던 설치 두 줄·훅 브리지·MCP 5종을 독립 섹션으로 승격하고, "앱 안 Claude Code 는 플러그인 없이도 기록된다(내장 MCP) / ACP 세션에선 /plugin 불가 → 터미널에서 설치" 구분 + 위키 링크를 명시.
- 헤더 링크 줄에 키노트·위키 추가, 설치 끝에 위키 포인터.

## 검증

- 구판 `## v2.x` 헤딩 잔존 0 (ko/en), 이미지 상대경로 7개 확인, 커밋 1e63d19 푸시. GitHub 렌더 확인은 사용자 몫.