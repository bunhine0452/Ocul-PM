---
schema_version: 1
type: bug
slug: "journal-toast-burst-on-reappearance"
status: done
difficulty: medium
created_at: "2026-09-22T05:04:33+09:00"
session_id: "20260922-004"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "11374f00-b5ac-48b5-baf8-a10f2cc343d9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher/journal.rs"
    op: update
  - path: "src/lib/journalToastGate.ts"
    op: create
  - path: "src/lib/journalAddedToast.ts"
    op: create
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/__tests__/journal_toast_gate.test.ts"
    op: create
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "watcher"
  - "toast"
  - "today"
  - "mcp-tool"
---
[x] 「새 일지」 토스트 폭주 — git 이 일지 폴더를 지웠다 되살리면 옛 일지 전부가 새 기록으로 방출됐다

## 증상

다른 세션이 일지를 쓰면 알림이 오는데, 그때 **과거 알림까지 전부** 다시 뜨는 것처럼 보였다 (사용자 보고 2026-09-22).

## 진단 (설치본 로그)

`~/Library/Application Support/com.kimhyunbin.ocul-pm/logs/oculpm.log.2026-09-21` 에서 `emitting OculpmJournalAdded` 를 분 단위로 집계하니 19:23 과 19:28 에 각 18건이 몰려 있었고, 전부 `20260918/**` 의 옛 일지였다. 바로 앞 로그: 같은 초에 그 폴더의 파일 전부에 `op=Delete` → `journal cache invalidated kind=Removed` → 곧바로 재생성. git 체크아웃·리베이스·stash 가 `.oculpm/journal/**` 를 폴더째 지웠다 되살린 것이고, 캐시 행이 지워진 뒤 다시 생긴 파일은 `UpsertOutcome::Inserted` 라 워처가 전부 「새 일지」로 방출했다. 토스트는 액션이 달려 최소 15초라 18장이 벽처럼 쌓였다. 같은 경로로 diff 캡처(지금 워킹트리의 diff 가 옛 일지에 남는다)와 플랜 화해까지 다시 돌았다. 과거 알림의 재표시가 아니라 **옛 일지의 신규 재분류**였다.

## 수정

- 백엔드 `watcher/journal.rs`: `Inserted` 라도 `created_at` 이 30분(`FRESH_ENTRY_WINDOW_SECS`)보다 오래됐으면 재출현으로 갈라 `OculpmJournalUpdated` 로 내보내고(목록은 갱신, 토스트 없음), diff 캡처·플랜 화해를 생략한다. 못 읽는 `created_at` 은 새것으로(침묵 쪽으로 넘어지지 않는다). `emit_journal_outcome` 이 "새 기록인가"를 돌려준다. 단위 테스트 3.
- 프론트 `lib/journalToastGate.ts`: 오래된 일지는 건너뛰고, 5초 창에 3장을 넘으면 「일지 여러 건이 한꺼번에 들어왔어요」 한 장으로 접는다(백필·병렬 에이전트의 정당한 폭주). 리스너는 `lib/journalAddedToast.ts` 로 분리(WorkspaceContext 래칫). 테스트 5.

## 검증

typecheck·test 2806·lint·build·clippy·fmt, watcher 46·session_verdict·plugin_manifest·resume_context 0. PR #30 → `fb77d4d9`. 설치본에서의 재현·확인은 다음 릴리스 뒤.