---
schema_version: 1
type: feature
slug: in-app-plugin-docs
status: done
created_at: 2026-07-31T23:25:00+09:00
session_id: "manual-20260731-232500"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: src/features/skills/pluginDocs.ts, op: create }
  - { path: src/features/skills/PluginDocsTab.tsx, op: create }
  - { path: src/features/skills/SkillsScreenV2.tsx, op: update }
  - { path: src/features/settings/OculpmSettings.tsx, op: update }
  - { path: src/__tests__/plugin_docs_sync.test.ts, op: create }
related: []
tags: [plugin, docs, skills-hub, in-app]
difficulty: medium
---

[x] 인앱 플러그인 문서 — 스킬·규칙 화면 4번째 "플러그인" 탭

## 추가 기능

플러그인 소개·커맨드 접근성을 앱 안으로 (사용자 요청). 배치 판단: 스킬·규칙 화면이 Claude Code 표면(스킬/규칙/훅)의 집이므로 4번째 탭 — 신규 화면 금지(Decision 1) 부합.

- **플러그인 탭**: 설치 상태 배지(claudePluginStatus)+미설치 시 설치 2줄 복사, 권장 흐름 칩(project_init→inception→next 반복→standup), 커맨드 4종 카드(예시 복사 버튼), MCP 도구 5종·훅 기능 3종 요약, oculpm.com/plugin·계약 문서 링크.
- **동기 강제**: pluginDocs.ts 의 커맨드 description 은 plugin/oculpm/commands/*.md frontmatter 와 문자 단위 일치 + 목록 양방향 대조 + 도구 이름은 tools.rs 와 양방향 대조 — plugin_docs_sync.test.ts 7건. 문서 표면 3곳(랜딩·인앱·플러그인 자체)이 전부 게이트 아래.
- 설정 → 연동 탭에 "커맨드·도구 안내는 스킬·규칙 → 플러그인 탭" 포인터.

## 동작 흐름

스킬·규칙 → 플러그인 탭 → 설치 여부에 맞는 안내 → 커맨드 복사 → Claude Code 붙여넣기. 커맨드/도구가 바뀌면 동기 테스트가 커밋을 막는다.

## 검증

plugin_docs_sync 7/7, 전체 vitest 418/418, typecheck/lint/build exit 0. 렌더 스모크는 미작성(정적 콘텐츠+단일 상태 호출 — 동기 테스트가 하중 가드).
