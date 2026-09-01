//! 번들 배치 — **우리가 놓은 것만 만진다** (Osaurus 라운드 Phase 6 #bundle-ownership).
//!
//! `rules.rs` 의 미러 마커 규약을 그대로 가져왔다. 우리가 쓴 파일에는 소유
//! 마커 한 줄을 남기고, **마커가 없는 파일은 절대 덮어쓰지도 지우지도
//! 않는다** — 그 자리에 이미 있던 것은 사용자의 파일이고, 임포트가 남의
//! 작업을 조용히 지우는 순간 이 기능은 쓰면 안 되는 기능이 된다.
//!
//! 그래서 결과는 셋으로 갈린다:
//!
//! | 결과 | 뜻 |
//! |---|---|
//! | `Wrote` | 새로 놓았거나, 우리가 놓았던 것을 갱신했다 |
//! | `Unchanged` | 같은 바이트라 쓰지 않았다 (워처 증폭 방지) |
//! | `Conflict` | 마커 없는 파일이 이미 있다 — **건드리지 않았다** |
//!
//! 하나가 `Conflict` 여도 나머지는 들어간다. 마지막에 요약이 남는다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use super::archive::BundleFile;
use super::manifest::{Artifact, ArtifactKind, BundleManifest};
use super::store::{InstalledBundle, InstalledItem};
use crate::config::schema::hash_bytes;
use crate::oculpm::atomic_io::write_atomic;

