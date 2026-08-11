# 세 기능 마스터 플랜 — 멀티 창 · 모바일(Tailscale) · 영어화

> 작성 2026-08-11 · 기준 v2.8.3 · **이 디렉토리가 세 기능의 SSOT**
>
> 하위 문서: [01-multi-window.md](01-multi-window.md) · [02-mobile-tailscale.md](02-mobile-tailscale.md) · [03-i18n.md](03-i18n.md)

## 0. 확정된 범위 (2026-08-11 사용자 결정)

| # | 기능 | 결정 |
|---|---|---|
| 1 | 멀티 프로젝트 창 | **메인 창 = 런처 전용**. 프로젝트를 열면 항상 별도 창(`project-<id>`). 메인은 다시는 셸을 띄우지 않는다 |
| 2 | Tailscale 모바일 | **읽기 전용 1차**. 일지·플래너·오늘 브리핑 조회까지. 쓰기는 검증 후 후속 라운드 |
| 3 | 영어화 | **UI + 백엔드 사용자 노출 에러 + LLM 프롬프트**. 디스크 산출물(AGENTS.md 템플릿·일지 섹션 규격)은 범위 밖 |

범위 밖으로 명시하는 것:
- 모바일에서의 쓰기(플래너 토글·일지 작성), 터미널·AI 패널
- `.oculpm/` 온디스크 스펙의 영어화 (`schema_version` 영향 → 별도 라운드)
- Windows/Linux 창 동작 (앱이 현재 macOS aarch64 단독 배포 — `release.yml:30`)

## 1. 왜 이 순서인가

권장 순서는 **i18n 뼈대 → 멀티 창 → i18n 본 추출 → 모바일** 입니다.

세 기능은 서로 독립처럼 보이지만 하나의 결합이 있습니다: **1번과 2번이 신규 UI 를 만들고, 3번이 모든 UI 문자열을 훑습니다.** 3번을 마지막에 두면 1·2번이 새로 만든 한글 문자열을 두 번째로 훑어야 하고, 3번을 통째로 처음에 두면 사용자가 실제로 원한 기능 두 개가 2,100줄짜리 기계적 추출 뒤로 밀립니다.

그래서 **i18n 을 뼈대와 본체로 쪼갭니다.**

```
Phase 0  i18n 뼈대            ~2일   설정 language 필드 + t() + lint 게이트 + 사전 골격
                                     ↓ (이 시점부터 신규 코드는 t() 로만 작성)
Phase 1  멀티 창              ~5일   창 모델 · 상태 격리 · PTY 생명주기 · 트레이 재배선
Phase 2  i18n 본 추출        ~8일   프런트 2,100줄 + Rust 에러 130곳 + 프롬프트 12파일
Phase 3  모바일 (Tailscale)  ~7일   axum 서버 · 바인딩 · 페어링 · 모바일 번들
```

Phase 0 이 먼저 들어가면 Phase 1 의 신규 UI(창 관리·런처 개편)가 처음부터 `t()` 로 작성되어 Phase 2 에서 재작업이 없습니다. Phase 3 을 마지막에 두는 이유는 신규 HTTP 서버가 셋 중 가장 크고, 앞의 두 Phase 가 확정한 프로젝트 모델·i18n 위에 얹히는 게 자연스럽기 때문입니다.

**Phase 1 과 Phase 2 는 병렬 가능합니다** (Phase 1 은 창/Rust, Phase 2 는 문자열 추출 — 충돌 면이 거의 없음). 혼자 작업하면 순차, 병렬 세션이면 동시에 가도 됩니다.

## 2. 각 기능의 실제 난도 — 조사 결과 요약

### 1번 멀티 창 — **중간**. 전례가 있으나 함정이 5개

이미 다중 창 전례가 있습니다. 트레이 팝오버가 `index.html?tray=1` 로 뜨고 `main.tsx:26-28` 이 쿼리 파라미터로 진입점을 분기합니다. 같은 패턴을 그대로 씁니다.

진짜 작업은 창을 만드는 게 아니라 **전역이라고 가정된 것들을 창 단위로 쪼개는 것**입니다:

- `localStorage` 단일 키 (`WorkspaceContext.tsx:274`)
- 전역 `PtyState` HashMap (`commands/terminal.rs:80`)
- `"main"` 을 하드코딩한 트레이 경로 (`tray.rs:508,526`)
- **"메인 창 닫기 = 앱 종료"** (`tray.rs:498-505`) ← 런처 모델에서 가장 위험한 함정

