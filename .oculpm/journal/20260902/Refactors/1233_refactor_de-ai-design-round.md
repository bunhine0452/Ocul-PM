---
schema_version: 1
type: refactor
slug: "de-ai-design-round"
status: done
difficulty: high
created_at: "2026-09-02T12:33:36+09:00"
session_id: "20260902-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/components/AgentMark.tsx"
    op: create
  - path: "scripts/check-design-discipline.mjs"
    op: create
  - path: "package.json"
    op: update
  - path: "src/App.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/features/graph/graph.css"
    op: update
  - path: "src/features/tray/tray.css"
    op: update
  - path: "src/features/docs/docs.css"
    op: update
  - path: "src/features/onboarding/home.css"
    op: update
  - path: "src/features/projects/projects.css"
    op: update
  - path: "src/features/today/StatCard.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodayMonitor.tsx"
    op: update
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/aiActions.tsx"
    op: update
  - path: "src/features/chat/conversation/ConfigControls.tsx"
    op: update
  - path: "src/features/chat/conversation/shared.ts"
    op: update
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/features/onboarding/WelcomeWizard.tsx"
    op: update
  - path: "src/features/onboarding/home/tiles.tsx"
    op: update
  - path: "src/features/onboarding/home/rows.tsx"
    op: update
  - path: "src/features/onboarding/home/atoms.tsx"
    op: update
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/features/retro/SkillCandidates.tsx"
    op: update
  - path: "src/features/retro/RuleCandidates.tsx"
    op: update
  - path: "src/features/retro/EvalTrend.tsx"
    op: update
  - path: "src/features/retro/DeferLedger.tsx"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/features/settings/tabs/DoctorSection.tsx"
    op: update
  - path: "src/features/settings/tabs/DataTab.tsx"
    op: update
  - path: "src/features/settings/tabs/FiringInsights.tsx"
    op: update
  - path: "src/features/graph/GraphInspector.tsx"
    op: update
  - path: "src/features/skills/ContextInbox.tsx"
    op: update
  - path: "src/features/skills/ContextProposals.tsx"
    op: update
  - path: "src/features/skills/PluginDocsTab.tsx"
    op: update
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/projects/ProjectManager.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalCardV2.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/features/oculpm/SourceBadge.tsx"
    op: update
  - path: "src/features/oculpm/triggerMeta.tsx"
    op: update
  - path: "src/features/terminal/TerminalRail.tsx"
    op: update
  - path: "src/features/terminal/TerminalAgentPill.tsx"
    op: update
  - path: "src/features/today/FirstRunCard.tsx"
    op: update
  - path: "src/features/today/CoreModelSeededCard.tsx"
    op: update
  - path: "src/features/today/PlanUpdates.tsx"
    op: update
  - path: "src/features/today/AgentBreakdown.tsx"
    op: update
  - path: "src/features/docs/DocsImage.tsx"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/components/ui/AppDialog.tsx"
    op: update
  - path: "src/components/ui/Toaster.tsx"
    op: update
  - path: "src/components/ui/Skeleton.tsx"
    op: update
  - path: "src/components/MarkdownImpl.tsx"
    op: update
  - path: "src/windows/Dialog.tsx"
    op: update
  - path: "src/windows/SettingsOverlay.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/mobile/MobileApp.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/claude_hooks_settings.test.tsx"
    op: update
  - path: "src/__tests__/mcp_settings.test.tsx"
    op: update
related: []
tags:
  - "design"
  - "ui"
  - "tokens"
  - "lint"
  - "icons"
  - "de-ai"
  - "mcp-tool"
---
[x] "AI 가 만든 화면" 관용구 제거 라운드 — 스파클 29곳 · KPI 색상자 · 유리 스크림 5벌 · 광택/앰비언트 그라데이션 · 팔레트 색 125곳 · 디자인 린트

## 동기

앱 UI 코드 전체와 랜딩 스크린샷 7장을 대조해 "생성형 AI 가 만든 화면" 의 관용구를 찾았다. 핵심 4화면(오늘·일지·diff·터미널)은 자기 언어가 있었지만, **AI 기능 주변부와 shadcn 기본값으로 만든 화면**에 관용구가 몰려 있었다:

