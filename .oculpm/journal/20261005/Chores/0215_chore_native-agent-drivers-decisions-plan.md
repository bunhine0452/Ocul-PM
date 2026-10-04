---
schema_version: 1
type: chore
slug: "native-agent-drivers-decisions-plan"
status: done
difficulty: low
created_at: "2026-10-05T02:15:00+09:00"
session_id: "20261005-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20261005_native-agent-drivers/00-master-plan.md"
    op: update
  - path: "docs/README.md"
    op: update
  - path: ".oculpm/planner/native-agent-drivers.md"
    op: create
related:
  - ref: "20261005/Chores/0204_chore_native-agent-drivers-design.md"
    kind: "followup"
tags:
  - "acp"
  - "codex"
  - "claude-code"
  - "docs"
  - "mcp-tool"
---
[x] 네이티브 드라이버 결정 확정(버전은 고정 대신 감시 D8) · 플랜 native-agent-drivers 생성 · /rc 원격 왕복 재시험 미검증

## 결정

- 사용자: **"버전은 계속 업데이트해야 한다"** → D5(사용자 PATH 의 claude·codex 우선) 확정 + **D8 신설: 버전은 고정하지 않고 감시**. 지금 ACP 경로는 어댑터를 고정하고 릴리스마다 손으로 올렸다(0.67→0.77→0.81, codex-acp 1.8→1.13). 대신 스케줄 CI `agent-cli-drift`(최신 CLI 설치 → Codex 스키마 재생성 diff · Claude initialize 핸드셰이크 대조 → 깨지면 이슈) + 앱 진단 버전 게이트 + 런타임 기능 감지. 최소 버전은 올리기만 한다.
- 나머지 3건은 사용자가 "모르겠다"며 위임 → 제안안 채택: ACP 되돌림 스위치 1릴리스 · `/rc` 는 명령으로만 · 플랜 생성. 문서 §7 을 결정 표로 바꾸고 누가 정했는지 열을 남겼다.
- 플랜 `native-agent-drivers` 생성 — 6 phase · 22 항목 (P0 trait 추출+버전 감시 → P1 Codex → P2 Claude → P3 /rc → P4 승인 영속+무인 실행 → P5 기본값 전환·Node 제거). 문서 머리에 플랜 링크, `docs/README.md` 색인 줄 갱신.

## /rc 원격 왕복 재시험 (R7)

- 15분 창으로 다시 열었다: `remote_control` 켜기 → `session_url` → connected → 끄기 → 종료 0 은 **재현**.
- 원격 입력은 끝내 없었다 → **여전히 미검증**. 브라우저 자동화로 보내려다 claude.ai 가 재로그인 화면으로 튀어 중단했다(시험 문장이 로그인 페이지에 입력됨, 인증 정보는 입력 안 함). 열었던 탭은 닫았다.
- 플랜 `rc-roundtrip` 항목이 이 검증을 P3 완료 조건으로 들고 있다.
- claude.ai/code 세션 목록에 시험 세션 "ocul-pm spike" · "ocul-pm spike 2" 가 남았을 수 있다 — 사용자가 보관 처리.

## 검증

- events.log: RC_ENABLE_RESPONSE(session_url) · bridge_state connected · RC_DISABLE success · EXIT 0, 그 사이 user/assistant/result 메시지 0건.
- plan_create 응답 phases 6 · items 22. 커밋 안 함.