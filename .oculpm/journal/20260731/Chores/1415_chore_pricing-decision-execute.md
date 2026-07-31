---
schema_version: 1
type: chore
slug: "pricing-decision-execute"
status: done
difficulty: low
created_at: "2026-07-31T14:15:00+09:00"
session_id: "mcp-20260731-141500"
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
  - path: "CONTRIBUTING.md"
    op: create
  - path: ".oculpm/discussion/pricing-open-core/discussion.md"
    op: update
  - path: ".oculpm/planner/plugin-round.md"
    op: update
related: []
tags:
  - "pricing"
  - "license"
  - "open-core"
  - "dco"
  - "decision"
  - "mcp-tool"
---
[x] 가격/라이선스 확정 실행 — 코어 영원 MIT 명문화 + DCO + 팀=별도 repo·호스팅

사용자가 결정을 위임("네가 최선의 선택으로 진행")해 discussion pricing-open-core 의 추천안을 채택·집행:

- **README 한/영** "라이선스와 약속" 섹션 신설 — "지금 이 저장소에 있는 기능은 영원히 무료·MIT", 개인=비팀사용 전부 무료, 유료화는 별도 팀 모듈에만.
- **CONTRIBUTING.md 신설** — CLA 없이 DCO(sign-off), 개발 환경·게이트 4종·bindings.ts 금지 등 기여 규칙.
- **discussion resolved** — Q1 경계고정=동의(DCO), Q2 개인=팀기능 미사용이면 회사 내 포함 무료, Q3 팀 서버=E2E 암호화 릴레이 우선. 팀 코드는 본 저장소 커밋 금지.
- **plugin-round Decision 3** 등재 (착수 트리거는 Decision 2 의 팀 수요 신호 유지).

## 검증

discussion status=resolved·결론 섹션·로그 행 확인. README 두 파일 렌더 확인. 문서 전용 변경(코드 게이트 무관).