---
schema_version: 1
type: feature
slug: provenance-phase3
status: done
difficulty: high
created_at: 2026-09-01T11:13:00+09:00
session_id: manual-20260901-111300
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/features/oculpm/entrySource.ts
    op: create
  - path: src/features/oculpm/SourceBadge.tsx
    op: create
  - path: src/features/settings/tabs/FiringInsights.tsx
    op: create
  - path: src/features/oculpm/JournalCardV2.tsx
    op: update
  - path: src/features/oculpm/JournalScreenV2.tsx
    op: update
  - path: src/features/oculpm/EntryDetailView.tsx
    op: update
  - path: src/features/today/MiniEntry.tsx
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/features/chat/acpBusyBus.ts
    op: update
  - path: src/features/chat/acpHistory.ts
    op: update
  - path: src/features/chat/AcpConversation.tsx
    op: update
  - path: src/features/chat/conversation/SessionPanel.tsx
    op: update
  - path: src/features/settings/automation/AutomationTab.tsx
    op: update
  - path: src/features/settings/tabs/DoctorSection.tsx
    op: update
  - path: src/features/settings/tabs/DiagnosticsTab.tsx
    op: update
  - path: src/features/skills/firingModel.ts
    op: update
  - path: src/features/skills/useFiringLedger.ts
    op: update
  - path: src/api/automation.ts
    op: update
  - path: src-tauri/src/commands/automation.rs
    op: update
  - path: src-tauri/src/oculpm/automation/runner.rs
    op: update
  - path: src-tauri/src/oculpm/automation/scheduler.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/styles/agent.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related:
  - 20260831/Features_to_add/2047_feature_watcher-automation-phase2.md
  - 20260831/Features_to_add/1927_feature_schedule-automation-phase1.md
  - 20260831/Features_to_add/1853_feature_automation-foundation-phase0.md
tags:
  - osaurus-bench
  - phase3
  - provenance
  - automation
---

[x] 누가 시켰는지 보인다 — 출처 배지 · 활성 행 · 발동 원장 (Phase 3)

## 추가 기능

Phase 1·2 가 스케줄과 감시라는 **새 발동원 둘**을 만들었다. 그런데 화면은
그것을 구분하지 못했다 — 내가 쓴 일지와 기계가 쓴 일지가 같은 카드였다.
자동화를 켠 순간 이 구멍은 편의가 아니라 결함이 된다.

- **출처 파생** `sourceOf(sessionId, agentId)` — 직접·에이전트·자동 초안·
  스케줄·감시·MCP·백필·들여옴 8종. 새 필드를 만들지 않는다: `session_id`
  접두와 `agent.id` 는 이미 디스크에 적힌 사실이고, 러너도 "출처는 접두가
  가른다" 는 규약으로 쓰고 있었다.
- **출처 배지** — 일지 카드 · 일지 상세 · 오늘 활동 피드 · 회고 에이전트 행.
  `.chip` 프리미티브를 그대로 쓴다 (새 도형을 만들지 않는다).
- **출처 필터 레일** — 일지 화면. 목록에 출처가 1종이면 **그리지 않는다**.
- **활성 행** — ACP 세션 목록이 `실행 중…` / `입력을 기다립니다` 를 말하고,
  활성 대화가 맨 위 버킷으로 온다.
- **인라인 Stop** — 열지 않고 그 자리에서 중단. 자동화 카드에도 같은 컨트롤.
- **닥터 자동화 5행** — 배경 모델(미설정이면 딥링크) · 스케줄 · 감시 · 오늘
  예산 · 최근 실패. 고장난 정의가 있으면 한 줄이 더 붙는다.
- **진단 「발동」** — 최근 7일 상위 발동 + **한 번도 안 걸린 규칙**.

## 동작 흐름

**출처 판정의 순서가 곧 규약이다.** 세션 접두를 먼저 보고 `agent.id` 를 나중에
본다. 자동화가 쓴 일지의 `agent.id` 는 `auto:<provider>` 라서, agent 를 먼저
읽으면 스케줄도 감시도 전부 "자동 초안" 으로 뭉개진다 — 배지가 존재할 이유가
사라진다. 접두 판정의 엄격도는 백엔드 `SessionId::kind()` 와 같게 맞췄다
(접두 + `YYYYMMDD-`): 느슨하면 손으로 적은 `auto-tune` 이 감시 자동화로 둔갑한다.

**레일의 표본은 출처 필터를 걸기 전 목록이다.** 걸린 뒤로 세면 하나를 고르는
순간 출처가 1종이 되어 레일이 스스로 사라지고, 되돌릴 길이 없어진다.

**활성 정렬은 원장을 건드리지 않는다.** `updated_at` 을 올려 정렬을 얻는 길도
있지만 그러면 답이 끝난 순간 그 대화가 "방금 이야기한 것" 으로 영구히 기록된다 —
`stabilizeHistory` 가 지키려던 의미의 정반대다. 활성은 정렬 키 **앞에 붙는
별도 버킷**이고 버킷 안의 순서는 원장 그대로다(안정 분할).

