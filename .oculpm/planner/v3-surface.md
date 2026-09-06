---
oculpm_plan: v1
id: v3-surface
title: "기둥 2 — 보이는 것이 정직하고 읽힌다 + 브랜치 축 (3.0)"
status: active
created: 2026-09-04
updated: 2026-09-04
owner: claude-code
---

전면 리디자인은 기각됐다(v3-round 결론). 대신 매일 보이는 두 면을 지렛대로 바꾼다 — AI 화면(활동 의미 층)과 사이드바(IA 재편 안 A). 둘 다 리디자인보다 싸고 부채를 함께 줄인다. 그리고 경계를 넘지 않는 유일한 신기능으로 브랜치 축.

## 라우팅 안전 — 화면 id 를 하나라도 없애기 전에 {#route-safety}
- [x] migrateUiV2View(raw) 를 migrateActiveView 옆에 — 지금 uiV2View 에 검증이 전혀 없어 모르는 값이면 라우터 ternary 가 null 로 끝나 툴바도 콘텐츠도 없는 빈 본문이 된다 {#uiv2view-migrate}
- [x] ShellV2 라우터의 마지막 null 을 Today 폴백으로 {#router-fallback}
- [x] KNOWN_VIEWS 를 딥링크뿐 아니라 영속값에도 적용 {#known-views-persist}

## 활동 의미 층 — AI 화면이 읽힌다 {#activity-layer}
- [ ] features/chat/activity/activityTypes.ts — 우리 어휘 15종. oculpm-journal·oculpm-plan·oculpm-a2a 셋이 우리만의 값어치다 {#activity-types}
- [ ] classify.ts 순수 provider 체인 + parseOculpmCliCommand() 가 셸 문자열에서 oculpm journal write 를 알아본다. 틀리면 shell 로 흘린다 — 잘못된 일지를 썼습니다 는 원장에 대한 거짓말이다 {#activity-classify}
- [ ] group.ts 2패스 묶기 + 개입 지점 불변 규칙 — permission·error·oculpm-* 는 절대 안 접는다. acpBusyBus 의 attention 집합을 존중하고 테스트로 못 박는다 {#activity-group}
- [ ] 프레젠터 6~7개 + satisfies Record 로 누락을 컴파일 에러로 {#activity-presenters}
- [ ] 원본 이벤트 레일(details) — 추상화가 틀려도 도망갈 데를 먼저 만든다. 분류학은 자란다(buzz 도 문서 12 vs 타입 15) {#raw-rail}
- [ ] AcpConversation.tsx 2,192줄 분해 — TraceRow 는 ToolActivity 몸통으로 재사용, 버리는 코드가 거의 없다. 파일 크기 래칫 부채 -1 {#acp-split}
- [ ] 바쁨 신호에 source(observer|typing|none) — Liveness 3상태 규율을 같은 자리에. 지금 스트림이 끕긴 것과 진짜 도는 것을 구별 못 한다 {#working-source}
- [ ] Sessions 화면·Today 함께 일하는 중이 같은 어휘를 쓰게 — 지금 무엇을 하고 있는가 가 lease 뿐이다 {#activity-vocab-reuse}

## IA 재편 — 사이드바가 정리된다 (안 A, 17→15) {#ia}
- [x] Claude Code + Codex → 에이전트 한 행 (컴포넌트는 두 벌 keep-alive 유지, uiV2View 값 보존, 배지 합산) {#agent-row-merge}
- [x] 세션 → 에이전트의 세 번째 갈래 — 혼자 쓰면 영구 빈 화면인 행을 없앨다 {#sessions-into-agent}
- [x] 논의·문서를 참고 그룹으로 강등, ⌘번호 회수 (논의 4건 vs 일지 537건, docs 없으면 ⌘9 는 영구 빈 화면) {#demote-disc-docs}
- [x] 재명명 — 코드 검색→검색, 코드→편집기, Diff→변경. ⌘K 별칭에 옛 이름 보존(v2.17.0 선례) {#rename-three}
- [x] ⌘번호 재배정 + WhatsNewCard 1회 안내 — ⌘3·⌘5·⌘6·⌘0 의 뜻이 바뀜다. 치트시트는 자동 파생이라 바로 맞는다 {#shortcut-remap}

## 첫 5분이 사실을 말한다 {#first-five-min}
- [x] 마법사 마무리 판의 시제 정정 — 그 시점에 심긴 것은 없다 (create_project 는 DB 행 하나, .oculpm · AGENTS.md 는 프로젝트 열기 때) {#wizard-tense}
- [x] Today 빈 상태가 자동으로 작성합니다 라고 말하지 않게 — 그 시점에 켜진 자동화가 하나도 없다 {#today-empty-truth}
- [x] Claude Code 플러그인을 온보딩으로 — 지금 미설치를 알리는 토스트·카드·배지가 0곳이고 안내는 설정 3단 깊이뿐이다 {#plugin-onboarding}
- [x] 첫날 안 사는 화면 12개의 빈 상태를 무엇을 하면 살아나는지 로 — 17화면 중 첫날 살아 있는 것은 5개다 {#first-day-screens}
- [x] 정직성 감사 패널에 행동을 — 지금 미기록 파일을 나열하면서 버튼이 하나도 없고, 일지없는세션 카드의 유일한 행동은 과금 LLM 을 켜라는 제안뿐이다 {#honesty-actions}

## 방언 수렴 (리디자인 아님) {#dialect}
- [x] @theme inline 에 --text-*·spacing·z 추가 — TSX 를 한 줄도 안 고치고 294곳이 정렬된다. 단 Tailwind 화면 5개 육안 확인 필수(text-sm 14→13px) {#theme-inline-scale}
- [x] --fs-* 를 제목까지 확장 — 리터럴 20종 → 5~6종으로 수렴 (현재 10~13px 만 정의되어 14px 이상은 자리마다 정한다) {#fs-scale-up}
- [x] --space-* 도입 — 실측 최빈값 존중(4·6·8·10·12·16·20·24). 값을 키우는 게 아니라 수렴시키는 것 — 이 앱은 밀도 도구다 {#space-scale}
- [x] EmptyState 공용 컴포넌트 — .empty-hint 52곳 + 전용 3벌 + 전용 클래스 8종을 하나로 (리치/단순 두 밀도). 일러스트는 넣지 않는다 {#empty-state-component}
- [x] 모달 크롬 두 벌 통합 + .set-modal-backdrop → .scrim — 프리셋 배경을 안 따르는 유일한 스크림이다 {#modal-chrome-unify}
- [x] 설정 검색 — 12탭 + 하위 5탭·7,386줄·항목 100+ 인데 검색이 없고 ⌘K 팔레트도 개별 설정을 색인하지 않는다 {#settings-search}
- [~] 문법 강조를 --code-* 단일 팔레트로 + 프리셋 5종 연결 — 지금 같은 코드가 편집기에선 보라, 변경 화면에선 빨강이다. 언어별 육안 확인 필요 {#hljs-unify}
- [x] 상위 액센트 신호색 통일 — --claude 토큰(#d97757)과 shell.css 의 #cb7b5d 가 다른 주황이다 {#claude-coral-unify}

## 브랜치의 이야기 — 경계를 넘지 않는 신기능 {#branch-axis}
- [x] 인덱스에 브랜치 축 추가 — git 은 이미 로컬에 있고 git.rs 가 읽는다. 새 저장 형식·네트워크 없음. 지금 브랜치는 스냅샷에 값으로만 잡힌다(spec.rs:294) {#branch-index}
- [x] 이 브랜치의 이야기 — 일지·플랜 항목·커밋·diff 를 브랜치로 묶어 보여 준다 {#branch-story-view}
- [x] 브랜치 이야기를 마크다운 한 장으로 내보내기 (oculpm_export_digest 가 이미 있다). 내보내기는 하되 동기화는 안 한다 {#branch-digest}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-06T12:46:25+09:00 | #uiv2view-migrate | claude-code | ☐→x | .oculpm/journal/20260906/Bugs/1245_bug_uiv2view-route-safety.md | 목록을 uiV2View.ts 하나로, 타입은 배열에서 파생 |
| 2026-09-06T12:46:32+09:00 | #router-fallback | claude-code | ☐→x | .oculpm/journal/20260906/Bugs/1245_bug_uiv2view-route-safety.md | Today 갈래를 사슬 끝으로 옮겨 코드 중복 없이 폴백 |
| 2026-09-06T12:46:38+09:00 | #known-views-persist | claude-code | ☐→x | .oculpm/journal/20260906/Bugs/1245_bug_uiv2view-route-safety.md | KNOWN_VIEWS 가 UI_V2_VIEWS 별칭이 되어 loadFromStorage 도 지난다 |
| 2026-09-06T12:46:44+09:00 | #agent-row-merge | claude-code | ☐→x | .oculpm/journal/20260906/Features_to_add/1246_feature_ia-sidebar-15-screens.md | NavEntry.children + 배지 합산. keep-alive·uiV2View 값 그대로 |
| 2026-09-06T12:46:50+09:00 | #sessions-into-agent | claude-code | ☐→x | .oculpm/journal/20260906/Features_to_add/1246_feature_ia-sidebar-15-screens.md | 세 번째 갈래. 화면은 남고 ⌘K 목적지로도 살아 있다 |
| 2026-09-06T12:46:56+09:00 | #demote-disc-docs | claude-code | ☐→x | .oculpm/journal/20260906/Features_to_add/1246_feature_ia-sidebar-15-screens.md | 새 ref 그룹. 행은 남기고 ⌘번호만 회수 |
| 2026-09-06T12:47:02+09:00 | #rename-three | claude-code | ☐→x | .oculpm/journal/20260906/Features_to_add/1246_feature_ia-sidebar-15-screens.md | 변경·검색·편집기. 옛 이름은 ⌘K 별칭에 (ko·en 양쪽) |
| 2026-09-06T12:47:09+09:00 | #shortcut-remap | claude-code | ☐→x | .oculpm/journal/20260906/Features_to_add/1246_feature_ia-sidebar-15-screens.md | 안내는 WhatsNewCard 대신 사이드바 NavRemapNotice — GitHub 없이도 뜬다. 첫 설치엔 안 뜸 |
| 2026-09-06T13:01:33+09:00 | #theme-inline-scale | claude-code | ☐→x | .oculpm/journal/20260906/Refactors/1301_refactor_dialect-convergence-tokens.md | TSX 0줄 수정. Tailwind 화면 5개 육안 확인 남음(text-sm 14→13) |
| 2026-09-06T13:01:40+09:00 | #fs-scale-up | claude-code | ☐→x | .oculpm/journal/20260906/Refactors/1301_refactor_dialect-convergence-tokens.md | 리터럴 20종→13단 램프. 소유 CSS 리터럴 28곳 토큰화, 단조 증가 테스트 |
| 2026-09-06T13:01:48+09:00 | #space-scale | claude-code | ☐→x | .oculpm/journal/20260906/Refactors/1301_refactor_dialect-convergence-tokens.md | 8단 도입, 122곳 치환, 값 변화 0. 램프 밖 값은 일부러 리터럴로 남김 |
| 2026-09-06T13:01:56+09:00 | #modal-chrome-unify | claude-code | ☐→x | .oculpm/journal/20260906/Refactors/1301_refactor_dialect-convergence-tokens.md | 하드코딩 rgba 제거 — 스크림이 프리셋 배경을 따른다. 머리/경고/발 한 벌로 |
| 2026-09-06T13:02:04+09:00 | #claude-coral-unify | claude-code | ☐→x | .oculpm/journal/20260906/Refactors/1301_refactor_dialect-convergence-tokens.md | shell.css 는 선행 커밋에서 이미 해소. 테스트로 못박음. 세 번째 주황(agentColor #d97a4f) 발견 — 병합 때 처리 |
| 2026-09-06T13:02:12+09:00 | #settings-search | claude-code | ☐→x | .oculpm/journal/20260906/Refactors/1301_refactor_dialect-convergence-tokens.md | 132항목 색인 + 두 언어 검색. 짝 테스트가 설정 25파일을 훑어 색인 누락을 지목 |
| 2026-09-06T13:02:19+09:00 | #hljs-unify | claude-code | ☐→~ | .oculpm/journal/20260906/Refactors/1301_refactor_dialect-convergence-tokens.md | hljs 는 단일 팔레트로 갔으나 code.css 의 편집기 지역 팔레트가 남아 프리셋에서 갈린다 — 병합 때 마무리 |
| 2026-09-06T13:05:09+09:00 | #empty-state-component | claude-code | ☐→x | .oculpm/journal/20260906/Refactors/1304_refactor_empty-state-one-component.md | 두 밀도, 일러스트 없음. chat·sessions·settings 호출부는 병렬 레인이라 남김 |
| 2026-09-06T13:05:15+09:00 | #wizard-tense | claude-code | ☐→x | .oculpm/journal/20260906/Bugs/1305_bug_first-five-minutes-truth.md | ✓→→, "프로젝트를 열면:" 라벨. 근거 StartTab:211 vs ProjectTab:124 |
| 2026-09-06T13:05:22+09:00 | #today-empty-truth | claude-code | ☐→x | .oculpm/journal/20260906/Bugs/1305_bug_first-five-minutes-truth.md | 거짓 문장 삭제하되 "꺼져 있다"고도 안 씀 — 렌더 시점에 config 를 안 읽는다 |
| 2026-09-06T13:05:28+09:00 | #plugin-onboarding | claude-code | ☐→x | .oculpm/journal/20260906/Bugs/1305_bug_first-five-minutes-truth.md | PluginSetupCard. 판정이 얕은 탐색이라 문구는 "미설치" 아닌 "못 찾음". 실기기 확인 필요 |
| 2026-09-06T13:05:34+09:00 | #first-day-screens | claude-code | ☐→x | .oculpm/journal/20260906/Bugs/1305_bug_first-five-minutes-truth.md | 9화면에 구체적 행동. 스킬은 "필터 0건"과 "아직 없음"을 분리 |
| 2026-09-06T13:05:41+09:00 | #honesty-actions | claude-code | ☐→x | .oculpm/journal/20260906/Bugs/1305_bug_first-five-minutes-truth.md | 무료 3종 + 씨앗은 화면 상한 아닌 경로 전부. 과금 토글 라벨에 "(모델 호출)" |
| 2026-09-06T13:07:35+09:00 | #branch-index | claude-code | ☐→x | .oculpm/journal/20260906/Features_to_add/1307_feature_branch-story-axis.md | 마이그레이션 일부러 안 만듦 — 브랜치는 움직이는 좌표라 저장하면 곧 거짓이 된다 |
| 2026-09-06T13:07:41+09:00 | #branch-story-view | claude-code | ☐→x | .oculpm/journal/20260906/Features_to_add/1307_feature_branch-story-axis.md | 통계 4칸+4패널, 회고 어휘 재사용으로 새 CSS 0. 실행 확인 미완 |
| 2026-09-06T13:07:47+09:00 | #branch-digest | claude-code | ☐→x | .oculpm/journal/20260906/Features_to_add/1307_feature_branch-story-axis.md | export_digest 의 저장 대화상자를 save_markdown 으로 추출해 재사용. 동기화 없음 |
<!-- oculpm:plan-log end -->
