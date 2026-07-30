---
schema_version: 1
type: chore
slug: "claude-plugin-strategy-research"
status: done
difficulty: high
created_at: "2026-07-30T23:54:25+09:00"
session_id: "mcp-20260730-235425"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/discussion/claude-plugin-strategy/discussion.md"
    op: create
related: []
tags:
  - "plugin"
  - "skills"
  - "mcp"
  - "token-efficiency"
  - "strategy"
  - "ecc"
  - "mcp-tool"
---
[x] Claude 플러그인·스킬 전략 6방향 리서치 + 적대 검증 + 문제 해결 문서 작성

ECC(affaan-m/ECC) 플러그인 구조를 참고해 oculpm 의 Claude Code/Desktop 스킬·플러그인 전략을 세우는 요청. 6방향 병렬 리서치(ECC 클론 분석 · Claude 플랫폼 배포 표면 · 플러그인 골격 갭 · 토큰 효율 실측 · 코드 효율 감사 · 제품 방향 진단) 후 적대 검증 2회(기술 팩트 · 전략)를 거쳐 `.oculpm/discussion/claude-plugin-strategy/discussion.md` 로 정리했다.

핵심 산출:

- 권고 = 방안 A: 슬림 플러그인(A0 안전 선청산→스키마 정합→스킬+활성화 배선→마켓플레이스) + 토큰 다이어트(템플릿 v6 이원화, −80%) + 플래너 디스패치(IN2) 3트랙 병행. Desktop .mcpb 는 백로그.
- 치명 발견: `journal_write` 가 비추적 프로젝트에 무가드 `.oculpm` 생성(tools.rs create_dir_all) — 플러그인 user 스코프 공개 배포 전 필수 가드. #managed-block-versioning 은 프라이버시 사고 경로로 A0 선두.
- 실측 교정: ECC PLUGIN_SCHEMA_NOTES 의 "hooks/agents 필드 금지"는 현 CLI 2.1.220 기준 낡음(`claude plugin validate` + `--plugin-dir` 실로드 통과 확인) — 자동발견 위임+실로드 회귀 테스트가 정답.
- 토큰 실측: AGENTS.md 템플릿 ~2,900 tok/세션 상시, MCP 활성 시 49% 죽은 무게. Claude Code 는 MCP 스키마 deferred(~0 tok), Desktop ~850 tok.

## 검증

- 리서치 워크플로 6 에이전트 + 검증 워크플로 2 에이전트 전부 정상 완료(에러 0).
- 기술 비판 에이전트가 초안 수치를 독립 재현: 언랩 147곳/32파일, manager.rs 3,580줄, target 116GB, 템플릿 섹션 문자수 일치, `gh repo view` visibility=PUBLIC, `claude plugin validate` 통과.