//! 에이전트·커맨드 표면 수집 (docs 플랜 `context-budget-truth` A).
//!
//! 2026-09-03 실측에서 드러난 구멍: 스킬·규칙 화면은 세션당 119KB 를 보고했는데
//! 실제는 약 149KB 였다. 차이는 `~/.claude/agents/*.md` 67개와
//! `commands/*.md` 94개의 **name+description 프론트매터**로, 하네스가 매 세션
//! 시스템 프롬프트에 목록으로 실어 보낸다 (18.6KB + 11.1KB). 예산 모델의
//! `ContextKind` 에 그 종류가 없어 통째로 누락돼 있었다.
//!
//! 세는 것은 스킬과 같은 규율이다 — **본문이 아니라 광고 비용**. 에이전트 본문은
//! 그 에이전트를 실제로 띄워야 읽히고, 커맨드 본문은 호출해야 읽힌다. 매 세션
//! 확정으로 나가는 건 이름과 설명뿐이다.
//!
//! 플러그인이 제공하는 에이전트·커맨드(`~/.claude/plugins/**`)는 세지 않는다.
//! 파일 단위로 손댈 수 없고 `/plugin` 이 관리하는 표면이라, 목록에 올려도
//! 사용자가 할 수 있는 일이 없다. 그 한계는 응답의 `excludes_plugins` 로
//! 드러내고 화면이 각주로 적는다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::oculpm::rules::{split_frontmatter, RuleScope};

/// 표면 파일이 사는 곳 — 스코프 루트 기준 상대.
const AGENTS_SUBDIR: &str = ".claude/agents";
const COMMANDS_SUBDIR: &str = ".claude/commands";

/// 재귀 깊이 상한 (플랫이 보통이지만 한 겹 묶음까지 수용).
const MAX_DEPTH: u8 = 3;
/// 한 스코프에서 올릴 파일 수 상한 — 거대 설치본에서도 한 번에 끝난다.
const MAX_LISTED: usize = 500;
/// 이 크기를 넘는 파일은 읽지 않는다 (규칙 목록과 같은 가드).
const MAX_SURFACE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SurfaceKind {
    Agent,
    Command,
}

/// 에이전트 또는 커맨드 파일 하나.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SurfaceEntry {
    pub scope: RuleScope,
    pub kind: SurfaceKind,
    /// 스코프 루트 상대 경로 (`.claude/agents/code-reviewer.md`).
    pub rel_path: String,
    /// frontmatter `name`, 없으면 파일 스템.
    pub name: String,
    /// frontmatter `description` (없으면 빈 문자열).
    pub description: String,
    /// **매 세션 비용** — name + description 의 UTF-8 바이트.
    pub bytes: u32,
    /// 디스크 전체 바이트 — 발동해야 읽히는 몫. 예산에 넣지 않고 참고로만 낸다.
    pub body_bytes: u32,
}

/// `agent_surface_list` 응답.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AgentSurfaceOverview {
    pub agents: Vec<SurfaceEntry>,
    pub commands: Vec<SurfaceEntry>,
    /// 빈 상태 안내용 절대 경로.
    pub project_agents_dir: String,
    pub global_agents_dir: String,
    /// 플러그인 제공 표면은 세지 않았다 — 화면 각주의 근거.
    pub excludes_plugins: bool,
}

/// frontmatter 에서 `name` 과 `description` 만 뽑는다. 관대하게 — 파싱이
/// 실패해도 에러로 만들지 않고 빈 값으로 둔다 (목록에서 사라지는 것보다 낫다).
pub fn parse_surface_meta(content: &str, fallback_name: &str) -> (String, String) {
    let (fm, _) = split_frontmatter(content);
    let mut name = String::new();
    let mut description = String::new();
    if let Some(fm) = fm {
        if let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(fm) {
            if let Some(s) = yaml.get("name").and_then(|v| v.as_str()) {
                name = s.trim().to_string();
            }
            if let Some(s) = yaml.get("description").and_then(|v| v.as_str()) {
                description = s.trim().to_string();
            }
        }
    }
    if name.is_empty() {
        name = fallback_name.to_string();
    }
    (name, description)
}

