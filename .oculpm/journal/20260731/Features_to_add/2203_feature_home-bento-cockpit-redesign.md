---
schema_version: 1
type: feature
slug: "home-bento-cockpit-redesign"
status: done
difficulty: superhigh
created_at: "2026-07-31T22:03:34+09:00"
session_id: "mcp-20260731-220334"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/onboarding/StartScreen.tsx"
    op: update
  - path: "src/features/onboarding/home.css"
    op: create
  - path: "src/features/onboarding/home/homeModel.ts"
    op: create
  - path: "src/features/onboarding/home/homeMatch.ts"
    op: create
  - path: "src/features/onboarding/home/useHomeBrief.ts"
    op: create
  - path: "src/features/onboarding/home/useHomeCursor.ts"
    op: create
  - path: "src/features/onboarding/home/atoms.tsx"
    op: create
  - path: "src/features/onboarding/home/rows.tsx"
    op: create
  - path: "src/features/onboarding/home/tiles.tsx"
    op: create
  - path: "src/features/onboarding/home/chrome.tsx"
    op: create
  - path: "src-tauri/src/home.rs"
    op: create
  - path: "src-tauri/src/commands/home.rs"
    op: create
  - path: "src-tauri/tests/home_brief.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src/App.tsx"
    op: update
  - path: "src/App.css"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/__tests__/start_screen.test.tsx"
    op: update
  - path: "src/__tests__/home_model.test.ts"
    op: create
  - path: "src/__tests__/home_match.test.ts"
    op: create
related: []
tags:
  - "startscreen"
  - "home"
  - "design"
  - "a11y"
  - "keyboard"
  - "tokens"
  - "home_brief"
  - "mcp-tool"
---
[x] 메인 화면 벤토 콕핏 재구성 — 토큰 전역화 + home_brief 1콜 + 키보드 우선 레일

## 추가 기능

프로젝트 선택 화면(StartScreen)을 "프로젝트 선택기"에서 **작업 재개 콕핏**으로 재구성했다. 답해야 할 질문을 하나로 좁혔다 — "어디서 이어서 일하지?"

4밴드 구성: 상단 레일(워드마크·데이트라인·설정·추가) → 검색 전용 밴드 → 벤토(사령탑 7열 · 오늘의 흐름 5열 · 판 2개) → 레일(모든 프로젝트 / 색인 / 초안 / 명령) → 액션 바. 검색어가 있으면 벤토가 빠지고 레일이 점수순 단일 목록이 된다.

3개 방향(에디토리얼 / 커맨드 런처 / 벤토 콕핏)을 각각 끝까지 설계한 뒤 3개 렌즈(고급감 · 구현리스크 · UX/a11y)로 심사해 벤토 콕핏을 골랐고, 런처 안의 키보드·검색 모델을 접붙였다.

## 동작 흐름

**PR-0 토큰 전역화 (버그 수정)** — 디자인 토큰이 `styles/index.css` 를 통해 ShellV2(lazy 청크)에서만 로드돼, 메인 화면이 콜드 스타트에서는 `--accent` 없이 emerald 폴백으로, 프로젝트를 열었다 돌아오면 사용자가 고른 액센트로 렌더됐다. 같은 화면이 세션 이력에 따라 두 얼굴. `App.css` 로 승격해 해소했다. 부수 효과로 트리거 색·그림자 4단·모션 토큰이 이 화면에서 살아나 `TYPE_TONE` 하드코딩 5색(셸과 초록이 어긋나 있던)을 제거했다.

**PR-1 `home_brief`** — 기존 cockpit 집계는 프로젝트마다 `listJournalEntries` 로 평생 이력 전량을 실어와 10건만 썼다. 프로젝트 수와 무관하게 **IPC 1회 · SQL 6문** 고정으로 교체. 매니저를 참조하지 않아(락 미접촉을 타입 시그니처로 강제) 워처·에이전트와 경합하지 않는다.

