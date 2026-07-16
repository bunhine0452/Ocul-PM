---
schema_version: 1
type: feature
slug: skills-manager-screen
status: done
difficulty: medium
created_at: "2026-07-16T20:11:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/skills.rs
    op: create
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/features/skills/SkillsScreenV2.tsx
    op: create
  - path: src/features/skills/skillsModel.ts
    op: create
  - path: src/features/skills/skills.css
    op: create
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/lib/navRegistry.ts
    op: update
  - path: src/components/Icons.tsx
    op: update
  - path: src/__tests__/skills_v2.test.tsx
    op: create
  - path: src/__tests__/nav_registry.test.ts
    op: update
related: []
tags: ["skills", "claude-code", "ui_v2", "new-screen", "backend-command"]
---

[x] 스킬 관리 화면 — 프로젝트/전역 Claude Code 스킬(.claude/skills)을 GUI 로 CRUD·토글·복사

## 추가 기능

ui_v2 12번째 화면 "스킬". 프로젝트(`.claude/skills/`)와 전역(`~/.claude/skills/`) 스킬을
한 화면에서 관리한다:

- **목록** — 두 스코프를 한 번에 (`skills_list`). SKILL.md frontmatter 의 name/description,
  비활성 배지, 보조 파일 수 표시. 활성 우선 → 이름순.
- **미리보기/편집** — frontmatter 는 접이식 원문, 본문은 마크다운 렌더. 편집은 원문
  textarea + ⌘S 저장 (`skills_read`/`skills_save`).
- **생성** — AppDialog 모달에서 스코프·이름(kebab 검증)·설명 입력 → 시드 SKILL.md 템플릿 생성.
- **토글** — 비활성화는 삭제가 아니라 `<skills>/.disabled/<skill>/` 로 **이동**. Claude Code 의
  스킬 탐색이 `skills/*/SKILL.md` 한 단계(숨김 제외)만 보는 점을 이용해, 파일을 보존한 채
  로드에서만 뺀다 (`skills_set_enabled`).
- **복사** — 프로젝트 ↔ 전역 스코프 간 폴더 재귀 복사, 심볼릭 링크 제외 (`skills_copy`).
- **삭제** — 확인 모달 + "SKILL.md 를 직접 품은 폴더만 삭제" 안전망 (`skills_delete`).

## 동작 흐름

1. 백엔드 `commands/skills.rs` — 커맨드 6종. SSOT 는 디스크(SKILL.md), 캐시 없음 (docs 뷰어와
   동일 결정). 모든 경로는 `dir_name` 검증(구분자·`..`·선행 `.` 거부) + `secure_skill_path`
   (clean_path + starts_with, docs 의 secure_docs_join 패턴)로 스킬 루트 안에 갇힌다.
2. `lib.rs` collect_commands + use 등록 → `cargo test` 로 bindings.ts 재생성.
3. 프런트 `features/skills/` — 목록/상세 2-pane (docs 화면 레이아웃 패턴), 변이 후
   `loadList()` + detailNonce 재조회. 내비는 navRegistry 단일 소스에 12번째 항목 append
   (⌘번호 10개는 기존 화면 순서 그대로 보존 — 뒤에 붙여 재배열 없음), 사이드바·⌘K 팔레트는
   자동 파생. `UiV2View` union 에 "skills" 추가.

## 검증

- Rust: `cargo test` 전체 그린 + `commands::skills::tests` 5건 (목록/토글 위치/이름 검증·탈출
  차단/frontmatter 관대 파싱/심링크 제외 복사).
- 프런트: `pnpm vitest run src/__tests__/skills_v2.test.tsx` 7건 (스코프 목록+자동 선택+axe,
  토글 커맨드 계약, 생성 모달 kebab 검증+템플릿 인자, 삭제 확인 플로우, 순수 헬퍼 3건).
- 게이트: typecheck / test(146) / lint / build 모두 exit 0.

## 메모

- 비활성 `.disabled/` 이동은 앱 규약이다 — Claude Code 공식 기능이 아니므로 UI 툴팁·README 에
  명시했다. 다른 도구가 이 폴더를 스킬로 오인하는 사례가 나오면 재검토.
- 후속 아이디어: 다른 에이전트 자산(.cursor/rules 등) 탭 확장, 스킬을 다른 *프로젝트*로 복사,
  ⌘K 팔레트에서 스킬 제목 검색(현재는 화면 이동만).
