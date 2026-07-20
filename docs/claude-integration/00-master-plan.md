# 00. Claude Integration — 마스터 플랜 (SSOT)

> 본 문서의 위상: 본 폴더의 모든 후속 문서가 참조하는 **단일 출처**.
> 작성일 2026-07-20. attribution: claude-code (Fable 5).
> 형식 선례: [`../planner-upgrade/00-master-plan.md`](../planner-upgrade/00-master-plan.md).
> 배경 분석: [`../vibe coding/바이브코딩_상세보고서.md`](<../vibe coding/바이브코딩_상세보고서.md>) (Claude 해커톤 수상작 방법론 분석).

---

## 0. Executive Summary (한 페이지)

바이브코딩 보고서의 결론은 세 가지다: 규율을 **파일로 외부화**하고, "항상 ~해라"류 지시는 프롬프트가 아니라 **hook 으로 강제**하며, **실패를 규칙으로 승격**시키는 자기개선 루프를 돌려라.

ocul-pm 은 첫 번째(파일 SSOT)는 이미 제품의 본질이다. 그러나 나머지 둘이 비어 있다:

1. **일지 작성이 프롬프트 규칙(AGENTS.md) 의존이다.** 에이전트가 규칙을 잊으면 일지가 안 남는다. 에이전트 귀속은 100% frontmatter 자기신고이고, 세션 감지는 파일와처 휴리스틱이다 (W4 도그푸딩의 세션 중복·종료 탐지 문제의 뿌리). 이것은 보고서 6.5절이 경고하는 안티패턴 그 자체다.
2. **실패→규칙 루프의 원재료(일지 error/bug, retro 신호, entry_diffs)는 전부 쌓이는데, 루프를 돌리는 엔진이 없다.** 규칙 계층 관리도 `.claude/skills` 하나뿐이다 (CLAUDE.md / `.claude/rules` / hooks / subagents 미관리).

이 라운드의 명령: **① Claude Code 공식 연동 표면(hooks·MCP·transcript)으로 기록을 결정론화하고, ② 쌓인 작업 이력에서 규칙을 승격시키는 플라이휠을 제품화하고, ③ 기록을 바깥(Notion 등)으로 흘려보낸다.** 3 Phase · PR-CI0~8.

핵심 통찰 두 가지:

- **훅 설치는 "11번째 어댑터"다.** `agents/mod.rs` 가 이미 10종 에이전트 설정 파일을 관리형(idempotent·드리프트 감지)으로 쓰고 있다. `.claude/settings.local.json` 의 hooks 블록도 같은 패턴의 파일 하나일 뿐이다 — 신규 개념이 아니라 기존 서브시스템의 확장.
- **MCP 서버는 앱과 IPC 가 필요 없다.** SSOT 가 디스크 마크다운이므로, 독립 stdio 바이너리(`oculpm-mcp`)가 `.oculpm/` 파일을 직접 읽고 쓰면 기존 watcher→인덱싱 파이프라인이 일관성을 공짜로 담보한다. 앱이 꺼져 있어도 동작한다.

---

## 1. 조사 팩트 시트 (2026-07-20 기준)

구현 전 반드시 실측 재검증할 것 (특히 훅 payload 필드). 출처: code.claude.com/docs (hooks·mcp·sessions·plugins·statusline·agent-sdk), developers.notion.com.

