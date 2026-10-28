<!-- template_version: 1 -->
# 일지 파일 규격 (ocul-pm)

> 이 파일은 ocul-pm 이 관리합니다 (직접 편집 금지 — 앱 업그레이드 시 갱신됨).
> 마스터 규칙(`AGENTS.md` §3)이 가리키는 on-demand 규격서입니다 — **MCP `journal_write` 도구가 없을 때만** 읽으세요. 도구가 있으면 경로·frontmatter·헤더 순서는 서버가 보장합니다.

경로 `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md` — workday/시각은 OS 로컬 그대로(묻지 말 것) · TypeFolder = `Bugs`|`Features_to_add`|`Errors`|`Refactors`|`Chores` · type = bug|feature|error|refactor|chore (⚠ 커밋 타입 `fix`·`feat` 가 **아니다** — 폴더도 `Fix/` 가 아니라 `Bugs/`) · slug = ASCII kebab ≤40자.

frontmatter 필수: `schema_version: 1` · `type` · `slug` · `status`(planned|in_progress|done|abandoned) · `created_at`(⚠ tz offset 반드시 `+09:00` 형태 — `Z`/`+0900` 금지) · `session_id`(없으면 `"manual-<workday>-HHMMSS"`) · `agent`(⚠ id/version 키의 **mapping**, 문자열 금지 — id 는 네 에이전트 id(claude-code/cursor/gemini-cli/…), version 은 네 모델명) · `language`(ko|en) · `verified_by_user: false` · `files_touched`(⚠ `[{path, op}]` — op 는 create|update|delete|rename|correct enum · path 에 `[` `]` `{` `}` `:` `#` 가 있으면 **반드시 따옴표**: `{ path: "app/[locale]/page.tsx", op: update }`) · `related: []` · `tags: []`. 선택: `difficulty`(verylow~superhigh), `updated_at`.

본문: 첫 줄 `[x] 제목` 체크박스. 강제 헤더 순서 — bug/error `## 발생 원인`→`## 해결 방법` · refactor `## 동기`→`## 변경 요약` · feature `## 추가 기능`→`## 동작 흐름` · chore 자유. 공통 끝: `## 검증`(필수, 1~3줄 — **네가 아닌 것**이 말하게: 돌린 명령과 그 **결과 끝 줄**(N passed · exit 0)·실측. 명령 이름만도, 「확인했다」도 증거가 아니다. 못 돌렸으면 그렇게 적는다) · `## 메모`(선택).

예시가 필요하면 같은 type 의 최근 일지 1~2개를 직접 읽으세요 — 실제 데이터가 가장 좋은 표본입니다.
