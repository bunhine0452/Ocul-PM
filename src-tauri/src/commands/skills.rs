//! 스킬(Skills) 관리 — 프로젝트/전역 Claude Code 스킬(`.claude/skills/`)을
//! GUI 로 조회·생성·편집·토글·복사·삭제한다.
//!
//! SSOT 는 디스크의 `SKILL.md` 다 (docs 뷰어와 동일하게 SQLite 캐시 없음 —
//! 스킬은 개수가 작고 요청마다 직접 읽어도 충분히 싸다).
//!
//! 비활성화는 `<skills>/.disabled/<skill>/` 로의 **이동**으로 구현한다. Claude
//! Code 의 스킬 탐색은 `skills/*/SKILL.md` 한 단계(숨김 폴더 제외)만 보므로,
//! 숨김 폴더 한 단계 아래로 옮기면 파일을 지우지 않고도 로드에서 빠진다.
//!
//! 보안: 모든 조작 경로는 (a) `dir_name` 검증(경로 구분자·`..`·선행 `.` 거부)
//! 을 거친 뒤 (b) `secure_skill_path` 로 스킬 루트 안에 갇힌다 — docs.rs 의
//! `secure_docs_join` 패턴을 쓰기 연산까지 확장한 것.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;

/// 프로젝트/홈 루트 기준 스킬 폴더 위치. Claude Code 규약 고정.
const SKILLS_SUBDIR: &str = ".claude/skills";
/// 비활성 스킬 보관 폴더 (스킬 루트 바로 아래 숨김 폴더).
const DISABLED_DIRNAME: &str = ".disabled";
/// 스킬 정의 파일명. Claude Code 규약 고정.
const SKILL_FILENAME: &str = "SKILL.md";
/// SKILL.md 저장 상한 — 에이전트 컨텍스트에 통째로 들어가는 파일이라 이보다
/// 크면 스킬로서도 잘못된 것이다.
const MAX_SKILL_BYTES: usize = 512 * 1024;
/// 보조 파일 나열 상한 (UI 표시용 — 초과분은 개수만 정확히 센다).
const MAX_LISTED_FILES: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SkillScope {
    /// `<project>/.claude/skills` — 이 프로젝트에서만 로드.
    Project,
    /// `~/.claude/skills` — 모든 프로젝트에서 로드.
    Global,
}

/// 스킬 목록의 한 줄. `dir_name` 이 (scope 내) 조작 키다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SkillEntry {
    pub scope: SkillScope,
    pub dir_name: String,
    /// frontmatter `name` (없으면 폴더명).
    pub name: String,
    /// frontmatter `description` (없으면 빈 문자열) — 에이전트 자동 발동 기준.
    pub description: String,
    pub enabled: bool,
    /// 표시용 경로 — project 는 프로젝트 루트 상대, global 은 `~/…`.
    pub display_path: String,
    /// SKILL.md 를 제외한 보조 파일 수 (참고 문서·스크립트 등).
    pub extra_files: u32,
}

/// `skills_list` 응답. 두 스코프를 한 번에 내려 UI 왕복을 줄인다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SkillsOverview {
    pub project: Vec<SkillEntry>,
    pub global: Vec<SkillEntry>,
    /// 절대 경로 — 빈 상태 안내·"폴더 열기" 용.
    pub project_skills_dir: String,
    pub global_skills_dir: String,
}

/// `skills_read` 응답 — 원문 + 보조 파일 목록.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SkillDetail {
    pub entry: SkillEntry,
    /// SKILL.md 원문 (frontmatter 포함).
    pub content: String,
    /// 스킬 폴더 내 보조 파일 상대 경로 (SKILL.md 제외, 최대 50개).
    pub files: Vec<String>,
    /// SKILL.md 절대 경로 — 외부 에디터로 열 때 사용.
    pub skill_md_path: String,
}

// ─── commands ───────────────────────────────────────────────────────────────