| 표면 | 확인된 사실 | 리스크/캐비앳 |
|---|---|---|
| **Hooks** | SessionStart / SessionEnd / Stop / UserPromptSubmit / Pre·PostToolUse / SubagentStop 등. stdin 으로 JSON payload — 공통 필드에 `session_id`, `transcript_path`, `cwd`, `hook_event_name` 포함. 설정 위치: `~/.claude/settings.json` · `.claude/settings.json` · `.claude/settings.local.json` | 프로그래매틱 설치 공식 API 없음 → 설정 파일 직접 쓰기(우리의 어댑터 패턴)가 표준 관행. payload 필드 구성은 버전에 따라 다를 수 있음 → PR-CI0 에 실측 캡처 단계 포함 |
| **Transcript** | `~/.claude/projects/<경로슬러그>/<session-id>.jsonl`. 훅 payload 의 `transcript_path` 로 위치 획득 | **JSONL 형식은 비공식** (버전 간 변경 가능) → 방어적 파싱 + 실패 시 세션 메타만 기록하는 폴백 필수 |
| **MCP (Claude Code)** | 프로젝트 스코프 `.mcp.json` / 유저 스코프 `~/.claude.json`. transport: stdio·HTTP. tools + resources + prompts 노출 가능 | 스코프 우선순위 존재(local>project>user). 프로젝트 `.mcp.json` 은 커밋 대상 → 절대경로 문제 (D3 참조) |
| **MCP (Claude Desktop)** | `claude_desktop_config.json` 에 동일 서버 등록 가능 (stdio·HTTP). Desktop 에는 훅·transcript 없음 — **MCP 가 유일한 연동로** | 데스크탑 확장(.mcpb) 패키징은 미검증 → 후속 조사 |
| **Agent SDK** | TS/Python 만 (Rust 없음). API key 인증, Claude Code 로그인 비의존 | 임베드하려면 Node/Python 사이드카 필요 → 이번 라운드 비범위 (아웃바운드는 REST/직접 MCP 클라이언트로) |
| **Notion** | 공식 MCP `https://mcp.notion.com/mcp` (~18 도구). REST API 는 internal integration token 으로 무인 호출 가능 | 공식 MCP 는 **OAuth 전용** → 데스크탑 앱 무인 내보내기에 부적합. 블록 단위 CRUD 없음 → 페이지 단위 설계 |
| **AGENTS.md 네이티브 지원** | 조사 출처 간 상충 (버전 의존 가능성) | 우리는 이미 `.claude/CLAUDE.md` 위임 어댑터가 있어 **무영향** — 의존하지 않는다 |

---

## 2. 목표 / 비목표

**목표**

1. Claude Code 세션의 시작·종료·턴 경계를 **훅으로 정확히** 감지한다 (휴리스틱 탈피). 옵인 시 transcript 기반 **일지 초안 자동 생성** — 사람 개입 0 으로 일지가 남는다.
2. 에이전트가 마크다운 포맷을 흉내 내는 대신 **구조화 MCP 도구**(`journal_write` 등)로 기록하게 한다 — frontmatter 오기입(F7a-B 가 고치던 문제)의 원천 차단. 같은 서버로 **Claude Desktop** 에서 프로젝트 현황 질의.
3. 규칙 계층 전체(CLAUDE.md·`.claude/rules`·hooks·subagents·skills)를 앱에서 관리하고, **일지·회고 데이터에서 실패→규칙 승격을 제안**하는 플라이휠을 돌린다 (draft=AI, decision=사람).
4. 회고·일지 요약을 **Notion 으로 내보낸다** (명시적 액션, 자동 아님).

**비목표 (이번 라운드)**

- Agent SDK 임베드(앱 내 에이전트 실행) — 사이드카 런타임 비용 대비 효용 불확실, 후속 검토.
- Cursor·Gemini CLI 의 훅 상당물 — Claude Code 를 레퍼런스 구현으로 먼저. (기록 경로는 MCP·AGENTS.md 로 이미 커버.)
- 자동 양방향 동기화(Notion→ocul-pm 역방향) — 단방향 내보내기만.
- 스킬/규칙 마켓플레이스 배포 — PR-CI8 은 패키징 골격까지만.

---

## 3. 아키텍처 결정 (Decision D1~D6)

### D1 — 훅 이벤트 수신 = 파일 인박스 (포트·IPC 없음) {#d1-hook-inbox}

훅 커맨드는 stdin JSON 을 **`.oculpm/hooks/claude-events.jsonl` 에 append** 하는 POSIX sh 한 줄이다:

```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command",
  "command": "mkdir -p \"${CLAUDE_PROJECT_DIR:-.}/.oculpm/hooks\" && cat >> \"${CLAUDE_PROJECT_DIR:-.}/.oculpm/hooks/claude-events.jsonl\"" } ] } ] } }
```

