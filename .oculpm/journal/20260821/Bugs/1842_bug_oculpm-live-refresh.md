---
schema_version: 1
type: bug
slug: oculpm-live-refresh
status: done
difficulty: medium
created_at: "2026-08-21T18:42:00+09:00"
session_id: "manual-20260821-184200"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/useRefetchOnWake.ts"
    op: create
  - path: "src/features/oculpm/useOculpmLive.ts"
    op: create
  - path: "src/features/oculpm/useJournalEvents.ts"
    op: delete
  - path: "src/features/oculpm/useJournalDays.ts"
    op: update
  - path: "src/features/today/useTodayBrief.ts"
    op: update
  - path: "src/features/today/useTodayMonitor.ts"
    op: update
  - path: "src/features/today/DiscussionPending.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/discussion/DiscussionScreenV2.tsx"
    op: update
  - path: "src/__tests__/oculpm_live.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags: [watcher, events, live-refresh, planner, discussion, journal, dogfooding]
---

[x] 에이전트가 `.oculpm/` 을 고쳐도 새로고침해야 보이던 것 — 계획·논의는 이벤트가 아예 없었고, 일지는 알림이 캐시보다 빨랐다

## 발생 원인

"에이전트가 일지나 다른 oculpm 파일을 만들거나 고치거나 지우면 앱에 바로 반영됐으면
좋겠다. 가끔 우클릭 새로고침을 하지 않으면 반영이 안 될 때도 있다."

원인이 한 덩어리가 아니라 둘이었다.

### 1. 계획·논의는 알림 자체가 없었다

`watcher.rs` 의 라우팅에서 두 트리는 로그만 찍고 그대로 빠져나갔다.

```rust
if rel_str.starts_with(".oculpm/planner/") {
    tracing::debug!(… "planner fs event (handled by projection on read)");
    return;                      // ← 여기서 끝. emit 이 없다
}
```

주석의 "the live-push event for the Planner UI lands in PR-PLN 3" 은 끝내 도착하지
않았다. 화면 쪽도 대칭이다 — `PlannerScreenV2` 는 `refreshPlans`/`refreshDetail` 을
**마운트와 사용자 동작에서만** 부르고, `DiscussionScreenV2` 는 `loadList`/`loadDetail`
을 그렇게 부른다. 구독이 한 줄도 없으니 이건 "가끔" 이 아니라 **항상** 안 바뀐다.
파일을 밖에서 고친 뒤 화면을 다시 보면 열었을 때의 내용이 그대로 있다.

### 2. 일지는 알림이 캐시 갱신을 앞질렀다

일지 트리는 이벤트가 있었지만 순서가 뒤집혀 있었다.

```rust
self.emit_journal_path_changed(&rel_str, op);          // 먼저 알리고
self.apply_journal_cache_invalidation(&rel_str, op).await;  // 그 다음에 캐시를 고친다
```

프런트는 이 알림을 250ms 병합해 다시 조회한다. 그런데 조회 대상은 SQLite 캐시고,
그 캐시를 고치는 건 알림 **뒤에** 오는 `await` 다. 재조회가 이기면 옛 행을 읽고
그대로 굳는다 — 다음 이벤트가 없으니 사용자가 손으로 새로고침할 때까지.

추가/수정은 그나마 그물이 있다. `apply_path_change` 가 `Inserted`/`Updated` 를
돌려주면 캐시를 고친 **뒤** `journal-added`/`journal-updated` 가 한 번 더 나가고,
프런트는 그것도 구독한다. 하지만 **삭제는 그 그물이 없다**:

```rust
PathChangeKind::Removed => {
    self.delete_entry(project_id, relative_path).await?;
    Ok((None, 0))          // ← outcome None → emit_journal_outcome 이 즉시 return
}
```

삭제된 일지에는 요약이 없으니 added/updated 를 만들 수 없다. 그래서 삭제는 **선발화된
path-changed 하나가 유일한 신호**였고, 레이스에 지면 지운 일지가 화면에 계속 남았다.
mtime 만 바뀐 수정(outcome 이 emit 대상이 아님)도 같은 구멍에 들어간다.

## 해결 방법

### 알림을 캐시 뒤로

`emit_journal_path_changed` 를 `apply_journal_cache_invalidation` **뒤로** 옮겼다.
이제 프런트가 재조회할 때 캐시는 반드시 새 상태다. 캐시 갱신이 실패한 경로(Err 분기)
에서도 알림은 그대로 나가므로 "실패해도 UI 는 흔들어 준다" 는 기존 성질은 유지된다.
신규 항목은 그 안에서 이미 `journal-added` 가 (diff 캡처보다 먼저) 나가므로 사용자가
체감하는 지연은 늘지 않는다.

