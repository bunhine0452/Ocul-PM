//! 설치된 번들 원장 — `.oculpm/plugins/<id>.md` (Osaurus 라운드 Phase 6
//! #bundle-ownership).
//!
//! 설치·업데이트·제거가 **한 단위**이려면 "이 번들이 어떤 파일을 놓았는가"
//! 를 알아야 한다. 마커는 파일 하나가 우리 것인지만 말하고, 어느 번들의
//! 것인지·무엇이 한 세트인지는 이 원장이 말한다.
//!
//! `.oculpm/automation/` 과 같은 결정(D1·D4)을 따른다 — 온디스크가 SSOT,
//! 새 디렉터리라 `schema_version` 불변, 원자 쓰기, 사람이 읽는 마크다운.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::error::{OculpmError, OculpmResult};

pub const PLUGINS_SUBDIR: &str = "plugins";
/// 원장 파일 상한 — 파일 목록 한 장이 이보다 크면 그 번들이 아니다.
const MAX_RECORD_BYTES: u64 = 256 * 1024;

/// 번들이 놓은 것 하나. 파일이거나 자동화 정의다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct InstalledItem {
    /// 프로젝트 루트 기준 경로 (`.claude/skills/run-evals/SKILL.md`).
    pub path: String,
    /// 놓을 때의 내용 해시 — 제거 시 "사용자가 고친 파일" 을 가려낸다.
    pub blake3: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct InstalledBundle {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    /// 어디서 왔는가 — `owner/repo` 또는 로컬 파일 경로.
    pub source: String,
    pub installed_at: String,
    pub items: Vec<InstalledItem>,
    /// `.mcp.json` 에 우리가 넣은 서버 키 (제거 시 이 키만 뺀다).
    #[serde(default)]
    pub mcp_keys: Vec<String>,
    /// 이 번들에서 만든 비활성 자동화 정의 id (`<kind>/<id>`).
    #[serde(default)]
    pub automations: Vec<String>,
}

pub fn plugins_dir(project_root: &Path) -> PathBuf {
    project_root.join(".oculpm").join(PLUGINS_SUBDIR)
}

/// 원장 파일 경로. id 가 경로로 탈출할 수 없음을 여기서 한 번 더 막는다.
pub fn record_path(project_root: &Path, id: &str) -> Option<PathBuf> {
    let safe = super::manifest::normalize_id(id)?;
    if safe != id {
        return None;
    }
    Some(plugins_dir(project_root).join(format!("{id}.md")))
}

/// 원장 한 장을 렌더한다. 항목 목록이 반복 데이터라 자동화 정의처럼 손으로
/// 찍지 않고 serde_yaml 에 맡긴다 — 사람이 고칠 파일이 아니라 우리가 남기는
/// 기록이고, 필드가 늘 때 렌더러가 조용히 뒤처지는 쪽이 더 나쁘다.
pub fn render(bundle: &InstalledBundle) -> OculpmResult<String> {
    let yaml = serde_yaml::to_string(bundle)
        .map_err(|e| OculpmError::InvalidConfig(format!("plugin record: {e}")))?;
    Ok(format!(
        "---\n{yaml}---\n\n# {}\n\n\
         이 파일은 ocul-pm 이 관리합니다 — 번들이 놓은 것의 목록입니다.\n\
         손으로 지우면 제거할 때 그 파일이 남습니다.\n",
        bundle.name
    ))
}

pub fn write(project_root: &Path, bundle: &InstalledBundle) -> OculpmResult<()> {
    let path = record_path(project_root, &bundle.id)
        .ok_or_else(|| OculpmError::InvalidPath(bundle.id.clone()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| OculpmError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    write_atomic(&path, render(bundle)?.as_bytes())?;
    Ok(())
}

pub fn read(project_root: &Path, id: &str) -> OculpmResult<Option<InstalledBundle>> {
    let Some(path) = record_path(project_root, id) else {
        return Ok(None);
    };
    read_path(&path)
}

fn read_path(path: &Path) -> OculpmResult<Option<InstalledBundle>> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(OculpmError::Io {
                path: path.to_path_buf(),
                source,
            })
        }
    };
    if meta.len() > MAX_RECORD_BYTES {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path).map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    // `---` 두 줄 사이가 frontmatter 다. 없으면 우리 원장이 아니다.
    let Some(rest) = text.strip_prefix("---\n") else {
        return Ok(None);
    };
    let Some(end) = rest.find("\n---") else {
        return Ok(None);
    };
    match serde_yaml::from_str::<InstalledBundle>(&rest[..end]) {
        Ok(bundle) => Ok(Some(bundle)),
        // 깨진 원장 하나가 다른 번들의 제거를 막지 않는다 (`list` 계약).
        Err(_) => Ok(None),
    }
}

/// 설치된 번들 전부. 읽지 못한 원장은 **건너뛴다** — 하나가 깨져도 나머지
/// 번들을 제거·갱신할 수 있어야 한다.
pub fn list(project_root: &Path) -> Vec<InstalledBundle> {
    let dir = plugins_dir(project_root);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    paths.sort();
    paths
        .iter()
        .filter_map(|p| read_path(p).ok().flatten())
        .collect()
}

pub fn delete(project_root: &Path, id: &str) -> OculpmResult<bool> {
    let Some(path) = record_path(project_root, id) else {
        return Ok(false);
    };
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(source) => Err(OculpmError::Io { path, source }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("oculpm-plugstore-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn bundle(id: &str) -> InstalledBundle {
        InstalledBundle {
            id: id.into(),
            name: "Team Kit".into(),
            version: Some("1.0.0".into()),
            source: "owner/repo".into(),
            installed_at: "2026-09-01T18:00:00+09:00".into(),
            items: vec![InstalledItem {
                path: ".claude/skills/a/SKILL.md".into(),
                blake3: "blake3:0011223344556677".into(),
            }],
            mcp_keys: vec!["team".into()],
            automations: vec!["schedules/reviewer".into()],
        }
    }

    #[test]
    fn round_trips_a_record() {
        let root = tmp("rt");
        write(&root, &bundle("team-kit")).unwrap();
        let back = read(&root, "team-kit").unwrap().unwrap();
        assert_eq!(back, bundle("team-kit"));
        assert_eq!(list(&root).len(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_an_id_that_would_escape_the_folder() {
        let root = tmp("escape");
        assert!(record_path(&root, "../../etc/passwd").is_none());
        assert!(record_path(&root, "a/b").is_none());
        assert!(
            record_path(&root, "Team-Kit").is_none(),
            "id must be normalized already"
        );
        assert!(record_path(&root, "team-kit").is_some());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_broken_record_does_not_hide_the_others() {
        let root = tmp("broken");
        write(&root, &bundle("good")).unwrap();
        std::fs::write(plugins_dir(&root).join("bad.md"), "not frontmatter at all").unwrap();
        let all = list(&root);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "good");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_is_idempotent() {
        let root = tmp("del");
        write(&root, &bundle("gone")).unwrap();
        assert!(delete(&root, "gone").unwrap());
        assert!(!delete(&root, "gone").unwrap());
        std::fs::remove_dir_all(&root).ok();
    }
}