**실행 중 표시는 이벤트 + 최초 1회 조회다.** 새 이벤트
`AutomationRunChanged` 를 `scheduler::run_job`(모든 자동화가 지나는 단 하나의
문)에서 시작·종료로 쏜다. 다만 이벤트만으로는 **이미 돌고 있던** 잡을 놓치므로,
러너에 `running()` 을 달고 새 커맨드 `automation_overview` 가 마운트 시점에
직접 묻는다. 러너는 프로세스 전역 1건이라 `project_id` 를 함께 실어, 남의
프로젝트 잡을 이 화면이 자기 것처럼 표시하지 않게 했다.

`running()` 의 해제는 RAII 가드다 — `run()` 은 슬롯을 잡은 뒤에도 이른 반환이
넷(Core Model 미설정·키 없음·예산·취소)이라, 손으로 지우면 언젠가 한 갈래를
빠뜨려 "영원히 실행 중" 이 남는다.

**예산은 백엔드에서 한 번만 센다.** 프런트가 `automation_runs` 를 접어 만들
수도 있지만 예산 창의 시작(자정이 아니라 `day_starts_at`)이 러너와 한 글자라도
달라지면 화면은 "12/20" 이라 말하는데 실제로는 소진된 상태가 생긴다.
`automation_overview` 가 러너와 **같은 `workday_start`** 를 쓴다.

**발동 원장을 디버깅 정식 경로로.** `firing_ledger.rs` 는 transcript 에서
규칙 주입·스킬 발동을 결정론적으로 관측한다(LLM 0 · 네트워크 0). 지금까지 그
값은 스킬 화면 배지로만 쓰였다. 진단 탭의 「발동」 섹션이 두 목록을 낸다 —
많이 걸린 것, 그리고 **한 번도 안 걸린 규칙**. 아래쪽이 진짜 값이다: 써 놓고
안 걸리는 규칙은 눈으로 절대 안 보이는 실패다. 아직 안 재 본 원장으로 "안
걸렸다" 를 말하지 않고(`measured` 게이트), 예산으로 끊긴 스캔은 "최종이 아니다"
라고 밝힌다. 경로 조건(`paths`)이 붙은 규칙은 안 걸리는 게 정상일 수 있으므로
그 사실을 함께 보여 준다 — 안 그러면 멀쩡한 규칙을 지우게 된다.

## 검증

`pnpm typecheck` · `pnpm test`(131 파일 1599건) · `pnpm lint`(storage/i18n/
bindings 3게이트) · `pnpm build` · `cargo test` · `cargo clippy --all-targets
-- -D warnings` · `cargo fmt --check` 전부 exit 0.

새 테스트: `entry_source.test.ts`(8종 판정 + 접두 엄격도 경계 + 레일 자동
숨김) · `provenance_rows.test.tsx`(레일 렌더/배타 선택 · 활성 버킷 안정 분할 ·
세션 줄 상태 · 인라인 Stop 1회 · 일지 카드 배지 · vitest-axe). 기존 파일 확장:
`firing_ledger_v2.test.ts`(안 걸린 규칙 · 미존재 슬롯 제외 · topFirings 안정
정렬) · `automation_tab.test.tsx`(마운트 시 실행 중 포착 · 남의 프로젝트 무시 ·
이벤트 on/off · Stop→cancel). Rust: `count_definitions` 2건(꺼진 정의의 더 이른
시각이 "다음 실행" 을 훔치지 않는다 · 깨진 정의는 활성이 아니라 broken).

## 메모

설계 문서가 배지를 걸라고 지목한 다섯 자리 중 **둘은 의도적으로 비웠다**.

- **검색 결과** — 검색 화면은 코드 검색(청크·심볼·정확)이라 일지 행이 없다.
  일지의 화면 내 검색 결과는 그대로 일지 카드이고 이미 배지를 단다.
- **ACP 세션 목록의 배지·레일** — ACP 대화는 전부 한 출처(앱에서 사람이 연
  것)다. 모든 줄이 같은 말을 하는 배지는 라벨이 아니라 소음이고, 레일은 이
  라운드가 정한 자기 규칙("출처 1종이면 그리지 않는다")에 의해 어차피 안
  그려진다. 대신 그 자리에는 §3 의 상태(실행 중/입력 대기)와 Stop 을 넣었다.

**우클릭 메뉴도 넣지 않았다.** 설계는 인라인 Stop 을 "hover 버튼 + 우클릭 메뉴
양쪽" 으로 적었지만, 세션 줄은 이미 보이는 액션 묶음(이름 바꾸기·삭제)을
갖고 있어 같은 동작으로 가는 숨은 두 번째 길은 표면만 늘린다. 저장소에 공용
컨텍스트 메뉴 프리미티브도 없다(TabStrip·CodeTree 가 각자 손으로 만들었다).

`relativeTime` 은 과거 전용이다(`Math.max(0, now - ms)`) — 닥터의 "다음 실행"
에 쓰면 어떤 미래 시각도 "지금" 으로 접힌다. 자동화 카드와 같은 절대 시각
포맷(`formatAt`)을 쓴다.
