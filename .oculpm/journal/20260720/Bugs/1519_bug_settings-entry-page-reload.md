---
schema_version: 1
type: bug
slug: settings-entry-page-reload
status: done
difficulty: low
created_at: "2026-07-20T15:19:30+09:00"
session_id: "manual-20260720-151930"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: vite.config.ts
    op: update
related:
  - 20260720/Bugs/1458_bug_tauri-dev-default-run.md
tags: ["vite", "dev-only", "settings", "optimize-deps", "runtime-verify"]
---

[x] dev 에서 설정(ocul-pm) 첫 진입 시 웹뷰 전체 리로드

## 발생 원인

실기기 확인 중 재현 보고. 로그 분석 — 06:15:48 의 재기동은 Rust 프로세스가 아니라
**웹뷰 페이지 리로드** (tracing 재초기화 없음, watcher stop→start 정상 인계). 원인은
Vite 의 온디맨드 의존성 최적화: 설정 화면은 lazy 청크인데, 그 트리만 임포트하는
`@tauri-apps/plugin-opener`/`plugin-updater`/`plugin-process` 가 사전 번들에 없어 첫
진입 때 재최적화가 돌고 "optimized dependencies changed. reloading" 전체 리로드가
났다. `.vite/deps/_metadata.json` 에 이 셋이 방금 추가된 것으로 확정. dev 전용 —
프로덕션 빌드 무관.

(같은 확인 세션의 락 에러는 별건 — 직전 인스턴스가 비정상 종료로 남긴 스테일 락이며,
보유 PID 사망 확인 후 수동 제거. 락의 5분 하트비트 스테일 회수 설계 자체는 정상.)

## 해결 방법

`vite.config.ts` 에 `optimizeDeps.include` 로 세 플러그인을 서버 시작 시 사전 번들.
fresh clone / `.vite` 캐시 삭제 후에도 설정 첫 진입 리로드가 재발하지 않는다.

## 검증

`pnpm typecheck` / `pnpm build`(vite 설정 경유) exit 0. 실기기 재확인은 dev 재시작 후
설정 진입 시 리로드 부재로 — 사용자 확인 대기 (#ci0-runtime-verify 흐름에 포함).