/// 소유 마커 — 이 줄이 있는 파일만 우리가 갱신·삭제한다.
/// `rules.rs` 의 `<!-- oculpm:rule-mirror … -->` 와 같은 모양이다.
pub const OWNER_MARKER_PREFIX: &str = "<!-- oculpm:bundle ";
pub const OWNER_MARKER_SUFFIX: &str = " -->";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlacementOutcome {
    Wrote,
    Unchanged,
    /// 마커 없는 사용자 파일이 이미 있다 — 손대지 않았다.
    Conflict,
    /// 쓰기 자체가 실패했다.
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Placement {
    pub path: String,
    pub outcome: PlacementOutcome,
    /// `Failed` 의 영어 원문.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct InstallReport {
    pub bundle_id: String,
    /// 미리보기였다 — 디스크는 그대로다. `wrote` 는 "쓸 것" 의 수다.
    pub dry: bool,
    pub placements: Vec<Placement>,
    pub wrote: u32,
    pub unchanged: u32,
    pub conflicts: u32,
    pub failed: u32,
    /// 감지했지만 이행하지 않은 아티팩트 (`manifest::Artifact`).
    pub not_honored: Vec<Artifact>,
    /// 아카이브에서 받아들이지 않은 엔트리 — `(경로, 사유)`.
    pub skipped: Vec<(String, String)>,
}

/// 소유 마커 한 줄. 마크다운·JSON 어디에도 그대로 넣을 수 없으므로 **주석을
/// 쓸 수 있는 파일에만** 붙인다 ([`marker_for`] 가 판단한다).
pub fn marker(bundle_id: &str) -> String {
    format!("{OWNER_MARKER_PREFIX}{bundle_id}{OWNER_MARKER_SUFFIX}")
}

/// 파일 내용에서 소유 번들 id 를 읽는다. 없으면 우리 것이 아니다.
pub fn owner_of(content: &str) -> Option<&str> {
    content.lines().find_map(|line| {
        line.trim()
            .strip_prefix(OWNER_MARKER_PREFIX)?
            .strip_suffix(OWNER_MARKER_SUFFIX)
    })
}

/// 이 목적지에 마커를 붙일 수 있는가. 마크다운만 붙인다 — `.mcp.json` 같은
/// 데이터 파일은 주석을 못 담고, 마커를 못 붙이면 소유 판정은 원장이 한다.
fn markable(dest: &str) -> bool {
    dest.ends_with(".md")
}

/// 놓을 바이트를 만든다. 마커를 붙일 수 있으면 **맨 끝에** 붙인다 —
/// 첫 줄에 붙이면 스킬·커맨드의 frontmatter 를 깨뜨린다.
pub fn body_with_marker(bundle_id: &str, dest: &str, bytes: &[u8]) -> Vec<u8> {
    if !markable(dest) {
        return bytes.to_vec();
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return bytes.to_vec();
    };
    let mut out = text.trim_end().to_string();
    out.push_str("\n\n");
    out.push_str(&marker(bundle_id));
    out.push('\n');
    out.into_bytes()
}

/// 한 파일을 놓는다. **경로 계산은 호출자가 아니라 여기서** 한다 — 번들이
/// 준 문자열을 그대로 join 하면 임포트 가드가 무의미해진다.
pub fn place(project_root: &Path, bundle_id: &str, dest_rel: &str, bytes: &[u8]) -> Placement {
    place_with(project_root, bundle_id, dest_rel, bytes, false)
}

/// `dry` 면 **한 글자도 쓰지 않고** 같은 판정을 낸다. 미리보기와 실제 설치가
/// 서로 다른 코드로 판정하면 "미리 본 것" 과 "일어난 것" 이 갈라진다.
pub fn place_with(
    project_root: &Path,
    bundle_id: &str,
    dest_rel: &str,
    bytes: &[u8],
    dry: bool,
) -> Placement {
    let fail = |detail: String| Placement {
        path: dest_rel.to_string(),
        outcome: PlacementOutcome::Failed,
        detail: Some(detail),
    };
    let Some(dest) = secure_join(project_root, dest_rel) else {
        return fail(format!("destination escapes the project root: {dest_rel}"));
    };

    let payload = body_with_marker(bundle_id, dest_rel, bytes);

    match std::fs::read(&dest) {
        Ok(existing) => {
            let owned = std::str::from_utf8(&existing)
                .ok()
                .and_then(owner_of)
                .is_some();
            if !owned {
                // 사용자의 파일이다. 어떤 경우에도 덮지 않는다.
                return Placement {
                    path: dest_rel.to_string(),
                    outcome: PlacementOutcome::Conflict,
                    detail: None,
                };
            }
            if existing == payload {
                return Placement {
                    path: dest_rel.to_string(),
                    outcome: PlacementOutcome::Unchanged,
                    detail: None,
                };
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return fail(e.to_string()),
    }

    if dry {
        return Placement {
            path: dest_rel.to_string(),
            outcome: PlacementOutcome::Wrote,
            detail: None,
        };
    }

    if let Some(parent) = dest.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return fail(e.to_string());
        }
    }
    match write_atomic(&dest, &payload) {
        Ok(()) => Placement {
            path: dest_rel.to_string(),
            outcome: PlacementOutcome::Wrote,
            detail: None,
        },
        Err(e) => fail(e.to_string()),
    }
}

/// 우리가 놓은 파일만 지운다. 마커가 없으면 남긴다 (사용자가 이어받은 파일).
pub fn unplace(project_root: &Path, bundle_id: &str, dest_rel: &str) -> PlacementOutcome {
    let Some(dest) = secure_join(project_root, dest_rel) else {
        return PlacementOutcome::Failed;
    };
    let Ok(existing) = std::fs::read_to_string(&dest) else {
        // 이미 없다 — 제거의 목표는 달성이다.
        return PlacementOutcome::Unchanged;
    };
    // 마커를 못 붙이는 파일은 마커로 판정할 수 없다. 원장이 지목한 경로이므로
    // 우리 것으로 보고 지운다 — 다만 마커가 **있는데 남의 것**이면 남긴다.
    match owner_of(&existing) {
        Some(id) if id != bundle_id => return PlacementOutcome::Conflict,
        None if markable(dest_rel) => return PlacementOutcome::Conflict,
        _ => {}
    }
    match std::fs::remove_file(&dest) {
        Ok(()) => PlacementOutcome::Wrote,
        Err(_) => PlacementOutcome::Failed,
    }
}

/// 프로젝트 루트 안에 가둔 경로. `..`·절대경로·심링크 탈출을 전부 거절한다
/// (`docs.rs` 의 `secure_docs_join` 을 쓰기 쪽으로 옮긴 것).
fn secure_join(root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.starts_with('/') {
        return None;
    }
    let mut out = root.to_path_buf();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return None;
        }
        if part.contains('\\') {
            return None;
        }
        out.push(part);
    }
    Some(out)
}

