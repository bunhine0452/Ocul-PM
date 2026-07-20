---
schema_version: 1
type: bug
slug: dead-holder-lock-takeover
status: done
difficulty: medium
created_at: "2026-07-20T15:37:40+09:00"
session_id: "manual-20260720-153740"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/lock.rs
    op: update
related:
  - 20260720/Bugs/1519_bug_settings-entry-page-reload.md
tags: ["lock", "crash-recovery", "dev-friction", "runtime-verify"]
---

[x] 죽은 보유자의 락이 5분간 read-only 를 강제 — PID 생존 검사로 즉시 회수

## 발생 원인

실기기 확인 중 같은 마찰이 하루 3회 재발: dev 의 `pnpm tauri dev` 를 Ctrl+C 로 끊으면
graceful 종료(락 해제)가 돌지 않아 `.oculpm/.lock` 이 남고, 5분 하트비트 스테일 창 안에
재시작하면 모든 열었던 프로젝트가 "lock held by another instance" read-only 로 밀렸다
(마지막 사례: 죽은 PID 94553 이 ai-pm·PySpace·bunhine_web 3개 락을 보유). 스테일 회수
설계는 정상이나, 회수 기준이 하트비트 나이뿐이라 "보유자가 확실히 죽은" 경우까지 5분을
기다렸다.

## 해결 방법

`LockGuard::acquire` 에 같은-호스트 보유 PID 생존 검사 추가 — `ps -p <pid>` (소유자
무관하게 존재 시 exit 0, `kill -0` 의 EPERM 오판 없음). 확실히 죽어 있으면 하트비트
나이와 무관하게 즉시 `Recovered`. 판정 불가(비 unix)나 PID 재사용으로 "살아있음" 이면
종전 하트비트 기준 폴백 — 잘못 회수하는 방향의 리스크는 지지 않는다.

## 검증

lock 테스트 5 그린 — 신규 1(죽은 PID + 신선한 하트비트 → 즉시 Recovered), 기존 Held
케이스는 살아있는 pid 1(launchd)로 갱신해 의미 보존. `cargo test` 356 전체 그린.
스테일 락 3개는 수동 제거로 즉시 복구 완료.