- 근거: 앱이 꺼져 있어도 이벤트가 디스크에 큐잉되고, 켜지면 기존 watcher 가 픽업한다. 로컬 HTTP 서버(포트 관리·앱 상시 실행 요구)와 CLI 바이너리 배포(경로 안정성) 모두 기각.
- v1 구독 이벤트: **SessionStart · Stop · SessionEnd** 3종. PostToolUse 는 이벤트 폭주(툴콜마다 1건) 대비 효용 낮아 제외 — 파일 변경은 이미 watcher 가 본다.
- `.oculpm/hooks/` 는 **머신 로컬** — gitignore 관리 블록(`# oculpm:begin`)에 추가, watcher 는 index/ 처럼 자기억제(일지 인덱싱 금지) + 인박스 소비 라우팅.
- 소비: append-only + SQLite 에 소비 오프셋 기록 (truncate 는 훅 동시 쓰기와 경합하므로 금지). 주기적 로테이션.

### D2 — 훅 설치 위치 = `.claude/settings.local.json`, 옵인, 서명 식별 {#d2-hook-install}

- **local**(비공유) 이 기본: 팀원에게 ocul-pm 없이도 무해하지만, 남의 저장소 공유 파일(`.claude/settings.json`)을 앱이 건드리는 것은 신뢰 문제. 프로젝트 스코프 공유는 후속 옵션.
- 설치는 설정 → 에이전트 탭의 **옵인 토글**. JSON 병합 시 기존 사용자 훅 보존; 우리 엔트리는 command 문자열의 `.oculpm/hooks/` 경로를 서명으로 식별해 추가·제거 (JSON 은 주석 불가 → 관리형 블록 대신 서명 식별).
- 어댑터 드리프트 감지(`OculpmAgentDrift` 패턴)를 훅 설정에도 적용 — 외부 수정 시 배지.
- `.claude/` 가 gitignore 된 저장소(본 레포 포함)에서도 local 파일이므로 동작 동일.

### D3 — MCP 서버 = 같은 crate 의 두 번째 bin `oculpm-mcp` (stdio, 디스크 직접) {#d3-mcp-bin}

- `src-tauri` 에 `[[bin]] oculpm-mcp` 추가, oculpm 라이브러리 모듈(frontmatter 빌더·redact·planner 파서·atomic_io)을 **재사용** — 포맷 규칙의 구현이 앱과 단일 소스. tauri 의존이 무겁게 링크되면 feature 게이트로 슬림화 검토 (구현 시 판단).
- rust SDK 는 `rmcp`(공식) + tokio stdio transport.
- **앱과 IPC 없음**: 서버가 `.oculpm/` 를 직접 읽고 쓴다 → watcher 가 인덱싱. 락은 기존 `lock.rs` 규약 준수.
- 번들: Tauri sidecar(externalBin) 로 `.app` 에 동봉. 등록: 앱이 프로젝트 `.mcp.json` 에 절대경로로 기입(옵인). **절대경로 캐비앳**: 앱 이동/업데이트 시 경로 재기입 로직 포함, `.mcp.json` 이 커밋되는 팀 저장소에선 경로가 머신 종속임을 UI 에 고지 (후속: PATH 셔틀·플러그인 배포로 해소, PR-CI8).
- Claude Desktop: 같은 바이너리를 `claude_desktop_config.json` 에 등록하는 원클릭 + 스니펫 복사 UI.

### D4 — transcript 는 방어적 파싱 + 일지 초안은 reconcile 패턴 재사용 {#d4-transcript-draft}

- Stop/SessionEnd payload 의 `transcript_path` 를 읽되, **형식 비보장** 전제: 파싱 실패 시 세션 메타(시각·session_id·cwd)만으로 강등 기록. 파서는 라인 단위 관용(모르는 필드 무시).
- 일지 초안 생성은 **옵인·과금 고지** (auto-reconcile 과 동일 등급): 설정 LLM 으로 transcript 요약 → 기존 frontmatter 빌더로 규격 일지 작성 → **redact.rs 통과 후 기록**. `agent.id = claude-code` 실측 귀속 + 훅 session_id 를 세션 메타에 보존 (oculpm session_id 형식 제약: 첫 8자 workday — 합성 id `<workday>-hNN` 계열, IndexWriter 규약 준수).
- 에이전트가 이미 직접 쓴 일지가 있으면 초안 생성 **스킵** (중복 방지 — 세션 창 내 일지 존재 검사). AGENTS.md 준수 에이전트와 공존.

### D5 — 규칙 허브 = 기존 "스킬" 화면의 확장 (신규 화면 아님) {#d5-rules-hub}

