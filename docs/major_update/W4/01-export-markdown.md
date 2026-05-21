# 01. export_changelog_markdown 백엔드

> **작업 ID**: W4 / UI-4 백엔드
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §4.1 (커맨드 표), §5.5 (Changelog 화면 Export)

---

## 변경 요약

Keep-a-Changelog 스타일의 마크다운으로 프로젝트 changelog 를 export 하는
Tauri 커맨드 `export_changelog_markdown` 신설. 프론트엔드는 반환된 문자열을
브라우저 blob 다운로드로 저장 (FS 권한·dialog 플러그인 회피).

## 변경 파일

### `src-tauri/src/commands/changelog.rs`

```rust
#[tauri::command]
pub async fn export_changelog_markdown(
    db: State<'_, Db>,
    project_id: u32,
    from: Option<i32>,   // unix sec — None = 처음부터
    to:   Option<i32>,   // unix sec — None = 지금까지
) -> Result<String, String>
```

흐름:
1. project 정보 페치 (이름 → 제목)
2. `list_changelog_entries(project_id, from, limit=5000)` 로 페치, `to` 가
   있으면 in-memory 필터
3. 일별 버킷으로 newest-first 그룹핑 (Vec-based, BTreeMap 회피)
4. 각 일자 안에서 카테고리별 sub-section 으로 한 번 더 그룹핑.
   `kac_section()` 가 our category → KaC heading 매핑:

   | 내부 category | KaC heading |
   |---|---|
   | feature   | Added |
   | fix       | Fixed |
   | refactor  | Changed |
   | docs      | Documentation |
   | test      | Tests |
   | chore     | Chores |
   | _other_   | Other |

5. 각 entry 는 `- **{title}** (📌 if pinned)` + 의도 + 통계 + 인덴트된 ai_summary

### 출력 예시

```markdown
# my-app — Changelog

All notable changes ...

## 2026-05-21

### Added
- **소셜 로그인 버튼 추가** 📌
  - _의도_: 로그인 페이지에 소셜 로그인 추가
  - _4 files · +312 / -88_
  - ## Why
  - OAuth 통합으로 가입률 향상
  - ## What
  - …

### Fixed
- **RAG 검색 중복 제거**
  - _1 files · +12 / -7_
  - …
```

### `src-tauri/src/lib.rs`

`use` + `collect_commands![]` 양쪽에 `export_changelog_markdown` 등록.

## 설계 결정

- **파일 저장 동작은 프론트에서**: 백엔드가 `Result<String>` 만 반환하고,
  실제 파일 쓰기는 프론트의 Blob 다운로드. 이점:
  - Tauri 의 FS scope/permission 설정 없이 동작
  - `@tauri-apps/plugin-dialog`/`-fs` JS dep 추가 불필요
  - export 의 내용을 사용자가 미리 볼 수도 있음 (필요해지면)
- **doc-comment on parameter 금지**: Rust 컴파일러가 함수 파라미터에 `///`
  doc comment 를 금지함. `// 일반 코멘트` 로 표현.
- **`limit=5000` 하드코딩**: changelog 한 프로젝트당 5000 entry 면 ~10 년치
  하루 1 entry. 그 이상 보내려는 사용자가 나오면 페이지네이션 도입.
- **Keep-a-Changelog 형식 채택 이유**: 표준이라 다른 도구들이 파싱하기 쉬움.
  `## yyyy-mm-dd` / `### Added` 헤딩 구조는 git 호스팅 사이트의 changelog
  렌더러들도 잘 이해함.

## 검증

```
$ cd src-tauri && cargo check
warning: `ai-pm` (lib) generated 5 warnings
errors: 0
```

자동 재생성된 `bindings.ts` 에 `exportChangelogMarkdown` 등록됨.