/// 디렉터리 하나를 훑어 `.md` 상대 경로를 모은다 (심볼릭 링크·점 파일 제외).
fn collect_files(base: &Path, dir: &Path, depth: u8, out: &mut Vec<String>) {
    if depth >= MAX_DEPTH || out.len() >= MAX_LISTED {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_LISTED {
            return;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if ft.is_dir() {
            collect_files(base, &entry.path(), depth + 1, out);
        } else if name.ends_with(".md") {
            if let Ok(rel) = entry.path().strip_prefix(base) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

fn utf8_len(s: &str) -> u32 {
    s.len().min(u32::MAX as usize) as u32
}

/// 한 스코프의 한 종류를 수집한다.
fn list_kind(scope: RuleScope, scope_root: &Path, kind: SurfaceKind) -> Vec<SurfaceEntry> {
    let subdir = match kind {
        SurfaceKind::Agent => AGENTS_SUBDIR,
        SurfaceKind::Command => COMMANDS_SUBDIR,
    };
    let dir = scope_root.join(subdir);
    let mut rels = Vec::new();
    collect_files(&dir, &dir, 0, &mut rels);
    rels.sort();

    let mut out = Vec::with_capacity(rels.len());
    for rel in rels {
        let abs = dir.join(&rel);
        let Ok(meta) = std::fs::metadata(&abs) else {
            continue;
        };
        if meta.len() > MAX_SURFACE_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&abs) else {
            continue;
        };
        let stem = Path::new(&rel)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| rel.clone());
        let (name, description) = parse_surface_meta(&content, &stem);
        out.push(SurfaceEntry {
            scope,
            kind,
            rel_path: format!("{subdir}/{rel}"),
            bytes: utf8_len(&name) + utf8_len(&description),
            body_bytes: utf8_len(&content),
            name,
            description,
        });
    }
    out
}

/// 프로젝트 + 전역의 에이전트·커맨드를 한 번에.
pub fn overview(project_root: &Path, home: &Path) -> AgentSurfaceOverview {
    let mut agents = list_kind(RuleScope::Project, project_root, SurfaceKind::Agent);
    agents.extend(list_kind(RuleScope::Global, home, SurfaceKind::Agent));
    let mut commands = list_kind(RuleScope::Project, project_root, SurfaceKind::Command);
    commands.extend(list_kind(RuleScope::Global, home, SurfaceKind::Command));

    AgentSurfaceOverview {
        agents,
        commands,
        project_agents_dir: PathBuf::from(project_root)
            .join(AGENTS_SUBDIR)
            .display()
            .to_string(),
        global_agents_dir: PathBuf::from(home)
            .join(AGENTS_SUBDIR)
            .display()
            .to_string(),
        excludes_plugins: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn seed(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    const AGENT: &str = "---\nname: code-reviewer\ndescription: Reviews code for quality.\n---\n\n# Reviewer\n\n본문은 발동해야 읽힌다.\n";

    #[test]
    fn counts_name_and_description_not_body() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(proj.path(), ".claude/agents/reviewer.md", AGENT);

        let ov = overview(proj.path(), home.path());
        assert_eq!(ov.agents.len(), 1);
        let e = &ov.agents[0];
        assert_eq!(e.name, "code-reviewer");
        assert_eq!(e.description, "Reviews code for quality.");
        // 세는 것은 광고 비용뿐 — 본문 바이트는 별도로 크게 남는다.
        assert_eq!(
            e.bytes,
            utf8_len("code-reviewer") + utf8_len("Reviews code for quality.")
        );
        assert!(e.body_bytes > e.bytes, "본문이 광고보다 커야 한다");
    }

    /// frontmatter 없는 파일도 목록에서 사라지지 않는다 — 이름은 스템, 비용은
    /// 이름 몫만. 조용히 빠지면 예산이 다시 거짓이 된다.
    #[test]
    fn file_without_frontmatter_still_listed() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(
            proj.path(),
            ".claude/commands/deploy.md",
            "# 배포\n\n절차\n",
        );

        let ov = overview(proj.path(), home.path());
        assert_eq!(ov.commands.len(), 1);
        assert_eq!(ov.commands[0].name, "deploy");
        assert_eq!(ov.commands[0].description, "");
        assert_eq!(ov.commands[0].bytes, utf8_len("deploy"));
    }

    #[test]
    fn separates_scopes_and_kinds() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(proj.path(), ".claude/agents/local.md", AGENT);
        seed(home.path(), ".claude/agents/global.md", AGENT);
        seed(home.path(), ".claude/commands/gcmd.md", AGENT);

        let ov = overview(proj.path(), home.path());
        assert_eq!(ov.agents.len(), 2);
        assert_eq!(ov.commands.len(), 1);
        assert_eq!(ov.agents[0].scope, RuleScope::Project);
        assert_eq!(ov.agents[1].scope, RuleScope::Global);
        assert_eq!(ov.commands[0].kind, SurfaceKind::Command);
        assert_eq!(ov.commands[0].rel_path, ".claude/commands/gcmd.md");
    }

    #[test]
    fn nested_dirs_and_non_md_are_handled() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(proj.path(), ".claude/agents/group/nested.md", AGENT);
        seed(proj.path(), ".claude/agents/notes.txt", "무시");
        seed(proj.path(), ".claude/agents/.hidden.md", AGENT);

        let ov = overview(proj.path(), home.path());
        assert_eq!(ov.agents.len(), 1);
        assert_eq!(ov.agents[0].rel_path, ".claude/agents/group/nested.md");
    }

    #[test]
    fn missing_dirs_are_empty_not_error() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        let ov = overview(proj.path(), home.path());
        assert!(ov.agents.is_empty() && ov.commands.is_empty());
        assert!(ov.excludes_plugins);
    }
}
