# v2 — 기능 스펙 (U4·U7·U10)

## §1. 스탠드업·PR 본문 생성 (U10 = 백로그 C1)

"기록→활용" 전환의 대표 기능. 쌓인 일지를 매일 쓰는 산출물로 되돌려준다.

### 백엔드
`oculpm_generate_summary(project_id, from_workday, to_workday, style) -> GeneratedSummary`
- `style ∈ { standup, pr_description, weekly_status }` (specta enum).
- 데이터 수집: 회고(F4)가 쓰는 `range_entries` 경로 재사용 — 기간 내 일지 요약(제목·타입·태그·파일수)
  + 활성 플랜 항목 상태. **redacted 캐시 본문만 사용** (R1 보장 위에 얹힘 — 원본 재독 금지).
- LLM: planner 화해와 동일한 provider 추상화(`llm/`) + 사용자 기본 모델·failover 체인 재사용.
  스타일별 한국어 시스템 프롬프트:
  - `standup`: 어제(또는 기간) 한 일 / 오늘 할 일(활성 플랜 [ ]·[~] 항목) / 막힌 것([!]) 3섹션 불릿.
  - `pr_description`: 변경 요약 / 주요 변경점(파일 그룹) / 검증 방법 — 커밋 메시지 톤.
  - `weekly_status`: 주간 하이라이트 / 진척(플랜 롤업 %) / 다음 주.
- **LLM 실패·키 없음 폴백**: 결정적 마크다운 생성 (일지 제목을 타입별 그룹핑 + 플랜 상태 롤업).
  기능이 API 키 없이도 항상 동작해야 한다.
- 반환: `{ markdown, style, entry_count, used_llm }`.

### 프런트
- 회고 화면(RetroScreenV2) 툴바에 "요약 생성" 드롭다운 (스탠드업/PR 본문/주간 보고).
- 기간은 회고 화면의 기존 기간 선택 상태 재사용. 결과는 모달(U13 AppDialog)에
  마크다운 프리뷰 + "클립보드 복사" 버튼 (`navigator.clipboard.writeText`).
- Today 툴바에 "스탠드업 복사" 원클릭 (오늘+어제 워크데이, style=standup, 토스트 확인).

## §2. 팔레트 엔티티 점프 백엔드 (U7)

`search_entities(project_id, query, limit) -> Vec<EntityHit>`
- `EntityHit { kind: journal|plan|plan_item|discussion|doc, id, title, subtitle, extra }`
  - journal: id=엔트리 상대경로, subtitle=워크데이·타입, extra=slug
  - plan: id=plan id / plan_item: id=`plan#item`, subtitle=플랜 제목
  - discussion: id=doc id(slug), subtitle=status
  - doc: id=docs 상대경로, subtitle=폴더
- 구현: SQLite 캐시 4 테이블에 대해 각각 `LIKE` prefix 우선 + substring 차선, kind 별 상한
  (limit/kind 균등 배분) 후 통합 점수 정렬. docs 는 파일시스템 tree 캐시(기존 docs_tree 경로) 재사용.
- U11 완료 후 journal/plan 검색을 FTS 인덱스로 승격 (인터페이스 불변).

## §3. 라우팅 계약 (U7 프런트)

팔레트 선택 → `ShellV2` 크로스링크 라우팅 재사용:
- journal → `setUiV2View("journal")` + `focusPath(entry)` (Today→journal 점프와 동일 경로)
- plan/plan_item → planner 화면 + 대상 plan 선택 (+item 하이라이트는 best-effort)
- discussion → discussion 화면 + 문서 선택
- doc → docs 화면 + 트리 선택

## §4. 에이전트 감지 확대 (U4 = 백로그 A1)

`src-tauri/src/oculpm/agents/mod.rs known_adapters()` 에 행 추가:

| 에이전트 | 지침 파일 | 쓰기 모드 |
|---|---|---|
| Windsurf | `.windsurfrules` (레거시) + `.windsurf/rules/oculpm.md` | dedicated 우선, 루트 파일은 marker-block |
| GitHub Copilot | `.github/copilot-instructions.md` | marker-block |
| Codex CLI | `AGENTS.md` (이미 공유) | 기존 AGENTS.md 로 커버 — id 매핑만 |
| aider | `CONVENTIONS.md` | marker-block |
| Cline | `.clinerules/oculpm.md` | dedicated 파일 |
| Zed | `.rules` | marker-block |

- 기존 antigravity·pi 선례(template_version 3, 패키지 불필요)와 동일: **AGENTS.md 계열은
  템플릿 공유**, 별도 파일 에이전트만 어댑터 행 추가.
- `template_version` bump 는 템플릿 *내용* 변경 시에만 — 어댑터 추가는 내용 불변이므로 유지.
- journal frontmatter `agent.id` enum 은 자유 문자열이므로 스키마 변경 없음.
- 테스트: adapter 경로·marker 왕복(sync→upgrade) 기존 패턴에 신규 행 케이스 추가.
