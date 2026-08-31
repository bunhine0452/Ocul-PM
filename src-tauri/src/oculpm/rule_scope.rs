//! AD-6 — 규칙 범위 감사 (docs/agent-discipline/00-master-plan.md D4).
//!
//! 2026-08-29 실측: 이 저장소의 세션마다 규칙 30파일·90KB(≈22K 토큰)가 주입되고
//! 그중 react-native 8 · arkts 5 · vue 1 은 Tauri 데스크탑 앱과 **무관**했다.
//! 원인은 규칙 frontmatter 의 `paths` 가 `**/*.ts(x)` 처럼 넓어서, TS 파일 하나만
//! 만져도 다른 스택의 규율이 통째로 딸려오는 것이다.
//!
//! 여기서 그걸 **결정적으로** 지목한다 (LLM 0 · 네트워크 0):
//!
//!   규칙의 각 glob 을 이 프로젝트의 실제 파일 목록에 맞춰 보고,
//!   매칭 0개인 glob 을 `dead` 로 부른다. 모든 glob 이 dead 면 그 규칙은
//!   이 프로젝트에서 **한 줄도 쓸모가 없는데 매번 들어오는** 것이다.
//!
//! 판정만 하고 고치지는 않는다 — 처방(축소·비활성·무시)은 사람이 고른다.
//! 특히 전역 규칙(`~/.claude/rules/**`)은 우리 소유 마커가 없는 **사용자
//! 파일**이라, 쓰기는 승인형 [`rules::save_with_backup`] 한 경로뿐이다.

use std::path::{Path, PathBuf};

use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use serde::Serialize;

use crate::oculpm::rules::{self, RuleEntry, RuleScope};

/// 감사에서 훑는 파일 수 상한 — 거대 저장소에서도 한 번의 걷기로 끝난다.
/// 상한에 걸려도 판정은 보수적이다(파일이 더 있으면 dead 가 줄 뿐 늘지 않는다).
const MAX_WALK_FILES: usize = 20_000;

/// `.gitignore` 와 무관하게 걷지 않는 디렉터리 — 벤더/빌드 산출물은 규칙의
/// 대상이 아니다 (indexer 의 deny 목록과 같은 취지).
const DENY_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "vendor",
    "dist",
    "build",
    "out",
    ".git",
    "__pycache__",
];

/// glob 하나의 매칭 결과.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct GlobMatch {
    pub glob: String,
    /// 이 프로젝트에서 매칭된 파일 수 (상한까지 셈).
    pub files: u32,
    /// glob 을 해석하지 못했다 — 판정 불가라 dead 로 부르지 않는다.
    pub unparsed: bool,
}

/// 규칙 하나의 감사 결과.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RuleScopeFinding {
    pub scope: RuleScope,
    pub rel_path: String,
    /// 발동 원장 키와 같은 절대경로 — 프런트가 주입 실측치와 잇는다.
    pub abs_path: String,
    pub name: String,
    /// 규칙 본문 바이트 (되찾을 수 있는 양의 근거).
    pub bytes: u32,
    pub globs: Vec<GlobMatch>,
    /// 매칭 0개인 glob (무관 확정).
    pub dead_globs: Vec<String>,
    /// 남길 glob — 축소 제안이 그대로 쓴다.
    pub live_globs: Vec<String>,
}

impl RuleScopeFinding {
    /// 모든 glob 이 dead — 이 프로젝트에서 통째로 무관하다.
    pub fn fully_dead(&self) -> bool {
        !self.globs.is_empty() && self.live_globs.is_empty()
    }
}

/// 프로젝트의 파일 목록 (루트 상대 경로). gitignore 를 존중하고 벤더를 건너뛴다.
pub fn walk_project_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut builder = WalkBuilder::new(root);
    builder.standard_filters(true);
    // git 저장소가 아니어도 `.gitignore` 를 적용한다 (indexer 와 같은 규율 —
    // 2026-08-30 사고: require_git(true) 기본값 때문에 node_modules 가 걸렸다).
    builder.require_git(false);
    builder.filter_entry(|entry| {
        !(entry.file_type().is_some_and(|t| t.is_dir())
            && entry
                .path()
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|name| DENY_DIRS.contains(&name)))
    });
    for entry in builder.build().flatten() {
        if out.len() >= MAX_WALK_FILES {
            break;
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(root) {
            out.push(rel.to_path_buf());
        }
    }
    out
}

/// glob 하나가 몇 개의 파일에 걸리는가. 해석 불가면 `None` (판정 보류).
fn count_matches(root: &Path, glob: &str, files: &[PathBuf]) -> Option<u32> {
    let mut builder = OverrideBuilder::new(root);
    // `!` 는 override 에서 "무시" 를 뜻한다 — 규칙 glob 에는 그 의미가 없으므로
    // 그대로 넘기지 않는다 (넘기면 매칭이 뒤집힌다).
    if glob.trim().is_empty() || glob.trim_start().starts_with('!') {
        return None;
    }
    builder.add(glob).ok()?;
    let overrides = builder.build().ok()?;
    let mut hits = 0u32;
    for rel in files {
        if overrides.matched(rel, false).is_whitelist() {
            hits = hits.saturating_add(1);
        }
    }
    Some(hits)
}