/// 프로젝트+전역 스킬을 한 번에 나열한다. 스킬 폴더가 없으면 빈 목록.
#[tauri::command]
#[specta::specta]
pub async fn skills_list(db: State<'_, Db>, project_id: u32) -> Result<SkillsOverview, String> {
    let (project_dir, global_dir) = scope_dirs(&db, project_id).await?;
    Ok(SkillsOverview {
        project: list_scope(SkillScope::Project, &project_dir),
        global: list_scope(SkillScope::Global, &global_dir),
        project_skills_dir: project_dir.display().to_string(),
        global_skills_dir: global_dir.display().to_string(),
    })
}

/// 단일 스킬의 SKILL.md 원문과 보조 파일 목록을 읽는다.
#[tauri::command]
#[specta::specta]
pub async fn skills_read(
    db: State<'_, Db>,
    project_id: u32,
    scope: SkillScope,
    dir_name: String,
) -> Result<SkillDetail, String> {
    let root = scope_dir(&db, project_id, scope).await?;
    let (dir, enabled) = locate_skill(&root, &dir_name)?;
    let skill_md = dir.join(SKILL_FILENAME);
    let content = std::fs::read_to_string(&skill_md)
        .map_err(|e| format!("Could not read SKILL.md: {e}"))?;
    let entry = build_entry(scope, &root, &dir_name, enabled, &content);
    Ok(SkillDetail {
        entry,
        content,
        files: list_extra_files(&dir, MAX_LISTED_FILES),
        skill_md_path: skill_md.display().to_string(),
    })
}

/// SKILL.md 를 저장한다. `create=true` 면 새 폴더 생성(중복 거부),
/// `false` 면 기존 스킬(비활성 포함)의 본문 교체.
#[tauri::command]
#[specta::specta]
pub async fn skills_save(
    db: State<'_, Db>,
    project_id: u32,
    scope: SkillScope,
    dir_name: String,
    content: String,
    create: bool,
) -> Result<SkillEntry, String> {
    if content.len() > MAX_SKILL_BYTES {
        return Err("SKILL.md is too large (over 512KB) — split long material into supporting files".into());
    }
    let root = scope_dir(&db, project_id, scope).await?;
    let (dir, enabled) = if create {
        validate_dir_name(&dir_name, true)?;
        if locate_skill(&root, &dir_name).is_ok() {
            return Err(format!("A skill with that name already exists: {dir_name}"));
        }
        let dir = secure_skill_path(&root, &dir_name, true)?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create the skill folder: {e}"))?;
        (dir, true)
    } else {
        locate_skill(&root, &dir_name)?
    };
    std::fs::write(dir.join(SKILL_FILENAME), &content)
        .map_err(|e| format!("Could not save SKILL.md: {e}"))?;
    Ok(build_entry(scope, &root, &dir_name, enabled, &content))
}

/// 스킬 폴더를 통째로 삭제한다 (보조 파일 포함, 복구 불가).
#[tauri::command]
#[specta::specta]
pub async fn skills_delete(
    db: State<'_, Db>,
    project_id: u32,
    scope: SkillScope,
    dir_name: String,
) -> Result<(), String> {
    let root = scope_dir(&db, project_id, scope).await?;
    let (dir, _) = locate_skill(&root, &dir_name)?;
    // 안전망: SKILL.md 가 있는 폴더만 지운다 — 오타·경합으로 엉뚱한 폴더를
    // 재귀 삭제하는 사고를 구조적으로 차단.
    if !dir.join(SKILL_FILENAME).is_file() {
        return Err("Folders without a SKILL.md are not deleted".into());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("Could not delete the skill: {e}"))
}

/// 스킬 활성/비활성 토글 — `<skills>/` ↔ `<skills>/.disabled/` 이동.
#[tauri::command]
#[specta::specta]
pub async fn skills_set_enabled(
    db: State<'_, Db>,
    project_id: u32,
    scope: SkillScope,
    dir_name: String,
    enabled: bool,
) -> Result<SkillEntry, String> {
    let root = scope_dir(&db, project_id, scope).await?;
    let (dir, currently) = locate_skill(&root, &dir_name)?;
    if currently != enabled {
        let target = secure_skill_path(&root, &dir_name, enabled)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create the archive folder: {e}"))?;
        }
        std::fs::rename(&dir, &target).map_err(|e| format!("Could not move the skill: {e}"))?;
    }
    let (dir, enabled) = locate_skill(&root, &dir_name)?;
    let content = std::fs::read_to_string(dir.join(SKILL_FILENAME)).unwrap_or_default();
    Ok(build_entry(scope, &root, &dir_name, enabled, &content))
}

