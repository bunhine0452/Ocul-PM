---
schema_version: 1
type: feature
slug: "semantic-search-includes-journal"
status: done
difficulty: high
created_at: "2026-09-22T00:36:32+09:00"
session_id: "mcp-20260922-003632"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Opus 5 (구현 세션 E)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/journal_index.rs"
    op: create
  - path: "src-tauri/src/journal_index/tests.rs"
    op: create
  - path: "src/features/search/SemanticResults.tsx"
    op: create
  - path: "src/__tests__/semantic_journal_results.test.tsx"
    op: create
  - path: "src-tauri/src/db/code_index.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/features/settings/tabs/IndexingTab.tsx"
    op: update
  - path: "src/features/chat/aiContext.ts"
    op: update
related: []
tags:
  - "journal-scale"
  - "search"
  - "semantic"
  - "indexer"
  - "watcher"
  - "mcp-tool"
---
[x] 의미검색이 일지·롤업을 찾는다 — .oculpm 이 점 디렉터리라 walk 가 통째로 건너뛰고 있었다

## 추가 기능

플랜 `journal-scale-round` {#search-semantic-journal}. 3차 웨이브 세션 E(Opus 5) 구현, 감독자 합류. PR #28.

**원인부터**: 일지가 의미검색 색인에서 빠진 건 `.gitignore` 도 `DENY_DIR_NAMES` 도 아니었다. `WalkBuilder::standard_filters(true)` 가 켜는 `hidden(true)` 하나 — `.oculpm` 이 점으로 시작해 walk 가 통째로 건너뛴다. 워처 쪽도 3단계(journal)·3.5단계(data area)에서 `return` 하므로 코드 증분 색인에 아예 닿지 않는다. 둘 다 "예외 규칙" 이 아니라 구조적으로 안 닿는 형태였다.

- `indexer.rs`(1124줄, 래칫 고정)에 예외를 끼우지 않고 전용 `journal_index.rs`: 코드는 AST 심볼이 청크 경계지만 일지는 `##` 섹션이 경계고, diff 스냅샷·심볼·그래프가 일지엔 무의미하다. 모든 청크 앞에 `# 제목 · type · tags · workday` 머리말(임베딩 품질 + 프런트가 이 줄에서 제목·종류를 읽음), frontmatter 제외, 펜스 안 `##` 은 경계 아님, 16KB 초과 섹션은 60줄 창. 리댁션 문은 하나(`chunk_journal`), `CALL_SITE_FILES` 27→28.
- 마이그레이션 불필요 — `chunks.kind` 열이 002 부터 있었다(`ast`/`lines`), 일지는 `journal`. 롤업(`.oculpm/rollups/`)도 색인.
- **일지는 「문서 제외」 필터 밖의 제 축** — 일지도 `.md` 라 `DOC_EXCLUDE_SQL` 에 통째로 걸려 기본 상태에서 한 건도 안 나올 뻔했다. `(c.kind='journal' OR (…))` 로 감싸고 `include_journal` 백엔드 인자(limit 이 백엔드에 있어 프런트 필터면 "20건 중 남은 것" 이 된다). 설정 `search_include_journal` 기본 켬.
- 워처: 3/3.5단계에서 `schedule_journal_index`(기존 `auto_index` 가드레일 동일 — 설정 뒤·`count_files > 0`·곁일). `index_project` 가 일지 스윕을 돌리고 **화해 집합에 일지 경로를 더한다**(안 더하면 방금 넣은 행을 같은 호출 끝에서 다시 지운다 — 옵션을 끄면 이게 곧 청소 경로). 진행률 total 에 일지 수를 미리 더해 100% 에서 멈춘 채 기다리는 모양을 없앰(2번째 커밋).
- 프런트: `SemanticResults.tsx` 분리(`SearchScreenV2` 793→782). 일지 행은 제목+`TriggerBadge`+워크데이, 클릭 → `onOpenJournal`; 롤업은 일지 항목이 아니라 주간 문서라 코드 화면으로. 「일지 N건 포함」·「일지 제외」 토글. 설정 색인 탭 스위치(`settingsIndex.ts` 등록 — 설정 검색 게이트가 잡아 줌). AI 패널 RAG 는 `includeJournal: false`(일지 맥락은 `includeOculpmContext` 가 따로 싣는다).

## 알아 둘 것

- **기존 사용자는 「인덱스 재구축」을 한 번** 눌러야 727편이 들어온다 — 워처 증분은 바뀐 파일만 보고 부트스트랩은 수동이라는 기존 가드레일 그대로. 새 일지는 쓰는 즉시.
- 설정을 끄기만 해서는 든 청크가 안 사라진다 — 다음 재구축의 화해가 걷어낸다(설정 힌트에 적음).
- 중첩 `.oculpm` 트리는 색인 대상 아님(워처의 `is_nested_oculpm_path` 억제와 같은 방향).

## 검증

Rust `journal_index/tests.rs` 6(머리말·frontmatter 제외·섹션·펜스·줄 번호·리댁션 AKIA) + `db/tests.rs` 1(기본=코드+일지 / 일지 제외 / 문서 포함) · vitest 5. 통합 브랜치 전 게이트 exit 0. 실기기 육안 미실시(재구축 진행률·일지 행 포커스·토글 재검색은 확인 필요).