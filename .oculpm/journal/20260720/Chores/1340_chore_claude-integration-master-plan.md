---
schema_version: 1
type: chore
slug: claude-integration-master-plan
status: done
difficulty: medium
created_at: "2026-07-20T13:40:46+09:00"
session_id: "manual-20260720-134046"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: docs/claude-integration/00-master-plan.md
    op: create
    bytes_added: 17434
    bytes_removed: 0
  - path: docs/claude-integration/README.md
    op: create
    bytes_added: 765
    bytes_removed: 0
  - path: .oculpm/planner/claude-integration.md
    op: create
    bytes_added: 2110
    bytes_removed: 0
related: []
tags: ["claude-integration", "design-doc", "vibe-coding", "mcp", "hooks", "planning"]
---

[x] Claude 직접 연동 + 규칙 플라이휠 라운드 — 마스터플랜(SSOT) 작성

바이브코딩 상세보고서(docs/vibe coding/, 해커톤 수상작 방법론 분석)를 ocul-pm 에 적용하는
라운드의 설계 문서를 작성했다. 사전 조사 2건(Claude Code/Desktop/Notion 연동 표면 공식 문서,
ocul-pm 코드베이스 연동 지점 매핑)을 종합한 결과가 근거.

핵심 진단: 현행 일지 작성은 AGENTS.md 프롬프트 규칙 의존(agent 귀속 = frontmatter 자기신고,
세션 감지 = 파일와처 휴리스틱)인데, 이는 보고서 6.5절이 경고하는 "결정론적 강제를 프롬프트로
하는" 안티패턴 — Claude Code hooks 로 결정론화하는 것이 이번 라운드의 축.

결정 사항 (상세·근거는 00-master-plan.md D1~D6):

- D1 훅 수신 = `.oculpm/hooks/` 파일 인박스 (포트/IPC 없음, 앱 꺼져도 큐잉, watcher 재사용)
- D2 훅 설치 = `.claude/settings.local.json` 옵인, command 경로 서명으로 식별·드리프트 감지
- D3 MCP 서버 = 같은 crate 두 번째 bin `oculpm-mcp` (stdio, 디스크 SSOT 직접 조작, sidecar 번들)
- D4 transcript 방어적 파싱 + 일지 초안은 reconcile 패턴 재사용 (옵인·redact 통과 후 기록)
- D5 규칙 허브 = 기존 스킬 화면 탭 확장 (신규 화면 아님), 실패→규칙 승격은 승인 카드 UX 재사용
- D6 Notion v1 = REST internal token (공식 MCP 는 OAuth 전용이라 무인 내보내기 부적합)

PR 분해: Phase A 기록의 결정론화(CI0 훅 브리지 / CI1 transcript 일지 초안 / CI2 oculpm-mcp v1),
Phase B 규칙 플라이휠(CI3 규칙 허브 / CI4 승격 루프 / CI5 스킬 갤러리), Phase C 검증·아웃바운드
(CI6 EDD-lite / CI7 Notion 내보내기 / CI8 플러그인 패키징). Phase A 완료 = v2.2.0 후보.

## 검증

- 문서 라운드로 코드 무변경 — 게이트(typecheck/test/lint/build) 비대상.
- 훅 payload 필드 등 외부 팩트는 문서 §1 에 "구현 전 실측 재검증" 으로 명시했고, PR-CI0 범위에
  실측 캡처 스파이크(01-hook-payload-actual.md)를 포함시킴.

## 메모

- 플래너 plan `claude-integration` 신설 (Phase 0~C, 9개 PR 항목). 커밋은 사용자 지시 대기.
