---
schema_version: 1
type: chore
slug: log-retention-cap
status: done
difficulty: verylow
created_at: "2026-07-06T21:56:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/lib.rs
    op: update
related: []
tags: ["v2-release", "U5", "logging", "retention", "disk"]
---

[x] U5 로그 retention 상한 — 일별 로그 무한 누적 종료 (최근 14개 보존)

## 배경

`tracing_appender::rolling::daily` 는 회전만 하고 삭제를 안 해 `<app_data>/logs/oculpm.log.YYYY-MM-DD` 가 앱 수명 내내 무한 누적됐다 (성능 조사 §5).

## 변경

`RollingFileAppender::builder().rotation(DAILY).filename_prefix("oculpm.log").max_log_files(14)` 로 교체 — 회전 시점에 오래된 파일부터 정리(기존 누적분도 prefix 매치로 정리 대상). 빌더 실패 시 기존 무제한 daily 로 폴백해 로깅이 앱 기동을 막지 않게 함.

## 검증

cargo test 332 passed (컴파일·기동 경로 포함). 파일 pruning 자체는 tracing-appender 0.2.5 의 `max_log_files` 상류 동작 — 다음 도그푸딩에서 logs/ 디렉토리 파일 수 ≤14 유지 육안 확인 예정.