/// 스킬을 다른 스코프로 복사한다 (프로젝트 ↔ 전역). 대상에 같은 이름이 있으면 거부.
/// 복사본은 항상 활성 위치에 놓인다.
#[tauri::command]
#[specta::specta]
pub async fn skills_copy(
    db: State<'_, Db>,
    project_id: u32,
    from_scope: SkillScope,
    to_scope: SkillScope,
    dir_name: String,
) -> Result<SkillEntry, String> {
    if from_scope == to_scope {
        return Err("Cannot copy into the same scope".into());
    }
    let from_root = scope_dir(&db, project_id, from_scope).await?;
    let to_root = scope_dir(&db, project_id, to_scope).await?;
    let (src, _) = locate_skill(&from_root, &dir_name)?;
    if locate_skill(&to_root, &dir_name).is_ok() {
        return Err(format!("The target scope already has a skill with that name: {dir_name}"));
    }
    let dst = secure_skill_path(&to_root, &dir_name, true)?;
    copy_dir_recursive(&src, &dst).map_err(|e| format!("Could not copy the skill: {e}"))?;
    let content = std::fs::read_to_string(dst.join(SKILL_FILENAME)).unwrap_or_default();
    Ok(build_entry(to_scope, &to_root, &dir_name, true, &content))
}

// ─── helpers ────────────────────────────────────────────────────────────────

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

fn home_dir() -> Result<PathBuf, String> {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .ok_or_else(|| "Could not find the home directory".to_string())
}

async fn scope_dirs(db: &Db, project_id: u32) -> Result<(PathBuf, PathBuf), String> {
    let project = project_root(db, project_id).await?.join(SKILLS_SUBDIR);
    let global = home_dir()?.join(SKILLS_SUBDIR);
    Ok((project, global))
}

async fn scope_dir(db: &Db, project_id: u32, scope: SkillScope) -> Result<PathBuf, String> {
    let (project, global) = scope_dirs(db, project_id).await?;
    Ok(match scope {
        SkillScope::Project => project,
        SkillScope::Global => global,
    })
}

/// 폴더명 검증. 어떤 경우에도 경로 구분자·`..`·선행 `.` 은 거부한다 (탈출 차단).
/// `strict=true`(신규 생성)는 Claude Code 관례인 kebab-case 만 허용한다.
fn validate_dir_name(name: &str, strict: bool) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("Skill name must be 1-64 characters".into());
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err("Skill name cannot contain path characters".into());
    }
    if strict {
        let ok = name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
            && name.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
        if !ok {
            return Err("Skill name may only use lowercase letters, digits, and hyphens (kebab-case)".into());
        }
    }
    Ok(())
}

/// `dir_name` 을 스킬 루트(또는 `.disabled`) 아래로 정규화 + 가둔다.
fn secure_skill_path(root: &Path, dir_name: &str, enabled: bool) -> Result<PathBuf, String> {
    validate_dir_name(dir_name, false)?;
    let base = if enabled { root.to_path_buf() } else { root.join(DISABLED_DIRNAME) };
    let clean = crate::indexer::clean_path(&base.join(dir_name));
    let root_clean = crate::indexer::clean_path(root);
    if clean.starts_with(&root_clean) {
        Ok(clean)
    } else {
        Err("Access denied: path is outside the skills folder".into())
    }
}

/// 활성 → 비활성 순서로 실제 폴더를 찾는다. `SKILL.md` 가 있어야 스킬로 인정.
fn locate_skill(root: &Path, dir_name: &str) -> Result<(PathBuf, bool), String> {
    for enabled in [true, false] {
        let dir = secure_skill_path(root, dir_name, enabled)?;
        if dir.join(SKILL_FILENAME).is_file() {
            return Ok((dir, enabled));
        }
    }
    Err(format!("Skill not found: {dir_name}"))
}

