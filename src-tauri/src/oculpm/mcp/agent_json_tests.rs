//! Cursor · Gemini 프로젝트 MCP 등록 — 빈 파일 · 남의 서버 · 깨진 JSON · 멱등 · 해제.

use super::*;
use tempfile::TempDir;

const BOTH: [AgentMcpTarget; 2] = [AgentMcpTarget::Cursor, AgentMcpTarget::Gemini];

fn fake_binary(dir: &Path) -> PathBuf {
    let p = dir.join("bin").join("oculpm-mcp");
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, "#!/bin/sh\n").unwrap();
    p
}

fn read(root: &Path, t: AgentMcpTarget) -> String {
    std::fs::read_to_string(root.join(t.rel_path())).unwrap()
}

fn write(root: &Path, t: AgentMcpTarget, body: &str) {
    let p = root.join(t.rel_path());
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

#[test]
fn no_file_or_an_empty_file_gets_a_fresh_entry_pointing_at_this_project() {
    for t in BOTH {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let bin = fake_binary(root);
        let st = register(t, root, None, &bin).unwrap();
        assert!(st.registered && st.binary_found, "{t:?}");
        let v: Value = serde_json::from_str(&read(root, t)).unwrap();
        assert_eq!(
            v["mcpServers"]["oculpm"]["command"],
            bin.to_string_lossy().as_ref()
        );
        assert_eq!(v["mcpServers"]["oculpm"]["args"][0], "--root");
        assert_eq!(
            v["mcpServers"]["oculpm"]["args"][1],
            root.to_string_lossy().as_ref()
        );
        assert!(
            v["mcpServers"]["oculpm"].get("type").is_none(),
            "Gemini 는 type 을 모른다"
        );

        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, t, "  \n");
        assert!(
            register(t, root, None, &bin).unwrap().registered,
            "{t:?} 빈 파일"
        );
    }
}

#[test]
fn other_servers_and_unknown_keys_keep_their_values_and_order() {
    let body = r#"{
  "theme": "GitHub",
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "gh-mcp"] },
    "oculpm": { "command": "/old/oculpm-mcp", "args": [] },
    "zeta": { "url": "https://example.invalid/mcp" }
  },
  "contextFileName": "GEMINI.md"
}"#;
    for t in BOTH {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let bin = fake_binary(root);
        write(root, t, body);
        register(t, root, None, &bin).unwrap();
        let v: Value = serde_json::from_str(&read(root, t)).unwrap();
        let top: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(top, ["theme", "mcpServers", "contextFileName"], "{t:?}");
        let servers: Vec<&str> = v["mcpServers"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            servers,
            ["github", "oculpm", "zeta"],
            "옛 항목은 제자리에서 바뀐다"
        );
        assert_eq!(v["mcpServers"]["github"]["args"][1], "gh-mcp");
        assert_eq!(
            v["mcpServers"]["oculpm"]["command"],
            bin.to_string_lossy().as_ref()
        );

        // 해제 — 우리 것만 걷는다.
        let st = unregister(t, root, None, Some(&bin)).unwrap();
        assert!(!st.registered);
        let v: Value = serde_json::from_str(&read(root, t)).unwrap();
        assert!(v["mcpServers"].get("oculpm").is_none());
        assert_eq!(
            v["mcpServers"]["zeta"]["url"],
            "https://example.invalid/mcp"
        );
        assert_eq!(v["contextFileName"], "GEMINI.md");
    }
}

#[test]
fn registering_twice_does_not_touch_the_file() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    let bin = fake_binary(root);
    let t = AgentMcpTarget::Cursor;
    register(t, root, None, &bin).unwrap();
    let first = read(root, t);
    // 사람이 고쳐 둔 들여쓰기도 같은 항목이면 그대로다.
    let hand = first.replace("  ", "    ");
    write(root, t, &hand);
    register(t, root, None, &bin).unwrap();
    assert_eq!(read(root, t), hand);
}

#[test]
fn broken_or_commented_json_is_refused_and_never_overwritten() {
    for t in BOTH {
        for body in [
            "{ broken !!",
            "{\n  // Gemini 는 주석을 허용한다\n  \"mcpServers\": {}\n}",
            "[1, 2]",
            "{\"mcpServers\": []}",
        ] {
            let dir = TempDir::new().unwrap();
            let root = dir.path();
            let bin = fake_binary(root);
            write(root, t, body);
            let err = register(t, root, None, &bin).unwrap_err();
            assert!(
                err.contains(t.rel_path().rsplit('/').next().unwrap()),
                "경로를 말한다: {err}"
            );
            assert!(err.contains("was left unchanged"), "이유를 말한다: {err}");
            assert!(unregister(t, root, None, Some(&bin)).is_err());
            assert!(status(t, root, None, Some(&bin)).is_err());
            assert_eq!(read(root, t), body, "{t:?} 덮어쓰지 않는다");
        }
    }
}

#[test]
fn unregister_without_a_file_writes_nothing_and_empties_are_cleaned() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    let bin = fake_binary(root);
    let t = AgentMcpTarget::Gemini;
    assert!(!unregister(t, root, None, Some(&bin)).unwrap().registered);
    assert!(
        !root.join(t.rel_path()).exists(),
        "없던 파일을 만들지 않는다"
    );

    register(t, root, None, &bin).unwrap();
    unregister(t, root, None, Some(&bin)).unwrap();
    assert_eq!(read(root, t), "{}\n", "빈 mcpServers 는 걷는다");
}

#[test]
fn detection_reads_project_markers_and_the_home_folder() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("p");
    let home = dir.path().join("home");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    for t in BOTH {
        assert!(!detected(t, &root, Some(&home)), "{t:?}");
    }
    std::fs::write(root.join("GEMINI.md"), "x").unwrap();
    assert!(detected(AgentMcpTarget::Gemini, &root, None));
    assert!(!detected(AgentMcpTarget::Cursor, &root, None));
    std::fs::create_dir_all(home.join(".cursor")).unwrap();
    assert!(detected(AgentMcpTarget::Cursor, &root, Some(&home)));
}

#[cfg(unix)]
#[test]
fn a_symlinked_config_is_not_written_through() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("p");
    std::fs::create_dir_all(root.join(".cursor")).unwrap();
    let outside = dir.path().join("secret.json");
    std::fs::write(&outside, "{}").unwrap();
    std::os::unix::fs::symlink(&outside, root.join(".cursor/mcp.json")).unwrap();
    let bin = fake_binary(dir.path());
    assert!(register(AgentMcpTarget::Cursor, &root, None, &bin).is_err());
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "{}");
}
