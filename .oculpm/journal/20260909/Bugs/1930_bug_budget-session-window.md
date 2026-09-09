---
schema_version: 1
type: bug
slug: "budget-session-window"
status: done
difficulty: medium
created_at: "2026-09-09T19:30:32+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/transcript_sessions.rs"
    op: create
  - path: "src-tauri/src/oculpm/firing_ledger.rs"
    op: update
  - path: "src-tauri/src/commands/firing_ledger.rs"
    op: update
  - path: "src-tauri/src/db/firings.rs"
    op: update
  - path: "src-tauri/src/db/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/agent_surface.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src/features/skills/contextModel.ts"
    op: update
  - path: "src/features/skills/ContextBudgetBar.tsx"
    op: update
  - path: "src/features/skills/ContextLiveList.tsx"
    op: update
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/__tests__/agent_context_model.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "context-budget"
  - "firing-ledger"
  - "agent-surface"
  - "file-size-ratchet"
  - "mcp-tool"
---
[x] 세션당 컨텍스트 예산이 이미 지운 규칙을 30일간 청구했다

사용자가 "이 프로젝트 세션당 컨텍스트가 왜 이리 길어?"(95KB / 목표 30KB)라고 물어 원장 DB 를 직접 캐면서 드러났다.

## 발생 원인

`firing_stats` 의 `bytes_per_session` 은 **날짜 창(30일)의 규칙 바이트 ÷ 날짜 창의 세션 수** 였다. 결함이 둘이고 방향이 같아(둘 다 과대) 겹쳐 있었다.

**① 창이 설정 변경을 가로지른다.** 실측: 창(20260811~0909)의 규칙 주입 6,244,682B ÷ 76세션 = 80.2KB. 그런데 그 6.2MB 중 **99.99% 가 `~/.claude/rules/ecc/**`** 였고, ECC 는 2026-09-03 에 전역 제거돼 `~/.claude/rules` 디렉터리 자체가 없다. 창 전체에서 **살아 있는 규칙의 주입은 `.claude/CLAUDE.md` 752B 한 번**뿐. 일자별로 20260903 에서 칼같이 끊기고 이후 6일간 행이 없다.

**② 조용한 세션이 분모에서 빠진다.** `context_firings` 는 발동이 **있어야** 행이 생긴다. 09-04 이후 이 프로젝트 transcript 는 98개인데 원장에 잡힌 세션은 3개 — 규칙이 하나도 안 걸린 95세션이 분모에 못 들어갔다.

「무관(실측) 0KB」도 같은 뿌리다. 범위 교정 카드는 디스크의 규칙 파일을 훑어 귀속하는데 ECC 파일이 없으니 80KB 를 누구 몫이라 말하지 못했다 — "80KB 쓰는데 범인은 없음" 화면.

## 해결 방법

**창을 날짜에서 「최근 N 세션」으로 바꾼다** (`BUDGET_SESSION_WINDOW = 20`). 분자는 그 세션들의 규칙 바이트, 분모는 **디스크의 transcript 를 센 수**라 ② 가 구조적으로 사라진다.

세션 창을 고른 이유: 삭제·`paths` 좁히기·추가를 **한 장치로** 처리한다. 대안으로 검토한 「디스크 존재 여부로 거르기」는 삭제만 잡고 좁히기를 놓치는데, 좁히기야말로 이 화면이 미는 주 처방이라 틀린 절반을 고치는 셈이다. 「마지막 규칙 변동 시각으로 창 자르기」는 즉시 정확하지만 `CLAUDE.md` 를 고칠 때마다 창이 오늘로 붕괴해 막대가 비고, 삭제 감지를 디렉터리 mtime 에 기대야 해 오발동한다. 활동일 기준 약 10세션/일이라 20 은 대략 이틀이면 옛 구성이 씻겨 나간다.

곁들여 둘:

- **`AGENTS.md` 7,550B 가 예산에서 통째로 빠져 있었다** — 항상-로드의 약 3분의 1. 편집 가능한 규칙 슬롯으로 올릴 수는 없다(`validate_rel` 이 저장·삭제를 의도적으로 거부하고 마스터는 `.oculpm/agents/_template.md`). `agent_surface` 에 `always_on` 갈래와 `SurfaceKind::Memory` 를 더해 **본문 전체**를 항상-로드 조각에 세우고, 목록 행은 「관리됨」 칩과 함께 편집기를 열지 않는다. 이 모듈은 애초에 같은 종류의 누락(에이전트·커맨드 30KB)을 메우려고 만든 자리다.
- **눈금 재기준** — `BUDGET_BASELINE_BYTES = 90KB` 는 ECC 가 깔려 있던 때의 값이라, 창을 고치면 막대가 "6배 줄였다"로 읽힌다. 그 진척은 이번 주에 번 것이 아니다. 목표의 2배(`BUDGET_SCALE_BYTES`)로 바꿔 목표 눈금이 한가운데 서게 했다.
- `sessionsConsidered === 0` 이면 `measured=false` — 스캔이 돌았다는 사실만으로 "실측 0KB" 라 말하면 거짓이다.

## 파일 크기 래칫이 설계를 한 번 되돌렸다

첫 구현은 `RuleEntry.readonly` + 읽기 전용 슬롯을 `rules.rs` 에 넣는 방식이었는데, 그 파일이 1264줄(한계 1.5배)이라 래칫이 **어떤** 증가도 막았다. 우회하지 않고 되돌린 결과가 위의 `agent_surface` 안이고, 편집 경로(`validate_rel`)를 건드리지 않아 더 안전하다 — 게이트가 더 나은 자리를 찾게 했다.

`firing_ledger.rs` 도 868줄로 넘쳐 **`transcript_sessions.rs` 를 분리**했다. 명분은 실재한다: 세션 목록의 소비자가 둘이 됐다(증분 스캔은 전부를 최근순으로, 예산은 최근 N 건만). 649 + 234 줄. 정렬 중 같은 파일을 여러 번 stat 하던 비교자도 파일당 1회로 접혔다.

## 검증

`cargo test` 1,587 통과(신규 4: 최근순·상한, 조용한 세션 포함, 세션 집합 분자 격리, `always_on` 본문 계수·부재 시 무행), `pnpm test` 2,471 통과(191 파일), `typecheck`·`lint` 6게이트·`build` 각각 exit 0 직접 확인. 병렬 세션이 도는 워킹트리라 `refs/backup/context-budget-window-20260909` 로 스냅샷.