- 스파클(✨) 아이콘 29곳 — "AI 기능이면 반짝이". 코드 화면의 **포맷** 버튼까지 스파클이었다.
- 오늘 현황 KPI 타일 8장 — 색 네모 안 아이콘 + 라벨 + 큰 숫자. 색이 트리거 팔레트(잡일=주황, 리팩토링=보라)를 빌려 와 지표와 무관했다.
- AI 패널 빈 화면 — 가운데 정렬 스파클 히어로 + "무엇이든 물어보세요" + 제안 칩. Claude Code 화면의 시작 상태도 같은 히어로.
- 그린필드 마법사 — 스파클 헤더 + 세그먼트 진행바 + 이모지 스택 아이콘(⚡🦀🐍🔵📁) + 로켓 "시작".
- 시작 화면 "이렇게 동작해요" — 큰 숫자 1·2·3 카드 3열 + "→" CTA (랜딩의 How-it-works).
- 두 스타일 시스템 — 설정·회고·그래프·팔레트·다이얼로그는 shadcn 기본 스케일(rounded-2xl·shadow-2xl·`bg-primary/10 text-primary` 탭), 핵심 화면은 토큰 CSS. 한 창에 '두 제품'.
- 유리 스크림 5벌 복붙(`bg-background/60 backdrop-blur-sm`) + 유리 툴바(blur 18px) + 유리 그래프 범례·라이트박스·AI 액션 카드. home.css 가 명시적으로 금지한 패턴과 모순.
- 캔버스·그래프의 액센트 라디얼 앰비언트, primary 버튼·활성 nav·프로젝트 아이콘의 광택 그라데이션, 게이지 4종의 그라데이션 채움, 트레이 스캔 빔, 스켈레톤 시머 3벌.
- Tailwind 팔레트 색(text-emerald-400 · bg-amber-500/10 …) 125곳 — 테마 5종·액센트 6종을 무시.
- AI 액션 라벨 이모지(🗂 ➕ ✅ ✏️ 🗑), "✅ 설치됨/⚠️ 미설치", 히어로 부제의 제품 설명 카피, 로봇(Bot) 아이콘 23곳, 로켓/불꽃/별 은유.

## 변경 요약

**아이콘 — 그 자리의 동작을 말하게.** `Sparkles` 는 Icons.tsx 에서 손그림·재수출 둘 다 제거. 포맷=AlignLeft · 초안=PenLine · AI 갱신=RefreshCw · 새 프로젝트=FolderPlus · 모델/LLM=Cpu · 산출물=FileText · 회고 생성=NotebookPen · 스킬 카탈로그=Store · 에이전트 감지=ScanSearch · AI 대화=MessageSquareText · 생각 블록=MessageSquareDashed · 의미 검색=Compass · 기능 트리거=Plus · 하이라이트=Pin · 계획 업데이트=ListChecks · 노력=Gauge · 첫 활성화=FolderCheck. `Bot` 은 새 `AgentMark`(Claude 계열은 ClaudeMark, 그 외 Cpu)로, 이름표가 옆에 있는 자리(일지 카드·상세)는 아이콘 자체를 뺐다. 회고 "Claude Code 로" 는 ClaudeMark. 아이콘 표의 값 타입 `IconComponent` 를 추가해 손그림·lucide 가 한 표에 섞일 수 있게 했다.

**오늘 현황 타일.** `StatCard` 의 `tint` 를 없애고 `tone?: "accent" | "danger"` 로. 색 상자 대신 선화 한 개, 색은 의미가 있을 때만(주 지표 1장 accent, 에러 사이클 >0 일 때 danger). 히어로 부제는 제품 설명 문장 대신 오늘 기록한 에이전트 목록(없으면 `today.subheadIdle`).

