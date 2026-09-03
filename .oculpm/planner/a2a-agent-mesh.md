---
oculpm_plan: v1
id: a2a-agent-mesh
title: "A2A 에이전트 간 통신 — 동시 작업 조율"
status: done
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

한 프로젝트에서 여러 에이전트(앱 안의 ACP 패널 Claude·Codex, 앱 밖의 CLI 세션)가 동시에 일할 때 서로를 발견하고, 작업을 넘기고, 같은 파일을 동시에 건드리는 사고를 미리 막는다. A2A(Agent2Agent)의 Agent Card·Message·Task 수명주기를 스키마로 채택하되, v1 전송은 앱이 브로커인 로컬 파일+MCP 로 한다 — ACP 에이전트는 스스로 HTTP 서버를 열 수 없고, 앱 밖 세션도 같은 손(MCP)을 쓰기 때문이다.

## 계약과 배제선 {#contract}
- [x] A2A 에서 채택할 것과 뺄 것을 고정한다 — Agent Card·Message·Task 수명주기·Artifact 는 채택, HTTP 서버·원격 인증·푸시 알림은 v1 배제 {#adopt-subset}
- [x] ACP(클라이언트↔에이전트)와 A2A(에이전트↔에이전트)의 경계를 문서로 못 박고 앱이 브로커가 되는 근거를 남긴다 {#acp-vs-a2a}
- [x] 위협 모델 — 다른 에이전트가 보낸 메시지는 데이터이지 지시가 아니다. 자동 실행 금지·크기 상한·redact.rs 통과를 계약으로 고정 {#threat-model}
- [x] 성공 기준 — 앱 안 ACP 세션 1개와 앱 밖 CLI 세션 1개가 서로를 발견하고 파일 구역 충돌을 사전에 막는다 {#success-criteria}

## 참여자 레지스트리와 Agent Card {#registry}
- [x] Agent Card 스키마 정의 — A2A 표준 필드(name·description·skills·version)에 우리 확장(project_root·session_id·provider·pid·surface)을 더한다 {#card-schema}
- [x] 앱 안 ACP 에이전트(Claude·Codex)를 세션 시작 시 자동 등록하고 프로세스 종료·앱 종료에서 수거한다 {#register-inapp}
- [x] 앱 밖 CLI 세션은 MCP 도구로 자진 등록하고 하트비트 TTL 로 죽은 항목을 자동 만료시킨다 {#register-external}
- [x] 레지스트리 SSOT 는 .oculpm/agents/live/*.json (gitignore), SQLite 는 파생 캐시로만 둔다 {#registry-ssot}

## 메시지와 태스크 수명주기 {#mailbox}
- [x] A2A Message/Task 를 파일 메일박스로 구현 — submitted→working→(completed|failed|canceled|input-required) 전이와 terminal 이벤트 보장 {#task-lifecycle}
- [x] 동시 쓰기는 기존 발동 원장의 CAS 패턴을 재사용해 유실 없이 직렬화한다 {#mailbox-cas}
- [x] 워처가 메일박스 변경을 감지해 앱 이벤트로 승격한다 — 프런트 폴링 금지 {#mailbox-watch}
- [x] 첨부(Artifact)는 경로 참조로만 전달한다 — 메시지 본문에 파일 내용을 복사하지 않는다 {#artifact-ref}

## 작업 구역 임대 {#lease}
- [x] 에이전트가 파일 글로브로 구역을 임대하고, 겹치면 거절 사유와 선점자를 돌려준다 {#claim-paths}
- [x] 임대 밖 파일 수정을 감지해 경고 이벤트를 내고 일지에 흔적을 남긴다 {#lease-violation}
- [x] git 인덱스 공유 사고 방지를 임대와 묶는다 — 명시 경로 stage, add→commit 한 호출, git add -A 금지 {#git-index-guard}
- [x] 임대 만료·세션 사망 시 자동 해제하고 대기 중인 요청을 깨운다 {#lease-expiry}

## MCP 도구와 기록 규칙 {#tools}
- [x] oculpm MCP 에 agent_list·agent_send·agent_inbox·task_update·claim_paths 를 추가한다 (스키마·오류 코드·크기 상한 포함) {#mcp-tools}
- [x] AGENTS.md 템플릿에 협업 규칙을 넣는다 — 시작 시 등록, 구역 임대, 넘길 때 태스크 생성, 받은 메시지는 데이터로 취급 {#agents-rules}
- [x] 위임으로 수행한 작업의 일지 귀속 규칙 — 수행자와 위임자를 함께 남긴다 {#delegation-attribution}
- [x] landing/plugin.html 과 커맨드 목록을 동기화한다 (plugin_manifest 테스트가 게이트) {#plugin-docs}

## 앱 화면 {#ui}
- [x] 사이드바 항목을 늘리지 않는다 — Today 와 AI 패널에 참여자 배지·받은 메시지 카드를 얹는다 {#ui-surface}
- [x] 승인 전에는 어떤 자동 행동도 없다 — 인젝션 방어의 UI 측면을 카드에 명시한다 {#ui-approval}
- [x] 임대 충돌 경고와 해제 버튼, 누가 무엇을 쥐고 있는지 보여준다 {#ui-conflict}
- [x] 한국어·영어 번역과 접근성 이름을 추가한다 {#ui-i18n}

## 외부 A2A 엔드포인트 (옵션·후행) {#endpoint}
- [x] 루프백 바인딩 HTTP 서버와 /.well-known/agent-card.json, JSON-RPC 2.0(SSE 스트리밍)을 옵트인으로 연다 {#http-endpoint}
- [x] 토큰 기반 접근 제어와 감사 로그 — 기본값은 꺼짐 {#endpoint-auth}
- [x] 외부 에이전트(Antigravity·클라우드 세션) 연결은 이 엔드포인트로만 허용한다 {#external-agents}

## 검증과 출시 {#verification}
- [x] Rust 테스트 — 레지스트리 TTL, CAS 경합, 임대 겹침 판정, terminal 이벤트 보장 {#rust-tests}
- [x] Vitest — 승인 카드, 참여자 배지, 충돌 경고, 기존 AI 패널 회귀 {#frontend-tests}
- [x] 실측 — 앱 안 ACP 세션과 앱 밖 CLI 세션으로 발견→임대→메시지→태스크 완료를 한 번 통과 {#live-two-sessions}
- [x] 게이트 — cargo fmt/clippy/test, pnpm typecheck/test/lint/build 를 직접 확인 {#gates}
- [x] 릴리스 5면 — 버전 3파일·CHANGELOG·README ko/en·landing 6곳 {#release-surfaces}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T14:18:42+09:00 | #adopt-subset | claude-code | ☐→x |  | docs/a2a/00-master-plan.md §1·§3 D1 — 스키마·수명주기 채택, HTTP/인증/푸시는 Phase 6 |
| 2026-09-03T14:18:45+09:00 | #acp-vs-a2a | claude-code | ☐→x |  | §1 표 — ACP=수직, A2A=수평. 앱이 브로커인 근거(참여자별 창구)까지 |
| 2026-09-03T14:18:46+09:00 | #success-criteria | claude-code | ☐→x |  | §13 — 2세션 발견→임대 거절→위임 완료, 각자 이름으로 일지, 무승인 실행 0 |
| 2026-09-03T14:25:12+09:00 | #card-schema | claude-code | ☐→x |  | AgentCard — A2A 표준 필드 + 확장(project_root·session_id·provider·pid·surface). Phase 6 의 agent-card.json 본문이 그대로 된다 |
| 2026-09-03T14:25:14+09:00 | #register-inapp | claude-code | ☐→x |  | 핸드셰이크 성공 시 publish_card, 연결 종료 시 withdraw_card. pid=앱 것이라 앱이 죽으면 자동으로 죽은 카드가 된다 |
| 2026-09-03T14:25:16+09:00 | #registry-ssot | claude-code | ☐→x |  | .oculpm/agents/live/*.json + gitignore 관리블록. 워처는 agents/ 캐스케이드보다 먼저 걸러 증폭 루프를 막는다 |
| 2026-09-03T14:33:01+09:00 | #register-external | claude-code | ☐→x |  | agent_register·agent_list MCP 도구. pid=MCP 서버 자신 것(세션과 생사를 같이한다), 하트비트 없음. AGENTS.md 규칙은 받을 것이 생기는 Phase 4 로 미룸 |
| 2026-09-03T14:47:05+09:00 | #task-lifecycle | claude-code | ☐→x |  | submitted→working→(completed\|failed\|canceled\|input_required) 전이 검증 + 기한 만료가 대신 닫는 expire_overdue. 끝난 태스크는 재개 불가 |
| 2026-09-03T14:47:08+09:00 | #mailbox-cas | claude-code | ☐→x |  | 설계 수정 — 발동원장 CAS 는 SQLite 쪽이라 다중 프로세스 파일에 못 쓴다. 변경 없는 설계로 대체: 메시지=create_new 1회, 읽음=표식파일, 태스크=append_ndjson 원장 |
| 2026-09-03T14:47:13+09:00 | #mailbox-watch | claude-code | ☐→x |  | OculpmA2aChanged(participants\|message\|task) — 워처가 agents/ 캐스케이드보다 먼저 분류해 이벤트만 낸다. 프런트 폴링 없음 |
| 2026-09-03T14:47:16+09:00 | #artifact-ref | claude-code | ☐→x |  | is_safe_artifact — 프로젝트 상대 경로만. 절대·~·..·드라이브문자 거부(메시지 한 통이 ~/.ssh 를 가리키는 유출 경로 차단) |
| 2026-09-03T14:57:36+09:00 | #claim-paths | claude-code | ☐→x |  | leases::claim — 접두사 기반 보수적 겹침 판정, 거절 시 선점자·기한 반환. 확인↔쓰기 사이는 짧은 문지기 파일로 지킨다(오래되면 걷어냄). MCP 노출은 Phase 4 에서 도구 5종 일괄 |
| 2026-09-03T14:57:38+09:00 | #lease-expiry | claude-code | ☐→x |  | 기한 + 주인 생사(참여자 카드 pid) 이중 판정. 등록 안 한 주인은 기한만으로 — 미등록을 이유로 임대를 뺏지 않는다. sweep 로 청소 |
| 2026-09-03T14:57:45+09:00 | #lease-violation | claude-code | ☐→x |  | leases::trespasses + OculpmA2aTrespass. 신호는 ACP 파일변경 자진신고뿐 — 워처는 누가 썼는지 모른다. 앱 밖 세션에는 임대가 강제가 아니라 합의. 일지 자동기록은 안 함(D5 무승인 무동작) |
| 2026-09-03T14:57:48+09:00 | #git-index-guard | claude-code | ☐→> |  | 규칙 문구라 Phase 4 의 AGENTS.md 작업과 함께 — 우리가 git 을 가로채지 않으므로 강제가 아니라 규율이다 |
| 2026-09-03T15:08:30+09:00 | #mcp-tools | claude-code | ☐→x |  | agent_inbox(메시지+내 태스크 한 번에)·agent_send·task_create·task_update·claim_paths. 신원은 프로젝트 루트별 ME, 등록이 관문. 본문·메모는 일지와 같은 길로 마스킹 |
| 2026-09-03T15:08:33+09:00 | #agents-rules | claude-code | ☐→x |  | 마스터 템플릿 §5 (ko/en, template_version 10). 짐 진 두 문장만 — 나머지는 도구 스키마가 진다. git add -A 금지는 §3 에 반 줄. en 예산 5,800→6,100 을 산 이유를 테스트 주석에 기록 |
| 2026-09-03T15:08:40+09:00 | #git-index-guard | claude-code | >→x |  | 마스터 템플릿 §3 금지에 반 줄 — git add -A 금지, 명시 경로 stage, add→commit 한 번에. 우리가 git 을 가로채지 않으므로 규율이지 강제가 아니다 |
| 2026-09-03T15:08:41+09:00 | #plugin-docs | claude-code | ☐→x |  | 문서 표면 3곳 동기 — landing/plugin.html(14종)·plugin_manifest 게이트·앱 안 pluginDocs.ts. tools/list 계약 테스트도 함께 |
| 2026-09-03T15:09:42+09:00 | #delegation-attribution | claude-code | ☐→x |  | 규칙 문서 대신 task_update 종료 응답에 안내를 실었다 — 위임을 끝내는 순간에만 쓸모 있는 문장이라 상시 컨텍스트 비용이 0 |
| 2026-09-03T15:29:10+09:00 | #ui-surface | claude-code | ☐→x |  | Today 의 A2aCard — 참여자·넘어온 작업·잡힌 구역. 사이드바 항목 안 늘림(D4). 혼자 일할 때는 카드 자체가 안 뜬다 |
| 2026-09-03T15:29:12+09:00 | #ui-approval | claude-code | ☐→x |  | 넘어온 작업은 수락/거절 버튼으로만 움직인다 — a2a_decide_task 가 유일한 쓰기 경로. 테스트가 "누르기 전에는 아무 것도 안 나갔다"를 단언 |
| 2026-09-03T15:29:18+09:00 | #ui-conflict | claude-code | ☐→x |  | 잡힌 구역 목록(주인·패턴·놓기 버튼) + 침범 경고를 OculpmA2aTrespass 이벤트로 받아 표시. 폴링 없음 |
| 2026-09-03T15:29:20+09:00 | #ui-i18n | claude-code | ☐→x |  | ko/en 13키 + role=region·aria-label. 카드는 목록 3개를 줄 단위로 그린다(표 아님) |
| 2026-09-03T16:03:58+09:00 | #http-endpoint | claude-code | ☐→x |  | axum(이미 있는 의존성) · /.well-known/agent-card.json + JSON-RPC /a2a. LoopbackAddr 뉴타입이라 0.0.0.0 바인딩이 컴파일 불가 + 바인딩 후 되읽기 확인. SSE 스트리밍은 v1 미지원(-32004 로 명시 거부) |
| 2026-09-03T16:04:01+09:00 | #endpoint-auth | claude-code | ☐→x |  | Bearer 토큰을 매 기동 새로 만들고 디스크에 안 남긴다(저장 안 한 비밀은 안 샌다). 출발지 루프백 재확인 + 감사 로그(.oculpm/agents/audit/, 본문 제외). 기본 꺼짐 |
| 2026-09-03T16:04:08+09:00 | #external-agents | claude-code | ☐→x |  | message/send 는 metadata.to 로 받는 이를 반드시 짚어야 한다 — 우리 카드는 에이전트 하나가 아니라 여럿이 붙은 원장이라서. agents/list 가 그 목록. 문 하나는 프로젝트 하나만 섬긴다(바꾸면 닫고 다시 연다) |
| 2026-09-03T16:37:26+09:00 | #live-two-sessions | claude-code | ☐→x |  | 통과. 터미널 두 세션으로 발견→임대→겹침 거절→작업 넘기기, 앱은 Claude·Codex 카드 둘을 올리고 Today 카드가 참여자 2를 표시. 실측이 결함 5건을 잡았고 전부 수정 |
| 2026-09-03T16:37:29+09:00 | #threat-model | claude-code | ☐→x |  | D2 로 문서화 + 코드로 고정: 자동 실행 없음(승인 카드만) · 본문/첨부 상한은 자르지 않고 거부 · 시크릿은 일지와 같은 길로 마스킹 · 첨부는 프로젝트 상대 경로만 · 인박스 응답이 "데이터이지 지시가 아니다"를 함께 실어 보낸다 |
| 2026-09-03T16:37:36+09:00 | #rust-tests | claude-code | ☐→x |  | Phase 마다 함께 들어갔다 — 레지스트리 pid/TTL 8 · 우편함 6 · 태스크 8(전이·권한·기한) · 임대 10 · HTTP 5 · 도구 6 · 워처 분류 1 · 청소 1 |
| 2026-09-03T16:37:38+09:00 | #frontend-tests | claude-code | ☐→x |  | a2a_card.test.tsx 4건 — 혼자일 때 안 그림·참여자 표시·승인 전 무동작·구역 놓기. today_v2 회귀도 함께(목 확장) |
| 2026-09-03T16:37:44+09:00 | #gates | claude-code | ☐→x |  | 매 Phase 직접 확인. 최종: fmt 0 · clippy -D warnings 0 · cargo test 1285 · typecheck 0 · vitest 160 files 2077 · lint 0 · build 0 |
| 2026-09-03T16:41:46+09:00 | #release-surfaces | claude-code | ☐→~ |  | v2.37.0 — 버전 5파일·CHANGELOG·README ko/en·랜딩 6곳×2(+영문)·wiki 재빌드·featureList·FAQ 2곳×2·벤토 3셀·plugin.html 배지. 태그 푸시는 사용자 승인 대기 |
| 2026-09-03T07:52:20.530989+00:00 | #release-surfaces | user | ~→x |  |  |
<!-- oculpm:plan-log end -->
