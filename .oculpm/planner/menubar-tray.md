---
oculpm_plan: v1
id: menubar-tray
title: "메뉴바 상주 라운드 — RunCat×Docker 트레이 (v2.3.0)"
status: active
created: 2026-07-20
updated: 2026-07-20
owner: claude-code
---

macOS 상단바에 상주하며 에이전트 세션을 실시간 표시(RunCat)하고, 클릭 팝오버로
오늘의 상태에 5초 안에 답한다(Docker Desktop). SSOT 는
docs/menubar/00-master-plan.md — 결정(D1~D5)·수용 기준은 그 문서가 정답이고,
이 plan 은 진척만 추적한다.

## Phase 0 — 설계 {#design}
- [x] 컨셉 확정 + 마스터플랜(D1~D5, PR-MB0~4) 작성 {#design-master-plan}

## Phase A — 트레이 {#phase-a}
- [ ] PR-MB0 트레이 스파이크 — tray-icon 실측(클릭 좌표·템플릿 이미지), 01 문서 {#mb0-tray-spike}
- [ ] PR-MB1 상태 아이콘 — 유휴/세션 애니/주의 점 3상태, 세션 신호 연결, 유휴 타이머 정지 {#mb1-status-icon}

## Phase B — 팝오버 {#phase-b}
- [ ] PR-MB2 팝오버 골격 — 무장식 창+경량 진입점+tray_summary, 스위처·활성 세션·오늘 한 줄 {#mb2-popover-core}
- [ ] PR-MB3 팝오버 완성 — 최근 일지 딥링크·플랜 진행률·스탠드업 복사, 빈 상태 {#mb3-popover-full}

## Phase C — 상주 {#phase-c}
- [ ] PR-MB4 상주 모드 — 닫기=최소화·Dock 숨김·autostart 옵인 토글 3종 + 종료 메뉴 {#mb4-residency}
- [ ] v2.3.0 릴리스 — 전 PR 머지 + 실기기 확인(아이콘 상태·팝오버 정확성·상주 왕복) {#v230-release}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-20T21:34:50+09:00 | #design-master-plan | claude-code | x→x | .oculpm/journal/20260720/Chores/2134_chore_menubar-tray-master-plan.md | D1~D5 + PR-MB0~4 분해. 훅 세션 신호·콕핏 집계 재사용으로 신규 백엔드 최소화. 착수는 PR-MB0 실측 스파이크부터 |
<!-- oculpm:plan-log end -->
