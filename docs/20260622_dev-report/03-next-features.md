# 03 — 발전 방향 (다음 기능)

> 5개 관점(AI-네이티브 / 파워유저 / 협업·공유 / 도입·통합 / 신뢰성·규모)의 제안을 중복 제거·우선순위화했다.
> 모든 제안은 **이미 존재하는 코드**에 근거한다(파일 경로 명시). Ocul-PM 의 고유 자산 = *에이전트가 실제로 무엇을 했는지의 로컬·구조화·종단 기록*(일지 + 영속 diff sidecar + 코드그래프 + 의미검색)을 직접 활용하는 것을 우선했다.

## 우선순위 매트릭스

| # | 기능 | 노력 | 임팩트 | 핵심 근거 (재활용 자산) |
|---|---|:---:|:---:|---|
| **R1** | **redaction 일지·diff 경로 연결** | S~M | high | `redact.rs`(완성, planner 만 소비) → `02` 문서 |
| **F1** | **자동 일지→플래너 화해** | M | ★transformative | watcher `Inserted` 훅 + `plan_ai_refresh` 머신 |
| **F2** | **정직성 감사 (빠뜨린 변경 탐지)** | M | high | `compare_layers`(완성·미사용) + `entry_diffs` |
| **F3** | **백엔드 저널 쿼리 + 무한 타임라인** | M | high | `EntryFilters`(완성, filters 인자 미사용) |
| **F7a** | **파싱 경고 노출 + frontmatter 자동보정** | M | high | `parse_ok`/`parse_warnings`(저장만, DTO 미노출) |
| **P1** | **키보드 우선 diff 검토 (j/k·in-diff 검색)** | M | high | `DiffScreenV2`+`diffParse.ts`+`diffReadPaths` |
| **A1** | **에이전트 감지 확대 (Windsurf/Copilot/Codex/aider/Cline/Zed)** | S | high | `agents/mod.rs` 정적 테이블(설계된 확장점) |
| **F5** | **Git 히스토리 백필** | M | ★transformative | `git.rs` log/diff + `entry_diffs` tier-3 |
| **F4** | **회고/인사이트 생성** | L | high | overview 파이프라인 + 코드그래프 centrality |
| **C1** | **스탠드업·PR 본문 생성 (clipboard)** | M | high | LLM 폴백체인 + `git_log_range` |
| **C2** | **공유 가능한 일지 내보내기 (HTML/MD)** | M | high | SSOT 읽기 + PatchView 렌더 + dialog 플러그인 |
| **F6** | **일지+그래프+diff 위 코드베이스 Q&A** | L | high | `aiContext.ts` + `entry_diffs` + `related` 링크 |
| **P2** | **검토 세션 (journal·diff·plan·영향 통합)** | L | high | `group_changes`+`get_change_impact`+`set_journal_verified` |
| **N1** | **무결성 닥터 (SSOT↔캐시 진단)** | M | high | `walk_journal`+`parse_ok`+lock/index 이력 |
| **A2** | **자동 커밋 + CI 일지 검증기** | M | high | `git::run_git` + `journal_committed`(죽은 플래그) |
| **P3** | **심볼 단위 코드맵 + 파급 캔버스 페인팅** | L | medium | `get_code_graph(symbol_level)`+`get_file_calls` |
| **N2** | **증분 코드그래프 재구축 + 해시 변경감지** | L | medium | `rebuild_code_graph`(풀리빌드) + blake3 게이트 |
| **N3** | **백엔드 워크데이 집계 + 가상화 타임라인** | L | medium | 미구현 `daily_brief` 설계 + 기존 집계 쿼리 |
| **AI1** | **AI 패널 정리: 스트림 취소·에러시 영속·이중구현 통합** | M | medium | `AiPanelScreenV2`/`ChatPanel` gap |
| **N4** | **SSOT 동시쓰기 보호 (CAS + 파일락)** | L | medium | `lock.rs` TOCTOU + `atomic_io` O_EXCL |
| **C3** | **팀 일지 머지 뷰 (git-as-sync)** | L | high | 1파일=1일지 충돌무관 설계 + git author |
| **C4** | **선택적 암호화 백업·멀티머신** | XL | medium | `atomic_io`+keyring+dialog |

