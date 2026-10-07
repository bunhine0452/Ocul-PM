---
schema_version: 1
type: chore
slug: "security-feedback-triage"
status: done
difficulty: medium
created_at: "2026-10-07T11:07:06+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "security"
  - "external-review"
  - "mcp-tool"
---
[x] 외부 보안 피드백 2건 판정 — 대부분 사실, 셋은 더 넓었고 하나는 틀렸다

## 작업 요약

사용자가 받은 외부 보안 리뷰 2건(리뷰 1: 실제 영향 7건 + CSP + 잘된 점, 리뷰 2: 검토 밀도·딥링크 플러그인·일지 경로 링크·hooks gitignore)을 코드에서 하나씩 확인했다. 보고서의 ✓ 표시를 믿지 않고 전부 직접 다시 봤다.

- **사실 → 고침**: 저장소 config 의 배경 자동화·모델 자동 시드(#1), 초안 입력 미마스킹과 원장 문구 불일치(#2), 기본 패턴 넷(#3), 에디터 저장 임시 파일(#4), 어댑터 무결성(#5), 메뉴의 위험 모드 클릭 한 번(#6 일부), Windows 승격 파이프(#7 일부), CSP 꺼짐, create_project 의 루트·홈, Notion 토큰 URL(프로덕션에서 켜져 있음 확인).
- **리뷰보다 넓었다**: #3 은 기본값만 늘리면 기존 프로젝트가 못 받는다(config 에 넷이 박혀 있다) → 내장 바닥. #4 는 rename 이 원본 자리에 링크를 앉혔고, 같은 부류가 `append_ndjson`·앱 쪽 `resolve_entry_path`(링크 검사 0, 모바일 브리지 공용)·`.oculpm` 전체·플러그인 훅에도 있었다. 리뷰 2 의 "중간 폴더 링크" 는 MCP 만이 아니라 앱 쪽에서 더 컸다.
- **틀렸다**: 리뷰 2 "플러그인 훅은 곧 실행 코드" — 앱 설치는 `hooks/`·`bin/` 을 놓지 않는다(NOT_HONORED). 실행 코드가 되는 것은 `.mcp.json` 서버 정의였고, 그 명령이 미리보기에 안 보였던 것은 고쳤다. "`.oculpm/hooks/` gitignore" 는 이미 managed 블록에 있다(리뷰 1 의 정정이 맞다).
- **업스트림과 같은 수준(유지)**: ⇧Tab 순환은 원래 위험 모드를 건너뛴다(Claude Code CLI 와 동일). 유닉스 PTY 소켓은 0600·같은 사용자 모델(Decision 2).
- **코드 밖의 지적**: "사람 저자 1명, 최근 커밋 전부 Claude 공동 작성, 30만 줄을 사람이 한 줄씩 봤다고 보기 어렵다" — 사실이고 코드로 고칠 일이 아니다. 이번 라운드의 답은 판정을 테스트로 남기는 것(원장 문구 거짓을 egress 원장이 못 잡았던 것처럼, 문서 주장은 낡는다)과 외부 리뷰를 이렇게 정기적으로 받는 것이다.

## 검증

- 커밋 9개(5825202a·113972af·4bfc42aa·72791622·04abb955·3e3be0ef·57209dba·d6e8145d·e146d47c + 미리보기·e2e 탐침) — PR #69. 전체 Rust·vitest·lint·clippy 통과, e2e 두 OS 초록(CSP 위반 0).
- 실기기 미확인 항목은 플랜 `#eyes-security-round`.