/// 번들 전체를 놓는다. `.mcp.json` 병합과 자동화 정의 생성은 호출자
/// (`commands/plugins.rs`)가 이어서 한다 — 그쪽은 앱 상태가 필요하다.
pub fn install(
    project_root: &Path,
    manifest: &BundleManifest,
    files: &[BundleFile],
    skipped: Vec<(String, String)>,
    source: &str,
    now: &str,
    dry: bool,
) -> (InstallReport, InstalledBundle) {
    let mut placements: Vec<Placement> = Vec::new();
    let mut items: Vec<InstalledItem> = Vec::new();

    for artifact in manifest.honored() {
        let Some(dest_root) = artifact.dest.as_deref() else {
            continue;
        };
        for (rel, bytes) in files_for(artifact, files) {
            let dest = match artifact.kind {
                // 스킬은 폴더째다 — 안쪽 상대 경로를 목적지에 이어 붙인다.
                ArtifactKind::Skill => format!("{dest_root}/{rel}"),
                _ => dest_root.to_string(),
            };
            let placement = place_with(project_root, &manifest.id, &dest, bytes, dry);
            if matches!(
                placement.outcome,
                PlacementOutcome::Wrote | PlacementOutcome::Unchanged
            ) {
                items.push(InstalledItem {
                    path: dest.clone(),
                    blake3: hash_bytes(&body_with_marker(&manifest.id, &dest, bytes)),
                });
            }
            placements.push(placement);
        }
    }

    let count = |o: PlacementOutcome| placements.iter().filter(|p| p.outcome == o).count() as u32;
    let report = InstallReport {
        bundle_id: manifest.id.clone(),
        dry,
        wrote: count(PlacementOutcome::Wrote),
        unchanged: count(PlacementOutcome::Unchanged),
        conflicts: count(PlacementOutcome::Conflict),
        failed: count(PlacementOutcome::Failed),
        not_honored: manifest.not_honored().cloned().collect(),
        skipped,
        placements,
    };
    let installed = InstalledBundle {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        source: source.to_string(),
        installed_at: now.to_string(),
        items,
        mcp_keys: Vec::new(),
        automations: Vec::new(),
    };
    (report, installed)
}

/// `.mcp.json` 병합 결과.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct McpMerge {
    /// 우리가 넣은 서버 키 (원장에 남아 제거 때 이 키만 뺀다).
    pub added: Vec<String>,
    /// 이미 남이 쓰고 있어 건드리지 않은 키.
    pub conflicts: Vec<String>,
    /// 프로젝트 `.mcp.json` 을 읽을 수 없었다 — **덮어쓰지 않고 포기**했다.
    pub unreadable: bool,
}

/// 번들의 `.mcp.json` 을 프로젝트 `.mcp.json` 에 병합한다.
///
/// `register.rs` 와 같은 계약이다 — 우리 키만 만지고, 남의 서버 정의와
/// 미지의 최상위 키는 보존하며, **파싱 불가 파일은 절대 덮어쓰지 않는다.**
/// 소유 표식을 파일에 넣지 않는 이유: `.mcp.json` 은 Claude Code 의 형식이고
/// 우리 필드를 끼워 넣으면 그 형식을 오염시킨다. 어떤 키가 우리 것인지는
/// 번들 원장(`store::InstalledBundle::mcp_keys`)이 안다.
pub fn merge_mcp(
    project_root: &Path,
    bundle_mcp: &[u8],
    owned_keys: &[String],
    dry: bool,
) -> McpMerge {
    let mut out = McpMerge {
        added: Vec::new(),
        conflicts: Vec::new(),
        unreadable: false,
    };
    let Ok(incoming) = serde_json::from_slice::<serde_json::Value>(bundle_mcp) else {
        out.unreadable = true;
        return out;
    };
    let Some(servers) = incoming.get("mcpServers").and_then(|v| v.as_object()) else {
        return out;
    };

    let path = project_root.join(".mcp.json");
    let mut current = match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(v) => v,
            Err(_) => {
                out.unreadable = true;
                return out;
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(_) => {
            out.unreadable = true;
            return out;
        }
    };
    if !current.is_object() {
        out.unreadable = true;
        return out;
    }

    let existing: Vec<String> = current
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();

    let mut changed = false;
    for (key, value) in servers {
        // 이미 있고 우리 것이 아니면 남의 서버다 — 덮지 않는다.
        if existing.contains(key) && !owned_keys.contains(key) {
            out.conflicts.push(key.clone());
            continue;
        }
        out.added.push(key.clone());
        if !dry {
            current
                .as_object_mut()
                .expect("checked above")
                .entry("mcpServers")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
                .map(|m| m.insert(key.clone(), value.clone()));
            changed = true;
        }
    }

    if changed {
        if let Ok(text) = serde_json::to_string_pretty(&current) {
            let _ = write_atomic(&path, format!("{text}\n").as_bytes());
        }
    }
    out
}