**PR-2 화면** — `homeModel`(랭킹·티어·스파크·포매팅) / `homeMatch`(초성 포함 매칭) 순수 모듈 + `useHomeBrief`(폴백 계약) + `useHomeCursor`(실제 포커스 이동, `aria-activedescendant` 미사용) 위에 조립.

같이 고친 기존 결함: `⌘,` 가 대시보드에서 무반응이면서 힌트는 표시하던 거짓 UI(언마운트된 셸 상태만 오염시키고 있었다), `⌘P` 수신자 부재, 대시보드에서 사실상 비어 있던 `⌘K` 팔레트, hover 에서만 나타나 키보드·터치에는 존재하지 않던 이름변경/제거, 확인 없이 즉시 삭제되던 초안, 그 아래 클릭을 삼키던 34px 드래그 데드존, "460 파일 · 7654 청크" 라는 사용자 가치 없는 지표.

## 사양의 전제를 뒤집은 것

`workday` 단독 인덱스 마이그레이션은 **철회**했다. 20,000행 + `ANALYZE` 로 실측하니 SQLite 가 기존 복합 인덱스를 커버링 skip-scan 으로 쓰고 있어, 단독 인덱스는 존재해도 선택되지 않고 쓰기 비용만 늘린다. 테스트를 "커버링 유지 + 임시 B-트리 없음"이라는 실제 성질로 바꿔 고정했다.

## 적대 검증에서 확정·수정한 결함

4개 렌즈 리뷰 34건 중 실제 결함으로 확정한 것:

- **커서 평면에 벤토 타일이 섞여 있었다** — `flat[0]` 이 커서에 등록되지 않은 사령탑을 가리켜 레일의 탭 스톱이 0개가 되고 ↓/↑/Home 이 전부 죽었다. `flat` 을 레일 행만으로 좁히고 ⏎ 대상은 `primary` 로 분리.
- **`home_brief` 가 `projects` 와 조인하지 않았다** — 일지 캐시는 FK 가 없어 제거된 프로젝트의 행이 남는다. 오늘 건수 이중 계상 + 열 수 없는 유령 피드 행. 6개 쿼리 전부 조인.
- **아이콘 버튼 44px 히트영역이 14px 겹쳤다** — 겹친 구간은 나중에 그려지는 '제거'가 이겨서, 이름 변경 버튼 오른쪽 6px 를 누르면 삭제 확인창이 떴다. gap 8px + 히트 36px 로 분리.
- **한글 IME 조합 중 Enter 가 프로젝트를 열었다** — 조합 확정이 실행으로 새던 문제.
- **Tab 순서에 파괴적 액션만 남았다** — 로빙 tabindex 가 '열기'에만 걸려, 레일을 Tab 으로 훑으면 프로젝트는 못 열고 삭제 버튼만 지나갔다.
- **화면 전용 CSS 가 Tailwind `@layer utilities` 를 항상 이겼다** — 컴포넌트 import 라 unlayered. 키캡 클래스에 얹은 `px-2`/`hover:text-*` 가 전부 죽어 있었다. 칩 전용 클래스로 완결.
- 전역 키가 모달 위에서도 무장 상태, `⌘E`/`⌘⌫` 가 마우스가 스쳐간 행을 대상으로 발동, 신호등 패딩이 중앙정렬 컨테이너 안에 있어 밴드 0/1 정렬선이 어긋남, `next_tasks` 와 진행률이 서로 다른 플랜을 가리킴, 부모·취소 항목이 진행률 모수에 포함, 오늘의 흐름 타일이 집계 실패를 "기록 없어요"로 단정.

## 검증

`pnpm typecheck` / `test`(411, 이전 348) / `lint` / `build` 와 `cargo test`(497 + 통합 스위트, `home_brief` 14건) 전부 exit 0 을 커밋 전 직접 확인.

시각 확인은 못 했다 — 접근성 권한이 없어 앱 창만 캡처할 수 없었고 전체 화면 캡처는 하지 않았다. 사용자 피드백으로 설정창 좌우 여백 누락(`embedded` 는 호스트가 여백을 준다는 전제인데 대시보드 모달만 패딩 없이 감싸고 있었다)을 잡아 수정했다.