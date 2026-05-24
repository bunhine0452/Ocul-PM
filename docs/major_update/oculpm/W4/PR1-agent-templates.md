# W4-PR1 — `.oculpm/agents/_template.md` + 4 어댑터 템플릿

> **목표**: 마스터 템플릿 1개 + 4 어댑터별 변형 5개 마크다운 파일을 작성. 이후 PR2 의 렌더러 + sync 가 이 파일들을 in-binary string 으로 임베드해 init 시 복사한다.
> **선행**: W3 전체 ✅ 특히 [`../W3/PR9-dogfooding-bootstrap.md`](../W3/PR9-dogfooding-bootstrap.md) 의 회고 (`_dogfooding-w3.md`) — 본 PR 의 마스터 템플릿이 그 회고를 직접 인용.
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR1, [`../00-spec.md`](../00-spec.md) §3 (frontmatter), §6 (어댑터 마커 4종).
> **상태**: ⬜

---

## 1. 신규 파일 (계획)

| 파일 | 임베드 위치 (PR2) | 모드 |
|---|---|---|
| `src-tauri/src/oculpm/agents/templates/master_ko.md.tpl` | `.oculpm/agents/_template.md` (init 시 복사, 사용자 편집 가능) | n/a — 원본 |
| `src-tauri/src/oculpm/agents/templates/cursor.mdc.tpl` | `.cursor/rules/ocul-pm.mdc` | Overwrite |
| `src-tauri/src/oculpm/agents/templates/claude_code.md.tpl` | `.claude/CLAUDE.md` | ManagedBlock |
| `src-tauri/src/oculpm/agents/templates/antigravity.md.tpl` | `.agent/rules/ocul-pm.md` | Overwrite |
| `src-tauri/src/oculpm/agents/templates/gemini.md.tpl` | `GEMINI.md` | ManagedBlock |

`.tpl` 확장자 = Rust 의 `include_str!` 로 in-binary 임베드 (런타임 IO 없음). 사용자가 마스터 (`.oculpm/agents/_template.md`) 를 수정하면 그 내용이 어댑터 sync 시 우선.

---

## 2. 마스터 템플릿의 핵심 구조 (계획)

페이즈 §1 W4-PR1 의 300줄 내외 한국어 마스터. 섹션 그대로:

1. **언제 기록하는가** — 4 trigger (bug fix / feature done / refactor batch / error cycle) + chore.
2. **어디에 쓰는가** — 경로 규칙 (`<workday>/<TypeFolder>/<HHMM>_<type>_<slug>.md`) + slug 정책.
3. **Frontmatter (필수)** — `00-spec.md §3.1` 의 8 필드 + agent.id/version + language + verified_by_user + files_touched + related + tags. 정확한 예시 1개.
4. **본문 구조 (타입별 강제 헤더)** — bug/error 는 `## 발생 원인` + `## 해결 방법`, refactor 는 `## 동기` + `## 변경 요약`, feature 는 `## 추가 기능` + `## 동작 흐름`, chore 는 자유. 모든 타입 공통 `## 검증` + 선택 `## 메모`.
5. **첫 줄** — `[x] 제목` 또는 `[ ] 제목` 체크박스 + 제목.
6. **금지 사항** — `.oculpm/index/**` 쓰기 금지, secrets/API key 금지, 다른 journal 파일 수정 금지 (`related` 로 링크), 한 파일에 두 작업 묶기 금지.
7. **잘 작성된 예시** — 1개만 (dogfooding 시드에서 가장 좋은 1개 채택). 나머지는 "`.oculpm/journal/` 의 기존 파일 참조" 로 외부화 → 토큰 비용 (페이즈 §2.1).

---

## 3. 어댑터별 차이 (계획)

| 어댑터 | 헤더 / 메타 | 추가 줄 |
|---|---|---|
| **Cursor** (`.mdc`) | `description`, `globs`, `alwaysApply` MDX 헤더 | Cursor 의 `@` 멘션 사용 예시 1개 |
| **Claude Code** (`.md`) | (없음 — 관리 블록) | "사용자의 다른 CLAUDE.md 규칙과 충돌 시 ocul-pm 규칙 우선" 한 줄 |
| **Antigravity** (`.md`) | (없음) | 마스터 그대로 |
| **Gemini CLI** (`.md`) | (없음 — 관리 블록) | 마스터 그대로 |

---

## 4. dogfooding 회고 인용 (의무)

`_dogfooding-w3.md` 에서 발견된 마찰을 마스터 템플릿의 다음 위치에 직접 반영:

- **frontmatter 강조 위치** — 회고의 "가장 마찰이 큰 필드 top 3" 를 templates 의 frontmatter 섹션의 inline 강조로 (예: `created_at: "..." # ⚠ timezone offset 필수, +09:00 누락 시 UTC 해석됨`).
- **slug 길이 권장** — 회고에서 "60자 너무 김" 발견 시 마스터에 권장 40자 추가.
- **본문 강제 헤더 풀이** — 회고의 "자연스러웠다 / 어색했다" 를 반영해 헤더 종류 조정.

**DoD §본 PR 의 PR 본문**: "_dogfooding-w3.md 의 항목 X 를 master_ko.md.tpl 의 § Y 에 인용" 형식으로 최소 1건 명시.

---

## 5. 테스트 (계획)

본 PR 은 텍스트 자산만 — 컴파일 외 단위 테스트는 PR2 의 렌더러 단계에서.

- [ ] `cargo build` 시 `include_str!` 가 5 파일 모두 임베드 (PR2 가 추가하지만 PR1 시점에 디렉토리/파일 존재 확인).
- [ ] 마스터 템플릿이 1500 토큰 이하 (LLM 컨텍스트 비용 — 페이즈 §2.1).
- [ ] 4 어댑터 변형이 마스터에서 derive 가능 (override 가 적을수록 좋음).

---

## 6. DoD

- [ ] 4 어댑터 템플릿 파일 + 1 마스터 = 5개 파일이 `src-tauri/src/oculpm/agents/templates/` 에 존재.
- [ ] PR 본문이 `_dogfooding-w3.md` 의 어느 항목을 어떻게 반영했는지 **최소 1건** 명시.
- [ ] 마스터가 1500 토큰 이하 (대략 1줄 ≈ 25 토큰 가정 시 60줄).
- [ ] `.tpl` 파일들이 UTF-8 + LF 통일.

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **`.tpl` vs `.md` 확장자** — `.md` 면 GitHub 가 자동 렌더하지만 `include_str!` 안에서 markdown 파서 충돌 가능. `.tpl` 추천.
2. **어댑터별 파일 vs 한 파일 + override map** — 4 파일이 명확. 한 파일 + match 는 코드 측에선 짧지만 마스터 변경 시 4번 동기화 필요해서 더 비쌈.
3. **마스터 한/영 분리 여부** — 1차는 한국어만 (`master_ko.md.tpl`). 영어는 W6 후보.
4. **`schema_version` 표시 방식** — 마스터 최상단 `<!-- schema_version: 1 -->` HTML 주석 + 인덱서가 미스매치 감지 시 경고.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR2 의 `include_str!` 가 정확히 본 PR 의 5 파일 경로를 import.
- PR4 의 drift 비교 hash 계산 시 본 PR 의 마스터/어댑터 템플릿이 byte-stable 해야 함 (BOM/CRLF 금지).
- PR9 의 자동 dogfooding 시 본 PR 의 마스터가 실제로 작동하는지 (LLM 이 따르는지) 검증되어야 함 — 작성률 < 60% 면 본 PR 로 돌아와 강화.
