---
oculpm_plan: v1
id: ui-density-round-20261028
title: "UI 밀도 라운드 — 초보부터 심화까지 같은 앱, 세 질문 한 순서"
status: done
created: 2026-10-28
updated: 2026-10-28
owner: claude-code
---

시안(claude.ai/artifact/GUnxubRtCWw11JAJwavzSg, 17장)을 두 기준으로 점검했다: ① 초보~심화 모두 — 두 앱이 아니라 같은 화면의 밀도(간단/전문), 등급이 곧 사이드바, 접힘이지 숨김이 아님 ② Rieseberg + 최고의 결과 — 완료 조건이 항목보다 먼저(고도), 증거가 제목 바로 아래(깊이), 세 질문 한 순서로 3분 안에 결정(범위). 점검에서 드러난 빈틈: 플랜 머리글에 완료 조건·확인 명령이 없었고, 항목 전부 닫힘을 앱이 말하지 않았고, 일지의 증거 배지만 있고 근거 줄이 없었다. 이 라운드가 그 자리들을 코드로 옮긴다. 보류 등급(터미널) 시안은 「결함 수정만」 규칙 때문에 구현하지 않는다.

**완료 조건:** 기본(간단) 밀도에서 사이드바는 핵심 4 + 접힌 도구·베타, 오늘 화면은 세 질문 칼럼 + 「더 보기」, 일지 상세는 증거 카드가 제목 아래, 플래너 머리글은 완료 조건·확인 명령·항목 전부 닫힘 띠를 보여 주고, ⌘. 과 설정 「표시」로 전문 밀도가 되면 전부 펼쳐진다 — 전부 v3.16.0 으로 공개.
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && (cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --lib)

## 밀도와 탐색 {#p1}
- [x] ui_density 설정(SQLite) + lib/density 모듈 + useDensity 훅 + ⌘. 수신기(main.tsx 한 곳) {#density-setting}
- [x] navRegistry tier(core/viewer/hold) + 사이드바 세 단 — 간단은 도구·베타 접힘(활성 화면이면 자동 펼침), 전문은 전부 펼침, 테스트 sidebar_density {#sidebar-tiers}
- [x] 툴바 오른쪽 끝 밀도 토글(모든 화면) + 설정 「모양」 밀도 섹션 {#toggle-settings}

## 세 질문 한 순서 {#p2}
- [x] 오늘 — 간단 밀도의 세 칼럼(무엇을 했나 · 믿을 수 있나 · 다음은) + 보조 카드 「더 보기」 접힘(DOM 에는 전부), 전문은 기존 배치 {#today-cols}
- [x] 일지 상세 — 증거 카드(검증 칸 줄 + 등급 필)가 제목 바로 아래 {#entry-evidence}
- [x] 플래너 — PlanDetail.done_when/check, 머리글에 완료 조건·확인 명령(복사)·없으면 없다고, 항목 전부 닫힘 띠 (항목 완료 ≠ 목표 달성) {#planner-goal}

## 공개 {#p3}
- [x] PR 합류 후 v3.16.0 — 6파일·CHANGELOG·README ko/en·랜딩 ko/en(벤토·featureList)·wiki build·태그·랜딩 배포 {#release-3-16}
- [>] [사용자] 설치본 3.16.0 에서 간단↔전문 토글·세 칼럼·증거 카드·플래너 머리글을 눈으로 → polish-round-20261027 #eyes-density {#eyes-density}
- [x] [사용자] 시작 탭 「오늘 어디서부터」와 터미널 결과 끝 줄 손잡이 시안은 미구현 — 터미널은 보류 등급 규칙, 시작 탭은 다음 라운드. 진행 여부 결정 {#deferred-decision}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-28T04:22:11+09:00 | #density-setting | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0421_feature_ui-density-round.md | ui_density · lib/density · useDensity · ⌘. 수신기 main.tsx |
| 2026-10-28T04:22:24+09:00 | #sidebar-tiers | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0421_feature_ui-density-round.md | NavEntry.tier · NavSection · sidebar_density 5건 |
| 2026-10-28T04:22:36+09:00 | #toggle-settings | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0421_feature_ui-density-round.md | Toolbar DensityToggle · DensitySection |
| 2026-10-28T04:23:52+09:00 | #today-cols | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0421_feature_ui-density-round.md | today-cols · details.today-more · statsBlock/proGrid/proTrailing/simpleMore |
| 2026-10-28T04:24:11+09:00 | #entry-evidence | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0421_feature_ui-density-round.md | EvidenceCard — 검증 칸 줄 + 등급 필 |
| 2026-10-28T04:24:19+09:00 | #planner-goal | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0421_feature_ui-density-round.md | PlanDetail.done_when/check · 머리글 · 전부 닫힘 띠 · paths.rs 분리 |
| 2026-10-28T05:06:11+09:00 | #deferred-decision | claude-code | ☐→x |  | 사용자 결정(10-28): 전부 구현. 보류 등급 규칙 해제. PR #106 (라운드 2) |
| 2026-10-28T06:04:07+09:00 | #release-3-16 | claude-code | ☐→x |  | v3.16.0 공개(macOS 4자산) · 랜딩 배포. Windows·Linux 는 E2E(접힌 단) 때문에 빠짐 → PR #107 로 고침, 3.17.0 에 복구 |
| 2026-10-28T23:24:15+09:00 | #eyes-density | claude-code | ☐→> |  | polish-round-20261027 #eyes-density |
| 2026-10-28T23:24:18+09:00 | #plan | claude-code | active→done |  | 덜어내기 라운드 — 플랜 18→4 (simplify-round-20261028 #plans-4). 미완은 전부 옮기거나 폐기 |
<!-- oculpm:plan-log end -->
