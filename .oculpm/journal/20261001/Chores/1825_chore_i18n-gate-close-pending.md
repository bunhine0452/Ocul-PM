---
schema_version: 1
type: chore
slug: "i18n-gate-close-pending"
status: done
difficulty: low
created_at: "2026-10-01T18:25:29+09:00"
session_id: "20261001-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "scripts/gen-i18n-allowlist.mjs"
    op: delete
related:
  - ref: "20260911/Features_to_add/1759_feature_i18n-english-screens-walk.md"
    kind: "followup"
tags:
  - "i18n"
  - "lint"
  - "mcp-tool"
---
[x] i18n 마감 게이트 — PENDING 집합과 시딩 스크립트 제거 (남은 둘은 9/11 에 이미 끝나 있었다)

`improvement-round-2026-09-14 {#i18n-finish}` 의 세 갈래를 하나씩 확인했다.

- **나머지 화면 묶음8** (`#i18n-rest`) — 이미 끝. `lint:i18n` 의 `PENDING` 은 2026-08-12 부터 비어 있었다.
- **영어 모드 12화면 오버플로 순회** (`#i18n-overflow`) — 이미 끝. 9/11 `f390ee4`: `i18n_english_screens.test.tsx`(15화면+사이드바, 한글 0·오류 경계 0) + 실제 CSS 하네스로 1280·960 폭에서 오버플로 넷 수정.
- **allowlist 빈 배열 게이트** (`#i18n-gate`) — 이번에 닫았다. 비어 있는 `PENDING` 집합과 그것을 채우던 `scripts/gen-i18n-allowlist.mjs` 를 지웠다. 그 스크립트를 다시 돌리면 "지금 한글이 있는 파일 전부" 가 미번역 목록으로 되살아나 게이트가 조용히 뚫리는 길이었다. 이제 allowlist 는 설계상 한글이 있어야 하는 세 집합(PERMANENT·DISK_CONTENT·TESTS)뿐이고, "나중에 번역" 으로 받아 둘 자리가 없다.

`docs/20260811_three-features/03-i18n.md` 의 시딩 절차 언급은 아카이브 문서라 그대로 둔다.

## 검증

- `pnpm lint:i18n` ✓, 새 테스트 파일(`native_dialogs.test.ts`)을 TESTS 에 넣기 전엔 붉고 넣은 뒤 초록 — 게이트가 살아 있음.
- 스크립트 참조 검색: `package.json`·`scripts/`·`src/` 에 남은 참조 0.