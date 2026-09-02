---
schema_version: 1
type: bug
slug: "journal-list-swallows-backend-hits"
status: done
difficulty: medium
created_at: "2026-09-02T11:52:11+09:00"
session_id: "20260902-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/SourceBadge.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/tests.rs"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
related: []
tags:
  - "journal"
  - "search"
  - "filter"
  - "cache"
  - "ui"
  - "mcp-tool"
---
[x] 작업 일지 목록이 백엔드가 찾아 준 것을 되버리던 자리들 · 열어 둔 일지가 멈춰 있던 것

작업 일지 화면을 감사해 결함 6건을 확인하고 고쳤다. 다섯은 한 부류다 — **백엔드는 제대로 주는데 화면이 버리거나, 손잡이가 사라진다.**

## 발생 원인

**1. 본문 검색이 통째로 죽어 있었다.** 백엔드 `build_list_sql` 은 `title / slug / body_markdown / tags` 를 훑는데, `JournalScreenV2` 가 그 결과를 `title + slug + tags` 로 **다시** 좁혔다. 목록이 받는 `JournalEntrySummary` 에는 본문이 없으니, 본문에만 있는 단어로 찾아 준 항목을 화면이 스스로 버렸다. 툴바 건수는 백엔드 결과 기준이라 "12건" 이라 적고 카드는 3장만 그리는 어긋남까지 났다.

**2. 최근 14일이 비면 예전 일지로 갈 길이 없었다.** 「이전 기록 더 보기」가 `filteredDays.length > 0` 가지 **안쪽**에만 있어서, 두 주 넘게 쉬었다 돌아온 프로젝트는 "아직 일지가 없어요 + git 백필" 벽에 갇혔다. 3주 전 일지가 멀쩡히 있어도 닿을 버튼이 없었다.

**3. 필터 중 날짜 접기 버튼이 죽은 버튼이었다.** `searchActive ? true : (dayOpen[wd] ?? idx < 2)` — 필터가 값을 통째로 덮어써서, 클릭하면 상태만 바뀌고 `aria-expanded` 는 `true` 에 못 박혀 있었다.

**4. 출처 필터를 걸면 되돌릴 손잡이가 사라졌다.** 레일은 표본 출처가 2종 미만이면 스스로 숨는데, 하나를 고른 뒤 검색으로 표본이 1종이 되면 **필터는 걸린 채 레일만** 없어져 빈 목록에 갇혔다.

**5. 검색어의 LIKE 와일드카드가 살아 있었다.** 이스케이프가 없어 `a_b` 가 `axb` 를, `a%b` 가 임의의 사이 문자열을 잡았다.

**6. 열어 둔 일지가 연 순간에 멈춰 있었다.** `EntryDetailView` 가 `relative_path` 가 바뀔 때만 다시 읽어서, 에이전트가 같은 일지를 고치거나 인덱서가 diff 사이드카를 뒤늦게 기록해도 화면은 그대로였다.

## 해결 방법

- **1** — `searchSettled`(전체 기간 질의 + 로딩 끝 + 디바운스 일치)면 화면 쪽 검색 필터를 건너뛴다. 타이핑 중 300ms 구간에만 즉시 좁히기를 남겼다. 툴바 건수도 `filteredDays` 기준으로 옮겨 목록과 어긋나지 않게 했다.
- **2** — 「더 보기」를 목록 밖으로 빼고 `oculpmReady && !allPeriod && 스켈레톤 아님` 으로만 가렸다. 빈 화면에서도 그려진다.
- **3** — `dayOpen[wd] ?? (searchActive ? true : idx < 2)` — 필터는 **기본값만** 정하고, 사용자의 명시적 토글이 이긴다.
- **4** — 레일이 고른 출처를 표본에 없어도 옵션으로 남기고, `value != null` 이면 표본이 몇 종이든 그린다. 사라진 출처는 건수를 `0` 으로 적어 왜 비었는지 말한다.
- **5** — `like_escape()` 로 `\ % _` 를 이스케이프하고 네 LIKE 절 전부에 `ESCAPE '\'` 를 붙였다.
- **6** — `useJournalEvents` 로 라이브 갱신을 붙였다. 선택·필터 초기화는 **다른 일지로 옮길 때만** 하고, 갱신에서는 읽던 파일 선택을 지키게 이펙트를 갈랐다.

## 검증

회귀 테스트를 먼저 심어 5건이 red 인 것을 확인한 뒤 고쳤다 (`journal_v2.test.tsx` 5건 + `cache/tests.rs` 와일드카드 1건). `pnpm typecheck` · `pnpm test`(150파일 1868건) · `pnpm lint` · `pnpm build` · `cargo fmt --check` · `cargo clippy --all-targets -D warnings` 전부 exit 0. `cargo test --lib oculpm::cache` 34건 통과 — `build_list_sql` 은 호출부가 하나뿐이라 검색 변경의 영향 범위는 이 스위트가 전부 덮는다.