/// frontmatter 에서 (name, description) 을 관대하게 추출한다.
/// 파싱 실패·부재 시 None — 스킬 자체는 유효할 수 있으므로 에러로 만들지 않는다.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let rest = match content.strip_prefix("---") {
        Some(r) => r,
        None => return (None, None),
    };
    let Some(end) = rest.find("\n---") else {
        return (None, None);
    };
    let yaml: serde_yaml::Value = match serde_yaml::from_str(&rest[..end]) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };
    let get = |key: &str| {
        yaml.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    (get("name"), get("description"))
}

fn build_entry(
    scope: SkillScope,
    root: &Path,
    dir_name: &str,
    enabled: bool,
    content: &str,
) -> SkillEntry {
    let (name, description) = parse_frontmatter(content);
    let dir = if enabled {
        root.join(dir_name)
    } else {
        root.join(DISABLED_DIRNAME).join(dir_name)
    };
    let display_base = match scope {
        SkillScope::Project => SKILLS_SUBDIR.to_string(),
        SkillScope::Global => format!("~/{SKILLS_SUBDIR}"),
    };
    let display_path = if enabled {
        format!("{display_base}/{dir_name}")
    } else {
        format!("{display_base}/{DISABLED_DIRNAME}/{dir_name}")
    };
    SkillEntry {
        scope,
        dir_name: dir_name.to_string(),
        name: name.unwrap_or_else(|| dir_name.to_string()),
        description: description.unwrap_or_default(),
        enabled,
        display_path,
        extra_files: count_extra_files(&dir),
    }
}