- navRegistry 끝-append 제약과 12화면 밀도를 고려, 12번째 "스킬" 화면을 **"스킬·규칙" 허브**로 확장 — 탭: 스킬(현행) · 규칙(CLAUDE.md + `.claude/rules/*.md`, globs frontmatter 편집) · 훅(D2 토글·상태) · 서브에이전트(`.claude/agents`, 후순위).
- 크로스툴 번역: 규칙 파일 저장 시 기존 10종 어댑터 파이프라인으로 Cursor `.mdc` 등 병행 배포 (옵인·어댑터별 on/off). "한 규칙 소스 → 모든 에이전트" 가 차별점.
- 승격 루프(PR-CI4): 회고 신호·일지 error/bug 반복 패턴 → LLM 이 규칙 초안 + **entry_diffs 로 globs 스코프 추론** → ActionProposalCard 승인 UX 재사용 → `.claude/rules/` 저장. 절대 자동 적용 없음 (draft=AI, decision=사람 — 보고서 6.2 의 정신).

### D6 — Notion v1 = REST(internal token, 키체인), MCP 클라이언트는 범용화 단계에서 {#d6-notion-rest}

- 공식 Notion MCP 가 OAuth 전용이라 무인 내보내기에 부적합 → v1 은 사용자가 워크스페이스에서 발급한 **internal integration token** 을 키체인(`secrets.rs` 규약)에 저장하고 REST 로 페이지 생성. 기존 LLM provider 키 관리와 동일 UX.
- 내보내기는 **명시적 버튼/스케줄** (자동 동기화 아님): 회고 리포트·주간 일지 요약 → 지정 부모 페이지 아래 페이지 단위 생성(블록 CRUD 없음 전제와도 정합).
- Slack·Linear 등 확장 시점에 범용 MCP 클라이언트 모듈로 승격 (그때 Notion 도 MCP 경로 병행 검토).

---

## 4. PR 분해

게이트(전 PR 공통): `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` / `cargo test` 전부 exit 0 확인 후 커밋. 브랜치 `feat/claude-integration-<pr>`.

### Phase A — 기록의 결정론화

| PR | 범위 | 수용 기준 |
|---|---|---|
| **PR-CI0 훅 브리지** | ① 훅 payload **실측 캡처 스파이크**(로그로 필드 검증, 문서 `01-hook-payload-actual.md` 갱신) ② settings.local.json 설치/제거/드리프트 (D2) ③ `.oculpm/hooks/` 인박스 + watcher 라우팅·자기억제 + gitignore 관리 블록 (D1) ④ SessionStart/Stop/SessionEnd → SessionActor 정밀 신호 (휴리스틱과 병존, 훅 신호 우선) | 훅 켠 프로젝트에서 Claude Code 세션 1회 → 세션 1개 정확 생성·종료 (중복 0, 유령 0). 훅 끈 프로젝트 회귀 없음. 실측 payload 문서화 |
| **PR-CI1 일지 초안** | Stop/SessionEnd 시 transcript 방어적 파싱 → 옵인 LLM 초안 → redact → 규격 일지 (D4). 에이전트 자필 일지 존재 시 스킵. 설정 토글 + 과금 고지 | transcript 정상: 규격 일지 생성(frontmatter 파서 경고 0). 파싱 실패 주입 시: 메타 강등 기록. 자필 일지 있으면 미생성. 옵인 off 면 무동작 |
| **PR-CI2 oculpm-mcp v1** | `[[bin]] oculpm-mcp` + rmcp stdio (D3). 도구: `journal_write` · `plan_status` · `plan_update`. sidecar 번들 + `.mcp.json` 옵인 기입 + Desktop 등록 UI. AGENTS.md 마스터 템플릿에 "MCP 도구 우선" 문구 (template_version 5) | Claude Code 에서 3 도구 호출 → 규격 파일 생성·글리프 갱신·plan-log append 확인, watcher 인덱싱 정상. Claude Desktop 에서 `plan_status` 응답 확인. 서버 단독(앱 종료) 동작 |

### Phase B — 규칙 플라이휠