---

## Now — 다음 1~2 릴리스 (안전 전제 + 간판 기능)

### R1. redaction 을 일지·diff 경로에 연결  `[S~M · high]`
→ 상세 `02-structural-debt.md §2`. **1순위.** 5개 관점 중 4개가 이걸 전제로 지목. 그 자체로 보안 버그를 닫고, 이후 모든 AI/공유/내보내기 기능의 안전을 by construction 으로 보장.

### F1. 자동 일지→플래너 화해 `[M · transformative]`
**문제** 간판 약속("에이전트가 일지를 쓰면 플랜도 스스로 갱신")이 미실현. 플랜은 수동 "AI 갱신" 또는 외부 수기 편집으로만 바뀜.
**제안** watcher 의 신규-일지 인덱싱 분기(`watcher.rs` `apply_journal_cache_invalidation` → 이미 `capture_entry_diffs` 호출)에 디바운스된 화해 패스 추가. `planner/ai.rs`(프롬프트+파싱) + `plan.rs` `plan_ai_refresh` 로직(`set_item_status`/`append_log_row`)을 **방금 쓰인 항목 1개** 스코프로 재사용해 "이 일지가 어떤 item_id 를 진전시켰나"를 물어 유효 status flip 만 적용. `agent_id='auto:<provider>'`, 지금까지 `None` 이던 `journal_ref` 채움.
**근거** `oculpm/watcher.rs`, `oculpm/planner/ai.rs`+`commands/plan.rs`, 미사용 `LogRow.journal_ref` 필드. **`02 §1`(플래너 일원화)과 함께 가면 시너지 — 화해 대상이 파일 기반 단일 플랜으로 정리됨.**
**의존** `ai.rs` 에 per-entry 프롬프트 변형 + `OculpmConfig` 플래그. 일지↔플랜 매칭은 "단일 활성 플랜"부터 시작.

### F2. 정직성 감사 — 에이전트가 빠뜨린 변경 탐지 `[M · high]`
**문제** 제품의 신뢰 전제("일지가 실제 변경을 반영")를 아무것도 검증 안 함. 에이전트가 12파일 바꾸고 3개만 기록해도 모름.
**제안** **이미 완성된 `oculpm_compare_layers`**(현재 호출처 0)를 재활성화. file_changes.ndjson(워처 ground-truth) vs 세션 일지의 files_touched 합집합을 비교해 `only_in_index`(바뀌었으나 미기록) 파일을 severity 칩으로 노출. 각 미기록 파일에 "이 변경 일지에 추가" 원클릭 → `ManualEntryModalV2` 프리필 + 그 파일의 `entry_diffs` sidecar 를 LLM 에 먹여 narrative 자동 초안. **격차를 표시만 하는 게 아니라 앱이 이미 캡처한 diff 로 채워준다.**
**근거** `manager.rs` `compare_layers`(LayerComparison DTO·severity 완성), `index.rs` ndjson, `cache.rs` files_for_session, `entry_diffs.rs` sidecar, `ManualEntryModalV2`.
**의존** 최근 윈도우 session_id 열거(sessions.json). → `01 §3-B` 의 재활성화 후보.

### F3. 백엔드 기반 저널 쿼리 + 무한 타임라인 `[M · high]`
**문제** 작업 일지 화면이 하드코딩 14일(`useJournalDays.ts` `DEFAULT_DAYS=14`)을 14번의 개별 list 콜로 받아 그 인메모리 윈도우만 ⌘F/scope 필터. 14일보다 오래된 일지는 검색으로도 못 닿음. **결정적으로 백엔드 `EntryFilters`(types/agents/difficulties/search/verified_only/unfinished_only)가 이미 완성**돼 있는데 `filters` 인자를 호출하는 곳이 없음.
**제안** `oculpm_list_journal_entries(workday=null, filters)` 전체-기간 쿼리 모드 추가(`cache.rs list_entries` 의 agents/difficulties 분기 완성). 타임라인을 IntersectionObserver 기반 "더 이전 불러오기" 무한 스크롤로 전환, 필터 켜지면 backend 전체-기간 쿼리로 스위치. 툴바에 에이전트/난이도/미완료/검증됨 칩(`observed_agent_ids`·`difficulty_mix` 가 옵션 소스).
**근거** `cache.rs` `EntryFilters`+`list_entries`(tags/type 인덱스 존재), `api/oculpm.ts listJournalEntries`(filters 파라미터 노출만 됨).
**의존** `WorkspaceContext.journalFilter` 를 단일 문자열→구조화 객체로(localStorage 스키마 버전 고려).

