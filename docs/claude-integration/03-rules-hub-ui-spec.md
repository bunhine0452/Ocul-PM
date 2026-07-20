# 03. 규칙 허브 — 데이터 모델·UI 스펙 (PR-CI3)

> 상위 문서: [`00-master-plan.md`](00-master-plan.md) D5. 작성일 2026-07-20 (PR-CI3 착수 시점).
> attribution: claude-code (Fable 5).
> PR-CI4(승격 루프)의 UX 는 이 문서를 확장해 추가한다 — 이번 판은 CI3 범위만.

---

## 1. 실측 팩트 (2026-07-20, code.claude.com/docs/en/memory.md 재검증)

마스터플랜 D5 는 조사 시점 표기로 "globs frontmatter" 라고 썼으나, **공식 스키마는 `paths` 다.** 이 문서가 규칙 파일 스키마의 정답이다.

| 사실 | 내용 |
|---|---|
| `.claude/rules/` 네이티브 지원 | **확인됨.** 프로젝트 `./.claude/rules/**/*.md` + 유저 `~/.claude/rules/**/*.md`, **재귀 탐색**. 유저 스코프가 먼저(낮은 우선순위) 로드 |
| frontmatter 스키마 | **`paths: [glob, …]` 하나뿐.** `paths` 없으면 세션 시작 시 무조건 로드, 있으면 매칭 파일을 읽을 때 조건부 로드. `globs`/`alwaysApply`/`description` 은 **공식 스키마에 없음** |
| glob 문법 | gitignore 스타일 — `*`(한 세그먼트), `**`(디렉터리 횡단), `[abc]` |
| CLAUDE.md 위치 | 프로젝트 = `./CLAUDE.md` **또는** `./.claude/CLAUDE.md` (첫 발견 파일 사용). 유저 = `~/.claude/CLAUDE.md`. 로드는 병합이 아니라 **연결(concatenation)** |
| `CLAUDE.local.md` | **여전히 지원** (deprecated 아님). 프로젝트 루트 전용, CLAUDE.md 뒤에 로드, gitignore 권장 |

## 2. 데이터 모델 (백엔드 `oculpm/rules.rs`)

SSOT 는 디스크 파일이다 — 스킬(commands/skills.rs)과 동일하게 **SQLite 캐시 없음**, 요청마다 직접 읽는다.

- `RuleScope` = `project` | `global`(홈 디렉터리)
- `RuleKind` = `claude_md` | `rule`
- `RuleEntry` = `{ scope, kind, rel_path(스코프 루트 상대·조작 키), name(표시명), title(본문 첫 H1), exists, paths[], bytes, mirror }`
  - `claude_md` 는 **고정 슬롯**으로 내려간다(없어도 `exists=false` 로 나열 → "만들기" 어포던스): 프로젝트 `CLAUDE.md` · `.claude/CLAUDE.md` · `CLAUDE.local.md`, 전역 `.claude/CLAUDE.md`(=~/.claude/CLAUDE.md)
  - `rule` 은 `.claude/rules/**/*.md` 실존 파일만. `name` 은 rules/ 이하 상대 스템 (`api/validation`)
  - `mirror` = `none` | `mirrored` | `conflict` — **프로젝트 rule 전용** (Cursor 미러 상태)
- 경로 검증: 허용 목록 + 세그먼트 검사(`..`·선행 `.`·구분자 금지) + `clean_path` 루트 감금 — skills 의 `secure_skill_path` 패턴 확장
- 안전 상한: 파일 512KB(스킬과 동일), rules 재귀 깊이 4, 나열 200개

## 3. 크로스툴 번역 (Cursor `.mdc` 미러)

"한 규칙 소스 → 모든 에이전트" 의 v1. **프로젝트 스코프 rule 만** 번역한다 (Cursor 전역 규칙은 파일이 아니라 앱 설정이므로 비대상).