| PR | 범위 | 수용 기준 |
|---|---|---|
| **PR-CI3 규칙 허브** | 스킬 화면 → 탭 허브 (D5): 규칙 탭(CLAUDE.md·`.claude/rules` CRUD + globs 편집기), 훅 탭(CI0 토글·상태). 크로스툴 번역 옵인 | 규칙 생성→저장→Cursor `.mdc` 병행 배포 확인. 기존 스킬 기능 회귀 0 (vitest) |
| **PR-CI4 승격 루프** | 회고·일지 반복 실패 신호 추출(결정적) → LLM 규칙 초안 + entry_diffs globs 추론 → ActionProposalCard 승인 → `.claude/rules/` 저장. 회고 화면에 "규칙 후보" 섹션 | 시드 데이터에서 후보 ≥1 제안, 승인 시 규칙 파일 생성, 거절 시 무변경. 자동 적용 경로 부재를 테스트로 고정 |
| **PR-CI5 스킬 갤러리** | 추천 스킬 템플릿(self-audit · run-evals · tdd-workflow) 원클릭 설치 (기존 skills_save 재사용) | 갤러리에서 설치 → `.claude/skills/` 생성·중복 설치 가드 |

### Phase C — 검증·아웃바운드

| PR | 범위 | 수용 기준 |
|---|---|---|
| **PR-CI6 EDD-lite** | 플래너 완료 소프트 게이트(검증 일지 미연결 시 경고) + 회고 eval 신호(EVALS.md 인식·점수 추이) | 게이트 경고 표시·무시 가능(소프트). EVALS.md 있는 프로젝트에서 추이 렌더 |
| **PR-CI7 Notion 내보내기** | internal token 키체인 + REST 페이지 생성 (D6). 회고 리포트·주간 요약 내보내기 버튼 | 토큰 검증 UX, 내보내기 → Notion 페이지 생성 확인, 토큰 없으면 기능 비노출. 시크릿은 키체인 외 저장 금지(lint) |
| **PR-CI8 플러그인 패키징** | `oculpm` Claude Code 플러그인 골격(훅 + MCP 등록 번들) — 배포 채널 조사·프로토타입 | 플러그인 설치로 CI0+CI2 설정이 수동 없이 구성됨 (프로토타입 수준) |

의존성: CI1←CI0, CI2 독립(CI0 과 병행 가능), CI4←(데이터만, CI3 UI 에 얹음), CI8←CI0·CI2. 릴리스 단위: Phase A 완료 = v2.2.0 후보.

---

## 5. 보안·프라이버시 불변식

1. transcript·훅 payload 는 **로컬 밖으로 나가지 않는다** — 예외는 사용자가 옵인한 LLM 초안 생성 호출뿐 (기존 auto-reconcile 과 동일 등급, 동일 고지).
2. 일지 초안은 **redact.rs 통과 후에만** 디스크에 쓴다 (transcript 에 시크릿이 있었을 수 있음).
3. 훅 커맨드는 로컬 append 한 줄 — 네트워크·외부 실행 없음. 설치·제거는 옵인 토글로만.
4. Notion token 등 모든 자격증명은 키체인(`secrets.rs`) — DB/localStorage 금지 (기존 규율 유지).
5. `.oculpm/hooks/` 는 gitignore — 이벤트 payload(로컬 경로 포함)를 커밋하지 않는다.

---

## 6. 성공 기준 (제품 관점)

- 훅 옵인 프로젝트에서 **사람 개입 0 으로** 세션·일지가 정확히 남는다 (세션 중복·유령 0, 일지 누락 0).
- frontmatter 파서 경고가 MCP 경로 기록에서 **구조적으로 0** (자기신고 오기입 소멸).
- Claude Desktop 에서 "이 프로젝트 지금 어디까지 됐어?" 가 답변된다 (`plan_status`).
- 회고에서 제안된 규칙 후보가 실제 승인·적용되는 루프가 돈다 (플라이휠 가동).
- 회고 리포트가 버튼 한 번으로 Notion 페이지가 된다.

---

## 7. 후속 문서 (필요 시 PR 착수 시점에 작성)

- `01-hook-payload-actual.md` — PR-CI0 스파이크의 실측 payload 기록 (팩트 시트 §1 의 검증본)
- `02-mcp-tool-schemas.md` — journal_write/plan_status/plan_update 입출력 스키마 (PR-CI2)
- `03-rules-hub-ui-spec.md` — 허브 탭 구조·승격 루프 UX (PR-CI3·4)