상세: [01-multi-window.md](01-multi-window.md)

### 2번 모바일 — **큼**. 전부 신규지만 읽기 API 는 이미 다 있음

HTTP 서버가 코드베이스에 **전혀** 없습니다 (`axum`/`hyper`/`tiny_http` 미포함, `reqwest` 는 클라이언트 전용, `oculpm-mcp` 는 stdio). 서버·인증·모바일 번들·배포 경로가 전부 신규입니다.

반대로 **데이터 계층은 손댈 게 없습니다.** 필요한 읽기 API 가 전부 존재합니다:
`manager.list_journal_entries` / `get_journal_entry` / `plan_list` / `plan_get` / `home::collect` / `oculpm_workday_brief`.

이 기기에서 Tailscale 동작을 실측 확인했습니다:

```
IP        100.73.187.123        (utun8)
MagicDNS  kimhyunbin-macbookpro.tail2a2edb.ts.net
CLI       /usr/local/bin/tailscale   (BackendState: Running)
```

상세: [02-mobile-tailscale.md](02-mobile-tailscale.md)

### 3번 영어화 — **가장 큼, 그러나 가장 단순**. 위험보다 물량

i18n 라이브러리도 스캐폴딩도 없습니다. 물량:

| 대상 | 규모 | 비고 |
|---|---|---|
| 프런트 UI 문자열 | **~2,100줄** / 133파일 | 주석 1,877줄 제외한 순수치. 한 줄에 문자열 여러 개인 경우가 많아 실제 키는 2,500~3,000개 추정 |
| Rust 사용자 노출 에러 | **~130곳** | `Err("한글")` / `format!("한글…")` 애드혹 |
| LLM 프롬프트 | **12파일** | `commands/{summary,overview,retro,plan,greenfield,rule_promotion,skill_promotion}.rs` + `oculpm/{reconcile,journal_draft,rule_promotion,skill_promotion,planner/ai}.rs` |

좋은 소식 하나: **`OculpmError` (`oculpm/error.rs`) 는 이미 100% 영어입니다.** 타입 시스템을 통과하는 에러는 손댈 게 없고, 커맨드 계층의 애드혹 문자열 130곳만 처리하면 됩니다.

상세: [03-i18n.md](03-i18n.md)

## 3. 세 기능이 공유하는 결정

### D1 — 창 라벨 규격

`project-<projectId>` 로 고정합니다. `projectId` 는 SQLite rowid 라 안정적이고, `tauri-plugin-window-state` 가 라벨 기준으로 창 위치·크기를 기억하므로 프로젝트별 창 배치가 자동으로 복원됩니다. 트레이 팝오버는 이미 denylist 라 영향 없습니다 (`lib.rs:435`).

### D2 — 프로젝트 1개 = 창 1개 (강제)

같은 프로젝트를 두 창에서 열 수 없습니다. 이미 열려 있으면 그 창을 포커스합니다.

이건 UX 선택이 아니라 **정합성 요구**입니다. `App.tsx:169` 의 언마운트 클린업이 `oculpmWatcherStop(projectId)` 를 호출하는데, 같은 프로젝트를 두 창에서 열면 한쪽을 닫을 때 살아 있는 다른 창의 watcher 가 죽습니다. `OculpmManager.projects` 가 `HashMap<u32, ProjectEntry>` (`manager.rs:94`) — 프로젝트 단위 단일 엔트리라 refcount 개념이 없습니다. refcount 를 도입하는 것보다 창을 1:1 로 강제하는 게 훨씬 싸고, Chrome 창 모델과도 어긋나지 않습니다.

### D3 — 모바일은 창 모델과 무관

모바일 서버는 앱 프로세스에 하나만 뜨고 **DB 의 모든 추적 프로젝트**를 서빙합니다. 창이 몇 개 열려 있든 상관없습니다. 서버 생명주기는 앱 프로세스에 묶입니다 (창이 아니라).

### D4 — 언어 설정은 전역 (창별 아님)

`SettingsContext` (SQLite 백엔드, `settings_*` 커맨드)에 `language` 필드를 추가합니다. `localStorage` 가 아니라 SQLite 라서 **창 격리 작업과 무관하게 모든 창이 같은 값을 봅니다** — 이게 맞는 동작입니다. 모바일 웹도 같은 설정을 읽습니다.

## 4. 통합 리스크 등록부

