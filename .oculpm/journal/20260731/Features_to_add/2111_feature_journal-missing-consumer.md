---
schema_version: 1
type: feature
slug: journal-missing-consumer
status: done
created_at: 2026-07-31T21:11:00+09:00
session_id: "manual-20260731-211100"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: src-tauri/src/oculpm/claude_hooks.rs, op: update }
  - { path: src-tauri/src/commands/claude_hooks.rs, op: update }
  - { path: src-tauri/src/lib.rs, op: update }
  - { path: src/lib/bindings.ts, op: update }
  - { path: src/features/today/JournalMissingCard.tsx, op: create }
  - { path: src/features/today/TodayScreenV2.tsx, op: update }
related: [.oculpm/journal/20260731/Features_to_add/2010_feature_journal-missing-signal.md]
tags: [today, journal-missing, hooks, consumer]
difficulty: medium
---

[x] 미기록 세션 앱 소비자 (H3b) — Today 에 "일지 없이 끝난 세션" 카드

## 추가 기능

- `journal_missing_signals(root, days)` — 신호 파일을 관용 파싱(깨진 줄 스킵·기간 필터·최신 우선). **해소 필터**: 신호 이후 어떤 일지든 생기면(사후 기록·auto_journal_draft 초안) 낡은 경고를 읽기 시점에 걷어낸다 — append-only 신호가 7일간 거짓 경고로 남던 문제(리뷰 MED) 해소. 세션 귀속이 아닌 보수적 근사임을 주석 명시.
- **Today "일지 없이 끝난 세션" 카드** — 정직성 감사 결의 자기은닉 warn 카드: 최근 7일 N건, 시각·세션 축약, auto_journal_draft 안내 + 설정 이동 버튼. 재조회는 마운트 + 기존 oculpmSessionEnded 이벤트 재사용(신호 append 를 이벤트 append **앞**으로 재배열해 순서 경합 제거 — 리뷰 LOW).
- 크로스-언어 계약 테스트: 훅 printf 템플릿과 동일 라인 실파싱(파서 쪽) + 템플릿·date 포맷 문자열 고정(매니페스트 쪽) — 어느 쪽이 바뀌어도 게이트가 잡는다.

## 동작 흐름

플러그인 훅이 신호 append → 워처 이벤트/마운트로 카드 갱신 → 사용자가 초안 기능을 켜거나 사후 일지 작성 → 해소 필터가 경고를 자동 정리.

## 검증

`cargo test --lib claude_hooks` 15/15 (해소 필터·템플릿 계약 포함), vitest today 스위트 그린, plugin_manifest 7/7. 적대 리뷰 8건 전수 반영(2건은 계약 테스트로, 1건은 한계 문서화).
