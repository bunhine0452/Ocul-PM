---
schema_version: 1
type: chore
slug: v2-1-release
status: done
difficulty: verylow
created_at: "2026-07-16T22:25:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: package.json
    op: update
  - path: src-tauri/tauri.conf.json
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: src-tauri/Cargo.lock
    op: update
related:
  - journal/20260716/Chores/2215_chore_runtime-verify-and-docs-truth.md
tags: ["release", "v2.1.0"]
---

[x] v2.1.0 릴리스 — 버전 bump + 태그 푸시 (release.yml 빌드)

## 변경 요약

- 버전 2.0.0 → **2.1.0** (package.json · tauri.conf.json · Cargo.toml · Cargo.lock).
- CHANGELOG v2.1.0 본문은 직전 기능 커밋(969f840)에 포함 — 릴리스 워크플로가
  태그와 같은 헤더의 본문을 릴리스 노트로 사용.
- 라운드 내용: 스킬 화면 / Atelier 리스킨+부트 모션 / 코드 맵 가독성 /
  터미널 한국어 / 전 기능 감사 정리 (일지 13건).

## 검증

- 커밋 직전 게이트 5종(typecheck/test/lint/build/cargo 8스위트) 전부 exit 0 재확인.
- 태그 `v2.1.0` 푸시 → GitHub Actions release.yml 빌드 결과는 푸시 후 확인.
