---
schema_version: 1
type: bug
slug: "port-tz-index-dblock-bugreport"
status: done
difficulty: medium
created_at: "2026-09-29T00:12:02+09:00"
session_id: "20260929-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/config/timezone.rs"
    op: create
  - path: "src-tauri/src/commands/project/index_flight.rs"
    op: create
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: ".github/ISSUE_TEMPLATE/platform-bug.yml"
    op: create
  - path: "src-tauri/src/commands/diagnostics/platform.rs"
    op: create
  - path: "src/features/settings/tabs/DiagnosticsTab.tsx"
    op: update
related: []
tags:
  - "cross-platform"
  - "indexing"
  - "timezone"
  - "diagnostics"
  - "mcp-tool"
---
[x] 기본 시간대는 시스템 · 색인 이중 실행 합류 · Windows DB 테스트 잠금 · 베타 버그 리포트 경로 (L-MISC, PR #53)

## 발생 원인

- **시간대** — `.oculpm` workday 시간대의 기본값이 `Asia/Seoul` 하드코딩이었다. 다른 시간대 사용자의 Today·일지 날짜가 하루 어긋났다(E2E 발견, 모든 OS).
- **색인 이중 실행** — 프로젝트를 추가하면 StartTab 이 등록 직후 색인을 걸고, ProjectTab 도 청크 0개를 보고 또 걸었다. 첫 색인은 모델을 받는 동안 청크가 0개다.
- **Windows DB 테스트** — tokio-rusqlite 의 drop 은 닫기를 기다리지 않는다. 그래서 WAL 닫기(체크포인트·잠금)가 같은 파일의 재열기와 겹쳐 `DatabaseBusy` 가 났다.
- **버그 리포트** — Windows·Linux 베타 사용자가 OS·설치 형식·WebView 판을 알려 줄 경로가 없었다.

## 해결 방법

- `oculpm/config/timezone.rs` — 기본값을 TZ(IANA 일 때) → OS 설정(`iana-time-zone`) → `Asia/Seoul` 순으로 정한다(위임 결정). 초기화가 늘 설정 전체를 적어 왔으므로, 기존 파일의 값은 그대로다.
- `commands/project/index_flight.rs` — `index_project` 를 프로젝트별 단일 비행으로 감쌌다. 진행 중에 온 요청은 합류해 같은 진행률과 결과를 받는다.
- `Db::close()` — 닫힐 때까지 기다린 뒤 다시 연다.
- `.github/ISSUE_TEMPLATE/platform-bug.yml` 과 `diagnostics_report` 커맨드(앱·OS 판·아키텍처·WebView2/WebKitGTK 판·세션·시간대·로그 폴더, 홈은 `~`). 설정 → 진단에 「진단 정보 복사」 를 두었다. Windows·Linux 의 버그 리포트는 양식을 채워서 연다.

## 검증

- 레인 CI(Portability 11잡 · E2E 양 OS)가 초록이었다. E2E 로그에서 `indexing start` 1회 → `joined it` → `done` 1회를 확인했다.
- 병합 전 임시 반복 테스트 커밋 4개를 걸러낸 깨끗한 브랜치를 만들었고, L-OS3 병합 뒤 `lib.rs` 커맨드 목록 충돌을 풀고 bindings 를 재생성했다. PR #53 전 체크 pass, rebase 병합(13eaab2c).
- DB 잠금은 부하 없는 반복(0/40)으로는 옛 방식에서도 재현되지 않았다. 결정적 수정이지만 누적 초록으로 판정한다.
- 설치 형식은 L-UPD 의 `install_kind` 가 들어오면 진단 글에 잇는다.