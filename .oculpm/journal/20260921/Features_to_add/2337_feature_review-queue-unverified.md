---
schema_version: 1
type: feature
slug: "review-queue-unverified"
status: done
difficulty: medium
created_at: "2026-09-21T23:37:26+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Sonnet 5 (구현 세션 V)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/review.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/unverified_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/tests_bulk_verify.rs"
    op: create
  - path: "src/features/oculpm/ReviewQueueBar.tsx"
    op: create
  - path: "src/features/oculpm/JournalStatusChips.tsx"
    op: create
  - path: "src/__tests__/journal_review_queue.test.tsx"
    op: create
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "journal-scale"
  - "journal-screen"
  - "verified"
  - "mcp-tool"
---
[x] 검토 대기함 — 「미검토」 필터·일괄 확인·`v` 토글로 verified_by_user 를 살린다

## 추가 기능

플랜 `journal-scale-round` {#review-queue}. 2차 웨이브 세션 V(Sonnet 5) 구현, 감독자 합류. PR #27.

근거: 727건 중 사용자 확인 8건. 724건이 claude-code 자기 보고라 어느 결론이 검증됐는지 구분할 수 없었다.

- `EntryFilters.unverified_only`(serde default) — SQL `NOT (verified_by_user = 1 AND verified_stale = 0)`: 미확인 **또는** 확인 뒤 stale 둘 다. `verified_only` 의 정반대.
- `oculpm_set_journal_verified_bulk` — 단건 `set_journal_verified` 를 그대로 순차 호출(같은 write guard·content-hash 바인딩), 실패는 `{path, reason}` 으로 쌓고 배치는 계속. `commands/oculpm.rs` 가 래칫 상한이라 `commands/review.rs` 로.
- 일지 화면 「미검토」 칩(「확인됨」과 상호 배타 — 둘 다 켜면 결과가 늘 비니 서로를 끈다) + `ReviewQueueBar`「미검토 N건 · 표시 중 M건」·「보이는 것 전부 확인」(`isConfirmed` 로 확정 항목이 벌크에 안 실리게, shown=0 은 `blocked()` 로 이유 있는 비활성). 상세에서 `v` → 확인 토글(충돌 없음 확인).
- **의도적 편차**: 필터를 WorkspaceContext 로 영속하지 않았다 — 옆의 `verifiedOnly`/`unfinishedOnly` 가 "어제 걸어 둔 필터 때문에 오늘 일지가 안 보인다는 착각" 을 이유로 화면 지역 상태인 관용구를 따름. 감독자 판단으로 그대로 둠.
- 감독자 합류: T(태그 정리)와 V 가 각자 한계 안에서 늘린 줄이 합쳐 `JournalScreenV2.tsx` 818줄 → 상태 칩 셋을 `JournalStatusChips.tsx` 로 분리(784줄).

## 검증

Rust 2(unverified 필터에 stale 포함, bulk 정상 2+skip 1) · vitest 3(칩 → 필터 인자, 상호 배타, 바 버튼 → bulk+토스트). 래칫 대응으로 테스트를 형제 파일로. 통합 브랜치 전 게이트 exit 0. 실기기 육안 미실시.