# 06. oculpm 플러그인 계약 — 무엇을 읽고, 쓰고, 절대 하지 않는가 (A3)

> 상위: [`00-master-plan.md`](00-master-plan.md) · [`04-plugin-packaging.md`](04-plugin-packaging.md).
> 작성 2026-07-31 (plugin-round A3). ECC `hooks/memory-persistence` 식 계약 문서 —
> 마켓플레이스 사용자·심사가 "이 플러그인이 내 머신에서 뭘 하는가"를 표 하나로
> 확인하는 곳. 로컬-퍼스트 신뢰 서사의 실물이다.

## 1. 구성 요소별 계약

| 구성 | 트리거 | 읽는 것 | 쓰는 것 | 하지 않는 것 |
|---|---|---|---|---|
| 훅 SessionStart/Stop | Claude Code 세션 이벤트 | stdin 의 이벤트 JSON | `<프로젝트>/.oculpm/hooks/claude-events.jsonl` 에 1줄 append | 네트워크 · 외부 실행 · `.oculpm` 없는 저장소에는 아무것도 안 씀 |
| 훅 SessionEnd | 세션 종료 (1회) | 〃 | 〃 + stderr 안내 1줄 | 〃 (Stop 에는 안내 없음 — 매 턴 소음 방지) |
| oculpm-mcp (`bin/` 셔틀 → 바이너리) | 도구 호출 시 | `<프로젝트>/.oculpm/` 마크다운·config | `journal/`·`planner/` 규격 파일 (redact 통과 후) | `.oculpm` 없거나 심볼릭 링크면 전 도구 거부 · 디렉터리 임의 생성 금지 · 앱 IPC 없음 |
| `project_init` (위 거부 규칙의 **유일한 예외**) | 사용자의 명시적 추적 시작 요청 + `confirm=true` | 프로젝트 루트 | `.oculpm/` 스캐폴드(config·schema-version·README)·`.gitignore` 관리 블록·AGENTS.md 등 어댑터 | confirm 없이 거부 · 선제/자동 호출 금지(도구 설명+instructions 로 강제) · 이미 추적 중이면 무변경 · 심볼릭 링크 `.oculpm` 거부 |
| 스킬 5종·커맨드 2종 (`/oculpm:standup` · `/oculpm:project_init`) | 모델 판단/사용자 호출 | (문서 — 실행 코드 없음) | 없음 (project_init 커맨드는 위 도구를 호출할 뿐) | 상시 컨텍스트 예산 매니페스트 테스트로 상한 고정 |

- 훅 payload 에는 대화 내용이 포함될 수 있어 `.oculpm/hooks/` 는 **앱이 gitignore
  관리 블록으로 커밋 차단**한다 (v7 블록 + 다운그레이드 가드 + union 병합).
- 모든 쓰기는 원자적(write_atomic)이고, 시크릿은 프로젝트 redact 패턴으로 마스킹된다.
- "비추적 저장소에는 아무것도 만들지 않는다"는 원칙은 `project_init` 도입(2026-08-01,
  사용자 승인) 후 "**사용자가 명시적으로 요청·확인한 초기화 한 가지만 예외**"로
  갱신됐다 — 게이트는 3중: confirm 인자 강제(`mcp/tools.rs` 테스트 잠금), 도구
  설명의 호출 조건, 서버 instructions 의 선제 호출 금지.

## 2. 설치 경로는 하나만

앱 설정의 프로젝트별 훅 토글·MCP 등록과 플러그인은 **같은 일을 다른 스코프로**
한다. 동시에 켜면 훅 이벤트 이중 적재(집합 연산이라 정확성은 유지되나 낭비) +
MCP 도구 2벌 노출. 앱 설정 화면이 플러그인 설치를 감지해 택일을 안내한다
(`claude_plugin_status`).

## 3. 버전 스큐 매트릭스

세 표면이 따로 업데이트된다: **플러그인**(마켓플레이스) · **앱**(updater) ·
**템플릿**(`template_version`, 앱이 배포).

| 조합 | 동작 | 근거 |
|---|---|---|
| 신 플러그인 + 구 앱 | 안전 — 훅 인박스는 append-only 스키마, MCP 는 디스크 SSOT 만 접촉 | 인박스 소비는 오프셋 기반 관용 파서 |
| 구 플러그인 + 신 앱 | 안전 — 이벤트 3종·도구 표면은 하위호환 유지가 계약 | 도구 제거·이벤트 스키마 변경은 major 취급 |
| 신 앱 + 구 템플릿 | 앱이 업그레이드 배지 제시 (강제 아님) | `master_upgrade_available` |
| 구 앱 + 신 템플릿/관리블록 | **다운그레이드 가드** — v(N+1) 블록은 구 앱이 건드리지 않음, gitignore 는 union 병합 | atomic_io `SkippedNewer` (2026-07-31) |
| 플러그인 ↔ Claude Code CLI | 검증 기준 2.1.220. `hooks`/`mcpServers` 는 자동발견 위임(신·구 CLI 안전) | `tests/plugin_manifest.rs` 가 계약 고정 |

- 플러그인·마켓플레이스 버전은 앱 버전과 자동 동기(`build-sidecar` 스탬프 + 테스트 강제) —
  "플러그인 vX = 앱 vX 에서 빌드·검증됨" 이 유일한 버전 서사다.

## 4. 지원 플랫폼 (v1)

macOS 전용 — `bin/oculpm-mcp` 는 POSIX sh 셔틀이고 바이너리는 .app 번들에서
해석한다. Windows/Linux 는 후속 (oculpm-mcp 가 순수 Rust bin 이라 release
파이프라인 3-platform 배포로 앱 포팅 없이 선행 가능 — 04 문서 잔여).
