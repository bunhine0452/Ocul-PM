//! 번들 안을 읽어 **무엇이 들어 있고 그중 무엇을 이행하는지** 가른다
//! (Osaurus 라운드 Phase 6 #plugin-import · #not-honored-notice).
//!
//! 여기서 하는 판단은 하나뿐이다: 이 경로를 우리가 놓을 자리가 있는가.
//! 자리가 없으면 **버리지 않고** [`ArtifactKind::NotHonored`] 로 남긴다 —
//! 상세 화면이 그 목록을 그대로 보여 준다. Osaurus 가 가장 잘한 UX 이고,
//! 이 저장소의 정직성 감사(honesty-audit)를 UI 로 옮긴 것이다.

use serde::{Deserialize, Serialize};
use specta::Type;

use super::archive::BundleFile;

/// 번들 매니페스트 위치 — Claude Code 규약 고정.
pub const PLUGIN_MANIFEST: &str = ".claude-plugin/plugin.json";
pub const MARKETPLACE_MANIFEST: &str = ".claude-plugin/marketplace.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    /// `skills/<n>/**` → `.claude/skills/<n>/**`
    Skill,
    /// `commands/<n>.md` → `.claude/commands/<n>.md`
    Command,
    /// `agents/<n>.md` → `.claude/agents/<n>.md` + 비활성 자동화 정의
    Agent,
    /// `.mcp.json` → 프로젝트 `.mcp.json` 에 병합
    McpServers,
    /// `CLAUDE.md` · `README.md` → 규칙 허브에 참조로 (읽기 전용 배치)
    Reference,
    /// 감지했지만 **실행하지 않는다**. 사유는 [`Artifact::reason`].
    NotHonored,
}

