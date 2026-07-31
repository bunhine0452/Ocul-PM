---
schema_version: 1
type: chore
slug: "launch-pricing-notion-round"
status: done
difficulty: medium
created_at: "2026-07-31T13:58:06+09:00"
session_id: "mcp-20260731-135806"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/launch/launch-post.md"
    op: create
  - path: "docs/launch/channels.md"
    op: create
  - path: "docs/notion-oauth-setup.md"
    op: create
  - path: ".oculpm/discussion/pricing-open-core/discussion.md"
    op: create
  - path: "landing/api/notion/oauth/start.ts"
    op: update
  - path: "landing/api/notion/oauth/callback.ts"
    op: update
related: []
tags:
  - "launch"
  - "community"
  - "pricing"
  - "notion-oauth"
  - "workflow"
  - "mcp-tool"
---
[x] 남은 계획 진행 — 발사 글·커뮤니티 제출·가격 결정 자료·Notion 절차/UX

plugin-round 잔여 4항목을 6-에이전트 워크플로(리서치 3 + 초안 2 + 심사 1, 웹 실확인)로 병렬 진행:

- **발사 글 확정** — 초안 2종(문제 서사/기술 설계)을 심사 합성한 최종본 ko/en + 헤드라인을 `docs/launch/launch-post.md` 로. "개인 영구 무료" 문구 포함, 전 주장 README/CHANGELOG 대조.
- **커뮤니티 제출 조사·실행** — `docs/launch/channels.md`: 실존 확인된 채널 7종 우선순위(공식 커뮤니티 마켓플레이스는 PR 불가·Console 폼 전용 확인). 실행: repo 토픽 스왑(ai/react/productivity → claude-code-plugins 등 4종), awesome-claude-plugins PR #385 제출.
- **가격/라이선스 결정 자료** — `.oculpm/discussion/pricing-open-core/discussion.md`: 방안 A(분리 open-core)/B(라이선스 전환)/C(호스팅 전용) 선례·CLA 분석, 추천 = A+C 조합·DCO. 사용자 결정 질문 3건 대기.
- **Notion OAuth** — 에러 페이지를 안내형(503+폴백 방법)으로 교체·배포. 등록 절차가 2026-05 부터 Developer portal 로 바뀐 것을 공식 문서로 확인해 `docs/notion-oauth-setup.md` 체크리스트화 (public connection 은 생성 시부터 public — installation scope 변경 불가).

## 검증

배포된 start 엔드포인트가 503+한국어 안내를 반환하는 것을 curl 로 확인. PR #385 생성 확인. 토픽 19종 반영 확인. 게이트 typecheck/lint/test/build exit 0 (Rust 무변경).