---
schema_version: 1
type: feature
slug: journal-retrieval-tools
status: done
difficulty: medium
created_at: "2026-08-21T19:10:00+09:00"
session_id: "manual-20260821-191000"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/protocol.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src/features/skills/pluginDocs.ts"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related:
  - ".oculpm/journal/20260821/Bugs/1842_bug_oculpm-live-refresh.md"
tags: [mcp, journal, retrieval, agents-md, template-version, dogfooding]
---

[x] 에이전트가 과거 일지를 되찾을 방법이 없었다 — MCP 도구가 전부 쓰기였다

## 추가 기능

이 저장소는 30 workday 동안 일지 333건을 쌓았다 (월별 4 → 43 → 122 → 164, 하루 5~8건).
"이만큼 쌓이면 에이전트가 필요한 과거를 못 찾지 않겠냐" 는 걱정에서 출발해 실제 회수
경로를 조사했더니, 절반은 이미 있고 절반은 통째로 비어 있었다.

**있던 절반 — 경로로 찾기.** `~/.cargo/bin/oculpm` CLI(별도 코드베이스 v0.1.0)가
`PreToolUse` 훅으로 걸려 있어 `context-for <path>` 가 그 파일이 등장한 과거 bug/error
일지를 "재발 경고 · 무효화된 접근 · 알아둘 것" 으로 주입한다. 이번 라운드에서 실제로
받았고 (`watcher.rs` 편집 시 "⚠ 재발 — 59.7일 안에 bug·err 3회") 판단에 영향을 줬다.

**비어 있던 절반 — 주제로 찾기.** 이 저장소의 `oculpm-mcp` 가 노출하던 도구 5종은
`journal_write` · `plan_update` · `plan_create` · `project_init` · `plan_status` —
**전부 쓰기이고 일지를 읽거나 검색하는 도구가 하나도 없었다.** AGENTS.md 도 §1~§5 가
전부 "언제 어떻게 쓰는가" 이고, 읽기는 §2 의 "예시가 필요하면 최근 일지 1~2개" 한 줄
(서식 참고용)뿐이었다. 파일 경로가 겹치지 않는 과거 작업은 사실상 회수 불가였다.

읽기 도구 2종을 추가했다.

- **`journal_search`** — 질의(제목·본문·태그·슬러그)에 더해 `file`(files_touched 부분
  일치) · `types` · `status` · `tags`(AND) · `since`/`until` · `limit`. 본문 전문 대신
  압축 TSV 히트(`path date type st title why`)를 돌려준다.
- **`journal_read`** — 검색이 고른 경로 1건의 본문 전체 + frontmatter 요약.

## 동작 흐름

**디스크만 읽는다.** `mcp/tools.rs` 모듈 문서가 "SQLite/앱 상태에 일절 접근하지 않으므로
앱이 꺼져 있어도 동작한다" 를 계약으로 걸어 뒀다. 캐시에 기대면 그 계약이 깨지므로
검색도 파일에서 한다. 대신 **경로만으로 거를 수 있는 것을 먼저 거른다** — workday 는
첫 세그먼트, 종류는 파일명 `HHMM_<type>_<slug>.md` 의 토큰이라 파일을 열지 않고 판정된다
(실측: `types:["bug"]` 이면 333 → 78건만 읽는다). 파일명 규약을 안 지킨 일지는 거르지
않고 통과시켜 frontmatter 로 판정하므로 손수 쓴 일지도 안 놓친다.

**매치 강도로 정렬한다.** 첫 구현은 최신순이었는데 실제 코퍼스에서 바로 깨졌다 —
`"IME"` 검색이 22건을 물었고 그중 다수가 본문의 `mtime`·`time` 에 부분 일치한 것이었다.
진짜(`tag:ime`)는 4번째로 밀렸고 `limit` 에 잘리면 아예 사라진다. 제목 > 태그 > 슬러그 >
(질의 없음) > 본문 순으로 rank 를 매기고 안정 정렬해 같은 강도 안에서만 최신순이 되게
했다. 같은 질의의 상위 4건이 전부 진짜 IME 일지로 바뀌었다.

**본문은 늘 가린다.** 히트 발췌와 `journal_read` 본문 모두 프로젝트의
`auto_redact_patterns` 로 마스킹한다 — 검색은 시크릿이 새는 새 표면이 될 수 있다.
`journal_read` 의 `path` 는 에이전트가 준 문자열이라 `..`·절대경로·숨김 세그먼트를
거부하고, 실파일만 인정한다(심볼릭 링크 거부 — `.oculpm` 가드와 같은 이유).

**규칙이 절반이다.** 도구만 있고 언제 부르는지가 없으면 에이전트는 안 부른다. AGENTS.md
마스터(ko/en)에 §0 "시작하기 전 — 과거를 먼저 찾는다" 를 넣고 `template_version` 8 → 9.
기존 §1~§5 번호는 건드리지 않았다(하위 템플릿들이 절 번호를 참조한다).

## 검증

- `cargo test` 641 그린 (직전 632 + 신규 9). 새 테스트: 본문 매치 발췌 · file 필터 ·
  필터 AND 합성과 최신순 · **매치 강도가 recency 를 이김**(limit=1 이면 최신이 아니라
  가장 강한 매치가 남는다) · limit 을 넘겨도 total 은 정확 · 깨진 frontmatter 도 검색됨 ·
  경로 탈출 거부 4종 · 발췌 시크릿 마스킹 · 경로 프리필터 헬퍼.
- `pnpm typecheck` · `pnpm test`(95파일 1089건) · `pnpm lint` · `pnpm build` 각각 exit 0.
- **실제 333건 코퍼스에 대고 JSON-RPC 로 확인**: `file:"watcher.rs"` → 333 스캔 / 12 매치,
  최신순 6건 모두 진짜. `query:"IME", types:["bug"]` → 78 스캔 / 22 매치, 25ms, 상위 4건
  전부 진짜 IME 일지. `journal_read` 로 15개 files_touched·7개 태그·3,987자 본문 반환.
- 계약 테스트 갱신: `tools/list` 순서(7종) · `plugin_manifest`(landing) ·
  `plugin_docs_sync`(앱 인앱 문서). 세 게이트 모두 도구를 추가하고 문서를 빼먹으면 깨진다.

## 메모

**토큰 예산을 하나 썼다.** 마스터 템플릿은 전 추적 프로젝트의 전 세션에 상시 주입돼서
`master_templates_stay_lean_and_in_parity` 가 상한을 건다(v5 의 8,031자 회귀 방지).
§0 을 넣고 ko 는 3,983/4,800 으로 들어갔지만 en 은 5,734 로 상한 5,200 을 넘겼다 — 같은
내용에 영어가 문자를 더 쓴다. 양쪽 §0 을 최대한 조인 뒤 **en 상한만 5,800 으로 올리고,
무엇을 샀는지 테스트 주석에 이력으로 남겼다**. 조용히 올리면 그 가드는 무의미해진다.

남은 구멍: 검색은 **부분 문자열**이라 짧은 ASCII 질의는 여전히 본문에서 우연히 걸린다
(rank 가 밀어낼 뿐 total 은 부풀어 있다). 토큰/단어경계 매칭이나 임베딩 검색은 이 도구의
디스크-온리 계약과 충돌해서 손대지 않았다 — 필요해지면 별도 판단이 필요하다.

별도 `oculpm` CLI 의 `context-for` 와는 **키가 다르다**: 그쪽은 경로키(편집 직전 자동
주입), 이쪽은 주제키(에이전트가 명시 호출). 겹치지 않으므로 통합하지 않았다.