/// 이행하지 않는 아티팩트와 그 사유 코드. 새 항목이 늘어날 때 여기만 고친다.
///
/// `hooks` 는 특히 의도적이다 — 남의 셸 스크립트를 우리가 설치해 실행시키는
/// 것은 임포트가 아니라 임의 코드 실행이다. 감지는 하되 손대지 않는다.
const NOT_HONORED: &[(&str, &str)] = &[
    ("hooks/", "hooks_run_shell"),
    ("bin/", "binaries_not_installed"),
    ("lspServers/", "not_supported_yet"),
    ("outputStyles/", "not_supported_yet"),
    ("channels/", "not_supported_yet"),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Artifact {
    pub kind: ArtifactKind,
    /// 번들 안 경로.
    pub source: String,
    /// 프로젝트 루트 기준 목적지. `NotHonored`·`McpServers` 는 `None`.
    pub dest: Option<String>,
    /// 사람이 읽는 이름 (스킬 폴더명·커맨드명·에이전트명).
    pub name: String,
    /// `NotHonored` 사유 코드.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct BundleManifest {
    /// `plugin.json` 의 `name` (없으면 번들 소스에서 유도한 이름).
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub artifacts: Vec<Artifact>,
    /// 매니페스트가 아예 없었다 — 폴더 구조만 보고 읽었다는 뜻.
    pub manifest_missing: bool,
}

impl BundleManifest {
    /// 실제로 놓을 아티팩트만.
    pub fn honored(&self) -> impl Iterator<Item = &Artifact> {
        self.artifacts
            .iter()
            .filter(|a| a.kind != ArtifactKind::NotHonored)
    }
    /// 「선언됐지만 아직 이행하지 않음」 목록.
    pub fn not_honored(&self) -> impl Iterator<Item = &Artifact> {
        self.artifacts
            .iter()
            .filter(|a| a.kind == ArtifactKind::NotHonored)
    }
}

/// 번들 id 로 쓸 수 있는 형태로. 자동화 id 규약(`normalize_id`)과 같은 문자
/// 집합이라 나중에 자동화 정의 파일명으로도 그대로 쓸 수 있다.
pub fn normalize_id(raw: &str) -> Option<String> {
    let mut out = String::new();
    let mut last_dash = true;
    for ch in raw.chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if mapped == '-' {
            if last_dash {
                continue;
            }
            last_dash = true;
        } else {
            last_dash = false;
        }
        out.push(mapped);
        if out.len() >= 64 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// 번들 파일 목록 → 매니페스트. 파일이 하나도 없으면 `None`.
pub fn read(files: &[BundleFile], fallback_name: &str) -> Option<BundleManifest> {
    if files.is_empty() {
        return None;
    }
    let meta = files
        .iter()
        .find(|f| f.path == PLUGIN_MANIFEST)
        .and_then(|f| serde_json::from_slice::<serde_json::Value>(&f.bytes).ok());

    let str_of = |key: &str| {
        meta.as_ref()
            .and_then(|m| m.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    let name = str_of("name").unwrap_or_else(|| fallback_name.to_string());
    let id = normalize_id(&name).unwrap_or_else(|| "bundle".to_string());

    Some(BundleManifest {
        id,
        name,
        version: str_of("version"),
        description: str_of("description"),
        homepage: str_of("homepage"),
        artifacts: classify(files),
        manifest_missing: meta.is_none(),
    })
}

fn classify(files: &[BundleFile]) -> Vec<Artifact> {
    let mut out: Vec<Artifact> = Vec::new();
    // 이행하지 않는 폴더는 **한 줄로** 접는다 — `hooks/` 안의 파일 여섯 개가
    // 여섯 줄이 되면 목록이 아니라 소음이다.
    let mut folded: Vec<&str> = Vec::new();

    for file in files {
        let path = file.path.as_str();

        if let Some((prefix, reason)) = NOT_HONORED.iter().find(|(p, _)| path.starts_with(p)) {
            if !folded.contains(prefix) {
                folded.push(prefix);
                out.push(Artifact {
                    kind: ArtifactKind::NotHonored,
                    source: (*prefix).to_string(),
                    dest: None,
                    name: prefix.trim_end_matches('/').to_string(),
                    reason: Some((*reason).to_string()),
                });
            }
            continue;
        }

        if let Some(rest) = path.strip_prefix("skills/") {
            // 스킬은 폴더 전체가 한 아티팩트다 — 안의 파일은 개별로 세지 않는다.
            let Some(dir) = rest.split('/').next().filter(|d| !d.is_empty()) else {
                continue;
            };
            if !out
                .iter()
                .any(|a| a.kind == ArtifactKind::Skill && a.name == dir)
            {
                out.push(Artifact {
                    kind: ArtifactKind::Skill,
                    source: format!("skills/{dir}"),
                    dest: Some(format!(".claude/skills/{dir}")),
                    name: dir.to_string(),
                    reason: None,
                });
            }
            continue;
        }

        if let Some(art) = single_md(path, "commands/", ArtifactKind::Command, ".claude/commands")
            .or_else(|| single_md(path, "agents/", ArtifactKind::Agent, ".claude/agents"))
        {
            out.push(art);
            continue;
        }

        if path == ".mcp.json" {
            out.push(Artifact {
                kind: ArtifactKind::McpServers,
                source: path.to_string(),
                dest: None,
                name: ".mcp.json".into(),
                reason: None,
            });
            continue;
        }

        if matches!(path, "CLAUDE.md" | "README.md") {
            out.push(Artifact {
                kind: ArtifactKind::Reference,
                source: path.to_string(),
                // 남의 CLAUDE.md 를 프로젝트 루트 CLAUDE.md 로 덮으면 사고다.
                // 번들 폴더 안에 참조로 둔다 — 규칙 허브가 링크로 보여 준다.
                dest: Some(format!(".claude/oculpm-bundles/{path}")),
                name: path.to_string(),
                reason: None,
            });
        }
    }
    out
}

fn single_md(path: &str, prefix: &str, kind: ArtifactKind, dest_dir: &str) -> Option<Artifact> {
    let rest = path.strip_prefix(prefix)?;
    // 한 단계만 본다 — Claude Code 도 `commands/*.md` 한 단계만 읽는다.
    if rest.contains('/') || !rest.ends_with(".md") {
        return None;
    }
    Some(Artifact {
        kind,
        source: path.to_string(),
        dest: Some(format!("{dest_dir}/{rest}")),
        name: rest.trim_end_matches(".md").to_string(),
        reason: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, body: &str) -> BundleFile {
        BundleFile {
            path: path.into(),
            bytes: body.as_bytes().to_vec(),
        }
    }

    fn sample() -> Vec<BundleFile> {
        vec![
            f(
                PLUGIN_MANIFEST,
                r#"{"name":"Team Kit","version":"1.2.0","description":"d"}"#,
            ),
            f("skills/run-evals/SKILL.md", "s"),
            f("skills/run-evals/references/a.md", "r"),
            f("skills/tdd/SKILL.md", "s"),
            f("commands/standup.md", "c"),
            f("agents/reviewer.md", "a"),
            f(".mcp.json", "{}"),
            f("CLAUDE.md", "m"),
            f("hooks/hooks.json", "h"),
            f("hooks/session-end.sh", "h"),
            f("bin/thing", "b"),
        ]
    }

    #[test]
    fn reads_identity_from_the_manifest() {
        let m = read(&sample(), "fallback").unwrap();
        assert_eq!(m.name, "Team Kit");
        assert_eq!(m.id, "team-kit", "id is normalized for use as a file name");
        assert_eq!(m.version.as_deref(), Some("1.2.0"));
        assert!(!m.manifest_missing);
    }

    #[test]
    fn falls_back_to_the_source_name_without_a_manifest() {
        let m = read(&[f("commands/a.md", "x")], "owner/repo").unwrap();
        assert!(m.manifest_missing, "the caller must be able to say so");
        assert_eq!(m.id, "owner-repo");
    }

    #[test]
    fn a_skill_folder_is_one_artifact_not_one_per_file() {
        let m = read(&sample(), "x").unwrap();
        let skills: Vec<&Artifact> = m
            .artifacts
            .iter()
            .filter(|a| a.kind == ArtifactKind::Skill)
            .collect();
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].dest.as_deref(), Some(".claude/skills/run-evals"));
    }

    #[test]
    fn artifacts_land_where_claude_code_reads_them() {
        let m = read(&sample(), "x").unwrap();
        let dest = |kind: ArtifactKind| {
            m.artifacts
                .iter()
                .find(|a| a.kind == kind)
                .and_then(|a| a.dest.clone())
        };
        assert_eq!(
            dest(ArtifactKind::Command).as_deref(),
            Some(".claude/commands/standup.md")
        );
        assert_eq!(
            dest(ArtifactKind::Agent).as_deref(),
            Some(".claude/agents/reviewer.md")
        );
    }

    #[test]
    fn a_bundle_claude_md_never_targets_the_project_root() {
        let m = read(&sample(), "x").unwrap();
        let reference = m
            .artifacts
            .iter()
            .find(|a| a.kind == ArtifactKind::Reference)
            .unwrap();
        assert_eq!(
            reference.dest.as_deref(),
            Some(".claude/oculpm-bundles/CLAUDE.md"),
            "overwriting the project's own CLAUDE.md would be a data-loss bug"
        );
    }

    #[test]
    fn unsupported_folders_are_listed_once_with_a_reason() {
        let m = read(&sample(), "x").unwrap();
        let nh: Vec<&Artifact> = m.not_honored().collect();
        assert_eq!(nh.len(), 2, "hooks/ and bin/ fold to one row each");
        let hooks = nh.iter().find(|a| a.name == "hooks").unwrap();
        assert_eq!(hooks.reason.as_deref(), Some("hooks_run_shell"));
        assert!(nh.iter().all(|a| a.dest.is_none()), "nothing gets placed");
    }

    #[test]
    fn nested_command_files_are_ignored_like_claude_code_ignores_them() {
        let m = read(
            &[f("commands/group/deep.md", "x"), f("commands/ok.md", "y")],
            "b",
        )
        .unwrap();
        let names: Vec<&str> = m.honored().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["ok"]);
    }

    #[test]
    fn normalize_id_collapses_runs_and_trims() {
        assert_eq!(normalize_id("Team  Kit!!"), Some("team-kit".into()));
        assert_eq!(normalize_id("owner/repo"), Some("owner-repo".into()));
        assert_eq!(normalize_id("---"), None);
    }
}