### F7a. 파싱 경고 노출 + frontmatter 자동 보정 `[M · high]`
**문제** 깨진 에이전트 일지에 대한 신뢰성 신호가 UI 에 0. `frontmatter.rs` 가 `parse_warnings` 를 기록하고 `cache.rs` 가 `parse_ok`/`parse_warnings` 컬럼에 저장하지만 DTO(`spec.rs`)에 필드가 없어 노출 안 됨. tz 누락(UTC 오해석)·agent-as-string·잘못된 op 같은 spec 의 "도그푸딩 마찰 top 3" 가 보이지 않고 보정도 없음.
**제안** **(A 노출)** `JournalEntry(Summary)` 에 `parse_ok`/`parse_warnings` 추가(SELECT 확장만), EntryDetail/타임라인 카드에 ⚠ 배지. **(B 보정)** `coerce_frontmatter` 에 보수적 패스: tz 없으면 workday resolver.tz 로 offset backfill(경고 기록), slug 정규화. 디스크 원본 불변, 캐시/표시에만 반영. "원본 고치기" 시 `oculpm_update_entry_meta`(이미 존재·legacy 만 호출)로 1회 기록.
**근거** `frontmatter.rs coerce_frontmatter`, `cache.rs`(컬럼 저장 완료), `spec.rs` DTO, W6-PR2 "frontmatter 자동 보정" 미구현 항목. → `01 §3-B` 재활성화(`update_entry_meta`).

### P1. 키보드 우선 diff 검토 모드 `[M · high]`
**문제** `DiffScreenV2` 는 에이전트 변경 검토의 핵심 면인데 전적으로 마우스 전용 — j/k 파일 이동도, ⌘F in-diff 검색도, 헌크 컨텍스트 확장도 없음(컨텍스트 radius 가 모든 곳에서 `3` 하드코딩). 02-screen-specs §3 의 "j/k + ⌘F" 미구현.
**제안** 화면-로컬 keydown 레이어(터미널/저널이 쓰는 패턴): j/k=파일 이동(즉시 패치 로드), x/Space=검토 완료 토글(`diffReadPaths` 존재), `]`/`[`=다음/이전 미검토, ⌘F=in-diff 검색(`classifyDiffLines` 출력에 매치 인덱스). 헌크 "컨텍스트 펼치기"는 `compute_diff`/`render_unified_diff` 의 `context_radius(3)` 를 인자화. 글로벌 ⌘1-7 충돌은 diff 포커스 가드로 차단.
**근거** `DiffScreenV2.tsx`(diffReadPaths 로직 존재), `PatchView.tsx`/`diffParse.ts`, `commands/diff.rs compute_diff`+`git.rs render_unified_diff`.

### A1. 에이전트 감지·AGENTS.md 동기화 확대 `[S · high]`
**문제** 통합 서사는 "AGENTS.md 동기화로 아무 에이전트나 일지 작성"인데, 감지·렌더는 4계열(cursor/claude-code/antigravity/gemini-cli + 범용 AGENTS.md)만 안다. Windsurf·GitHub Copilot·Codex·aider·Cline·Zed 사용자는 "에이전트 미감지".
**제안** `agents/mod.rs known_adapters()` 에 행 추가: 각 도구의 표준 instruction 경로 + write_mode(co-owned 파일은 ManagedBlock, 전용 파일은 Overwrite), 기존 `@AGENTS.md` 위임-스텁 트릭 재사용, `adjacent_marker_for()` 에 마커 추가. 순수 가산적 변경.
**근거** `agents/mod.rs` 는 정적 테이블 + `detect()` — 행 추가가 설계된 확장점. ManagedBlock/Overwrite 머신(`atomic_io`)이 co-owned 파일을 멱등 처리.
**의존** 없음. 각 도구의 정확한 instruction 경로는 도구별 확인(엔지니어링 아닌 리서치 단계).

