---
schema_version: 1
type: feature
slug: "ui-density-round-2"
status: done
difficulty: high
created_at: "2026-10-28T05:06:11+09:00"
session_id: "20261028-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/onboarding/home/LeadBand.tsx"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/hooks/useDensity.ts"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/features/terminal/commandBlocks.ts"
    op: update
  - path: "src/features/terminal/TerminalBlockMenu.tsx"
    op: update
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/features/sessions/SessionAside.tsx"
    op: create
  - path: "src/features/chat/conversation/AcpToolbar.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/features/branch/BranchReceipt.tsx"
    op: create
  - path: "src/features/branch/BranchScreenV2.tsx"
    op: update
  - path: "src/features/search/RollupHits.tsx"
    op: create
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/styles/density.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/query.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/branch/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/branch/tests.rs"
    op: update
  - path: "src-tauri/src/commands/summary.rs"
    op: update
  - path: "src-tauri/src/commands/export.rs"
    op: update
  - path: "src-tauri/src/oculpm/rule_promotion.rs"
    op: update
  - path: "src-tauri/src/oculpm/skill_promotion_tests.rs"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
related: []
tags:
  - "ui-density-round"
  - "terminal"
  - "branch"
  - "search"
  - "start-tab"
  - "settings"
  - "mcp-tool"
---
[x] UI 밀도 라운드 2 — 시작 탭 사령탑, 설정 탭 접힘, 일지 부록 접힘, 터미널 결과 끝 줄·세션 열, 에이전트 두 탭, 브랜치 영수증, 검색 요약 우선

## 추가 기능

사용자가 "안 들어간 것도 전부 시안대로 구현해" 라고 했다 — 보류 등급(터미널)의 「결함 수정만」 규칙도 사용자가 풀었다. 1차(PR #105)에 안 들어간 시안을 옮겼다.

- **시작 탭 사령탑 밴드**(`LeadBand`) — 1위 프로젝트에 `plan_get` 의 완료 조건 한 줄과 `promise_scorecard` 의 숫자 셋(증거 · 재수정 7일 · 사용자 몫). API 가 없는 자리(테스트)에선 동기 예외까지 삼키고 「모름」.
- **설정 탭 접힘**(`SettingsPanel`) — 간단 밀도는 모양 · ocul-pm · 데이터, 나머지 7개는 「전문 ▸」 토글 뒤. 열린 탭이 접힌 쪽이면 자동 노출.
- **사이드바** — `NavRow` 의 단축키 힌트는 전문 밀도에만. `DensityShortcut` 이 `<html data-density>` 를 걸고 `density.css` 가 전문의 행 높이를 24급으로.
- **일지 상세** — `EntryFileList` 를 `<details class="entry-files-fold">` 에. 간단은 접힌 채 시작.
- **터미널** — `commandBlocks.verificationLine`(명령 · 결과 끝 줄 · exit N) + 블록 메뉴 「결과 끝 줄을 검증 칸으로 복사」. `TerminalScreenV2` 오른쪽 `SessionAside`(오늘 일지 N · 미기록 파일 — `compare_workday` 와 일지 목록, 간단은 접힘). ShellV2 가 projectId·workday 를 넘긴다.
- **에이전트 두 탭** — `AcpToolbar` 의 화면 이름 자리에 Claude Code ↔ Codex 세그. 프로바이더를 모르는 자리라 `NAV_BUS.setView` 를 쏘고 ShellV2 의 **활성 탭만** 받는다(비활성 탭도 마운트된 채라 안 거르면 탭 수만큼 바뀜). `role=tab` 을 안 쓴다 — 세션 탭 테스트와 역할이 겹친다.
- **브랜치 영수증**(`BranchReceipt`) — 검증된 · 검증 안 된(bug/feature/refactor 중 evidence<2) · 일지에 없는 파일(files − recorded). 영수증 마크다운 복사 · `/oculpm:redteam <branch>` 복사. CI 는 로컬이 모르므로 적지 않는다. 백엔드 `RangeEntry.evidence` → `BranchEntry.evidence`(range_entries SELECT 에 evidence 열). 간단 밀도는 네 패널을 「일지 · 플랜 · 커밋 · 파일」 접힘에.
- **검색 요약 우선**(`RollupHits`) — 일지 범위 결과 위에 질의어 토큰(2자+)을 담은 주간 요약 최대 2장.

## 동작 흐름

간단 밀도로 시작 탭 → 1위 프로젝트의 완료 조건·숫자 → 열면 오늘 세 질문 → 터미널 화면 오른쪽에 오늘 일지·미기록 파일 → 명령 블록에서 결과 끝 줄을 검증 칸으로 복사 → 브랜치 화면의 영수증 한 장 → 검색은 요약부터.

**그대로 둔 시안**: 첫 실행 세 단계 시트(첫 기록·플러그인 카드가 같은 상태 기계), 논의 옵션 카드·스킬 규칙 후보/잠자는 중(이미 있음), 도크 접힘 한 줄(`WorkspaceContext` 래칫 — 새 키를 못 더함).

## 검증

- `pnpm typecheck` exit 0 · `pnpm test` 260 files / 3296 passed · `pnpm lint` 6게이트 clean · `pnpm build` ✓ built
- `cargo fmt` · `cargo clippy --all-targets --locked -- -D warnings` exit 0 · `cargo test --lib` 1846 passed · `export_bindings` 재생성
- 설치본 육안은 `{#eyes-density}` 에 묶는다 — 사용자 몫

## 메모

- `RangeEntry` 에 필드를 더하면 초기화 다섯 곳(query.rs · branch/tests.rs · summary.rs · rule_promotion.rs · skill_promotion_tests.rs)이 전부 붉는다 — `cargo test --no-run` 의 E0063 위치로 찾는다.
- `journal_v2.test.tsx` 는 정확히 800줄이라 한 줄 단언 교체만 허용된다.
- 해요체 게이트(`i18n_glossary`)가 「모릅니다」·「뜹니다」를 잡았다 — 새 문자열은 해요체.