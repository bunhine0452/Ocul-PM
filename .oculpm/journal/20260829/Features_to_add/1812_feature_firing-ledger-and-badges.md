---
schema_version: 1
type: feature
slug: firing-ledger-and-badges
status: done
created_at: 2026-08-29T18:12:00+09:00
session_id: "manual-20260829-181200"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/migrations/030_context_firings.sql
    op: create
  - path: src-tauri/src/oculpm/firing_ledger.rs
    op: create
  - path: src-tauri/src/db/firings.rs
    op: create
  - path: src-tauri/src/commands/firing_ledger.rs
    op: create
  - path: src-tauri/src/db/mod.rs
    op: update
  - path: src-tauri/src/oculpm/mod.rs
    op: update
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/features/skills/firingModel.ts
    op: create
  - path: src/features/skills/FiringBadge.tsx
    op: create
  - path: src/features/skills/useFiringLedger.ts
    op: create
  - path: src/features/skills/SkillsScreenV2.tsx
    op: update
  - path: src/features/skills/RulesTab.tsx
    op: update
  - path: src/features/skills/skills.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/firing_ledger_v2.test.ts
    op: create
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - .oculpm/journal/20260829/Chores/1753_chore_agent-discipline-redesign-plan.md
tags:
  - skills
  - rules
  - firing-ledger
---

[x] 발동 원장(AD-1) + 발동 배지(AD-2) — 규칙·스킬이 실제로 걸리는지 처음으로 보인다

## 추가 기능

재설계 마스터플랜의 전제였던 계측을 착지시켰다. 스킬·규칙 화면이 지금까지
"무엇이 있는가"만 말했다면, 이제 "그게 실제로 걸리는가"를 말한다.

- **AD-1 발동 원장** — Claude Code transcript(JSONL)에서 두 신호를 결정론적으로
  긁는다 (LLM 0 · 네트워크 0): 규칙 조건부 주입(`attachment.type ==
  "nested_memory"` — 주입 본문 바이트와 매칭 glob 포함)과 스킬 발동
  (`tool_use.name == "Skill"` 의 `input.skill`). 커맨드 2종 `firing_rescan` /
  `firing_stats`.
- **AD-2 발동 배지** — 스킬·규칙 목록 행과 상세 헤더에 `30일 N회`(초록) 또는
  `안 걸림`(점선) 배지. 규칙 탭 부제에는 세션당 규칙 주입량(KB)을 얹었다 —
  규칙 화면에서 유일하게 "비용"을 말하는 숫자다.

## 동작 흐름

1. 화면 진입 → `firing_stats(project_id, 30)` 로 창 통계를 먼저 그린다.
2. 뒤에서 `firing_rescan` 이 증분 스캔을 돌린다. transcript 는 append-only 라
   바이트 오프셋만 있으면 재개할 수 있고(claude_hooks 인박스와 같은 규약,
   완전한 `\n` 종료 라인만 소비), 이 저장소 기준 누적 293MB 라 전량 재파싱은
   매번 할 수 없다. 한 호출은 96MB 예산에서 끊고 `complete=false` 로 보고하며,
   훅이 최대 6라운드까지 이어 부른다.
3. 스캔이 끝나면 통계를 다시 읽어 배지를 채운다.

transcript 폴더는 경로 슬러그(`/Users/x/git/ai-pm` → `-Users-x-git-ai-pm`)로
찾되, 하위 디렉터리에서 시작한 세션이 별도 폴더로 갈리므로 접두 일치까지
후보로 잡고 **실제 `cwd` 가 프로젝트 루트 안인지 확인**해 남의 프로젝트를
배제한다 (슬러그는 `/` 와 `-` 가 같은 글자가 되는 손실 변환이라 이름만으로는
못 가른다).

## 검증

- 게이트 5종 전부 exit 0 직접 확인: `cargo test`(851 통과, 신규 9) ·
  `pnpm typecheck` · `pnpm test`(121파일 1437) · `pnpm lint` · `pnpm build`.
- **실기 transcript 로 파서 확인** — 임시 `#[ignore]` 프로브로 실제
  `~/.claude/projects/` 를 스캔해, 폴더 판정(본 폴더 + `-docs-acp-panel-spike`
  채택 / jsonl 없는 `-src-tauri` 배제)과 파싱 결과(53파일에서 규칙 주입 788건 ·
  스킬 6건 · 2.3MB)를 grep 기준선과 대조한 뒤 프로브는 제거했다.
- 원장 실패 내성: `commands.firingStats/firingRescan` 이 없거나 던지는 환경
  (기존 스킬 테스트의 부분 모킹)에서도 화면이 안 깨지도록 훅이 전부 삼키고
  배지만 빠진다 — 실제로 그 회귀가 한 번 났고(unhandled error 14건) 그래서 이
  방어를 넣었다.

## 메모

배지는 "측정 안 됨"과 "0회"를 구분한다. 원장이 한 번도 안 돌았으면 배지를
아예 그리지 않는다 — 스캔 전에 `안 걸림`을 띄우면 멀쩡한 규칙을 거짓 휴면으로
모함하게 된다.

specta 가 u64 노출을 막아 바이트는 u32 로 좁혀 내보낸다. 실측 규모(세션당
~90KB · 창당 수 MB)에서 상한에 닿지 않는다.