### 계획·논의에 알림 신설

`OculpmDataChanged { project_id, area, relative_path, op }` 이벤트를 추가했다
(`area` 는 `planner` | `discussion` enum — TS 에서 문자열 유니온으로 떨어진다).
경로 판정은 순수 함수 `data_area_for_path` 로 분리했다. 접두사에 `/` 를 넣어
`.oculpm/planner-backup/` 같은 이웃을 삼키지 않게 했고 그걸 단위 테스트로 고정했다.

두 영역은 SQLite 캐시를 쓰지 않고 읽을 때마다 파일에서 다시 투영하므로, 캐시 무효화
없이 "다시 읽어라" 신호만 내면 된다.

### 프런트 — 구독 한 곳으로

`useJournalEvents.ts` 를 `useOculpmLive.ts` 로 옮기고 공용 구독 코어를 두 훅이
나눠 쓰게 했다 (`useJournalEvents`, `useOculpmDataEvents`). 250ms 병합은 그대로다.
연결한 곳:

| 화면 | 구독 |
|---|---|
| 계획 | planner — 목록 + 상세(조용히) |
| 논의 | discussion — 목록 + 상세(편집 중이면 상세는 건너뜀) |
| Today "결정 대기" 카드 | discussion |
| Today brief | journal + planner (`open_plan_items` 를 담으므로) |
| Today 모니터 · 일지 타임라인 | journal (기존) |

상세 재조회에 `silent` 를 붙였다 — 사용자가 요청한 적 없는 갱신이 읽고 있던 내용을
로딩 뼈대로 깜빡이게 하면 안 된다. 논의는 편집 중일 때 본문을 갈아끼우지 않는다:
`draft` 는 열었을 때의 본문에서 갈라져 나온 작업본이라, 그 아래 `detail` 을 바꾸면
저장이 무엇을 덮어쓰는지가 사용자가 보던 것과 달라진다.

### 이벤트를 놓쳤을 때의 그물

`useRefetchOnWake` — 창으로 돌아오면 한 번 다시 읽는다(10초 스로틀). 워처가 살아
있어도 신선도가 보장되지 않는 구간이 있다: 앱이 꺼져 있던 동안의 변경, fs 이벤트를
흘리는 동기화 볼륨, 워처가 멈춘 상태. 사용자는 보통 터미널에서 에이전트를 돌리다
창으로 돌아오므로 그 복귀가 가장 값싼 재확인 지점이다. 시작 화면(`useHomeBrief`)에
이미 있던 패턴을 이벤트 훅 전체로 넓힌 것.

## 검증

- `cargo test` 전량 그린 (lib 632 + 통합 스위트, 실패 0). 새 단위 테스트 1개 —
  `data_area_for_path` 가 planner/discussion 만 잡고 일지·이웃 디렉터리·동명의 소스
  디렉터리는 안 잡는다.
- `pnpm test` 95파일 1089건 그린. 새 스위트 `oculpm_live.test.tsx` 9건 — 영역/프로젝트
  필터, 3연발 이벤트의 1회 병합, 언마운트 해제, **삭제(path-changed)만 와도 재조회**,
  focus 재조회와 그 스로틀, projectId 없을 때 무동작.
- `pnpm typecheck` · `pnpm lint` · `pnpm build` 각각 exit 0. `bindings.ts` 는
  `cargo test` 가 재생성했다 (수동 편집 아님).
- 정직하게: 일지 **삭제 레이스는 코드 경로 판독으로 특정**했고 (Removed → outcome
  `None` → `emit_journal_outcome` 즉시 return → 선발화 path-changed 가 유일 신호),
  타이밍을 실제로 재현해 실패시키지는 않았다. 계획·논의의 무반응은 재현이랄 것도
  없다 — 구독이 존재하지 않았다.

## 메모

대응하는 활성 플래너 항목이 없어 플래너는 갱신하지 않았다 (AGENTS.md §4 의 "대응
항목이 없으면 생략").

`.oculpm/` 안에서 아직 라이브가 아닌 곳: `config.toml`(워처 재시작 자체가 W4 이후로
미룬 상태), 회고 화면(범위 집계라 이벤트마다 다시 돌리면 비싸고, 이미 "오래됨" 배지로
신선도를 밝힌다). 둘 다 이번 증상과는 다른 판단이라 그대로 뒀다.
