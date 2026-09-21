---
schema_version: 1
type: feature
slug: "weekly-rollup-layer"
status: done
difficulty: superhigh
created_at: "2026-09-21T23:36:43+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Opus 5 (구현 세션 R)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/rollup/"
    op: create
  - path: "src-tauri/src/commands/rollup.rs"
    op: create
  - path: "src-tauri/src/commands/summary/chunking.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/search/rollup_hits.rs"
    op: create
  - path: "src/features/today/WeeklyRollupCard.tsx"
    op: create
  - path: "src-tauri/src/commands/summary.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/classify.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/search.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src/features/chat/aiContext.ts"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
related: []
tags:
  - "journal-scale"
  - "rollup"
  - "summary"
  - "mcp"
  - "today"
  - "mcp-tool"
---
[x] 주간 롤업 요약 층(.oculpm/rollups) + 주간 보고 60건 캡 청킹 + 검색·AI 컨텍스트가 요약을 먼저

## 추가 기능

플랜 `journal-scale-round` {#rollup-weekly} {#weekly-cap} {#rollup-first}. 2차 웨이브 세션 R(Opus 5) 구현, 감독자 합류·충돌 해소. PR #27.

근거: 회고 화면이 9월 8일 제거되어 묶어 보는 시야가 Today 7일과 주간 보고뿐이었고, 주간 보고는 LLM 입력을 60건에서 잘라 주 100건 시절엔 40건이 「외 N개」로 사라졌다.

### 요약 층
- `.oculpm/rollups/YYYY-Www.md`: frontmatter `oculpm_rollup: v1`·`week`·`range`·`entry_count`·`entries_hash`(relative_path+body_md_hash 의 blake3 — 원본이 바뀌면 오래됨)·`generated_at`·`generator`. 섹션 다섯(한 주 요약·결정·해결한 결함·추가한 기능·이월/미완)은 **온디스크 규격**이라 UI 언어를 안 따르고, LLM 프롬프트도 같은 제목을 요구해 생성기에 따라 모양이 갈리지 않는다(테스트가 문다).
- 「결정」은 요약이 아니라 **인용** — 결정적 경로가 정직하게 할 수 있는 건 "이 주에 이런 문장이 적혔다"까지. 문장 분리는 마침표 뒤 공백/줄끝만 종결로 봐 `watcher.rs` 가 안 부서진다.
- 커맨드 3: `oculpm_rollup_week`/`_list`/`_read`(모달이 한 주만 읽는 편이 목록에 본문 전부 싣기보다 싸다). 락은 `cas::acquire_doc_guard` 재사용(파일 옆 `.lock`, 크로스프로세스).
- **schema_version 은 올리지 않았다**: 기존 일지·플래너·논의의 모양·락이 한 글자도 안 바뀌고, `automation/`·`discussion/` 선례가 같은 판정. 롤업 자신의 판은 `oculpm_rollup: v1` 이 진다.
- **워처 라우팅은 필수** — `data_area_for_path` 에 `Rollups` 영역. 안 하면 코드 변경 ndjson·증분 색인·히스토리 캡처까지 흘러가고 정직성 감사에 가짜 「누락」이 뜬다(`cas.rs` 의 doc 이 이미 적어 둔 함정). 락 파일까지 접두사가 덮는 건 의도.
- egress: `summary::call_llm` 을 지나므로 새 아웃바운드 자리 없음 — 그러려고 `call_llm` 이 스타일 대신 시스템 프롬프트 문자열을 받게 바꿈.
- Today 「이번 주 요약」 카드: 있으면 첫 문단+「오래됨」(지문을 못 구하면 배지를 안 단다 — 거짓 배지는 배지 전체를 못 믿게 만든다), 없으면 「만들기」/「AI 로 만들기」. 0건이어도 숨지 않음.

### 청킹
`LLM_ENTRY_CAP` 잘라내기 → 60건 단위 부분 요약 후 합성(map-reduce). `entry_count` 가 실제 반영 건수. `summary.rs` 812줄이 되어 `commands/summary/chunking.rs` 로 분리(617+226).

### 요약 우선
`journal_search` 응답 `rollups`(상위 3, 별도 배열; `tools/search/rollup_hits.rs`), `journal_read` 가 롤업 경로도 읽음, `aiContext` 가 롤업 문단을 최근 일지 앞에(목록 요청을 먼저 띄우고 롤업을 옆에서 받아 IPC 병렬성 테스트 통과), AGENTS 마스터 §0 "응답에 `rollups` 가 있으면 그것부터" — template_version 12→13(P 세션과 합쳐 한 번).

## 검증

게이트가 잡은 결함 2: egress `CALL_SITE_FILES` 실측 불일치(합류 후 27 로 확정), `ai_context_parts` 병렬성 회귀(2026-09-07 감사가 잡았던 것의 재발). 통합 브랜치 전 게이트 exit 0. 실기기 육안 미실시. 롤업 자동 생성(automation 스케줄)·다국어 결정 표지어는 후속.