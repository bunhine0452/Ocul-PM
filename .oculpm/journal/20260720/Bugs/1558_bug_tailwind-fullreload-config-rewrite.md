---
schema_version: 1
type: bug
slug: tailwind-fullreload-config-rewrite
status: done
difficulty: medium
created_at: "2026-07-20T15:58:44+09:00"
session_id: "manual-20260720-153740"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/config.rs
    op: update
  - path: vite.config.ts
    op: update
related:
  - 20260720/Bugs/1519_bug_settings-entry-page-reload.md
  - 20260720/Chores/1542_chore_reload-diagnostics-scaffold.md
tags: ["vite", "tailwind", "dev-only", "reload", "idempotent-write", "dogfooding-finding"]
---

[x] ai-pm 열기 직후 웹뷰 전체 리로드 — 같은-내용 config.toml 재작성이 tailwind full-reload 유발

## 발생 원인

2단 계측(클라 [vite-diag] + ws.send 스택 스파이)으로 확정한 체인:

1. 앱이 프로젝트를 열면 어떤 경로가 `.oculpm/config.toml` 을 **내용 동일해도 재작성**
   (mtime 변경 — 우리 watcher 의 "config.toml changed" 경고와 같은 근원).
2. 도그푸딩으로 ai-pm(=Vite dev 루트) 자체를 열면 이 쓰기가 chokidar 감시 범위 안에
   떨어지고, **`@tailwindcss/vite` 의 `hotUpdate` 가 비모듈 파일 change 에 로그 없이 raw
   `full-reload`** 를 쏜다 (스파이 스택: MinimalPluginContext.hotUpdate → handleHMRUpdate).
3. 리로드 → 재마운트 → 프로젝트 재오픈 → 재작성 → 연쇄 리로드. Vite 코어가 아니라서
   서버 로그에 사유가 전혀 없었고, 다른 프로젝트는 config 가 Vite 루트 밖이라 무증상 —
   "ai-pm 에서만 리로드" 의 전모.

## 해결 방법

1. **근본**: `OculpmConfig::save` 멱등화 — 직렬화 결과가 기존 파일과 바이트 동일하면
   디스크를 건드리지 않는다 (어댑터 sync 의 byte-stable 규율과 동일 원칙, 전 호출자 공통).
2. **방어**: vite `server.watch.ignored` 에 `**/.oculpm/**` 추가 — 앱 런타임 데이터는
   프런트 모듈이 아니므로 감시 자체를 끊는다 (세션/인덱스 쓰기도 함께 차단).
3. 스파이 플러그인은 임무 완수로 제거, 경량 계측(customLogger tee + [vite-diag])은 유지.

## 검증

cargo test 356(config 8 포함) / typecheck / vitest 143 / lint / build 전부 그린.
리로드 부재 실확인은 사용자 dev 재시작 후 ai-pm 전환으로 (계측이 남아 있어 재발 시
즉시 판독 가능).

## 메모

- config.toml 을 열기마다 재작성하는 호출자 자체(감지 후 저장으로 추정)는 멱등 save 로
  무해화됐으므로 별도 추적하지 않음 — "config.toml changed" watcher 경고도 함께 사라짐.
