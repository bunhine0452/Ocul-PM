---
schema_version: 1
type: refactor
slug: github-pat-retire
status: done
difficulty: low
created_at: "2026-07-16T21:44:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/settings/SettingsPanel.tsx
    op: update
  - path: src-tauri/src/commands/git.rs
    op: update
  - path: src-tauri/src/github.rs
    op: delete
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
related: []
tags: ["settings", "github", "dead-code", "audit-fix"]
---

[x] 설정 GitHub PAT 탭 은퇴 — 소비처 없는 토큰 저장 + 없는 기능을 약속하던 안내 제거

## 동기

감사 HIGH #2: 토큰을 발급·저장·검증해도 소비처가 `github_verify` 하나뿐이었고,
안내문은 "PR·이슈·GraphQL·write 에 필요"라고 존재하지 않는 기능을 약속했다.
로컬 git(로그/상태/그래프)은 git CLI 라 토큰이 필요 없고, 릴리스 패치노트도
비인증 public API 를 쓴다.

## 변경 요약

- SettingsPanel: GitHub 탭(TabId·TABS·GithubTab 161줄·라우팅 case) 제거.
- 백엔드: `github_verify` 커맨드 + `github.rs` 모듈(verify_token·GithubUser·
  GithubVerifyResult) 삭제, lib.rs 등록 해제, bindings 재생성.
- 키체인의 기존 `github_api_key` 항목은 파괴하지 않는다 — 앱이 더 안 읽을 뿐,
  삭제는 사용자의 키체인 권한 영역.

## 검증

- cargo test 그린 + bindings 에서 githubVerify/GithubVerifyResult 소멸 확인.
- 프런트 게이트 4종 exit 0. 릴리스 패치노트 탭(비인증 fetch)은 무영향.
