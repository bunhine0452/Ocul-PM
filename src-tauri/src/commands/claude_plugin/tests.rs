use std::path::{Path, PathBuf};

use serde_json::json;

use super::reach::{candidate_paths, reaches_app, SHUTTLE_CANDIDATES};
use super::registry::{oculpm_entries, pick};
use super::*;

fn picked(r: &serde_json::Value, root: Option<&str>) -> Option<(String, String)> {
    let entries = oculpm_entries(r);
    pick(&entries, root.map(Path::new)).map(|p| (p.version, p.scope))
}

fn registry() -> serde_json::Value {
    json!({"version": 2, "plugins": {"oculpm@oculpm": [
        {"scope": "project", "projectPath": "/u/me/Desktop/git/ai-pm", "version": "3.3.0"},
        {"scope": "project", "projectPath": "/u/me/Desktop/1dev/board", "version": "3.13.0"},
        {"scope": "project", "projectPath": "/u/me/Desktop/1dev/board/packages/core", "version": "3.13.2"},
        {"scope": "local", "projectPath": "/u/me/scratch", "version": "4.0.0"},
        {"scope": "user", "version": "3.6.0"}
    ]}})
}

#[test]
fn project_scope_wins_and_the_deepest_ancestor_wins() {
    let r = registry();
    let p = |v: &str, s: &str| Some((v.to_string(), s.to_string()));
    assert_eq!(
        picked(&r, Some("/u/me/Desktop/git/ai-pm")),
        p("3.3.0", "project")
    );
    assert_eq!(
        picked(&r, Some("/u/me/Desktop/1dev/board/packages/core/src")),
        p("3.13.2", "project")
    );
    assert_eq!(
        picked(&r, Some("/u/me/Desktop/1dev/board/other")),
        p("3.13.0", "project")
    );
    assert_eq!(picked(&r, Some("/u/me/scratch")), p("4.0.0", "local"));
    // 어느 프로젝트 스코프에도 안 걸리면 사용자 스코프.
    assert_eq!(picked(&r, Some("/u/me/elsewhere")), p("3.6.0", "user"));
    assert_eq!(picked(&r, None), p("3.6.0", "user"));
    assert_eq!(picked(&json!({"plugins": {}}), None), None);
}

#[test]
fn a_v1_registry_object_is_one_user_entry() {
    let r = json!({"version": 1, "plugins": {"oculpm@oculpm": {"version": "2.40.0"}}});
    assert_eq!(
        picked(&r, Some("/x")),
        Some(("2.40.0".into(), "user".into()))
    );
}

#[test]
fn behind_is_a_numeric_compare_that_never_nags_on_junk() {
    assert!(version_behind("3.3.0", "3.14.0"));
    assert!(version_behind("2.31.0", "3.0.0"));
    assert!(!version_behind("3.14.0", "3.14.0"));
    assert!(!version_behind("3.15.0", "3.14.0"));
    assert!(!version_behind("0120fb83", "3.14.0"));
    assert!(version_behind("v3.13", "3.13.2"));
}

#[test]
fn the_bundled_version_is_the_plugin_manifest() {
    let v = bundled_plugin_version();
    assert!(v.split('.').count() == 3, "{v}");
}

// ─── 상태 판정 — 임시 `~/.claude` 로 ────────────────────────────────────────

struct Fake {
    _tmp: tempfile::TempDir,
    home: PathBuf,
    root: PathBuf,
}

