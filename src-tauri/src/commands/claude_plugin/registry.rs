//! Claude Code 가 디스크에 적은 것을 읽는다 — 설치 기록(`installed_plugins.json`)과 켜고 끈 값
//! (`enabledPlugins`). **읽기만 한다.** Claude 의 설정을 고치는 것은 사람이 붙여 넣는 명령의 몫이다.

use std::path::Path;

use serde_json::Value;

/// `installed_plugins.json` 에서 oculpm 항목들. v2 는 배열, v1 은 객체 하나였다.
pub fn oculpm_entries(registry: &Value) -> Vec<&Value> {
    let Some(map) = registry.get("plugins").and_then(Value::as_object) else {
        return Vec::new();
    };
    let Some((_, v)) = map
        .iter()
        .find(|(k, _)| k.as_str() == "oculpm@oculpm" || k.starts_with("oculpm@"))
    else {
        return Vec::new();
    };
    match v {
        Value::Array(list) => list.iter().collect(),
        Value::Object(_) => vec![v],
        _ => Vec::new(),
    }
}

/// 이 프로젝트에 적용되는 항목 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picked {
    pub index: usize,
    pub version: String,
    /// `project` · `local` · `user`.
    pub scope: String,
    /// 프로젝트 · 로컬 스코프면 그 폴더.
    pub project_path: Option<String>,
}

fn norm(p: &str) -> String {
    p.trim_end_matches(['/', '\\']).to_string()
}

/// 실제 경로 — 심볼릭 링크(`/tmp` → `/private/tmp`, 링크로 연 작업 폴더)를 풀어 둔다. 못 풀면 `None`.
fn real(p: &str) -> Option<String> {
    std::fs::canonicalize(p)
        .ok()
        .map(|c| norm(&c.to_string_lossy()))
}

/// `root` 가 `pp` 이거나 그 아래인가.
fn under(root: &str, pp: &str) -> bool {
    root == pp || root.starts_with(&format!("{pp}/")) || root.starts_with(&format!("{pp}\\"))
}

fn version_of(e: &Value) -> Option<String> {
    e.get("version").and_then(Value::as_str).map(str::to_string)
}

fn project_path_of(e: &Value) -> Option<&str> {
    e.get("projectPath").and_then(Value::as_str)
}

/// 이 프로젝트에 적용되는 oculpm 항목을 고른다. 프로젝트 · 로컬 스코프(`projectPath` 가 루트이거나
/// 루트의 조상)가 사용자 스코프보다 먼저다. Claude Code 가 그 순서로 겹친다.
///
/// 실측 2026-10-27: 프로젝트 15개가 2.29.0 ~ 3.13.2 로 제각각이었고, 프로젝트 스코프는 스스로
/// 올라가지 않는다. 그래서 「깔렸다」 만으로는 모자라고 **몇 판인지**가 필요하다. 다른 프로젝트의
/// 항목은 고르지 않는다. 그것을 「깔렸다」 로 읽으면 훅도 MCP 도 오지 않는 프로젝트에 「연결됨」 이
/// 떴다(11-23 #plugin-detect-false-positive).
pub fn pick(entries: &[&Value], project_root: Option<&Path>) -> Option<Picked> {
    if let Some(root) = project_root.map(|r| norm(&r.to_string_lossy())) {
        // 글자 그대로 맞거나, 링크를 푼 실제 경로끼리 맞으면 같은 자리다 — 앱이 아는 루트와 Claude 가 적은
        // `projectPath` 가 링크 하나로 갈라져 「다른 프로젝트에만」 이라고 거짓말하지 않게.
        let root_real = real(&root);
        // 가장 깊은 조상이 이긴다 (하위 폴더 설치가 상위를 덮는다).
        let mut best: Option<(usize, Picked)> = None;
        for (index, e) in entries.iter().enumerate() {
            let Some(pp) = project_path_of(e).map(norm) else {
                continue;
            };
            let applies = under(&root, &pp)
                || root_real
                    .as_deref()
                    .zip(real(&pp))
                    .is_some_and(|(r, p)| under(r, &p));
            let Some(version) = version_of(e).filter(|_| applies) else {
                continue;
            };
            if best.as_ref().is_none_or(|(len, _)| pp.len() > *len) {
                let scope = match e.get("scope").and_then(Value::as_str) {
                    Some("local") => "local",
                    _ => "project",
                };
                best = Some((
                    pp.len(),
                    Picked {
                        index,
                        version,
                        scope: scope.to_string(),
                        project_path: Some(pp),
                    },
                ));
            }
        }
        if let Some((_, p)) = best {
            return Some(p);
        }
    }
    entries.iter().enumerate().find_map(|(index, e)| {
        let user =
            project_path_of(e).is_none() || e.get("scope").and_then(Value::as_str) == Some("user");
        let version = version_of(e).filter(|_| user)?;
        Some(Picked {
            index,
            version,
            scope: "user".to_string(),
            project_path: None,
        })
    })
}

