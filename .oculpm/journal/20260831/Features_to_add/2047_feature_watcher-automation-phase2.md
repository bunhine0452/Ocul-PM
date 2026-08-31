---
schema_version: 1
type: feature
slug: watcher-automation-phase2
status: done
created_at: 2026-08-31T20:47:00+09:00
session_id: manual-20260831-204700
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
difficulty: high
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/automation/tiers.rs
    op: create
  - path: src-tauri/src/oculpm/automation/settle.rs
    op: create
  - path: src-tauri/src/oculpm/automation/draft_claim.rs
    op: create
  - path: src-tauri/src/oculpm/automation/watchers.rs
    op: create
  - path: src-tauri/src/oculpm/automation/mod.rs
    op: update
  - path: src-tauri/src/oculpm/automation/runner.rs
    op: update
  - path: src-tauri/src/oculpm/automation/scheduler.rs
    op: update
  - path: src-tauri/src/oculpm/automation/store.rs
    op: update
  - path: src-tauri/src/oculpm/automation/seeds.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src-tauri/src/oculpm/journal_draft.rs
    op: update
  - path: src-tauri/src/oculpm/reconcile.rs
    op: update
  - path: src-tauri/src/oculpm/session_id.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/config.rs
    op: update
  - path: src-tauri/src/oculpm/session.rs
    op: update
  - path: src-tauri/src/commands/automation.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/features/settings/automation/automationModel.ts
    op: update
  - path: src/features/settings/automation/AutomationEditor.tsx
    op: update
  - path: src/features/settings/automation/AutomationTab.tsx
    op: update
  - path: src/features/settings/automation/AutomationTroubleshooting.tsx
    op: create
  - path: src/features/settings/tabs/DiagnosticsTab.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/automation_tab.test.tsx
    op: update
related:
  - .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md
  - .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md
tags: [automation, osaurus-bench, phase2, watchers, settle-then-act]
---

[x] Osaurus 라운드 Phase 2 — 손이 멎으면 기록한다 (반응성 티어 · 감시 자동화)

## 추가 기능

Phase 1 이 **시계에 반응하는 축**을 얹었다면 Phase 2 는 **현실에 반응하는 축**이다.
8항목 전부 구현했다.

**반응성 티어 6단**(`tiers.rs`) — fast 200ms · balanced 1s · patient 3s ·
relaxed 60s · deferred 5m · extended 10m. 디바운스 숫자를 이름 있는 정책으로
승격했다. `watcher.debounce_ms` 는 **하위호환으로 그대로 산다** — `responsiveness`
가 없을 때만 숫자를 쓴다(커스텀 값을 쓰던 `config.toml` 을 깨지 않는다).

**settle-then-act 타이머**(`settle.rs`) — 트리거는 "변경이 있었다" 가 아니라
**"변경이 멎었다"** 이다. 이것이 자동 일지가 오래 보류돼 있던 락 문제를 우회하는
열쇠다: 에이전트가 활발히 쓰는 동안에는 아무것도 하지 않고, 손이 멎은 뒤에만
락을 잡는다.

**워처 자동화 런타임**(`watchers.rs`) — 정착하면 잡을 만들어 **Phase 1 과 같은
문**(`scheduler::run_job`)을 통과시킨다. 예산·동시 1건·취소·원장 규약이 경로마다
갈라지면 안 된다.

**정착 트리거 일지 초안** — 훅 `AgentExit` 외 **두 번째 경로**. 훅은 Claude Code
를 통해 일한 것만 본다; 터미널에서 직접 편집하거나 다른 도구로 작업하면 아무것도
안 남았다. 그 구멍을 메운다.

**`auto_reconcile` 흡수** — 플랜 화해가 이제 러너를 통과한다. 편집 로직 자체
(CAS·`plan_write_lock`)는 `reconcile.rs` 가 그대로 소유한다.

## 동작 흐름

**긴 디바운스를 OS 워처에 걸지 않는다.** relaxed(60s) 이상을 notify 디바운서
창으로 주면 OS 워처가 이벤트를 들고 있어 메모리·유실 위험이다. 그래서 둘로 나눴다:

```
notify(≤ balanced 창, tiers::os_debounce_ms 가 자른다)
  → 이벤트 수집 → "마지막 이벤트 + 티어 지연" 타이머 리셋
  → 만료 = 정착 → [중복 가드] → scheduler::run_job
```

