//! A1 (#a1-schema-paths) — 플러그인 매니페스트 불변식.
//!
//! ECC 의 PLUGIN_SCHEMA_NOTES 교훈: plugin.json 의 hooks/agents 선언 가부는
//! CLI 버전에 따라 흔들렸다 (add/revert 4회 flip-flop). 우리는 자동발견에
//! 위임하는 쪽(신·구 CLI 모두 안전)을 계약으로 고정하고, 여기서 회귀를 잡는다.
//! 검증 기준 CLI: claude 2.1.220 (`claude plugin validate` + `--plugin-dir`
//! 실로드·인벤토리(Hooks 3 · MCP 1) 통과 실측 — 2026-07-31).

use std::path::PathBuf;

fn plugin_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../plugin/oculpm")
}

fn read_json(rel: &str) -> serde_json::Value {
    let path = plugin_root().join(rel);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{} 읽기 실패: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{rel} 파싱 실패: {e}"))
}

/// plugin.json 은 문서화된 메타 필드만 갖는다. hooks/mcpServers 는 자동발견
/// (`hooks/hooks.json`·`.mcp.json`)에 위임 — 선언하면 구버전 CLI 에서 중복
/// 로드 에러가 났던 이력이 있다. version 은 앱 버전과 동기 (build-sidecar 가
/// 스탬프).
#[test]
fn plugin_json_is_minimal_and_version_synced() {
    let manifest = read_json(".claude-plugin/plugin.json");
    assert_eq!(manifest["name"], "oculpm", "이름은 짧게 — MCP 자동 도구명 64자 제한");
    assert!(manifest.get("hooks").is_none(), "hooks 는 자동발견에 위임 (선언 금지)");
    assert!(manifest.get("mcpServers").is_none(), "mcpServers 는 자동발견에 위임 (선언 금지)");

    let tauri_conf: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        manifest["version"], tauri_conf["version"],
        "plugin.json 버전은 앱 버전과 동기여야 한다 — scripts/build-sidecar.mjs 실행"
    );
}

/// 훅은 3이벤트, 전부 `.oculpm` 추적 가드 + 비추적에서도 stdin 소비
/// (가드 실패 시 cat 미실행으로 세션당 3회 EPIPE 가 나던 문제의 재발 방지).
#[test]
fn hooks_json_guards_and_consumes_stdin() {
    let hooks = read_json("hooks/hooks.json");
    let map = hooks["hooks"].as_object().expect("hooks 맵");
    assert_eq!(map.len(), 3, "구독 이벤트는 SessionStart/Stop/SessionEnd 3종 (D1)");
    for ev in ["SessionStart", "Stop", "SessionEnd"] {
        let cmd = map[ev][0]["hooks"][0]["command"].as_str().unwrap_or_else(|| panic!("{ev} command"));
        assert!(cmd.contains(".oculpm"), "{ev}: 추적 프로젝트 가드 누락");
        assert!(cmd.contains("cat > /dev/null"), "{ev}: 비추적에서도 stdin 을 소비해야 한다 (EPIPE)");
        for banned in ["curl", "wget", "http://", "https://"] {
            assert!(!cmd.contains(banned), "{ev}: 훅은 로컬 append 만 — 네트워크 금지 계약");
        }
    }
}

/// MCP 는 머신 종속 절대경로 대신 플러그인 동봉 셔틀을 가리킨다.
#[test]
fn mcp_json_uses_plugin_root_shuttle() {
    let mcp = read_json(".mcp.json");
    assert_eq!(
        mcp["oculpm"]["command"], "${CLAUDE_PLUGIN_ROOT}/bin/oculpm-mcp",
        "절대경로 하드코딩 금지 — bin/ 셔틀 경유"
    );
    let args: Vec<&str> = mcp["oculpm"]["args"]
        .as_array()
        .expect("args")
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert_eq!(args, vec!["--root", "${CLAUDE_PROJECT_DIR}"]);
}

/// 셔틀 실행 비트 — 플러그인 설치는 디렉터리 복사라 실행 비트 유실이
/// 공식 문서 Troubleshooting 1순위 고장 원인이다.
#[cfg(unix)]
#[test]
fn shuttle_script_is_executable_and_stderr_only() {
    use std::os::unix::fs::PermissionsExt;
    let path = plugin_root().join("bin/oculpm-mcp");
    let meta = std::fs::metadata(&path).expect("bin/oculpm-mcp 존재");
    assert!(meta.permissions().mode() & 0o111 != 0, "실행 비트 유실");
    let script = std::fs::read_to_string(&path).unwrap();
    assert!(script.starts_with("#!/bin/sh"), "POSIX sh — bash 의존 금지");
    assert!(script.contains(">&2"), "안내는 stderr 로 (stdout 은 MCP 프로토콜 전용)");
}
