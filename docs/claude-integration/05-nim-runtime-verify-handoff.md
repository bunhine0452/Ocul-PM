# 05. NIM 실호출 실기기 검증 — 다음 세션 인수인계

> 작성 2026-07-20 19:0x · 브랜치 `feat/claude-integration-ci0` (main 대비 21커밋)
> 이 문서 자체가 다음 세션에 붙여넣을 프롬프트다. 아래 「프롬프트」 절을 그대로 복사.

---

## 프롬프트 (이 아래를 복사해서 새 세션에 붙여넣기)

이 저장소(ocul-pm)의 `feat/claude-integration-ci0` 브랜치에서, **NVIDIA NIM 을 LLM
제공자로 설정해 아직 미검증인 "실호출" 기능들을 실기기 검증**해줘. 코드는 이미 다
구현·커밋됐고 게이트(cargo 384 / vitest 176 / typecheck / lint / build)는 전부 그린이야.
남은 건 **실제 LLM 호출이 도는 경로를 실앱에서 돌려보는 것**뿐이야.

### 배경 (읽을 것)

- 진척 SSOT: `.oculpm/planner/claude-integration.md` — 미완료 항목이 검증 대상이야.
- 설계 SSOT: `docs/claude-integration/00-master-plan.md` (결정 D1~D6).
- 오늘 라운드 요약: `.oculpm/journal/20260720/` 아래 일지들. 특히
  `Bugs/1901_bug_rules-managed-block-and-review-fixes.md` (적대 리뷰 수정 5건)과
  `Chores/1607_chore_phase-a-runtime-verify.md` (Phase A 실기기 확인 통과 기록).
- 규율: `CLAUDE.md` + `AGENTS.md`. 작업 단위마다 일지 1건 + 플래너 갱신, 커밋 전 게이트
  5종 직접 확인(추측 금지).

### NIM 설정 방법

앱에서: **설정 → LLM** 탭 → provider `nim` 의 API 키 입력(키체인 저장) →
**기본 제공자**를 `nim` 으로, 모델은 비워두면 기본값 `meta/llama-3.3-70b-instruct` 가
쓰여. 다른 모델을 쓰려면 `model_nim` 설정값으로 넣으면 돼.

- 백엔드 진입점: `src-tauri/src/llm/nim.rs` (BASE_URL
  `https://integrate.api.nvidia.com/v1/chat/completions`, OpenAI 호환 스키마).
- 해석 규칙: `default_provider` → `model_{provider}` → `default_model`
  (`src/lib/llmTarget.ts`, 백엔드는 `reconcile.rs`/`journal_draft.rs` 안에 동형 코드).
- 키는 OS 키체인에만 저장돼(`secrets.rs`). DB/localStorage 금지 규율 유지.

### 검증 대상 (플래너 미완료 항목 = 전부 실호출)

우선순위 순. 각 항목은 **성공/실패 모두** 결과를 일지에 남기고 플래너 글리프를 갱신해줘.

1. **`#ci1-runtime-verify` — 일지 자동 초안 (PR-CI1)**
   설정 → ocul-pm → **자동화** 탭에서 "일지 자동 초안" 켜고, **연동** 탭에서 훅 연동이
   켜져 있는지 확인. 그 다음 이 프로젝트에서 Claude Code 세션을 하나 열었다 닫아.
   기대: 세션 종료(AgentExit) 후 `.oculpm/journal/<오늘>/` 에 규격 일지 1건 자동 생성
   (frontmatter 파서 경고 0, `agent.id=claude-code`, `tags` 에 `auto-draft`).
   반대 케이스도 확인: **에이전트가 스스로 일지를 쓴 세션에서는 초안이 생기지 않아야 함**
   (`journal_draft.rs` 의 self_entry_exists 스킵).
   실패 시 강등 경로 확인: transcript 를 못 읽어도 세션 메타 chore 엔트리는 남아야 함.

2. **`#ci4-runtime-verify` — 실패→규칙 승격 루프 (PR-CI4)**
   회고 화면에서 "규칙 후보" 섹션이 실데이터로 뜨는지 → 후보의 "초안 생성"(NIM 실호출)
   → 제안 카드에서 승인 → `.claude/rules/<slug>.md` 실제 생성 확인 → **같은 후보가 다시
   제안되지 않는지**(promoted-from 마커 억제) 확인.
   ⚠ 오늘 고친 것: 넓은 glob(`src/**`)도 후보를 억제하도록 `rule_covers_area` 를
   양방향으로 바꿨어 — 넓은 규칙이 있는 상태에서 후보가 과다 노출되지 않는지도 봐줘.