/// 고르지 않은 항목 중 앱의 판보다 낮은 것의 수 — 폴더가 없어진 프로젝트는 세지 않는다(지운 곳을
/// 두고 「옛 판」 이라고 조르지 않는다).
pub fn others_behind(entries: &[&Value], picked: Option<usize>, bundled: &str) -> u32 {
    let n = entries
        .iter()
        .enumerate()
        .filter(|(i, _)| Some(*i) != picked)
        .filter(|(_, e)| project_path_of(e).is_none_or(|p| Path::new(p).is_dir()))
        .filter(|(_, e)| version_of(e).is_some_and(|v| version_behind(&v, bundled)))
        .count();
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// 설정 파일 하나의 `enabledPlugins["oculpm@…"]` — 없거나 못 읽으면 `None`(모름은 꺼짐이 아니다).
fn enabled_flag(file: &Path) -> Option<bool> {
    let text = std::fs::read_to_string(file).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let map = v.get("enabledPlugins")?.as_object()?;
    map.iter()
        .find(|(k, _)| k.as_str() == "oculpm@oculpm" || k.starts_with("oculpm@"))
        .and_then(|(_, v)| v.as_bool())
}

/// 사람이 oculpm 을 꺼 두었는가. Claude Code 가 겹치는 순서 그대로 — 프로젝트의
/// `settings.local.json` > `settings.json` > 사용자 `~/.claude/settings.json`. 처음 만난 참/거짓이
/// 이긴다. `false` 라고 **적혀 있을 때만** 꺼짐이다.
pub fn disabled(claude_home: &Path, project_dirs: &[&Path]) -> bool {
    for dir in project_dirs {
        for file in ["settings.local.json", "settings.json"] {
            if let Some(on) = enabled_flag(&dir.join(".claude").join(file)) {
                return !on;
            }
        }
    }
    enabled_flag(&claude_home.join("settings.json")).is_some_and(|on| !on)
}

/// 숫자 세 자리를 읽는다. 못 읽으면 `None`.
fn parse_version(s: &str) -> Option<Vec<u64>> {
    let v: Vec<u64> = s
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|p| p.trim().parse::<u64>().ok())
        .collect::<Option<Vec<_>>>()?;
    (!v.is_empty()).then_some(v)
}

/// `a < b` — 숫자 세 자리 비교. 못 읽는 쪽이 있으면 false (안내하지 않는다).
pub fn version_behind(a: &str, b: &str) -> bool {
    let (Some(a), Some(b)) = (parse_version(a), parse_version(b)) else {
        return false;
    };
    let n = a.len().max(b.len());
    let at = |v: &Vec<u64>, i: usize| v.get(i).copied().unwrap_or(0);
    (0..n)
        .find(|&i| at(&a, i) != at(&b, i))
        .is_some_and(|i| at(&a, i) < at(&b, i))
}
