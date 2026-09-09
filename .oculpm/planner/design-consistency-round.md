---
oculpm_plan: v1
id: design-consistency-round
title: "디자인 일관성 라운드 — \"여러 손이 만든 티\" 지우기"
status: active
created: 2026-09-09
updated: 2026-09-09
owner: claude-code
---

2026-09-09 3세션 병렬 감사 결과. AI스러움(✨·유리·마케팅 카피)은 de-AI 라운드가 이미 지웠다 — 사전 3,346개에 과장어 1·느낌표 1·이모지 0, font-size 648개 중 640개가 토큰. 남은 것은 프리미티브·토큰·훅이 다 있는데 채택률이 낮고, lint 게이트가 CSS만 보느라 TSX로 새는 것이다. 게이트를 먼저 세워 재발을 막고, 깨진 것을 고치고, 같은 것을 하나로 접는다.

## 게이트 — 재발을 막는 lint 세 줄 {#gates}
- [x] 정의되지 않은 `var(--x)` 검사 — 정의 0건인 토큰이 17곳에서 쓰여 선언이 통째로 무효화된다. fallback 있는 var() 도 함께 봐야 한다 (조용히 다른 값으로 돌아가 더 안 잡힌다) {#gate-undef-var}
- [x] TSX 리터럴 검사 — `check-design-discipline.mjs` 의 track/weight 규칙이 `ext: /\.css$/` 라 TSX 를 못 본다. `text-[Npx]` 282개(11px 186·10px 65·13px 15) · 아이콘 `w-N h-N` 66개(w-3.5 44·w-4 18, 넷 다 램프 밖) · `z-[1000]`(Toaster) {#gate-tsx-literals}
- [x] 모션 리터럴 검사 — `--dur-1/2/3` 3단인데 duration 리터럴 40종, easing 은 맨 `ease` 5곳·`ease-out` 3곳·은퇴 곡선 2곳. 곡률·무게 규칙과 같은 형태로 추가 {#gate-motion}

## 깨져 있는 것 — 스타일이 죽거나 대비가 무너진 자리 {#broken}
- [x] 정의되지 않은 토큰 17곳 치환 — `--line`·`--shadow-soft`(code.css:693,695 :1428,1430 → Monaco 호버·시그니처 팝업에 테두리도 그림자도 없음) · `--text-1` 7곳(screens.css:2366 hover 무효, ErrorBoundary.tsx:75·TerminalErrorBoundary.tsx:50 = 크래시 화면 제목) · `--font-mono` 3곳(tray.css:338,346,353) {#fix-undef-tokens}
- [x] `nav-ia.css` 53줄을 `shell.css` nav 블록으로 흡수 — 통째로 다른 시스템 어휘다(`--r-1`/`--r-2`/`--bg` 정의 없음, `var(--fs-2, 12px)` 인데 실제 10.5px 로 fallback 이 거짓말). 파일 머리 주석이 이미 옮기라고 적어 뒀다 {#fix-nav-ia}
- [x] `App.css` 의 shadcn 팔레트를 hex 재선언에서 `--foreground: var(--text)` 별칭으로 — ui_v2 CSS 가 shadcn 어휘를 173곳 참조해(--border 87·--primary 19·--muted-foreground 18) 두 팔레트가 한 창에 동시 렌더된다. tokens.css 가 전역이 된 2026-07-31 이후 분리 전제는 무효 {#fix-palette-alias}
- [x] `design_tokens.test.ts` 대비 래칫에 shadcn 팔레트 추가 — 지금은 tokens.css 쪽만 지킨다. 실측 미달: Nord `--destructive` on `--card` 2.46(삭제 버튼 글자) · Solarized `--muted-foreground` 4.13 · Dracula 3.68 {#fix-contrast-ratchet}
- [x] 액션 달린 토스트에 기본 지속시간 금지 — `useFileOps.ts:161` 이 durationMs 를 안 줘 info 기본 5초, `undoMoves` 호출부는 코드베이스 전체에서 이 한 줄뿐(메뉴도 ⌘Z 도 없다). push() 에서 actions 가 있으면 최소 15초, 그리고 호버·포커스 시 타이머 정지 {#fix-undo-toast}
- [x] 입력 경계와 포커스 — `--input` 대 `--card` 대비가 라이트 1.33·Nord 1.17 로 WCAG 1.4.11 의 3:1 미달이고, `outline:none` 32곳 중 `:focus-within` 대체가 없는 6곳(skills.css:393,736 · agent.css:885,1174,1836 · discussion.css:629)은 Tab 으로 들어가도 화면이 안 변한다 {#fix-focus-visible}
- [x] 모달 4곳에 `useModalBehavior` — 트랩·복원 없음: WelcomeWizard.tsx:167(첫 실행 화면) · ProjectManager.tsx:224 · Attachments.tsx:29 · AcpUsageMeter.tsx:234. ConfigControls.tsx:372 는 팝오버 메뉴에 role="dialog" 오용 {#fix-modal-trap}
- [x] `Toaster.tsx:20` 라이브 리전 상시 마운트 — 지금은 `if (toasts.length === 0) return null` 이라 리전이 내용과 동시에 삽입돼 `role="status"` 가 자주 침묵한다. 같은 파일의 `z-[1000]` 도 `--z-*` 램프로 {#fix-live-region}
- [x] 아이콘 전용 버튼 6곳에 접근명 — TrayPopover.tsx:373,473,573(메뉴바 팝오버의 유일한 "앱 열기") · WelcomeWizard.tsx:343 · GreenfieldWizard.tsx:753 · CodeDebugPanel.tsx:271 {#fix-aria-icons}
- [ ] 버튼 35개가 왜 비활성인지 말하지 않는다 — 유효성으로 막힌 51개 중 title·aria-describedby 없는 것 35개. AutomationEditor.tsx:386 은 `problem` 이라는 이유 문자열을 손에 들고도 안 붙인다 {#fix-disabled-reason}

## 같은 것을 하나로 — "여러 손" 신호 {#unify}
- [x] 설정 진입점 단일화 — ⌘, 는 `ProjectTab.tsx:93` 을 거쳐 `.scrim` 모달, 사이드바는 `ShellV2.tsx:343` 전체화면, 안내 버튼은 `settingsNav.ts` 로 전체화면. 탭 내비도 가로 스트립(SettingsPanel.tsx:164)과 세로 192px 열(:185)로 갈린다. 프로젝트 창은 화면으로 통일하고 오버레이는 런처 탭 전용으로 {#unify-settings}
- [x] `SettingsOverlay.tsx:39` 의 하드코딩 영어 `<h2>Settings</h2>` 와 :45 의 손으로 붙인 인라인 SVG 닫기 버튼을 공유물로 {#unify-settings-chrome}
- [ ] 문서형 드릴다운 통일 — 일지는 전체화면(목록 사라짐, ArrowLeft size=18) · 스킬은 전체화면인데 툴바 자체가 `.sk-head` 로 바뀌어 크롬이 52→60px(ArrowLeft size=15) · 논의/변경은 2-pane. 논의 규격(2-pane)으로 접거나, 최소한 `.sk-head` 를 `<Toolbar>` 로 {#unify-drilldown}
- [ ] AI 3면 파리티 — `AcpToolbar.tsx:50` 만 title 자리에 세션 탭을 넣어 16화면 중 제목 없는 유일한 둘이다. 지난 대화가 ACP 는 사이드 패널·AI 패널은 모달이고, 컴포저는 `AiPanelScreenV2.tsx:840-1010` 이 170줄을 다시 짰다(공유 Composer.tsx 의 첨부·슬래시 없이) {#unify-chat}
- [x] 모달 셸 두 벌 — `AppDialog` 17곳(z-modal 100, useModalBehavior) vs `.set-modal` 2곳(z-popover 60, 자체 keyframes). 층이 달라 `.set-modal` 이 AppDialog 밑으로 들어간다. ConversationHistoryModal·ManualEntryModalV2 를 AppDialog 로 {#unify-modal-shell}
- [~] 검색 입력 6종을 `.search-box` 2단으로 — 30px/radius-s · 46px/radius-l+그림자(검색 히어로) · 26px/pill(코드 맵) · 24px · 28px · 시작 탭. 공유 프리미티브조차 호출부가 인라인 height 로 덮는다(SettingsSearch.tsx:41 등) {#unify-search-input}
- [ ] 툴바 버튼 어휘를 4개로 — `btn`/`btn sm`/`btn primary`/`disc-btn primary`/`code-tool-btn`/`gr-chip`/`sk-textbtn` 이 같은 52px 바에 섞이고 SkillsScreenV2.tsx:309-330 은 한 줄에 4종. "선택됨" 표현도 4가지(.seg-item[aria-selected] 는 3곳뿐, DiffScreenV2.tsx:130-133 은 JSX 인라인 배경색 계산) {#unify-toolbar-vocab}
- [ ] 칩 11벌을 2단으로 — 높이 18·22·23·25·28px, 곡률 xs·s·m·pill 이 섞여 한 줄에 서면 광학 중심이 어긋난다(.file-pill 25 · .chip 22 · .scope-chip 28). 아이콘 버튼 `--iconbtn-size` 도 26/28/30/32 네 단 {#unify-chips}

## 문안 — 화자를 한 명으로 {#copy}
- [~] 화자 통일 + `lint:tone` — 합쇼체 405 / 해요체 253 이 접두사별로 갈리고(code.* 39:5 · today.* 3:19 · graph.* 0:11) 한 문자열 안에서 섞이는 게 28건(ko.ts:41 · :90 · :1512). 해요체로 정하고 code.*·ctx.*·automation.* 87건을 옮긴다. 최소한 "한 문자열 안 혼재" 는 즉시 게이트로 {#copy-voice}
- [x] 에러 문안 — `{error}` 를 그대로 보간하는 111건 중 `"…실패: {error}"` 42건을 "무엇이 안 됐는지 + 다음 한 걸음" 으로 바꾸고 영문 원문은 접힌 상세로. 에러성 273건 중 다음 행동을 말해주는 건 32건뿐이다 {#copy-errors}
- [x] 파괴 확인 3벌을 `useConfirm` 하나로 — 표준("지울까요? [취소][삭제]") vs settings.danger("정말로 삭제하시겠습니까? [예, 모두 삭제]") vs home/rows.tsx:110("정말 버릴까요? [예][아니오]"). "…할까요?" 22 vs "…하시겠습니까?" 2 인데 그 2건이 가장 위험한 자리다 {#copy-confirm}
- [x] "복사됨" 토스트 6종을 `common.copied` 하나로 — 공용 키가 이미 있는데 5곳이 각자 썼다(ko.ts:167 "복사됨" · :671 "복사됨!" ← 사전 유일 느낌표 · :2756 "복사됨 ✓" · :300 · :982 · :1559) {#copy-toast}
- [x] 용어집 확정 + 금지어 lint — "작업 일지" 16/"작업일지" 7(같은 화면) · "플래너" 20/"플랜" 15/"계획" 59/"Planner" 4 · "Ocul-PM" 6/"ocul-pm" 35 · "폴더" 46/"디렉토리" 3/"디렉터리" 2 · "기록없음" 1/"기록 없음" 4. 영문 뒤 조사 붙여쓰기 15건(관례는 띄어쓰기 156건) {#copy-glossary}
- [x] `gf.*` 54개(GreenfieldWizard)를 `welcome.*` 목소리로 재작성 — 사전 전체의 이상치가 여기 몰려 있다: 유일한 과장어("자유롭게") · 미번역 "narrative" · 정식 명칭 위반("Today 탭" vs nav.today="오늘 현황") · "디렉토리" · 조사 붙여쓰기 2건. 컴포넌트도 `.btn` 대신 raw Tailwind {#copy-greenfield}
- [x] `ai.actionApply` = "적용하기 (Apply)" → "적용" — 다른 "적용" 3개는 전부 그냥 "적용"이고, 영어를 병기한 유일한 순수 한국어 동사다 {#copy-apply-label}

## 램프 채택 — 세워 놓고 안 쓴 것들 {#ramps}
- [~] 여백 토큰 채택 — padding/margin/gap 이 토큰 129 : px 리터럴 1,007(11%). agent.css·code.css·skills.css 셋만 옮겨도(434곳) 절반이 정리된다. 램프 밖 최빈값 5px(48)·7px(30) 을 6/8 로 수렴시킬지 램프에 5·7 을 더할지 먼저 결정 {#ramp-space}
- [ ] 컨트롤 높이 램프 신설 — `height:` 리터럴 42종, 18~40px 구간에만 15종. 곡률·무게처럼 램프를 세우고 칩 2단(22·26)·아이콘 버튼 2단(26·30)으로 접는다 {#ramp-height}
- [x] 줄간격 램프 신설 — line-height 19종, 본문 계열만 9종(1.4~1.72). 한국어는 제목도 1.3 아래로 안 내린다. `--lh-tight`/`--lh-body`/`--lh-prose` 3~4단. screens.css:2266 은 h1~h6 를 크기와 무관하게 전부 1.35 로 준다 {#ramp-leading}
- [x] 흐림 토큰 2개 — `:disabled` opacity 가 0.32/0.35/0.4/0.45/0.5/0.55 여섯 단이고 `.btn:disabled`(0.5) 와 `.iconbtn:disabled`(0.32) 가 같은 툴바에서 눈에 띄게 다르다. `--dim-disabled`/`--dim-quiet` 로 {#ramp-dim}
- [x] 무한 애니메이션 29개를 2벌로 — 주기가 0.7·0.8·0.9·1.0·1.2·1.4·1.6·2.0·2.4s 아홉 종이라 사이드바 배지·탭·터미널이 서로 다른 박자로 숨 쉰다. 회전(작업 중) 하나 + 맥동(주의) 하나, 주기는 토큰. `nav-attention-blink` 깜빡임은 맥동으로 교체 {#ramp-pulse}
- [x] `screens.css` 의 transition 0.12s 15곳 삭제 — 전역 `:where(button)` = `--dur-1`(90ms) 와 싸우는 재정의라 지우기만 하면 된다. `@theme inline --ease-out`(App.css:110) 은 은퇴 곡선에 고정돼 tokens.css:180 과 갈라져 있다 {#ramp-dur-cleanup}
- [x] 죽은 토큰 정리 — `App.css:404~406` 의 `--radius-card:16px`/`--radius-button:8px`/`--radius-chip:999px` 는 소비처 0인데 램프 밖 값을 이름으로 정당화한다(둥글기 lint 는 `border-radius:` 선언만 본다). `App.css:468`·`bootsplash.css:14` 의 z 리터럴 200 은 `var(--z-command)` 로 {#ramp-dead-tokens}

## 구조 — 창이 바뀔 때 {#layout}
- [ ] 컨테이너 쿼리로 격자 접기 — 프로젝트 셸의 폭 기반 @media 가 2개뿐(.date-rail 940px · .sess-board 900px)이고 그 둘마저 뷰포트 기준이라 사이드바 248px·터미널 도크가 먹은 폭을 못 본다. 플래너가 이미 세운 패턴(screens.css:729 주석)을 `.content-main` 에 걸고 .stat-row(repeat(4,1fr))·.grid-2·.entry-row2·.diff-screen 을 접는다 {#layout-container-query}
- [ ] 읽기 폭·패널 폭 토큰화 — 읽기 열 5종(AI 760·일지 820·논의 860·플래너 880·검색 880) 대 꽉 차는 화면들, 좌측 패널 4종(264·284·288·320) 중 끌어서 조절되는 건 플래너 하나뿐. `--read-narrow`/`--read-wide` 2단 + 드래그 규약 통일. `.journal-wrap` 이 `.page` 의 padding·max-width 를 손으로 복사한 것도 함께 {#layout-widths}
- [ ] Today 를 카드 대시보드에서 섹션으로 — ⌘1 기본 착지 화면이 카드 17개이고 세로 리듬을 각 컴포넌트가 인라인으로 따로 갖는다(marginTop:16 · 12 · marginBottom:16 · 없음). 표면도 3겹(시트→카드→카드). 카드는 행동을 요구하는 것에만 남기고 리듬은 부모가 gap 으로 소유 {#layout-today}
- [ ] `LoadingState` 신설 — `EmptyState` 로 `common.loading` 을 그리는 곳 7군데(PlanUpdates·DiscussionPending·NextTasks·WhatsNewCard·ConversationHistoryModal·BinaryFileView·AutomationHistory)라 "불러오는 중" 과 "없음" 이 픽셀 단위로 같다. 로딩 표현도 스켈레톤 7화면/스피너 4화면/없음 3화면(세션·AI 패널·터미널) {#layout-loading-state}
- [ ] `EmptyState` 밀도 계약 복구 — plain/rich 두 단으로 선언했는데 호출부 20곳이 인라인 padding 으로 덮는다(16 · "24px 8px" · "16px 20px" · "18px 16px" · "24px 16px" · "6px 2px" · "6px 0 0"). `compact` 한 단을 더해 흡수 {#layout-empty-density}
- [ ] 검색 화면 툴바 — `SearchScreenV2.tsx:266-270` 은 액션이 0개이고 sub 와 유일한 칩이 같은 문자열이라 한 바에 같은 문장이 두 번 뜬다. 주 컨트롤은 본문의 46px 히어로 카드(웹 랜딩 관용구)에 있다. 일지처럼 툴바 30px 필드로 올린다 {#layout-search-toolbar}
- [ ] 화면 진입 애니메이션 — `.page fade-in` 8곳 vs 맨 `.page` 8곳(skills·code·discussion) {#layout-page-enter}
- [~] 잡동사니 — `navRegistry.ts:117` 주석이 「에이전트」를 ⌘0 이라 하지만 index 8 → ⌘9 다(주석 드리프트). 사이드바 첫 그룹만 라벨이 없다(Sidebar.tsx:410/421/450 은 「도구」·「AI」·「참고」). `SkillShopTab.tsx:162`·`PluginDocsTab.tsx:62` 의 <Toolbar> 는 항상 embedded 로만 마운트돼 렌더되지 않는 죽은 코드 {#layout-misc}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-09T19:52:43+09:00 | #gate-undef-var | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1952_refactor_design-gates-and-undefined-tokens.md | 별도 패스로 구현. 추정 17곳이 아니라 25곳이었다 (chart 5·surface-2 2·pc-text 1 추가). probe 파일로 음성 테스트 확인 |
| 2026-09-09T19:52:49+09:00 | #gate-tsx-literals | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1952_refactor_design-gates-and-undefined-tokens.md | 리터럴의 원인은 램프에 이름이 없던 것 — @theme inline 에 --text-fs-0..12 추가 후 282개 치환. 아이콘 64곳은 size= 로, 판정은 대문자 컴포넌트 기준(소문자 태그=도형은 통과) |
| 2026-09-09T19:52:55+09:00 | #gate-motion | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1952_refactor_design-gates-and-undefined-tokens.md | 여러 줄 선언 때문에 별도 패스. 접는 기준은 값이 아니라 역할(색 계열=--dur-1, 기하만 값에 맞는 단) — 36곳 치환. animation: 은 범위 밖으로 명시 ({#ramp-pulse} 몫) |
| 2026-09-09T19:53:02+09:00 | #fix-undef-tokens | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1952_refactor_design-gates-and-undefined-tokens.md | 25곳 — --line→--sep · --shadow-soft→--shadow-pop · --text-1→--text · --font-mono→--mono · --pc-text→--pc(오타) · --surface-2→--bg-inset(fallback 이 순수 검정이었다) · --chart-1..5 매핑 삭제(소비처 0) |
| 2026-09-09T19:53:07+09:00 | #ramp-dur-cleanup | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1952_refactor_design-gates-and-undefined-tokens.md | gate-motion 과 함께 처리. @theme inline --ease-out 이 은퇴 곡선에 고정돼 tokens.css 와 갈라져 있던 것도 동기화 |
| 2026-09-09T19:53:14+09:00 | #ramp-dead-tokens | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1952_refactor_design-gates-and-undefined-tokens.md | --radius-card\|button\|chip 삭제(소비처 0, rounded-* 유틸리티도 안 생김). z 리터럴 200 둘 + Toaster 의 z-[1000] 까지 램프로 |
| 2026-09-09T19:53:20+09:00 | #fix-nav-ia | claude-code | ☐→~ | .oculpm/journal/20260909/Refactors/1952_refactor_design-gates-and-undefined-tokens.md | 토큰 셋(--r-1·--r-2·--bg)은 램프 이름으로 고쳤다. 남은 것: shell.css 로 접어 넣기 + --border→--sep + 거짓 fallback var(--fs-2, 12px) 제거 |
| 2026-09-09T20:02:36+09:00 | #fix-palette-alias | claude-code | ☐→x |  | 142줄 → 52줄, 블록 7개가 :root 하나로 (data-preset 이 html 에만 붙으므로 안전). 부수 효과로 액센트 6종·커스텀 테마가 이제 shadcn 표면까지 칠한다 |
| 2026-09-09T20:02:42+09:00 | #fix-contrast-ratchet | claude-code | ☐→x |  | 대비를 다시 계산하는 대신 별칭 계약 3개로 대체 — 별칭이면 기존 램프 래칫이 shadcn 쪽까지 자동 보증한다. 회귀 경로("이 프리셋만 다르게")를 셋째 테스트가 막고 실제 패턴으로 음성 확인 |
| 2026-09-09T20:11:12+09:00 | #unify-settings | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2011_refactor_unify-settings-entry-points.md | ⌘, 가로채기 제거로 프로젝트 창은 화면 하나. 감사의 "탭 내비 두 벌" 지적은 프로덕션에선 틀렸고(둘 다 embedded) 대신 세로 갈래가 죽어 있어 embedded 프롭째 삭제 |
| 2026-09-09T20:11:18+09:00 | #unify-settings-chrome | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2011_refactor_unify-settings-entry-points.md | 하드코딩 영어 → t("shell.settings.title"), 인라인 SVG → 공유 X 아이콘 + aria-label |
| 2026-09-09T20:16:38+09:00 | #fix-undo-toast | claude-code | ☐→x | .oculpm/journal/20260909/Bugs/2016_bug_toast-undo-window-and-live-region.md | 호출부를 고치는 대신 바닥을 올렸다 (ACTION_MIN_MS=15초, 잊어도 손해가 안 나게). 타이머를 Map 으로 바꿔 호버·포커스에 pause/resume 배선 |
| 2026-09-09T20:16:44+09:00 | #fix-live-region | claude-code | ☐→x | .oculpm/journal/20260909/Bugs/2016_bug_toast-undo-window-and-live-region.md | 리전 둘(polite/assertive)을 항상 마운트. z-[1000] 은 앞선 게이트 라운드에서 z-top 으로 이미 처리됨 |
| 2026-09-09T20:22:16+09:00 | #fix-modal-trap | claude-code | ☐→x | .oculpm/journal/20260909/Bugs/2022_bug_modal-focus-trap-and-aria-audit.md | 셋만 진짜였다 (WelcomeWizard·ProjectManager·Lightbox). AcpUsageMeter 는 오탐 — useDismiss 가 Esc·바깥클릭을 이미 한다. 대신 ConfigControls 의 role="dialog" 오용을 role="group" 으로 |
| 2026-09-09T20:22:23+09:00 | #fix-aria-icons | claude-code | ☐→x | .oculpm/journal/20260909/Bugs/2022_bug_modal-focus-trap-and-aria-audit.md | 6곳 중 5곳이 오탐 — TrayPopover 3곳·WelcomeWizard·GreenfieldWizard 는 전부 보이는 텍스트 라벨이 있다. 진짜는 CodeDebugPanel 트리 캐럿 하나뿐(aria-label + common.expand/collapse 키 신설) |
| 2026-09-09T20:36:18+09:00 | #fix-focus-visible | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2036_refactor_focus-visible-and-single-modal-shell.md | 감사 줄번호가 모션 커밋 이후 밀려 다시 도출 — 6곳이 아니라 9곳이고 셋은 고칠 게 아니었다. 진짜 여섯에 focus-within/focus 배선. --input 은 --sep-strong 으로 한 단 올렸지만 3:1 은 미달(입력 전용 경계색 신설은 사용자 판단 사항) |
| 2026-09-09T20:36:25+09:00 | #unify-modal-shell | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2036_refactor_focus-visible-and-single-modal-shell.md | 층만 올릴 수 없었다 — 중첩 확인창을 백드롭보다 앞에 렌더하고 있어서 순서를 함께 고쳐야 했다. .set-modal 셸 전부 삭제, 스크림 계약 테스트를 "같은 바탕" 에서 "되살아나지 않는다" 로 강화 |
| 2026-09-09T20:44:32+09:00 | #copy-toast | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2044_refactor_copy-glossary-and-clipboard-form.md | 6종이 아니라 13종이었고 말투가 셋. common.copiedWhat 은 넣을 명사 키가 없어 접고, 키는 두되 값의 형태를 「(무엇) 복사됨」으로 통일. 느낌표·체크글리프 제거 |
| 2026-09-09T20:44:39+09:00 | #copy-glossary | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2044_refactor_copy-glossary-and-clipboard-form.md | 작업일지·디렉토리/터리·기록없음·값 안의 Planner·조사 붙여쓰기 17곳 정리. Ocul-PM/ocul-pm 은 오탐(CLAUDE.md 가 문서화한 산문/식별자 구분). i18n_glossary.test.ts 15개로 계약화 |
| 2026-09-09T20:44:44+09:00 | #copy-apply-label | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2044_refactor_copy-glossary-and-clipboard-form.md | "적용하기 (Apply)" → "적용" |
| 2026-09-09T20:54:54+09:00 | #copy-errors | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2054_refactor_error-messages-and-voice-mixing.md | 41건을 "무엇이 안 됐는지 — {error}" 로. 원문은 진단 정보라 남겼다(접힌 상세는 토스트에 없는 UI 라 별도 항목). graph.previewFailed 값에 주석 기호 "//" 가 들어가 있던 것도 발견·제거. 「…실패: {error}」 금지 게이트 추가 |
| 2026-09-09T20:55:01+09:00 | #copy-voice | claude-code | ☐→~ | .oculpm/journal/20260909/Refactors/2054_refactor_error-messages-and-voice-mixing.md | 한 문자열 안 혼재 24건 정리 + 게이트 완료. 「하세요」+「합니다」는 서법이 달라 정상이므로 제외(그걸 세면 66건). 남은 것: 사전 전체 합쇼 532/해요 396 을 하나로 — 900+ 문자열이라 사용자 결정 필요 |
| 2026-09-09T20:58:54+09:00 | #copy-confirm | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2058_refactor_unify-destructive-confirm.md | "모달로 통일" 이 답이 아니었다 — 목록 행의 초안 버리기는 인라인이 맞다. 진짜 문제는 앱 최대 파괴 동작(전체 삭제)이 그것과 같은 생김새였던 것. DataTab 만 useConfirm 으로, rows 는 버튼이 결과를 말하게. 게이트 2개 추가 |
| 2026-09-09T21:06:56+09:00 | #copy-greenfield | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2106_refactor_greenfield-wizard-voice.md | 감사가 못 짚은 게 더 컸다 — 다섯 스텝 제목이 물음표 문장 2 + 명사구 3 으로 갈려 있었다. welcome.step.* 규격으로 통일. "Today 탭"(없는 화면 이름) 4곳·"narrative" 2곳도 정리. raw Tailwind 버튼은 시각 변화라 남김 |
| 2026-09-09T21:10:55+09:00 | #ramp-leading | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2110_refactor_leading-and-dim-ramps.md | 4단(1.35/1.45/1.55/1.7) 75곳. line-height:1 과 px 7곳은 조판이 아니라 도형(고정 높이 배지 수직 중앙)이라 제외하고 게이트도 소수만 본다. h1~h6 를 크기별로 가르는 건 조판 설계라 값만 램프에 얹음 |
| 2026-09-09T21:11:02+09:00 | #ramp-dim | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2110_refactor_leading-and-dim-ramps.md | --dim-disabled 0.45 로 24곳. .iconbtn:disabled 의 color:--text-3 는 그대로 뒀다 — 흐림과 색을 동시에 바꾸면 눈으로 확인 없이 두 변수를 움직이는 것. --dim-quiet 은 즉시 소비처가 없어 만들지 않았다 |
| 2026-09-09T21:38:26+09:00 | #ramp-pulse | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/2138_refactor_loop-animation-periods.md | 2벌이 아니라 3벌이 맞았다(회전·맥동·느린 호흡). 25곳 치환, 예외 4(브랜드 로더 합성모션 3·캐럿 1). nav-attention-blink 는 오탐 — 이미 opacity 0.45 맥동이고 이름만 blink 였다(이름을 고침) |
| 2026-09-09T21:41:45+09:00 | #ramp-space | claude-code | ☐→~ | .oculpm/journal/20260909/Refactors/2141_refactor_space-ramp-adoption.md | 램프에 딱 맞는 892곳 완료(시각 변화 0, 채택 129→850). 남은 480곳은 램프 밖(5px 108·7px 88·9px 88 — 저단 2px 격자 사이에 낀 값)이라 옮기면 1~2px 씩 움직인다. 5·7·9 를 램프에 더할지 수렴시킬지는 실기기 확인이 필요 → 래칫 480 으로 동결 |
| 2026-09-09T22:02:38+09:00 | #unify-search-input | claude-code | ☐→~ | .oculpm/journal/20260909/Refactors/2202_refactor_settings-screen-redesign.md | 6종 중 1종 해소 — 설정 재설계로 SettingsSearch.tsx:41 의 인라인 height 가 사라졌다(레일 머리 `.cfg-search`). 남은 5종은 그대로 |
| 2026-09-09T22:08:02+09:00 | #layout-misc | claude-code | ☐→~ | .oculpm/journal/20260909/Refactors/2207_refactor_fs-ramp-caps-icon-stroke-sidebar.md | 셋 중 하나 완료 — 사이드바 첫 그룹에 sidebar.mainSection「작업」. 남은 둘: navRegistry 주석 드리프트, 죽은 Toolbar 2곳 |
| 2026-09-09T22:08:08+09:00 | #fix-nav-ia | claude-code | ~→~ | .oculpm/journal/20260909/Refactors/2207_refactor_fs-ramp-caps-icon-stroke-sidebar.md | 거짓 fallback 3곳만 제거(var(--fs-2,12px) → var(--fs-3)). shell.css 로의 흡수는 병렬 세션 몫으로 남김 |
| 2026-09-09T22:52:48+09:00 | #fix-nav-ia | claude-code | ~→x | .oculpm/journal/20260909/Refactors/2252_refactor_nav-ia-absorbed-into-shell.md | 항목 근거 3개 중 3개가 이미 해소돼 있었다(488b6fc) — 남은 건 흡수뿐. 12개 선택자를 뒤 4레이어에서 grep 해 경쟁 선언 0 확인 후 shell.css nav 블록으로. 값은 한 자도 안 바꿈(램프 밖 7px·22px 은 ramp-space 래칫 동결 중). index.css 주석의 "5 files" 가 도로 참이 됐다 |
<!-- oculpm:plan-log end -->