드라이버는 폴링 주기가 아니라 **마감 시각**까지 잔다(`Notify` + `next_deadline`).
그래서 200ms 티어도 10분 티어도 같은 루프 하나가 감당한다.

**증폭 루프 가드는 판정이 둘로 갈린다.** `watcher.rs` 는 일지·플래너·정의·색인
변경을 **계속 emit** 한다(화면이 갱신돼야 하니까). 그러나 자동화 트리거 판정에서는
`settle::is_excluded_cause` 가 그 넷을 **원인에서 제외**한다. 자동화가 쓴 일지가
자동화를 다시 부르는 고리가 여기서 끊긴다. 그물은 셋이다 — 원인 제외 · 최소
간격(티어 지연 ×2) · 일일 예산.

**플랜 화해는 정착이 아니라 일지 삽입 신호로 깨어난다.** 정착 채널이 일지를 원인에서
제외하므로, 화해를 그 채널에 두면 영영 안 돈다. 대신 새 일지가 색인되는 자리에서
`output: plan` 잡을 넣는다. 켜졌는지는 **그때의 config** 가 판정한다 — 켜진 `plan`
워처 정의가 있으면 그것, 없으면 레거시 `agents.auto_reconcile` 플래그. 후자에는
최소 간격을 걸지 않는다: **기존 사용자의 동작을 바꾸지 않기 위해서**다(Phase 0 의
"조용한 정지 금지" 와 같은 결). 정의 파일로 옮기면 그 티어의 간격이 붙는다.

내장 규칙의 id 는 씨앗과 같은 `plan-reconcile` 이고, 고아 정리가 그 id 를 면제한다
(`store::known_ids_for_prune`). 씨앗을 만드는 순간 그동안의 실행 이력이 끊기지 않고
이어진다.

**초안 이중 생성 금지.** 훅과 정착은 같은 작업 구간에 둘 다 걸릴 수 있다. 순차로
도착하면 mtime 판정(`self_entry_exists` — 자필이든 `auto:*` 초안이든 다 본다)이
나중 쪽을 비키게 하지만, **동시에** 통과하면 둘 다 쓴다. 그래서 두 경로가
`(project_id, 구간 시작~끝)` 을 나눠 갖는다(`draft_claim.rs`). 먼저 잡은 쪽만 쓰고,
진 쪽은 누가 이겼는지가 적힌 사유를 들고 물러난다. 사유 문구는 한 곳
(`claim_skip_reason`)에만 있다 — 두 경로가 다른 말로 적으면 History 를 읽을 수 없다.

정착 쪽이 지면 그 스킵은 **run 으로 남는다**(`scheduler::record_skip` — 러너와 같은
문). 훅 쪽이 지면 `DraftOutcome::Skipped` + `[FLOW]` 로그로 남는다: 훅에는
automation_id 가 없어 원장 행의 주인이 없다. 못 쓰고 물러날 때는 청구를 되돌린다
(실패 한 번이 그 구간을 영영 막지 않게).

**씨앗 2종을 더했다** — 「일지 초안 (손이 멎으면)」(루트·deferred·journal) ·
「플랜 화해」(`.oculpm/journal/`·relaxed·plan). 둘 다 꺼진 채로 생긴다.

**`.oculpm/automation/**` 이 이제 데이터 영역이다.** 예전에는 정의 파일이 코드 변경
ndjson 파이프라인으로 흘러 들어갔다. 이제 `OculpmDataArea::Automation` 으로 신호만
내고(자동화 탭이 다시 읽는다) 규칙 캐시를 무효화한다 — 그리고 **원인에서는 제외**된다.

## 검증

- `pnpm typecheck` · `pnpm test`(129파일 1558) · `pnpm lint`(storage·i18n·bindings)
  · `pnpm build` · `cargo test`(981) · `cargo clippy --all-targets -- -D warnings`
  · `cargo fmt --check` **전부 exit 0 을 직접 확인**.