---

## Next — 분기 (가치 확장)

### F5. Git 히스토리 백필 — 콜드스타트 절벽 제거 `[M · transformative]`
**문제** 일지는 AGENTS.md 에이전트가 앞으로 써야만 생긴다. 이미 수개월 Claude Code/Cursor 작업이 쌓인 실제 레포는 git 히스토리는 풍부하나 `.oculpm/journal/` 이 비어 — day 1 에 Today/타임라인/Planner 가 전부 빈 화면 → 죽은 제품처럼 보임.
**제안** `oculpm_backfill_from_git(project_id, since, max)`: `git log`(`git.rs` `log`/`log_range`/`changes_in_range`/`diff_at_nearest_commit` 재사용)를 걸어 커밋당 일지 1개 합성 — subject→title/slug(`validate_slug` 존재), body→narrative, 변경파일→files_touched + 실제 per-file diff 를 `entry_diffs` sidecar 로 직접 캡처(tier-3 'nearest-commit' 경로가 바로 이 머신), created_at←author date+tz, agent.id←커밋 trailer("Co-Authored-By")에서 휴리스틱 추론.
**근거** `git.rs`(log/diff 완비), `entry_diffs.rs`(커밋에서 per-file diff 재구성+self-heal), `validate_slug`+`create_manual_journal_entry` 쓰기 경로, synthetic session_id 형식(`<workday>-mNN`, 메모리 노트 준수).
**의존** `.oculpm` init 후 실행. redaction(R1) 선행 권장(옛 diff 스크럽).

### F4. 회고/인사이트 생성 `[L · high]`
**문제** 타입별 일지·per-file diff·에러 사이클·에이전트 귀속·의존성 그래프라는 고유 종단 기록이 쌓이는데 시간축 종합이 0(회고·주간요약·인사이트 부재).
**제안** "회고" 면(경량 화면 또는 Today 드로어): 기간 선택 → LLM 한국어 회고. 무엇이 출시됐나(done 플랜 항목 + 기능/리팩토링 일지), 무엇이 저항했나(에러 타입 + bug 일지의 반복 파일), 어디에 노력이 몰렸나(files_touched 빈도 × **코드그래프 hub 노드** `get_change_impact` 교차 → "이번 주 고팬아웃 코어 모듈에 시간 씀"을 근거 있게), 에이전트별 기여. 결과는 캐시 + 일지로 재기록 가능.
**근거** `oculpm_overview_stats`(by_type/by_agent/heatmap), `cache.rs list_entries`(full body), `commands/graph.rs get_change_impact`/`get_file_calls`/centrality, 캐싱은 `commands/overview.rs run_generation` 패턴. → `01 §3-B`(overview 파이프라인 재활성화).

### C1. 스탠드업·PR 본문 생성 `[M · high]`
**문제** 개발자가 매일 손으로 재작성하는 것(스탠드업·PR 설명·주간보고)이 바로 Ocul-PM 이 이미 구조화해 가진 데이터(날짜·타입·난이도·에이전트 귀속 일지 + git 커밋).
**제안** `oculpm_generate_summary(project_id, range, style)` (`style ∈ {standup, pr_description, weekly_status}`): 기간 일지 + 매칭 커밋(`git_log_range`)을 redact 후 **`plan_ai_refresh` 와 동일한 provider+failover 경로**로 LLM 에 전송. style 별 시스템 프롬프트. clipboard 복사(클립보드 플러그인 추가 필요) 또는 파일 저장.
**근거** `commands/plan.rs` provider/fallback/keychain 패턴, `llm/mod.rs create()`, `git_log_range`(GitCommit 메타), SSOT 일지 읽기.
**의존** R1(redaction-on-read) 공유. 클립보드 플러그인(현재 미설치) 또는 dialog 저장.