3. **`#ci3-runtime-verify` — 규칙 허브 (PR-CI3)**
   규칙 탭에서 CRUD·paths 칩 편집·Cursor 병행 배포 토글(`.cursor/rules/*.mdc` 실생성).
   ⚠ **오늘 HIGH 버그를 고친 지점을 반드시 실사용으로 확인**: `.claude/CLAUDE.md` 를 열어
   (a) `oculpm:begin/end` **블록 밖** 편집 → 저장 성공 (b) **블록 안** 편집 → 거부 +
   `_template.md` 안내 메시지 (c) 저장 거부 후 디스크가 안 바뀌었는지. 그리고 프로젝트를
   다시 열어(=sync_agents 실행) 블록 밖 내 편집이 **살아있는지** 확인.

4. **`#phase-c-runtime-verify` 잔여 — EDD-lite + Notion (PR-CI6/CI7)**
   - 플래너에서 검증 일지 없는 항목을 완료로 바꿔 **소프트 게이트 다이얼로그**가 뜨는지,
     "검증 없이 완료"로 진행되는지(차단이 아니어야 함).
   - `EVALS.md` 가 있는 프로젝트에서 회고의 eval 추이 카드가 렌더되는지
     (형식은 `.claude/skills/run-evals` 템플릿의 `## 기록` 표 규약).
   - Notion: 실계정 토큰 검증 → 부모 페이지 지정 → 회고 "Notion 으로" 내보내기 →
     실제 페이지 생성 + 링크 열림. ⚠ 오늘 고친 것: URL 에 `#블록id` 프래그먼트가 붙어도
     페이지 id 를 올바로 뽑는지(`normalize_page_id`), 그리고 내보내기 본문이 redact 를
     한 번 더 통과하는지(`notion_export` 에 `project_id` 인자 추가됨).

5. **(참고) auto_reconcile** — "자동 화해" 토글도 NIM 실호출 경로야. 위 검증 중에 켜서
   일지→플랜 자동 갱신이 NIM 으로도 도는지 곁다리로 확인하면 좋아 (플래너 항목은 없음).

### NIM 특이사항으로 볼 것

이 경로들은 원래 Anthropic/OpenAI 로 개발·검증됐어. NIM(오픈웨이트 모델)에서 **JSON 출력
품질**이 관건이야:

- `journal_draft.rs` 의 `parse_draft_response` 와 `rule_promotion` 의 초안 파서는 코드펜스·
  서문을 관용적으로 벗기지만, 모델이 JSON 을 아예 안 주면 **강등/실패 경로**로 빠져.
  그게 정상 동작이니 "실패했다"가 아니라 **"어떤 실패 모드로 빠졌는지"** 를 기록해줘.
- 파싱 실패가 잦으면 프롬프트를 NIM 친화적으로 보강하거나(예: "JSON 만 출력" 강조),
  실패 시 재시도 1회를 넣는 걸 후속 항목으로 제안해줘 — **단, 프롬프트/재시도 변경은
  실측 실패를 확인한 뒤에만.** 추측으로 미리 고치지 말 것.
- 비용/속도: NIM 은 응답이 길어질 수 있어. 타임아웃이나 UI 멈춤이 보이면 그것도 기록.

### 작업 규율

- dev 실행은 `pnpm tauri dev` (한 번에 하나만 — 두 개 띄우면 락 경합).
  Ctrl+C 로 껐다 바로 켜도 이제 락에 안 막혀(오늘 `ps -p` 생존검사 fix).
- 검증 결과는 **성공이든 실패든** `.oculpm/journal/20260720 이후 날짜/` 에 일지로 남기고
  `.oculpm/planner/claude-integration.md` 의 해당 항목 글리프 + plan-log 를 갱신.
- 코드를 고쳤으면 커밋 전에 게이트 5종(`cargo test`, `pnpm typecheck`, `pnpm test`,
  `pnpm lint`, `pnpm build`)을 **직접 실행해 exit 0 을 확인**하고 커밋.
- 검증만 하고 코드 변경이 없으면 일지 type 은 `chore` 로.

### 남은 백로그 (이번 검증 범위 밖 — 손대지 말 것)

`#review-fixes-round2`(리뷰 잔여 5건), `#managed-block-versioning`(구버전 앱이 gitignore
관리블록을 downgrade 하는 위험), `#ci2-sidecar-bundle`(.app 에 oculpm-mcp 동봉),
Claude Desktop 실연결. 검증 중 관련 증상을 보면 일지 메모로만 남겨줘.

---

## (참고) 이 문서를 만든 세션이 이미 검증 완료한 것

실호출이 아니라서 이번 대상에서 빠진 것들 — 재검증 불필요:

| 항목 | 결과 |
|---|---|
| PR-CI0 훅 브리지 | 실앱 통과 — 세션 1개·`agent_label_guess=claude-code`·`ended_reason=agent_exit`, 사용자 permissions 보존 |
| PR-CI2 MCP | 앱 UI 등록 `.mcp.json` 으로 실세션 `plan_status` → 라이브 플랜 응답 |
| PR-CI8 플러그인 | `--plugin-dir` 실로드 — 도구 3종 노출·훅 3건 발화·비추적 프로젝트 무동작(가드) |
