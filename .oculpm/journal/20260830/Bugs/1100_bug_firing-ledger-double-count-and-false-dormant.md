---
schema_version: 1
type: bug
slug: firing-ledger-double-count-and-false-dormant
status: done
created_at: 2026-08-30T11:00:00+09:00
session_id: "manual-20260830-110000"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/db/firings.rs
    op: update
  - path: src-tauri/src/oculpm/firing_ledger.rs
    op: update
  - path: src-tauri/src/commands/firing_ledger.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/db/tests.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/features/skills/useFiringLedger.ts
    op: update
  - path: src/features/skills/RulesTab.tsx
    op: update
  - path: src/features/skills/skills.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related:
  - .oculpm/journal/20260829/Features_to_add/1812_feature_firing-ledger-and-badges.md
tags: [firing-ledger, skills, rules, audit-round]
---

[x] 발동 원장이 동시 스캔·파일 회전에서 이중 집계를 영구화했고, 항상-로드 규칙을 "안 걸림"으로 거짓 표시했다

## 발생 원인

어제 착지한 AD-1/AD-2(발동 원장·배지)를 감사가 리뷰했다.

1. **이중 집계가 영구화된다.** `db/firings.rs` 의 적재는 `count = count + excluded.count` 가산 UPSERT 인데(주석은 "멱등" 이라 주장 — 증분에서만 참), (a) `commands/firing_ledger.rs` 에 직렬화가 없어 규칙 탭·스킬 탭이 각자 `useFiringLedger` 를 마운트하면서 **같은 재개점에서 스캔 둘이 동시에** 돌아 같은 청크를 두 번 더했고, (b) 파일이 줄어(회전) 0 부터 다시 읽을 때 기존 행 위에 다시 가산됐다. 마스터플랜이 명시한 `firing_rebuild` 는 미구현이라 사용자가 되돌릴 길도 없었다.
2. **항상-로드 규칙이 휴면으로 찍힌다.** transcript 의 `nested_memory` 신호는 `paths:` 가 있는 **조건부** 규칙이 걸린 순간만 찍힌다(이 저장소 상위 30 파일 실측: `ecc/common/*` 0건). 그런데 `RulesTab` 은 `paths.length === 0` 행에도 배지를 달아 원장 부재를 "한 번도 안 걸림" 으로 그렸다 — 가장 중요한 규칙이 AD-5 "정리" 카드의 첫 후보가 될 판이었다. 예산 라벨 "세션당 규칙 주입" 도 실제론 조건부 규칙만 세는 값이었다.
3. 파일명이 UUID 라 이름순 스캔은 날짜와 무관 — 첫 스캔이 예산으로 끊기면 30일 창이 마지막에 채워졌고, 그 부분 상태를 화면은 최종처럼 보였다.

## 해결 방법

- `firing_apply_scan` 을 **CAS** 로: 트랜잭션 안에서 읽은 재개점이 스캔이 시작한 값(`ScannedFile.started_at`)과 다르면 아무것도 쓰지 않고 `false`. `reset`(파일 축소) 이면 그 세션 파일의 기존 행을 먼저 지운 뒤 적재. 새 `firing_clear`.
- 프로젝트별 `tokio::sync::Mutex` 로 스캔 직렬화(`scan_lock`) — 둘째 스캔은 첫째가 끝난 뒤 새 재개점을 읽으므로 파일을 두 번 읽지도 않는다. DB CAS 는 마지막 그물.
- 새 커맨드 `firing_rebuild`: 비우고 예산 라운드를 이어 붙여(≤20) 한 번에 다시 센다. 규칙 탭 툴바 「발동 다시 세기」.
- `enumerate_targets` 가 mtime 내림차순 — 최근 세션부터. 훅이 `partial` 을 노출해 마지막 라운드가 끊겼으면 부제에 "부분 계측".
- 배지: `paths` 가 없는 규칙은 목록에서 배지를 안 달고, 상세에선 「매 세션」 칩. 예산 라벨을 "세션당 **조건부** 규칙 주입" 으로 정정하고 툴팁에 항상-로드·CLAUDE.md 는 포함되지 않는다고 적었다.

## 검증

- `firing_apply_scan_is_compare_and_swap`: 첫 적재 1 → 낡은 재개점 재적재는 버려져 1 유지 → 이어 붙이기 3 → reset 적재는 교체라 5 → clear 로 두 표 모두 비움. `cargo test` 867 그린.
- `pnpm typecheck` · `lint` · `test`(1450) · `build` 전부 exit 0. 실기기(규칙 탭에서 다시 세기 → 부제 KB 변화) 는 앱 꺼진 뒤 몰아서.

## 메모

파일 하나를 통째로 메모리에 올리는 `read_to_end`(수십 MB 세션이면 피크 수백 MB) 와 서브에이전트 transcript 미스캔은 감사에서 지적됐으나 이번 범위 밖 — 실측 0건이라 당장 무해.
