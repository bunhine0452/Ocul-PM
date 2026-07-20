---
schema_version: 1
type: chore
slug: "menubar-tray-master-plan"
status: done
difficulty: low
created_at: "2026-07-20T21:34:36+09:00"
session_id: "mcp-20260720-213436"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/menubar/00-master-plan.md"
    op: create
  - path: ".oculpm/planner/menubar-tray.md"
    op: create
related: []
tags:
  - "design"
  - "menubar"
  - "tray"
  - "v2.3.0"
  - "mcp-tool"
---
[x] v2.3.0 메뉴바 상주 설계 — RunCat×Docker 트레이 마스터플랜 작성

## 작업 내용

사용자 요구("RunCat 처럼 상단바 상주 + Docker 처럼 클릭 시 정보")를 마스터플랜으로 확정. docs/menubar/00-master-plan.md (형식 선례: claude-integration).

핵심 결정 D1~D5: ① 트레이 3상태(유휴 정적/세션 활성 애니메이션/주의 점) — v2.2.0 훅 브리지의 실시간 세션 신호를 재사용, 세션 0 이면 타이머 정지로 유휴 전력 0. ② 팝오버는 무장식 보조 창 1개 재사용 + 경량 진입점 (NSPanel 서드파티는 v1 비범위). ③ 데이터는 콕핏 집계·훅 인박스·플래너 파서 전부 재사용, 신규 커맨드 tray_summary 1개 — 폴링 없음. ④ 상주(닫기=최소화)·Dock 숨김·autostart 전부 옵인, 기본 현행 유지, 종료 경로 상시 제공. ⑤ 팝오버는 읽기 전용+딥링크, 쓰기는 스탠드업 복사뿐. 팝오버 구성: 프로젝트 스위처 → 활성 세션 → 오늘 한 줄(정직성 감사 ⚠ 포함) → 최근 일지 3건 → 활성 플랜 진행률 → 빠른 액션. 빈 상태("오늘 아직 기록 없음")를 1급 설계로.

PR-MB0(스파이크 실측)~MB4(상주) 5개로 분해, 전체 = v2.3.0. 플랜 menubar-tray 등록.

## 검증

문서·플랜 파일만 — 코드 무변경. Tauri tray API 팩트시트는 구현 착수 시(PR-MB0) 실측 재검증을 문서에 명시.