### C2. 공유 가능한 일지 내보내기 (HTML/MD) `[M · high]`
**문제** 코드베이스 어디에도 export 경로가 없음. "이번 주 AI 가 뭘 출시했는지"를 동료/매니저/클라이언트에게 건넬 산출물이 없어 화면 공유밖에 없음 — 로컬-퍼스트 도구의 가장 유기적 입소문 채널을 막음.
**제안** `oculpm_export_digest(project_id, scope)` (scope=워크데이/날짜범위/플랜): 일지 + per-entry diff(sidecar) + 플랜을 수집해 **자기완결 단일 .html**(인라인 CSS + PatchView 식 diff 컬러, 네트워크 자산 0) 또는 평탄화 .md 번들로 렌더, 폴더 피커로 저장. 모든 body/frontmatter/경로/diff 를 `redact_text` 통과 + forbidden-path 일지 제외. **엄격 read-only·offline.**
**근거** SSOT 읽기(`list_journal_entries`/`read_or_reconstruct_entry_diffs`), `redact.rs`(R1), 문서뷰어+PatchView 렌더 경로, `tauri-plugin-dialog`(설치됨).
**의존** R1. HTML 변형은 번들 템플릿, .md 번들은 무의존(먼저 출시 가능).

### F6. 일지+그래프+diff 위 코드베이스 Q&A `[L · high]`
**문제** AI 패널 RAG 는 코드 청크 + 최근 일지 제목 평면 목록만 검색. "이 파일이 왜 이렇게 됐어?"·"지난주 auth 에서 뭘 왜 바꿨어?"·"이 함수 마지막으로 누가 왜 건드렸어?" 같은, Ocul-PM 만 답할 수 있는 질문을 못 함. 일지 본문·per-entry diff·`related` 교차링크(파싱·저장되나 **어디에도 렌더 안 됨**)·콜그래프가 다 디스크에 있는데 안 씀.
**제안** `aiContext.ts assembleAiContext` 에 "history-aware" 검색 모드: 질의가 파일/심볼 언급 또는 why/when/who 면 → (a) files_touched 에 그 경로를 포함하는 일지(narrative+linked plan), (b) `entry_diffs` sidecar(실제 변경 텍스트), (c) `get_file_calls`/`get_change_impact`(구조적 이웃), (d) frontmatter `related` 그래프 를 해석해 "### 변경 이력" 컨텍스트 블록으로 주입. 특정 일지+diff+엣지를 인용하며 답변(인용 pill UI 는 `ChatPanel ContextBadge` 패턴 존재).
**근거** `aiContext.ts`, `commands/oculpm.rs`(files_touched 키 조회), `entry_diffs.rs get_entry_diffs`, `commands/graph.rs`, `frontmatter.rs parse_related`(`RelatedRef` — 저장만, 미렌더). **부수: 오래 저장만 돼온 교차링크 데이터가 처음으로 가시화됨.**
**의존** file_path→일지 역인덱스 쿼리(`cache.rs` files_touched 인덱스).

### P2. 검토 세션 — 흩어진 4개 능력을 하나의 의도로 `[L · high]`
**문제** 어떤 일지가 어떤 파일을 바꿨고(group_changes), 그 시점 diff 가 영속(entry_diffs)이고, 어떤 플랜에 묶였고, 그 변경이 그래프상 무엇에 파급되는지(change_impact)가 전부 백엔드에 있으나 서로 다른 화면에 흩어짐. "오늘 에이전트가 한 일을 항목별 승인/반려하며 훑는" 단일 동선이 없음.
**제안** "검토 세션" 면: 한 workday/session 의 일지를 카드 스택으로 세로 배열, 각 카드에 (a) narrative+태그, (b) sidecar 복원 패치(PatchView), (c) `group_changes` 연결 플랜 칩, (d) `change_impact` "건드리는 N개 파일" 접이식. j/k 로 카드 넘기며 "검증됨" 토글(**`oculpm_set_journal_verified` — 백엔드 살아있으나 호출처 0**), "완료?" 제안 승인, 검토 완료 표시. 끝에 "N개 중 M개 검증" 요약.
**근거** `entry_diffs.rs`(self-heal 복원), `oculpm_group_changes`, `get_change_impact`(이미 DiffScreenV2 배선), `oculpm_set_journal_verified`+`verified_by_user`(미도달 검증 루프). 프런트는 PatchView/EntryDetailView/AgentColor 재사용 — **새 백엔드 거의 불필요.** → `01 §3-B`.
**의존** F3·P1 과 시너지(독립 가능). 새 ui_v2 화면 1개.