**빈 상태.** `.ai-hero`(가운데 아이콘 히어로 + 칩) → `.ai-start`(왼쪽 정렬, 제목=프로젝트 이름, 붙는 컨텍스트 한 줄, "시작할 질문" 목록). Claude Code 시작/꺼짐 상태도 같은 물체로 — 마크는 제목 줄에 제 색으로.

**마법사·온보딩.** 그린필드: 세그먼트 진행바 제거(머리의 "n / 5" 로 충분), 이모지 대신 실제 스캐폴드 명령(`pnpm create vite` 등)을 mono 로, 설치 여부는 `.chip sm ok/warn` + Check/AlertTriangle, 로켓→ArrowRight, 스크림→`.scrim`. 시작 화면 "이렇게 동작해요" 는 큰 숫자 카드 3열 → 아이콘·제목·한 문장의 세 줄 목록 + `.btn primary` (죽은 `home-tile*`/`bentoIn` 도 정리). 테스트 계약 문자열 5개는 그대로.

**한 벌로.** primitives.css 에 `.scrim`(어둡게만, blur 없음) · `.seg`(agent.css 에서 전역으로 이동) · `.subnav`(설정 탭 — 강조색 틴트 대신 들어간 면) · `.skel`(세 벌을 접고 시머 대신 호흡) · `.btn:disabled`. 다섯 스크림·툴바·그래프 범례·라이트박스·프로젝트 시트의 blur 제거. App.css `@theme inline` 에서 Tailwind `rounded-md/lg/xl/2xl` · `shadow-sm~2xl` 을 tokens.css 스케일에 묶어 두 시스템의 둥글기·그림자를 한 값으로. 회고 Stat/Card 는 `.stat`/`.card`, 설정 하위 탭은 `.seg`, 그래프 인스펙터 버튼은 `.btn sm`, AI 액션 카드는 `.card` + `.chip sm accent`.

**단색.** 캔버스·그래프 앰비언트 라디얼 제거, primary 버튼·활성 nav·프로젝트 아이콘 광택 제거, 사용량/노력/주간/진행 게이지 단색, 트레이 스캔 빔 → 호흡. 죽은 `.brand-mark` 삭제.

**색 토큰.** Tailwind 팔레트 색 125곳 → `text-(--ok-text)` · `bg-(--warn-soft)` · `border-(--danger)/40` 등 상태 토큰(다크 변형 `dark:text-*` 도 토큰이 흡수). 이모지 라벨 7개 제거.

**게이트.** `scripts/check-design-discipline.mjs` 를 `pnpm lint` 에 추가 — Sparkles · backdrop-filter/blur(예외: mobile.css) · Tailwind 팔레트 색 · 광택/라디얼 그라데이션이 되살아나면 실패. 주석은 건너뛰고 `design-ignore -- 사유` 로 예외.

## 남긴 것

- `#tag` 칩·타입 배지 필은 정보 밀도상 정당해서 유지. ACP 모드 아이콘의 로켓(auto)은 "빨리 읽힌다" 는 의도가 주석에 있어 유지. 모바일 웹뷰 sticky 헤더 blur 는 iOS 네이티브 관용구라 allowlist.
- SourceBadge.tsx · EntryDetailView.tsx 는 병렬 세션의 WIP 와 같은 파일이었다 — 한 줄 아이콘 교체만 얹었고, 그 세션이 c8ebf11 로 커밋한 뒤 남은 차이는 이 한 줄들이다.
- 실기기 육안 확인은 미완(설치본 실행 중 dev 빌드 금지 규율).

## 검증

- `pnpm typecheck` · `pnpm test`(150 파일 1871 테스트) · `pnpm lint`(storage·i18n·bindings·design 4종) · `pnpm build`(critical CSS 8선택자) 전부 exit 0.
- 기존 테스트 2건(claude_hooks_settings · mcp_settings)은 `text-amber-400` 클래스명을 단언하던 것이라 `text-(--warn-text)` 로 기대값을 바꿨다 — 동작 변경이 아니라 색의 출처가 토큰으로 바뀐 것.
- 남은 `Sparkles`/`backdrop-blur`/팔레트 색 0건 (`lint:design` 이 확인).