/// 원장이 지목한 서버 키를 `.mcp.json` 에서 뺀다. 남의 키는 건드리지 않는다.
pub fn unmerge_mcp(project_root: &Path, keys: &[String]) -> bool {
    if keys.is_empty() {
        return false;
    }
    let path = project_root.join(".mcp.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(mut current) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    let Some(servers) = current
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
    else {
        return false;
    };
    let mut removed = false;
    for key in keys {
        removed |= servers.remove(key).is_some();
    }
    if removed {
        if let Ok(text) = serde_json::to_string_pretty(&current) {
            let _ = write_atomic(&path, format!("{text}\n").as_bytes());
        }
    }
    removed
}

/// 아티팩트 하나가 실제로 나르는 파일들 — `(아티팩트 기준 상대경로, 바이트)`.
fn files_for<'a>(artifact: &Artifact, files: &'a [BundleFile]) -> Vec<(String, &'a [u8])> {
    match artifact.kind {
        ArtifactKind::Skill => {
            let prefix = format!("{}/", artifact.source);
            files
                .iter()
                .filter_map(|f| {
                    f.path
                        .strip_prefix(&prefix)
                        .map(|rel| (rel.to_string(), f.bytes.as_slice()))
                })
                .collect()
        }
        _ => files
            .iter()
            .filter(|f| f.path == artifact.source)
            .map(|f| (String::new(), f.bytes.as_slice()))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::manifest;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oculpm-install-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn f(path: &str, body: &str) -> BundleFile {
        BundleFile {
            path: path.into(),
            bytes: body.as_bytes().to_vec(),
        }
    }

    fn bundle() -> Vec<BundleFile> {
        vec![
            f(
                manifest::PLUGIN_MANIFEST,
                r#"{"name":"kit","version":"1.0.0"}"#,
            ),
            f(
                "skills/run-evals/SKILL.md",
                "---\nname: run-evals\n---\nbody",
            ),
            f("skills/run-evals/references/a.md", "ref"),
            f("commands/standup.md", "standup"),
            f("hooks/hooks.json", "{}"),
        ]
    }

    fn install_sample(root: &Path) -> (InstallReport, InstalledBundle) {
        let files = bundle();
        let m = manifest::read(&files, "kit").unwrap();
        install(
            root,
            &m,
            &files,
            vec![],
            "owner/repo",
            "2026-09-01T18:00:00+09:00",
            false,
        )
    }

    #[test]
    fn places_artifacts_where_claude_code_reads_them() {
        let root = tmp("place");
        let (report, installed) = install_sample(&root);
        assert_eq!(report.conflicts, 0);
        assert!(root.join(".claude/skills/run-evals/SKILL.md").is_file());
        assert!(root
            .join(".claude/skills/run-evals/references/a.md")
            .is_file());
        assert!(root.join(".claude/commands/standup.md").is_file());
        assert!(
            !root.join(".claude/hooks").exists(),
            "not-honored artifacts must not touch disk"
        );
        assert_eq!(installed.items.len(), 3);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn every_placed_markdown_carries_the_owner_marker() {
        let root = tmp("marker");
        install_sample(&root);
        let body = std::fs::read_to_string(root.join(".claude/commands/standup.md")).unwrap();
        assert_eq!(owner_of(&body), Some("kit"));
        assert!(
            body.starts_with("standup"),
            "the marker goes last so frontmatter survives"
        );
        let skill =
            std::fs::read_to_string(root.join(".claude/skills/run-evals/SKILL.md")).unwrap();
        assert!(
            skill.starts_with("---\nname: run-evals"),
            "frontmatter is still first"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn never_overwrites_a_file_we_did_not_place() {
        let root = tmp("conflict");
        let dest = root.join(".claude/commands/standup.md");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, "MY OWN COMMAND").unwrap();

        let (report, installed) = install_sample(&root);
        assert_eq!(report.conflicts, 1);
        assert_eq!(
            std::fs::read_to_string(&dest).unwrap(),
            "MY OWN COMMAND",
            "the user's file must be byte-identical afterwards"
        );
        assert_eq!(
            report.wrote, 2,
            "the rest still installs — partial failure is allowed"
        );
        assert!(
            !installed.items.iter().any(|i| i.path.contains("standup")),
            "a conflicted file is not recorded as ours"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reinstalling_the_same_bundle_writes_nothing() {
        let root = tmp("idem");
        install_sample(&root);
        let (again, _) = install_sample(&root);
        assert_eq!(again.wrote, 0);
        assert_eq!(again.unchanged, 3);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn removal_takes_our_files_and_leaves_adopted_ones() {
        let root = tmp("remove");
        let (_, installed) = install_sample(&root);

        // 사용자가 스킬 하나를 자기 것으로 이어받았다 (마커를 지웠다).
        let adopted = root.join(".claude/skills/run-evals/SKILL.md");
        std::fs::write(&adopted, "mine now").unwrap();

        let outcomes: Vec<PlacementOutcome> = installed
            .items
            .iter()
            .map(|i| unplace(&root, &installed.id, &i.path))
            .collect();
        assert!(outcomes.contains(&PlacementOutcome::Conflict));
        assert!(adopted.is_file(), "an adopted file survives removal");
        assert!(!root.join(".claude/commands/standup.md").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_dry_run_judges_the_same_but_writes_nothing() {
        let root = tmp("dry");
        let files = bundle();
        let m = manifest::read(&files, "kit").unwrap();
        let (dry, _) = install(&root, &m, &files, vec![], "owner/repo", "t", true);
        assert!(dry.dry);
        assert_eq!(dry.wrote, 3, "the preview counts what it would write");
        assert!(
            !root.join(".claude").exists(),
            "a preview must not touch disk"
        );

        let (real, _) = install(&root, &m, &files, vec![], "owner/repo", "t", false);
        assert_eq!(
            (real.wrote, real.conflicts),
            (dry.wrote, dry.conflicts),
            "preview and install must judge identically"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn mcp_merge_adds_ours_and_refuses_to_touch_a_foreign_key() {
        let root = tmp("mcp");
        std::fs::write(
            root.join(".mcp.json"),
            r#"{"mcpServers":{"theirs":{"command":"x"}},"other":1}"#,
        )
        .unwrap();
        let incoming = br#"{"mcpServers":{"theirs":{"command":"HIJACK"},"kit":{"command":"k"}}}"#;

        let merge = merge_mcp(&root, incoming, &[], false);
        assert_eq!(merge.added, vec!["kit".to_string()]);
        assert_eq!(merge.conflicts, vec!["theirs".to_string()]);

        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(".mcp.json")).unwrap())
                .unwrap();
        assert_eq!(
            after["mcpServers"]["theirs"]["command"], "x",
            "foreign entry untouched"
        );
        assert_eq!(after["mcpServers"]["kit"]["command"], "k");
        assert_eq!(after["other"], 1, "unknown top-level keys survive");

        assert!(unmerge_mcp(&root, &["kit".into()]));
        let back: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(".mcp.json")).unwrap())
                .unwrap();
        assert!(back["mcpServers"].get("kit").is_none());
        assert!(
            back["mcpServers"].get("theirs").is_some(),
            "removal never takes theirs"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_unparseable_mcp_json_is_never_overwritten() {
        let root = tmp("mcpbad");
        std::fs::write(root.join(".mcp.json"), "{ this is not json").unwrap();
        let merge = merge_mcp(&root, br#"{"mcpServers":{"kit":{}}}"#, &[], false);
        assert!(merge.unreadable);
        assert_eq!(
            std::fs::read_to_string(root.join(".mcp.json")).unwrap(),
            "{ this is not json"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_destination_cannot_escape_the_project_root() {
        let root = tmp("escape");
        let p = place(&root, "kit", "../../evil.md", b"x");
        assert_eq!(p.outcome, PlacementOutcome::Failed);
        assert!(!root.parent().unwrap().join("evil.md").exists());
        for bad in ["/etc/passwd", "a/../../b", "", "a\\b"] {
            assert!(secure_join(&root, bad).is_none(), "{bad} must be refused");
        }
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_report_carries_what_was_skipped_and_not_honored() {
        let root = tmp("report");
        let files = bundle();
        let m = manifest::read(&files, "kit").unwrap();
        let (report, _) = install(
            &root,
            &m,
            &files,
            vec![("../evil".into(), "unsafe_path".into())],
            "owner/repo",
            "t",
            false,
        );
        assert_eq!(report.not_honored.len(), 1);
        assert_eq!(report.not_honored[0].name, "hooks");
        assert_eq!(
            report.skipped.len(),
            1,
            "dropped entries are reported, not swallowed"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
