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
- [x] PR-MB0 트레이 스파이크 — tray-icon 실측(클릭 좌표·템플릿 이미지), 01 문서 {#mb0-tray-spike}
- [x] PR-MB1 상태 아이콘 — 유휴/세션 애니/주의 점 3상태, 세션 신호 연결, 유휴 타이머 정지 {#mb1-status-icon}

## Phase B — 팝오버 {#phase-b}
- [x] PR-MB2 팝오버 골격 — 무장식 창+경량 진입점+tray_summary, 스위처·활성 세션·오늘 한 줄 {#mb2-popover-core}
- [x] PR-MB3 팝오버 완성 — 최근 일지 딥링크·플랜 진행률·스탠드업 복사, 빈 상태 {#mb3-popover-full}

## Phase C — 상주 {#phase-c}
- [x] PR-MB4 상주 모드 — 닫기=최소화·Dock 숨김·autostart 옵인 토글 3종 + 종료 메뉴 {#mb4-residency}
- [ ] v2.3.0 릴리스 — 전 PR 머지 + 실기기 확인(아이콘 상태·팝오버 정확성·상주 왕복) {#v230-release}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-20T21:34:50+09:00 | #design-master-plan | claude-code | x→x | .oculpm/journal/20260720/Chores/2134_chore_menubar-tray-master-plan.md | D1~D5 + PR-MB0~4 분해. 훅 세션 신호·콕핏 집계 재사용으로 신규 백엔드 최소화. 착수는 PR-MB0 실측 스파이크부터 |
| 2026-07-20T21:58:48+09:00 | #mb0-tray-spike | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/2158_feature_menubar-tray-implementation.md | tray-icon feature+아이콘 표시+클릭 핸들러 구현. 좌표 실측 로그 심음 — 01 문서는 실기기에서 (#v230-release) |
| 2026-07-20T21:58:52+09:00 | #mb1-status-icon | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/2158_feature_menubar-tray-implementation.md | 런타임 RGBA 3상태 + 세션 이벤트 구독 + 유휴 타이머 정지. 단위테스트 3 |
| 2026-07-20T21:59:00+09:00 | #mb2-popover-core | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/2158_feature_menubar-tray-implementation.md | 무장식 창+?tray=1 경량 진입점. 집계는 기존 커맨드 재사용 — tray_summary 신설 불필요로 판명 |
| 2026-07-20T21:59:04+09:00 | #mb3-popover-full | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/2158_feature_menubar-tray-implementation.md | 일지 딥링크(TrayNavigate→ShellV2 핸드오프)·플랜 진행률·스탠드업 복사·빈 상태. vitest 4 |
| 2026-07-20T21:59:16+09:00 | #mb4-residency | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/2158_feature_menubar-tray-implementation.md | 토글 3종(모양 탭)+CloseRequested 가로채기+Accessory 왕복+트레이 메뉴 종료. autostart 는 후속(옵션) |
| 2026-07-20T22:20:45+09:00 | #mb3-popover-full | claude-code | x→x | .oculpm/journal/20260720/Bugs/2220_bug_tray-polish-shadow-picker-settings.md | 실기기 피드백 반영 — 그림자 클리핑·커스텀 스위처·팝오버 내 상단바 설정 패널·⌘W 계약 fix |
| 2026-07-20T22:38:16+09:00 | #mb1-status-icon | claude-code | x→x | .oculpm/journal/20260720/Features_to_add/2238_feature_tray-arc-icon-and-inline-journal.md | 아이콘 브랜드 아크 재작(끊긴 호 3개·회전 애니·슈퍼샘플링) — 피드백 반영 |
<!-- oculpm:plan-log end -->
