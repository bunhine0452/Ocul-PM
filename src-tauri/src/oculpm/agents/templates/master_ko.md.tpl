<!-- schema_version: 1 -->
<!-- template_version: 6 -->
# ocul-pm 작업 기록 규칙

당신은 ocul-pm 추적 프로젝트에서 작업 중입니다. **하나의 논리적 작업 단위**(버그 수정 / 기능 / 리팩토링 / 에러 사이클 / 잡일)를 끝낼 때마다 즉시 기록하세요 — 사용자에게 묻지 말 것.

> **MCP 도구 우선**: `oculpm` 도구(`journal_write` / `plan_status` / `plan_update` / `plan_create`)가 보이면 **아래 §2 의 파일 직접 작성 대신 도구를 쓰라** — 경로·frontmatter·{#id} 규격은 서버가 보장한다 (§4 의 플래너 갱신도 `plan_update`, 새 plan 은 `plan_create`). 도구가 안 보일 때만 직접 쓴다.

## 1. 언제 기록하는가 (5 trigger)

**bug fix**(재현되던 결함의 해소를 직접 확인) · **feature done**(첫 happy-path 동작) · **refactor batch**(기능 동일+구조 변경 완료, 테스트 그린) · **error cycle**(진단·수정 사이클 1회 — 실패도 기록) · **chore**(config/문서 등 비기능 변경 완료).

## 2. 일지 파일 규격 (도구가 없을 때만)

경로 `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md` — workday/시각은 OS 로컬 그대로(묻지 말 것) · TypeFolder = `Bugs`|`Features_to_add`|`Errors`|`Refactors`|`Chores` · type = bug|feature|error|refactor|chore · slug = ASCII kebab ≤40자.

frontmatter 필수: `schema_version: 1` · `type` · `slug` · `status`(planned|in_progress|done|abandoned) · `created_at`(⚠ tz offset 반드시 `+09:00` 형태 — `Z`/`+0900` 금지) · `session_id`(없으면 `"manual-<workday>-HHMMSS"`) · `agent`(⚠ id/version 키의 **mapping**, 문자열 금지 — id 는 네 에이전트 id(claude-code/cursor/gemini-cli/…), version 은 네 모델명) · `language`(ko|en) · `verified_by_user: false` · `files_touched`(⚠ `[{path, op}]` — op 는 create|update|delete|rename|correct enum) · `related: []` · `tags: []`. 선택: `difficulty`(verylow~superhigh), `updated_at`.

본문: 첫 줄 `[x] 제목` 체크박스. 강제 헤더 순서 — bug/error `## 발생 원인`→`## 해결 방법` · refactor `## 동기`→`## 변경 요약` · feature `## 추가 기능`→`## 동작 흐름` · chore 자유. 공통 끝: `## 검증`(필수, 어떻게 확인했는지 1~3줄) · `## 메모`(선택).

예시가 필요하면 같은 type 의 최근 일지 1~2개를 직접 읽으세요 — 실제 데이터가 가장 좋은 표본입니다.

## 3. 금지

- `.oculpm/index/**` 에 쓰기 금지 (앱 관리 영역).
- secrets / API key / `.env` 내용 포함 금지 — 감지 시 거부됩니다.
- 기존 일지 수정 금지 (새 파일 + frontmatter `related` 링크) · 한 파일에 작업 두 개 금지.

## 4. Planner 갱신 (일지 직후)

일지가 회고라면 **Planner**(`.oculpm/planner/*.md`)는 현재 계획입니다. 일지를 쓴 직후 대응 항목이 있으면 갱신하세요 (대응 항목이 없으면 생략).

1. 항목 글리프 한 글자 교체: `[ ]` 할일 · `[~]` 진행중 · `[x]` 완료 · `[!]` 막힘 · `[>]` 이월 · `[-]` 폐기
2. plan 하단 `<!-- oculpm:plan-log begin v1 -->` 표에 **한 줄 append** (기존 행 수정 금지):
   `| <ISO 시각+offset> | #항목id | <네 agent.id 그대로> | 이전→새 글리프 (신규 항목은 →☐) | <방금 쓴 일지 상대경로> | 짧은 메모 |`

규칙: `{#id}` 와 managed block 경계는 **보존** · 항목은 한 줄 — `{#id}` 를 줄 *끝* 에 두고 줄바꿈 금지(둘째 줄의 `{#id}` 는 파서가 못 읽음) · 새 항목엔 안정적 영어 kebab id 부여 · 일지 내용을 플래너에 복붙 금지(일지 열로 참조만) · **frontmatter `status:` 가 `active` 가 아닌 plan(done/archived)은 절대 수정 금지** — 그럴 땐 새 plan 에서 진행 · 현재 상태는 본문 글리프가 정답, 로그는 이력.

새 plan 은 MCP `plan_create` 로 만드는 것이 정답. 도구가 없으면: YAML frontmatter(`oculpm_plan: v1` · `id`(파일명과 동일 kebab) · `title`(따옴표) · `status: active` · `created`/`updated` · `owner`(네 agent.id)) → `## Phase 제목 {#id}` 헤딩(글리프 없음 — phase 진척은 하위 롤업 자동) → `- [ ] 항목 {#id}` 줄 → 빈 `<!-- oculpm:plan-log begin v1 -->`…`<!-- oculpm:plan-log end -->` 블록 순서로 작성.

큰 결정은 `## 결정` 섹션에 `### Decision N — 제목 {#id}` 블록으로 잠급니다 (잠금 날짜·agent.id·근거·`영향: #항목id`).

## 5. 문제 해결 문서 (명시 요청 시에만)

사용자가 *"옵션을 비교하자 / 이 문제를 정리하자 / 큰 계획을 세우자"* 고 **명시적으로 요청**할 때만 `.oculpm/discussion/<slug>/discussion.md` 를 씁니다 — 그때 **`.oculpm/agents/discussion-spec.md` 를 읽고** 그 규격을 따르세요. 일반 작업에는 만들지 말 것 (작업이 끝나면 일지·플래너가 정답).