---

## 신뢰성·규모 — 규모에서 무너지는 곳

### N1. 일지 무결성 닥터 `[M · high]`
**문제** 현 `db_health`(`diagnostics.rs`)는 SQLite 파생 캐시만 봄(db_path/schema_version/page_count/integrity_ok). 디스크 SSOT 정합성은 전혀 모름 — (a) 디스크엔 있는데 캐시 누락/반대, (b) `parse_ok=0` 누적, (c) ndjson 손상 tail, (d) 좀비 락 인수 이력, (e) redaction 미적용. 사용자가 "데이터 없음"과 "백엔드 부분 손상"을 구분 못 함.
**제안** `oculpm_doctor(project_id)→JournalHealth`: `walk_journal`(존재) vs `oculpm_journal` 행 수 대조(cache_drift), `parse_ok=0` 카운트+샘플, 손상 tail 백업(`.corrupted-tail-*`) 존재, 최근 좀비 Recovered 카운트, sidecar 누락 비율(backfill 필요량), redaction 플래그. SettingsPanel "진단" 탭(이미 db_health 렌더)에 "작업 일지 무결성" 카드 + 각 문제에 "고치기"(`reindex_journal_cache`/`backfill_entry_diffs` — 둘 다 존재).
**근거** `diagnostics.rs`, `cache.rs walk_journal`+parse_ok, `index.rs`(손상 tail), `lock.rs`(ZombieInfo), `entry_diffs.rs backfill`, `SettingsPanel.tsx` 진단 탭. F7a 와 데이터 소스 공유.

### A2. 자동 커밋 + CI 일지 검증기 `[M · high]`
**문제** (1) `config.git.journal_committed=true` 가 기본 플래그인데 **실제로 .md 를 커밋하는 코드가 없음** → 일지가 working tree 에만 남아 clean checkout/clone 시 유실. (2) 일지를 팀 규범으로 만들 수단 없음.
**제안** (a) `journal_committed` 존중: watcher 가 신규 일지 인덱싱 시 옵션으로 `git add .oculpm/journal/<file> && git commit`(별도 커밋, config-gate, solo 기본 off, forbidden-path 가드). (b) `oculpm verify` 경량 CLI(또는 앱이 떨어뜨리는 portable 스크립트): git diff 범위가 주어지면 "src/ 를 건드린 모든 커밋/PR 이 겹치는 files_touched 일지를 갖는가"를 assert, 미달 시 non-zero.
**근거** `git.rs::run_git`(repo root 해석), 죽은 `journal_committed`+`GitConfig`, watcher 신규-일지 경로, `frontmatter.rs` files_touched 파싱.
**의존** 자동 커밋은 forbidden-path/redact(R1) 존중 필수.