- 옵인: `config.agents.rules_translate: string[]` (v1 허용값 `"cursor"` 하나). 기본 `[]`(off) — serde default 로 기존 config 호환
- 미러 경로: `.claude/rules/api/validation.md` → `.cursor/rules/api-validation.mdc` (중첩은 `-` 로 평탄화 — 구버전 Cursor 호환)
- 스키마 번역: `paths: [...]` → `globs: [...]` + `alwaysApply: false` / `paths` 없음 → `globs` 생략 + `alwaysApply: true` (Claude 의 "항상 로드" 의미 보존)
- **소유 마커**: 본문 첫 줄 `<!-- oculpm:rule-mirror <원본 rel> -->`. 마커 없는 기존 `.mdc` 는 **절대 덮어쓰지 않고** `conflict` 로 보고 (우리 어댑터 `ocul-pm.mdc` 충돌도 이 규칙이 자연 차단)
- 멱등: 동일 바이트면 무기록(`unchanged`) — watcher·어댑터 sync 규율과 동일
- 라이프사이클: rule 저장 시 미러 갱신, rule 삭제 시 마커 미러 삭제(옵인 여부 무관 — 잔재 제거), 토글 on→`rules_sync_translations` 가 전체 미러+고아 정리, 토글 off→마커 미러 전량 제거

## 4. 커맨드 (thin — `commands/rules.rs`)

| 커맨드 | 요약 |
|---|---|
| `rules_list(project_id)` | `RulesOverview { claude_md[], project_rules[], global_rules[], project_rules_dir, global_rules_dir, cursor_translate }` |
| `rules_read(project_id, scope, rel_path)` | 원문 + 절대경로 |
| `rules_save(project_id, scope, rel_path, content, create)` | 저장(+옵인 시 미러) → `{ entry, mirror? }` |
| `rules_delete(project_id, scope, rel_path)` | **rule 만** 삭제 가능 (CLAUDE.md 계열은 삭제 비제공) + 마커 미러 제거 |
| `rules_sync_translations(project_id)` | config 기준 미러 전체 화해 → `MirrorWriteResult[]` |

번역 토글 자체는 신규 커맨드가 아니라 기존 `oculpm_get_config`/`oculpm_set_config` 로 `agents.rules_translate` 를 쓰고, 직후 `rules_sync_translations` 를 부른다.

## 5. UI (스킬 화면 → "스킬·규칙" 허브)

- navRegistry `skills` 항목의 라벨을 "스킬·규칙" 으로, alias 에 규칙/rules/훅/hooks 추가 (id·순서 불변 — ⌘번호 유지)
- Toolbar 우측에 세그먼트 탭 `[스킬 | 규칙 | 훅]` (GraphScreenV2 의 `.gr-seg` 패턴, role=tablist). 탭 상태는 비영속 useState — localStorage 비사용 (WorkspaceContext 규율 위반 없음)
- **스킬 탭**: 기존 화면 그대로 (회귀 0 — 기존 vitest 가 그대로 통과해야 함)
- **규칙 탭**: 스킬과 동일한 2-pane. 좌측 목록 = "CLAUDE 메모리" 그룹(고정 슬롯, 없으면 만들기) + "프로젝트 규칙" + "전역 규칙" 그룹. 우측 = 미리보기/원문 편집(⌘S)
  - **paths 편집기**: 편집 모드에서 원문 textarea 위에 paths 칩 입력 — 순수 헬퍼(`rulesModel.ts`)가 draft 의 frontmatter 를 **행 단위로만** 치환해 다른 키·본문 바이트 보존
  - 신규 규칙 모달: 이름(kebab, 평탄 생성만) + paths(쉼표 입력, 비우면 항상 적용) → 템플릿 생성
  - 번역 옵인 토글("Cursor 로 병행 배포") + 규칙별 미러 배지(`mirrored`/`conflict`)
- **훅 탭**: 설정의 `ClaudeHooksBlock`(CI0) 재사용 + 자동 일지 초안·MCP 는 설정 위치 안내 텍스트

## 6. 비범위 (CI3)

- 서브에이전트(`.claude/agents`) 탭 — D5 후순위 그대로
- 실패→규칙 승격 제안 — PR-CI4 (이 허브 위에 얹는다)
- 전역 규칙의 Cursor 미러, Cursor 외 타깃(windsurf 등) — `rules_translate` 배열이 이미 확장 지점
- CLAUDE.md 계열 삭제/이름변경 — 파괴적 조작은 에디터/파인더에 위임