fn fake() -> Fake {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join(".claude");
    let root = tmp.path().join("proj");
    std::fs::create_dir_all(home.join("plugins")).unwrap();
    std::fs::create_dir_all(&root).unwrap();
    Fake {
        _tmp: tmp,
        home,
        root,
    }
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// `marketplace add` 가 남기는 것 — 마켓 클론 안의 플러그인 매니페스트와 마켓 목록.
fn add_marketplace(f: &Fake) {
    write(
        &f.home
            .join("plugins/marketplaces/oculpm/plugin/oculpm/.claude-plugin/plugin.json"),
        r#"{"name": "oculpm", "version": "4.12.1"}"#,
    );
    write(
        &f.home.join("plugins/known_marketplaces.json"),
        r#"{"oculpm": {"source": {"source": "github", "repo": "bunhine0452/Ocul-PM"}}}"#,
    );
}

fn install_for(f: &Fake, project: &Path, version: &str) {
    let reg = json!({"version": 2, "plugins": {"oculpm@oculpm": [
        {"scope": "project", "projectPath": project.to_string_lossy(), "version": version}
    ]}});
    write(
        &f.home.join("plugins/installed_plugins.json"),
        &reg.to_string(),
    );
}

fn status(f: &Fake, bundled: &str) -> ClaudePluginStatus {
    status_in(Some(&f.home), Some(&f.root), bundled.to_string(), true)
}

#[test]
fn nothing_on_disk_is_not_installed() {
    let f = fake();
    let s = status(&f, "4.12.1");
    assert_eq!(s.state, ClaudePluginState::NotInstalled);
    assert!(!s.installed);
}

/// 거짓 「연결됨」 1 — 마켓플레이스만 더했다. 마켓 클론 안의 `plugin.json` 은 설치가 아니다.
#[test]
fn a_marketplace_clone_alone_is_not_connected() {
    let f = fake();
    add_marketplace(&f);
    let s = status(&f, "4.12.1");
    assert_eq!(s.state, ClaudePluginState::MarketplaceOnly);
    assert!(!s.installed);
    assert!(s.path.is_some(), "폴더는 찾되 설치로 읽지 않는다");
}

/// 거짓 「연결됨」 2 — 다른 프로젝트에만 깔았다.
#[test]
fn an_install_for_another_project_is_not_connected_here() {
    let f = fake();
    add_marketplace(&f);
    let other = f.root.parent().unwrap().join("other");
    std::fs::create_dir_all(&other).unwrap();
    install_for(&f, &other, "4.3.0");
    let s = status(&f, "4.12.1");
    assert_eq!(s.state, ClaudePluginState::OtherProject);
    assert!(!s.installed);
    assert_eq!(s.installed_version, None);
    assert_eq!(s.other_behind, 1, "그 프로젝트의 옛 판은 센다");
}

#[test]
fn an_install_here_is_connected() {
    let f = fake();
    install_for(&f, &f.root, "4.12.1");
    let s = status(&f, "4.12.1");
    assert_eq!(s.state, ClaudePluginState::Connected);
    assert!(s.installed && !s.behind && !s.ahead);
    assert_eq!(s.scope.as_deref(), Some("project"));
}

/// 거짓 「연결됨」 3 — 깔았지만 꺼 두었다. 프로젝트 설정이 사용자 설정을 이긴다.
#[test]
fn enabled_plugins_false_is_disabled_with_claude_precedence() {
    let f = fake();
    install_for(&f, &f.root, "4.12.1");
    write(
        &f.home.join("settings.json"),
        r#"{"enabledPlugins": {"oculpm@oculpm": false}}"#,
    );
    assert_eq!(status(&f, "4.12.1").state, ClaudePluginState::Disabled);

    write(
        &f.root.join(".claude/settings.json"),
        r#"{"enabledPlugins": {"oculpm@oculpm": true}}"#,
    );
    assert_eq!(status(&f, "4.12.1").state, ClaudePluginState::Connected);

    write(
        &f.root.join(".claude/settings.local.json"),
        r#"{"enabledPlugins": {"oculpm@oculpm": false}}"#,
    );
    assert_eq!(status(&f, "4.12.1").state, ClaudePluginState::Disabled);
}

/// 모르는 것은 꺼짐이 아니다 — 키가 없거나 파일이 깨졌으면 켜진 것으로 둔다.
#[test]
fn an_unreadable_settings_file_does_not_disable() {
    let f = fake();
    install_for(&f, &f.root, "4.12.1");
    write(&f.root.join(".claude/settings.json"), "{ not json");
    write(
        &f.home.join("settings.json"),
        r#"{"enabledPlugins": {"other@x": false}}"#,
    );
    assert_eq!(status(&f, "4.12.1").state, ClaudePluginState::Connected);
}

/// 플러그인이 앱보다 새 판 — 한 방향 비교의 반대쪽.
#[test]
fn ahead_is_the_mirror_of_behind() {
    let f = fake();
    install_for(&f, &f.root, "4.12.0");
    let s = status(&f, "4.11.0");
    assert!(s.ahead && !s.behind);
    let s = status(&f, "4.12.0");
    assert!(!s.ahead && !s.behind);
    let s = status(&f, "4.13.0");
    assert!(!s.ahead && s.behind);
}

/// 다른 프로젝트의 옛 판 수 — 지운 폴더는 세지 않는다.
#[test]
fn other_behind_counts_only_projects_that_still_exist() {
    let f = fake();
    let parent = f.root.parent().unwrap();
    let a = parent.join("a");
    let b = parent.join("b");
    std::fs::create_dir_all(&a).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    let reg = json!({"version": 2, "plugins": {"oculpm@oculpm": [
        {"scope": "project", "projectPath": f.root.to_string_lossy(), "version": "4.12.1"},
        {"scope": "project", "projectPath": a.to_string_lossy(), "version": "4.3.0"},
        {"scope": "project", "projectPath": b.to_string_lossy(), "version": "4.12.1"},
        {"scope": "project", "projectPath": parent.join("gone").to_string_lossy(), "version": "2.42.0"}
    ]}});
    write(
        &f.home.join("plugins/installed_plugins.json"),
        &reg.to_string(),
    );
    let s = status(&f, "4.12.1");
    assert_eq!(s.state, ClaudePluginState::Connected);
    assert_eq!(s.other_behind, 1);
}

// ─── 셔틀이 앱에 닿는가 ──────────────────────────────────────────────────────

/// 셔틀의 `for cand in … do` 목록 — 줄마다 한 후보.
fn shuttle_list(text: &str) -> Vec<String> {
    let start = text
        .find("for cand in \\\n")
        .expect("셔틀에 for cand in 이 없다");
    let rest = &text[start..];
    let end = rest.find("\ndo\n").expect("셔틀의 do 가 없다");
    rest[..end]
        .lines()
        .skip(1)
        .map(|l| l.trim().trim_end_matches('\\').trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// 표가 셔틀과 갈라지면 화면이 「닿아요」 라고 하는데 셔틀은 못 찾는다(또는 그 반대).
#[test]
fn the_table_is_the_shuttle_list_line_for_line() {
    let shuttle = include_str!("../../../../plugin/oculpm/bin/oculpm-mcp");
    let table: Vec<&str> = SHUTTLE_CANDIDATES.iter().map(|(sh, _, _)| *sh).collect();
    assert_eq!(shuttle_list(shuttle), table);
}

/// 번들 이름은 productName 그대로(`Ocul-PM.app`) — 대소문자를 가르는 볼륨에서도 셔틀이 찾는다.
#[test]
fn the_shuttle_names_the_real_bundle() {
    let conf: serde_json::Value =
        serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
    let product = conf["productName"].as_str().unwrap();
    let bundle = format!("/Applications/{product}.app/Contents/MacOS/oculpm-mcp");
    assert!(
        SHUTTLE_CANDIDATES
            .iter()
            .any(|(sh, _, _)| sh.contains(&bundle)),
        "{bundle}"
    );
}

#[test]
fn an_app_outside_the_candidate_places_is_unreachable() {
    let tmp = tempfile::tempdir().unwrap();
    let fs_root = tmp.path().join("root");
    let home = tmp.path().join("home");
    let none = |_: &str| None;
    // 내려받기 폴더나 dmg 마운트에서 연 앱 — 후보 자리는 모두 비었다.
    std::fs::create_dir_all(home.join("Downloads/Ocul-PM.app/Contents/MacOS")).unwrap();
    assert!(!reaches_app(&candidate_paths(&none, Some(&home), &fs_root)));

    write(
        &fs_root.join("Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp"),
        "",
    );
    assert!(reaches_app(&candidate_paths(&none, Some(&home), &fs_root)));
}

#[test]
fn the_environment_places_count_and_empty_values_do_not() {
    let tmp = tempfile::tempdir().unwrap();
    let fs_root = tmp.path().join("root");
    let xdg = tmp.path().join("xdg");
    write(&xdg.join("ocul-pm/bin/oculpm-mcp"), "");
    let xdg_s = xdg.to_string_lossy().to_string();
    let env = move |k: &str| (k == "XDG_DATA_HOME").then(|| xdg_s.clone());
    assert!(reaches_app(&candidate_paths(&env, None, &fs_root)));

    let empty = |k: &str| (k == "OCULPM_MCP_BIN").then(String::new);
    assert!(!reaches_app(&candidate_paths(&empty, None, &fs_root)));
}