/// 한 스코프의 스킬을 나열한다 — 활성(`root/*`) + 비활성(`root/.disabled/*`).
/// SKILL.md 를 직접 품은 폴더만 스킬로 취급하고, 정렬은 활성 우선 → 이름순.
fn list_scope(scope: SkillScope, root: &Path) -> Vec<SkillEntry> {
    let mut out = Vec::new();
    collect_dir(scope, root, root, true, &mut out);
    collect_dir(scope, root, &root.join(DISABLED_DIRNAME), false, &mut out);
    out.sort_by(|a, b| {
        b.enabled
            .cmp(&a.enabled)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

fn collect_dir(scope: SkillScope, root: &Path, dir: &Path, enabled: bool, out: &mut Vec<SkillEntry>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        // 심볼릭 링크는 루프/탈출 위험이 있어 따라가지 않는다 (docs.rs 와 동일).
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let skill_md = entry.path().join(SKILL_FILENAME);
        let Ok(content) = std::fs::read_to_string(&skill_md) else {
            continue;
        };
        out.push(build_entry(scope, root, &name, enabled, &content));
    }
}

/// SKILL.md 를 제외한 보조 파일 수 (재귀, 심볼릭 링크 제외).
fn count_extra_files(dir: &Path) -> u32 {
    fn walk(dir: &Path, count: &mut u32, depth: u8) {
        if depth > 6 || *count > 5000 {
            return; // 비정상 트리 가드 — UI 배지용 개수라 상한이면 충분.
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                walk(&entry.path(), count, depth + 1);
            } else if entry.file_name() != SKILL_FILENAME {
                *count += 1;
            }
        }
    }
    let mut count = 0;
    walk(dir, &mut count, 0);
    count
}

/// 보조 파일 상대 경로 목록 (SKILL.md 제외, `cap` 개까지).
fn list_extra_files(dir: &Path, cap: usize) -> Vec<String> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<String>, cap: usize, depth: u8) {
        if depth > 6 || out.len() >= cap {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            if out.len() >= cap {
                return;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                walk(base, &entry.path(), out, cap, depth + 1);
            } else if entry.file_name() != SKILL_FILENAME {
                if let Ok(rel) = entry.path().strip_prefix(base) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out, cap, 0);
    out.sort();
    out
}

/// 폴더 재귀 복사 — 심볼릭 링크는 건너뛴다 (스킬 폴더에 있을 이유가 없고 위험만 있다).
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        let target = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn seed(root: &Path, rel: &str, contents: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, contents).unwrap();
    }

    const FM: &str = "---\nname: review-checklist\ndescription: PR 리뷰 체크리스트\n---\n\n# 본문\n";

    #[test]
    fn lists_enabled_and_disabled_skills() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(root, "review/SKILL.md", FM);
        seed(root, "no-frontmatter/SKILL.md", "# 제목뿐\n");
        seed(root, ".disabled/legacy/SKILL.md", "---\nname: legacy\n---\nx");
        seed(root, "not-a-skill/README.md", "스킬 아님"); // SKILL.md 없음 → 제외
        seed(root, "review/references/guide.md", "보조 파일");

        let entries = list_scope(SkillScope::Project, root);
        let names: Vec<_> = entries.iter().map(|e| (e.dir_name.as_str(), e.enabled)).collect();
        assert_eq!(
            names,
            vec![("no-frontmatter", true), ("review", true), ("legacy", false)],
            "활성 우선 → 이름순, SKILL.md 없는 폴더 제외: {names:?}"
        );
        let review = entries.iter().find(|e| e.dir_name == "review").unwrap();
        assert_eq!(review.name, "review-checklist");
        assert_eq!(review.description, "PR 리뷰 체크리스트");
        assert_eq!(review.extra_files, 1);
        let bare = entries.iter().find(|e| e.dir_name == "no-frontmatter").unwrap();
        assert_eq!(bare.name, "no-frontmatter", "frontmatter 없으면 폴더명 폴백");
    }

    #[test]
    fn toggle_moves_between_root_and_disabled() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(root, "review/SKILL.md", FM);

        // 비활성화 = .disabled/ 로 rename 한 것과 동일한 위치 계산.
        let (dir, enabled) = locate_skill(root, "review").unwrap();
        assert!(enabled);
        let target = secure_skill_path(root, "review", false).unwrap();
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::rename(&dir, &target).unwrap();

        let (dir, enabled) = locate_skill(root, "review").unwrap();
        assert!(!enabled);
        assert!(dir.ends_with(".disabled/review"));
        assert_eq!(list_scope(SkillScope::Project, root).len(), 1);
    }

    #[test]
    fn dir_name_validation_blocks_traversal_and_enforces_kebab() {
        for bad in ["", "..", "a/b", "a\\b", ".hidden", &"x".repeat(65)] {
            assert!(validate_dir_name(bad, false).is_err(), "느슨한 검증도 거부해야: {bad:?}");
        }
        for bad in ["My Skill", "UPPER", "한글이름", "-lead"] {
            assert!(validate_dir_name(bad, true).is_err(), "strict 는 kebab 만: {bad:?}");
        }
        for good in ["review", "pr-check_2", "a"] {
            assert!(validate_dir_name(good, true).is_ok(), "허용돼야: {good:?}");
        }
        // 검증을 통과해도 최종 경로는 루트 안이어야 한다.
        let tmp = TempDir::new().unwrap();
        assert!(secure_skill_path(tmp.path(), "ok", true).is_ok());
        assert!(secure_skill_path(tmp.path(), "../escape", true).is_err());
    }

    #[test]
    fn frontmatter_parse_is_lenient() {
        assert_eq!(parse_frontmatter("no frontmatter"), (None, None));
        assert_eq!(parse_frontmatter("---\nname: a\n---\n"), (Some("a".into()), None));
        let (n, d) = parse_frontmatter("---\nname: a\ndescription: \"b c\"\nextra: 1\n---\nbody");
        assert_eq!((n, d), (Some("a".into()), Some("b c".into())));
        // 깨진 YAML → None 폴백 (에러 아님).
        assert_eq!(parse_frontmatter("---\n{invalid\n---\n"), (None, None));
    }

    #[test]
    fn copy_dir_skips_symlinks_and_copies_tree() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src-skill");
        seed(&src, "SKILL.md", FM);
        seed(&src, "references/a.md", "a");
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc", src.join("evil-link")).unwrap();

        let dst = tmp.path().join("dst-skill");
        copy_dir_recursive(&src, &dst).unwrap();
        assert!(dst.join("SKILL.md").is_file());
        assert!(dst.join("references/a.md").is_file());
        assert!(!dst.join("evil-link").exists(), "심볼릭 링크는 복사하지 않는다");
    }
}