| ID | 리스크 | 영향 | 완화 |
|---|---|---|---|
| R1 | **런처 닫기 = 앱 종료** 가 프로젝트 창을 다 죽임 | 데이터 손실 위험 (미저장 상태) | `handle_main_close_requested` 를 "열린 프로젝트 창이 있으면 종료하지 않고 숨김"으로 재작성. Phase 1 최우선 |
| R2 | 새 창 라벨에 capability 누락 → 모든 IPC 무음 실패 | 창은 뜨는데 완전 먹통 | `capabilities/default.json` 에 글롭 `"project-*"` 추가. 스키마가 글롭 지원함을 확인 완료 |
| R3 | 창 A·B 가 같은 localStorage 키를 덮어씀 | 터미널 탭·필터·현재 화면 소실 | 키를 `aipm:workspace:v1:p<id>` 로 분리 + `WORKSPACE_SCHEMA_VERSION` 4 로 bump |
| R4 | 창 닫을 때 PTY 미정리 → 좀비 셸 누수 | 프로세스·메모리 누수 | 창 close 이벤트에서 해당 창 소유 sid 전량 `kill_pty_session` |
| R5 | 모바일 서버가 카페 WiFi·LAN 에 노출 | **보안 사고** | 4중 방어 — ① `/32` 점대점 + CGNAT 대역 + CLI 교차검증으로 Tailscale 인터페이스에만 바인딩 ② 검증된 주소로만 생성 가능한 `TailscaleBindAddr` newtype 이라 폴백이 **컴파일 에러** ③ 바인딩 후 `local_addr()` 되읽기 검증 ④ 요청 출발지 IP 검사. 탐지 실패 = 서버 미기동 |
| R5b | `100.64.0.0/10` 은 Tailscale 전용이 아님 — **ISP CGNAT 이 물린 WiFi 도 이 대역** | R5 와 동일 | 대역만 보지 않고 **`/32` + broadcast 없음**(점대점 터널)까지 요구. 회귀 테스트로 고정 |
| R6 | 모바일 응답에 시크릿 유출 | **보안 사고** | 반드시 `manager` 의 redaction 경로(`JournalCache::with_redaction`) 경유. 디스크 직독 금지 |
| R7 | i18n 추출 중 문자열 누락 → 영어 모드에 한글 잔존 | 품질 | `scripts/check-no-hardcoded-korean.mjs` lint 게이트를 Phase 0 에서 먼저 넣고, 파일을 처리할 때마다 allowlist 에서 뺀다 (역방향 게이트) |
| R8 | 세 Phase 가 동시에 `bindings.ts` 를 건드려 충돌 | 머지 마찰 | `bindings.ts` 는 생성물 — 충돌 시 재생성(`cargo test`)으로 해소. 손으로 머지 금지 |

## 5. Phase 별 완료 기준 (게이트)

각 Phase 는 `pnpm typecheck && pnpm test && pnpm lint && pnpm build` + `cargo test` 전부 exit 0 을 **커밋 직전 직접 확인**한 뒤에만 닫습니다.

| Phase | 추가 게이트 |
|---|---|
| 0 | `pnpm lint` 에 한글 하드코딩 검사기가 포함되고, allowlist 에 현재 133파일이 전부 등재된 상태로 통과 |
| 1 | 프로젝트 3개를 동시에 열고 각각 터미널 탭을 만든 뒤, 창을 하나씩 닫아도 나머지 창의 watcher·PTY 가 살아 있음. 런처를 닫아도 앱이 안 죽음 |
| 2 | 영어 모드에서 12개 화면 + 설정 8탭을 순회했을 때 한글 0. lint allowlist 가 빈 상태 |
| 3 | 폰(같은 tailnet)에서 일지·플래너 조회 성공. 같은 LAN 의 비-tailnet 기기에서 접속 **실패** 확인 (R5 검증) |

## 6. 릴리스 계획

Phase 마다 별도 마이너 릴리스로 끊습니다 — 셋을 한 번에 묶으면 회귀 원인 분리가 불가능합니다.

| 버전 | 내용 |
|---|---|
| v2.9.0 | Phase 0 + Phase 1 (멀티 창) |
| v2.10.0 | Phase 2 (영어화) |
| v2.11.0 | Phase 3 (모바일 읽기 전용) |

릴리스는 태그 푸시 → `release.yml` 이 빌드·서명합니다. 로컬 `pnpm build` 로 릴리스 아티팩트를 만들지 않습니다.

랜딩(`landing/`)은 git 연동이 없어 **수동 배포**입니다 — v2.11.0 처럼 사용자에게 보이는 신기능이 나가면 `landing/` 에서 `vercel --prod` 를 별도로 돌려야 합니다.