fn finding_for(
    entry: &RuleEntry,
    scope_root: &Path,
    root: &Path,
    files: &[PathBuf],
) -> RuleScopeFinding {
    let mut globs = Vec::with_capacity(entry.paths.len());
    let mut dead = Vec::new();
    let mut live = Vec::new();
    for glob in &entry.paths {
        match count_matches(root, glob, files) {
            Some(0) => {
                dead.push(glob.clone());
                globs.push(GlobMatch {
                    glob: glob.clone(),
                    files: 0,
                    unparsed: false,
                });
            }
            Some(n) => {
                live.push(glob.clone());
                globs.push(GlobMatch {
                    glob: glob.clone(),
                    files: n,
                    unparsed: false,
                });
            }
            // 해석 못 한 glob 은 **살아 있는 쪽**에 넣는다 — 모르는 것을
            // 무관하다고 말하면 사용자 파일을 잘못된 근거로 고치게 된다.
            None => {
                live.push(glob.clone());
                globs.push(GlobMatch {
                    glob: glob.clone(),
                    files: 0,
                    unparsed: true,
                });
            }
        }
    }
    RuleScopeFinding {
        scope: entry.scope,
        rel_path: entry.rel_path.clone(),
        abs_path: scope_root
            .join(&entry.rel_path)
            .to_string_lossy()
            .to_string(),
        name: entry.name.clone(),
        bytes: entry.bytes,
        globs,
        dead_globs: dead,
        live_globs: live,
    }
}

/// 조건부 규칙(=`paths` 가 있는 규칙) 전부를 감사한다. 항상-로드 규칙과
/// CLAUDE.md 는 대상이 아니다 — 범위가 없으니 좁힐 것도 없다.
pub fn audit(project_root: &Path, home: &Path) -> Vec<RuleScopeFinding> {
    let overview = rules::overview(project_root, home, false);
    let files = walk_project_files(project_root);
    let mut out = Vec::new();
    for entry in &overview.project_rules {
        if !entry.paths.is_empty() {
            out.push(finding_for(entry, project_root, project_root, &files));
        }
    }
    for entry in &overview.global_rules {
        if !entry.paths.is_empty() {
            out.push(finding_for(entry, home, project_root, &files));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn seed(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn dead_globs_are_the_ones_with_no_matching_file() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        seed(root, "src/api/handler.ts", "export {}\n");
        seed(root, "README.md", "# x\n");
        let files = walk_project_files(root);

        assert_eq!(count_matches(root, "**/*.ts", &files), Some(1));
        assert_eq!(count_matches(root, "src/api/**/*.ts", &files), Some(1));
        // HarmonyOS 규칙의 확장자 — 이 프로젝트엔 하나도 없다.
        assert_eq!(count_matches(root, "**/*.ets", &files), Some(0));
    }

    #[test]
    fn unparsable_globs_are_never_called_dead() {
        let dir = TempDir::new().unwrap();
        let files = walk_project_files(dir.path());
        assert_eq!(count_matches(dir.path(), "", &files), None);
        assert_eq!(count_matches(dir.path(), "!src/**", &files), None);
    }

    #[test]
    fn walk_honors_gitignore_and_denies_vendor_dirs() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        seed(root, ".gitignore", "generated/\n");
        seed(root, "generated/out.ts", "x\n");
        seed(root, "node_modules/pkg/index.ts", "x\n");
        seed(root, "src/app.ts", "x\n");
        let files = walk_project_files(root);
        let names: Vec<String> = files
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        assert!(names.iter().any(|n| n.ends_with("src/app.ts")), "{names:?}");
        assert!(!names.iter().any(|n| n.contains("generated")), "{names:?}");
        assert!(
            !names.iter().any(|n| n.contains("node_modules")),
            "{names:?}"
        );
    }

    #[test]
    fn audit_reports_a_fully_dead_global_rule() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(proj.path(), "src/app.ts", "export {}\n");
        seed(
            home.path(),
            ".claude/rules/arkts/coding-style.md",
            "---\npaths:\n  - \"**/*.ets\"\n---\n\n# ArkTS\n",
        );
        seed(
            proj.path(),
            ".claude/rules/api.md",
            "---\npaths:\n  - \"src/**/*.ts\"\n---\n\n# API\n",
        );

        let findings = audit(proj.path(), home.path());
        let arkts = findings.iter().find(|f| f.name.contains("arkts")).unwrap();
        assert!(arkts.fully_dead());
        assert_eq!(arkts.dead_globs, vec!["**/*.ets".to_string()]);

        let api = findings.iter().find(|f| f.name == "api").unwrap();
        assert!(!api.fully_dead());
        assert!(api.dead_globs.is_empty());
    }
}
