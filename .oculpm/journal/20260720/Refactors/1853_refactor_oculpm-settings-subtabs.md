---
schema_version: 1
type: refactor
slug: oculpm-settings-subtabs
status: done
difficulty: low
created_at: "2026-07-20T18:53:18+09:00"
session_id: "manual-20260720-184859"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/__tests__/oculpm_settings_subtabs.test.tsx
    op: create
related:
  - 20260720/Features_to_add/1411_feature_claude-hooks-bridge.md
  - 20260720/Features_to_add/1449_feature_oculpm-mcp-server.md
tags: ["ui", "settings", "information-architecture", "dogfooding-finding"]
---

[x] 설정 → ocul-pm 탭 5분할 — 한 화면 스크롤 과부하 해소

## 동기

사용자 보고: "설정 창의 ocul-pm 항목들이 너무 길어진다". PR-CI0~CI8 이 이 한 화면에
훅 연동·MCP 서버·자동화 토글(과금 고지 문단 포함)을 계속 얹으면서, 원래 5섹션이던
화면이 6섹션 + 블록 2개 + 긴 설명 문단들로 불어나 스크롤 없이는 아무것도 못 찾는
상태가 됐다. 특히 성격이 전혀 다른 항목(작업일 경계 ↔ 과금 AI 토글 ↔ 외부 연동)이
한 줄기로 이어져 있었다.

## 변경 요약

성격별 5개 하위 탭으로 분리 (탭 하나만 렌더 — 스크롤 길이가 구조적으로 억제된다):

| 탭 | 내용 | 성격 |
|---|---|---|
| 기록 | Workday · Session · Git · Watcher | 언제·무엇을 기록하나 |
| 에이전트 | 활성 어댑터 + 감지/동기화 + 정책 2 | 누가 규칙을 받나 |
| 자동화 | 자동 화해 · 일지 자동 초안 | **과금 AI 호출** (한곳에 모아 위험 가시화) |
| 연동 | Claude 훅 · MCP 서버 | 외부 도구 연결 |
| 로그 | 로그 폴더 | 진단 |

- 자동화 탭에 "켜면 설정한 AI 제공자로 자동 호출이 나갑니다. 둘 다 기본 꺼짐" 을 섹션
  설명으로 올려, 과금 토글 2개가 한 화면에서 함께 보이게 했다.
- 탭 상태는 화면 내 일시적 UI 상태라 `useState` — localStorage 금지 규율 대상이 아니다.
- 일지 자동 초안 설명의 "아래 훅 연동" → "**연동** 탭의 훅 연동" 으로 참조 수정
  (분리로 더 이상 같은 화면 아래가 아님).

## 검증

- 신규 vitest 3 (탭 5개 노출·기본 선택 기록 / 클릭 전환 시 aria-selected 정확히 1개 /
  axe 0). typecheck·vitest 176(28파일)·lint·build 전부 exit 0.
- 시각 확인(탭 전환 체감·좁은 창 랩)은 사용자 실기기 몫.
