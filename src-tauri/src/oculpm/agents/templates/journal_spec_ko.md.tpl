<!-- template_version: 2 -->
# 일지·플랜 파일 규격 (ocul-pm)

> 이 파일은 ocul-pm 이 관리합니다 (직접 편집 금지 — 앱 업그레이드 시 갱신됨).
> 마스터 규칙(`AGENTS.md` §3)이 가리키는 on-demand 규격서입니다 — **MCP 도구(`journal_write`·`plan_update`·`plan_create`)가 없을 때만** 읽으세요. 도구가 있으면 경로·frontmatter·헤더 순서·plan-log 는 서버가 보장합니다.

## 일지

경로 `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md` — workday/시각은 OS 로컬 그대로(묻지 말 것) · TypeFolder = `Bugs`|`Features_to_add`|`Errors`|`Refactors`|`Chores` · type = bug|feature|error|refactor|chore (⚠ 커밋 타입 `fix`·`feat` 가 **아니다** — 폴더도 `Fix/` 가 아니라 `Bugs/`) · slug = ASCII kebab ≤40자.

frontmatter 필수: `schema_version: 1` · `type` · `slug` · `status`(planned|in_progress|done|abandoned) · `created_at`(⚠ tz offset 반드시 `+09:00` 형태 — `Z`/`+0900` 금지) · `session_id`(없으면 `"manual-<workday>-HHMMSS"`) · `agent`(⚠ id/version 키의 **mapping**, 문자열 금지 — id 는 네 에이전트 id(claude-code/cursor/gemini-cli/…), version 은 네 모델명) · `language`(ko|en) · `verified_by_user: false` · `files_touched`(⚠ `[{path, op}]` — op 는 create|update|delete|rename|correct enum · path 에 `[` `]` `{` `}` `:` `#` 가 있으면 **반드시 따옴표**: `{ path: "app/[locale]/page.tsx", op: update }`) · `related: []` · `tags: []`. 선택: `difficulty`(verylow~superhigh), `updated_at`.

본문: 첫 줄 `[x] 제목` 체크박스. 강제 헤더 순서 — bug/error `## 발생 원인`→`## 해결 방법` · refactor `## 동기`→`## 변경 요약` · feature `## 추가 기능`→`## 동작 흐름` · chore 자유. 공통 끝: `## 검증`(필수, 1~3줄 — **네가 아닌 것**이 말하게: 돌린 명령과 그 **결과 끝 줄**(N passed · exit 0)·실측. 명령 이름만도, 「확인했다」도 증거가 아니다. 못 돌렸으면 그렇게 적는다) · `## 메모`(선택).

예시가 필요하면 같은 type 의 최근 일지 1~2개를 직접 읽으세요 — 실제 데이터가 가장 좋은 표본입니다.

## 플랜 (`.oculpm/planner/<plan_id>.md`)

갱신: 항목 글리프 한 글자만 바꾸고, 하단 `<!-- oculpm:plan-log begin v1 -->` 표에 **한 줄 append** (기존 행 수정 금지):
`| <ISO 시각+offset> | #항목id | <네 agent.id 그대로> | 이전→새 글리프 (신규 항목은 →☐) | <방금 쓴 일지 상대경로> | 짧은 메모 |` — 셀 안의 `|` 는 `\|`. 확인 명령을 돌린 결과는 메모를 `판정 ✓ <결과 끝 줄>` 또는 `판정 ✗ <결과 끝 줄>` 로 시작한다.

규칙: `{#id}` 와 managed block 경계는 보존 · 항목은 한 줄 — `{#id}` 를 줄 *끝* 에 두고 줄바꿈 금지(둘째 줄의 `{#id}` 는 파서가 못 읽음) · 새 항목엔 안정적 영어 kebab id · 중첩은 최대 1단계(두 칸 들여쓴 `  - [ ] 하위 {#id}`, 부모 글리프는 하위 롤업) · 일지 내용을 복붙하지 말고 일지 열로 참조 · `archived:` 마커 줄은 손대지 말 것 · 현재 상태는 본문 글리프가 정답, 로그는 이력.

닫기: 미완(`[ ]`·`[~]`·`[!]`)이 남은 plan 을 `status: done` 으로 닫지 말 것 — 남은 항목을 살아 있는 plan 으로 **옮긴 뒤** 닫는다 (접힌 plan 의 미완은 유실된다).

새 plan: YAML frontmatter(`oculpm_plan: v1` · `id`(파일명과 동일 kebab) · `title`(따옴표) · `status: active` · `created`/`updated` · `owner`(네 agent.id)) → `**완료 조건:** …` · `**확인 명령:** …` 한 줄씩 → `## Phase 제목 {#id}` 헤딩(글리프 없음 — 진척은 하위 롤업) → `- [ ] 항목 {#id}` 줄 → 빈 `<!-- oculpm:plan-log begin v1 -->`…`<!-- oculpm:plan-log end -->` 블록.