- 설계 §3 의 Phase 2 테스트 3종:
  - **티어 정착** — 0s·1s·2s 에 이벤트를 주입하고 3s(첫 이벤트 기준 만료)·4.999s 에
    0건, 마지막 이벤트+지연인 5s 에 정확히 1건. 창을 꺼내면 사라져 두 번 돌지 않는다.
  - **증폭 루프** — 정착으로 1건 발동 → 그 발동이 일지·색인·플래너·정의를 쓰는
    시나리오 → 창이 하나도 열리지 않고 **재발동 0건**. 대조군으로 `src/lib.rs` 는
    창을 연다. 허브 수준(`hub_ignores_our_own_outputs_as_a_cause`)에서도 같은 단언.
  - **초안 중복 방지** — 두 경로가 겹치는 구간을 청구하면 먼저 온 쪽만 성공하고,
    진 쪽의 사유가 이긴 경로를 지목한다. 순서를 뒤집어도 같다.
- 그 밖에 Rust: 티어 표 못박기 · 긴 티어가 OS 디바운서에 닿지 않음 · 숫자 하위호환 ·
  최소 간격(연속 스로틀은 원장에 **한 번만**) · watch 범위(`src2` 가 `src` 로 안 걸림,
  비재귀는 직속 자식만) · 사라진 정의의 창 폐기 · 경로 상한 초과 시 센 값은 남김 ·
  자동화가 쓴 일지는 화해를 안 깨움 · 플랜 잡의 원인 일지 없음/캐시 없음 사유 ·
  화해 요약이 "적용 0건" 과 "실패" 를 구분 · 인플라이트 플래그가 패닉에도 되돌아옴 ·
  러너 전(前) 스킵이 원장에 사유와 함께 남고 세션 id 가 `auto-` 접두.
- 프런트 7건 추가: 워처 카드가 빈도가 아니라 감시 범위·티어를 말함 · 종류 전환이
  반대편 축을 비움 · 영원히 안 도는 감시 경로 차단 · 두 전역 스위치와 문제 해결
  3종 · 워처/스케줄 입력칸 분리 · 티어 6개 선택지 · 종류 전환이 화면을 바꿈.
- 비동기 대기 예산은 CI 러너 기준 5s 를 넘지 않는다 — 정착 테스트는 **시각 주입**
  이라 실시간을 기다리지 않는다(10분 티어를 실제로 기다릴 수는 없다).

## 메모

**최소 간격을 레거시 `auto_reconcile` 경로에는 걸지 않았다.** 설계 §2.4 는 "같은
자동화는 최소 간격 안에 재발동하지 않음" 이라고 쓰지만, 그대로 적용하면 일지를
연달아 쓰는 세션에서 두 번째 화해가 사라진다 — 기존 사용자에겐 **잘 되던 게 멈추는**
변화다. 그래서 정의 파일 기반 규칙에만 걸고, 레거시 플래그 경로는 동작 변화 0 으로
두었다. 대신 그 경로에도 프로젝트당 인플라이트 1건(옛 `reconcile_lock` 과 같은 판단,
git 백필이 수백 건을 쏟아도 원장이 드롭 행으로 뒤덮이지 않게)은 그대로 있다.

**중복 키 등록소는 테이블이 아니라 메모리다.** 두 경로가 같은 프로세스 안에 있고,
Phase 2 는 새 마이그레이션을 예약하지 않았으며(R6 — 033/034/035 만 예약), 청구는
한 구간이 살아 있는 동안에만 의미가 있다. 재시작 뒤에는 디스크의 일지가 그 사실을
이미 말해 준다. TTL 6시간으로 자라지 않게 했다.

정착 창의 `watch` 는 fs 접근이 아니라 **접두 비교**에만 쓰이므로 경로 탈출 위험이
없다. 다만 `..`·절대 경로는 어떤 상대 경로와도 만나지 않아 조용히 안 도는 자동화가
되므로, 저장 시점에 프런트·백엔드 양쪽이 막는다.

문제 해결 3종(안 돈다·너무 자주 돈다·결과가 이상하다)은 에디터와 진단 탭이 **같은
컴포넌트**를 렌더한다. 세 번째가 발동 원장을 자동화 디버깅의 정식 경로로 가리키는데,
그 화면 자체의 확장은 Phase 3 `#firing-insights` 의 몫이다.

Phase 2 는 v2.27.0 으로 나간다 (마스터 플랜 §4). 릴리스는 5면 절차.
