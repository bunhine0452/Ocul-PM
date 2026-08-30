---
schema_version: 1
type: chore
slug: dead-config-keys-and-undefined-tokens
status: done
created_at: 2026-08-30T15:11:00+09:00
session_id: "manual-20260830-151100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/config.rs
    op: update
  - path: src-tauri/src/oculpm/session.rs
    op: update
  - path: src-tauri/src/oculpm/agents/mod.rs
    op: update
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/__tests__/rules_hub_v2.test.tsx
    op: update
  - path: src/features/code/code.css
    op: update
  - path: src/features/skills/skills.css
    op: update
related:
  - .oculpm/journal/20260830/Features_to_add/1111_feature_verified-toggle-and-related-links.md
tags: [config, settings, css-tokens, polish-round]
---

[x] 아무 코드도 읽지 않던 config.toml 키 7개를 스키마·설정 화면에서 걷어내고, 미정의 CSS 토큰 2곳을 실존 토큰으로

## 왜·무엇

- **죽은 설정 키**: `session.auto_close_on_workday_boundary` · `session.auto_close_on_app_quit` · `session.crash_recovery_grace_minutes` · `watcher.batch_max_events` · `agents.auto_detect_on_open` · `agents.auto_sync_adapters` · `git.journal_committed` 는 런타임 리더가 0 이었다(경계 종료·앱 종료 정리·감지·동기화는 전부 무조건 동작). 그중 넷은 설정 화면에 토글로 떠 있어 "끄면 안 닫힌다/안 감지한다" 는 거짓 믿음을 줬다 — 지난 라운드에 내린 `journal_committed` 와 같은 처지였다. 구조체·기본값·`validate`·테스트 픽스처·UI 토글·i18n 키 5개에서 제거. 디스크의 옛 키는 serde 가 무시한다(`unknown keys must be ignored` 테스트가 그대로 지킨다).
- **미정의 토큰**: `code.css` 의 `var(--bg-2)`(검색 패널 헤더) 와 `skills.css` 의 `var(--bg-elevated, var(--bg))`(스코프 세그먼트 활성) 는 어디에도 정의되지 않아 배경이 투명이었다 → `--bg-card`.

## 검증

`cargo test` 869 · `pnpm typecheck` · `lint` · `test`(1450) · `build` exit 0. 바인딩에서 7개 키가 사라짐.
