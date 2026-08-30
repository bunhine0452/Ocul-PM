---
schema_version: 1
type: feature
slug: verified-toggle-and-related-links
status: done
created_at: 2026-08-30T11:11:00+09:00
session_id: "manual-20260830-111100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src/features/oculpm/EntryDetailView.tsx
    op: update
  - path: src/features/oculpm/JournalScreenV2.tsx
    op: update
  - path: src/features/oculpm/JournalCardV2.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related: []
tags: [journal, review-loop, audit-round]
---

[x] 일지 상세에서 「검증」을 토글하고 frontmatter `related` 링크를 칩으로 따라갈 수 있다 — 검토 루프의 마지막 고리

## 추가 기능

- **검증 토글**: 상세 화면 툴바에 「검증 / 검증됨」 버튼. `oculpmApi.setJournalVerified` 는 래퍼까지 있었지만 호출처가 0 이었고(감사), `verified_by_user` 는 AGENTS.md 가 에이전트에게 `false` 로 쓰라고 강제하는 필드인데 사람이 `true` 로 바꾸는 자리가 앱에 없었다 — 타임라인의 「검증됨」 필터 칩은 늘 빈 결과였다. 카드에도 초록 체크가 붙는다.
- **관련 일지 칩**: frontmatter `related`(`RelatedRef[]`) 는 파싱·저장만 되고 어디에도 그려지지 않았다(이 저장소 408건 중 149건이 채움). 상세의 태그 위에 `종류 · 파일명` 칩으로 그리고, 누르면 그 일지로 이동한다. 종류 4종(blocks/blocked_by/followup/duplicate) 은 i18n, 낯선 종류는 그대로.

## 동작 흐름

- 토글 → `set_journal_verified` 가 frontmatter 만 고쳐 디스크에 쓰고 마스킹 캐시로 재투영 → 워처가 `JournalUpdated` 를 쏴 타임라인 카드가 따라온다. 실패는 토스트.
- 칩 클릭 → `JournalScreenV2.openByPath`: Planner 링크(`openEntryPath`) 가 쓰던 해석(워크데이 폴더로 목록 조회 → 정확 일치 → 파일명 일치) 을 함수로 빼서 공유. 에이전트가 자주 쓰는 `.oculpm/journal/…` 접두 형태도 벗겨 받는다. 뒤로 가기는 타임라인으로.

## 검증

`pnpm typecheck` · `lint` · `test`(1450, journal_v2 스위트 포함) · `build` 전부 exit 0. 실기기(칩 클릭 이동·토글 후 카드 체크) 는 앱 꺼진 뒤 몰아서.

## 메모

6월 백로그 P2 「검토 세션」(j/k 로 카드를 넘기며 검증) 의 전제가 이것이다 — 토글과 링크가 생겼으니 남은 것은 순회 화면.