### N2~N4 (요약)
- **N2. 증분 코드그래프 + 해시 변경감지** `[L·medium]` — `rebuild_code_graph`(`db.rs:1283`)가 인덱스마다 전체 DELETE+재삽입(graph-upgrade Invariant #3 위반). `changed_file_ids` 인자로 변경 파일 엣지만 갱신. `reindex_incremental` 의 mtime-skip 을 "mtime 같아도 blake3 다르면 재파싱"으로 보강(checkout/touch 누락 방지).
- **N3. 백엔드 워크데이 집계 + 가상화 타임라인** `[L·medium]` — `useTodayBrief` 의 7+N IPC 왕복을 `oculpm_workday_brief` 단일 쿼리로(미구현 `daily_brief` 설계 부활). `list_journal_entries` 에 limit/before-workday 커서 + react-window 가상화. 수년치 일지에서도 상수 시간.
- **N4. SSOT 동시쓰기 보호** `[L·medium]` — `lock.rs`(single-process advisory, TOCTOU) + `plan_apply_edit`(per-edit re-lock 없음). 프로젝트별 tokio Mutex 직렬화 + write 직전 mtime/blake3 CAS(외부 에이전트 클로버 시 `ConcurrentEdit` 반환→"새로고침 후 재시도") + stale 인수에 O_EXCL 게이트.

---

## 도메인 빠른 수정 (capability map gap 중 저비용·고가치)

| 도메인 | 현 격차 | 빠른 수정 |
|---|---|---|
| AI 패널 (**AI1**) | 스트림 취소(abort) 없음; 메시지가 스트림 종료 후에만 영속(에러/강제종료 시 유실); `AiPanelScreenV2` 모델 피커 없음; `AiPanelScreenV2`(553) vs `ChatPanel`(1178) 이중 구현 | abort 버튼+AbortController, 낙관적 영속, 모델 피커 통일, 한 구현으로 수렴 |
| 터미널 | detach 윈도우 **broken**(`App.tsx` 에 `?window=` 라우팅 없음); "`.oculpm 감시중`" 점이 하드코딩(데이터 미바인딩); ⌘숫자 충돌 | `?window=` 라우팅 추가 또는 detach 제거, 감시 점을 `.oculpm/index` last-append 에 바인딩, 터미널 포커스 시 ⌘숫자 가드 |
| 문서 뷰어 | 앵커 링크 깨짐(**rehype-slug 없음**); 문서 편집기 부재(다음 라운드로 명시); 폴더명 `docs` 하드코딩; 문서 내 검색 없음 | rehype-slug 추가(즉시), 폴더명 설정화, 트리 검색 박스 |
| 코드 맵 (**P3**) | 항상 `symbol_level:false` — 심볼 노드/심볼→심볼 호출 미렌더(백엔드는 반환 가능); 파급이 캔버스에 안 칠해짐; 레이아웃 메인스레드 동기 | 더블클릭→심볼 LOD 펼침(포커스 이웃 한정), `change_impact` 결과 hop 별 캔버스 페인팅, 레이아웃 워커 |
| 의미 검색 | 유사도 컷오프 없음(약한 매치 20개 노출); 하이브리드/리랭크/FTS 없음; `// AST Symbol:` 프리픽스가 결과에 노출 | min-similarity 임계값, 프리픽스 표시 제거, (선택) FTS5 하이브리드 |

---

## 협업 — 로컬-퍼스트를 배신하지 않는 공유

> 공통 원칙: **push-only(내보내기)·opt-in·redaction-gated.** 앱은 리스닝 포트를 열지 않고 자동 동기화/pull 하지 않으며, 사용자가 검토한 정제 산출물만 기기를 떠난다.

- **C3. 팀 일지 머지 뷰 (git-as-sync)** `[L·high]` — 이 레포가 그렇듯 `.oculpm/journal/**` 를 공유 레포에 커밋하면 git pull 이 곧 제로-인프라 동기화. 1파일=1일지 설계라 머지 충돌 거의 0(충돌 회피 파일명 이미 존재). 타임라인에 frontmatter `agent.id` + 도입 커밋의 git author 로 "작성자" 차원 추가. **R1(redaction) 강하게 동반** — 없으면 시크릿이 팀 전체로 배포됨.
- **C4. 선택적 암호화 백업·멀티머신** `[XL·medium]` — `oculpm_snapshot_export(passphrase)`: `.oculpm` 을 클라이언트 암호화해 dialog 저장(iCloud/Dropbox/USB/private git). `snapshot_import` 는 1파일=1일지 충돌-안전 규칙으로 머지. `atomic_io`+keyring+dialog 재사용. R1 필요 + 암호화 크레이트 추가.

---

## 실행 순서 제안

`00-summary.md` 의 로드맵과 동일. 한 줄 요약:

> **R1(redaction) → C1(legacy 이전·삭제) → S1(플래너 일원화) → F1·F2·F3·F7a·P1 → F4·F5·A1·C1·C2 → 큰 베팅(F6·C3·P2·N 시리즈).**

핵심 원리: **새 백엔드를 짓기 전에, 이미 지은 것을 연결하라.** 고아 커맨드 분류표(`01 §3`)와 이 문서의 매트릭스가 그 연결 지점을 가리킨다.
