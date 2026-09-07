//! `{#token-glob-false-positive}` — 이 저장소 자신의 `.oculpm/config.toml` 이
//! **시크릿은 막고 소스는 통과시키는가**.
//!
//! 왜 실제 파일을 읽는가: 이 목록은 코드가 아니라 **설정**이라 타입 검사가
//! 없다. `forbid_journal_for_paths` 한 줄이 넓어지는 순간 `files_touched` 에서
//! 조용히 파일이 사라지는데, 사라진 것은 화면에 안 나오므로 아무도 못 본다.
//! 2026-09-04 에 기록된 오탐이 2026-09-05 에 **그대로 다시** 물린 이유가 그것이다.
//!
//! 부정 규칙(`!`)이 정말 먹는지도 여기서 함께 잠근다 — gitignore 문법은
//! "뒤에 오는 규칙이 이긴다"이고, 그 순서가 깨지면 조용히 옛 동작으로 돌아간다.

use std::path::Path;

use ocul_pm_lib::oculpm::redact::{build_forbidden_matcher, is_forbidden_path};
use ocul_pm_lib::oculpm::spec::OculpmConfig;

fn repo_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri 의 부모 = 저장소 루트")
}

fn matcher() -> ignore::gitignore::Gitignore {
    let cfg = OculpmConfig::load(&repo_root().join(".oculpm/config.toml"))
        .expect("이 저장소의 .oculpm/config.toml 은 읽혀야 한다");
    build_forbidden_matcher(repo_root(), &cfg.git.forbid_journal_for_paths)
}

/// 이름에 token/secret 이 들어간 **소스 파일**은 일지에 적을 수 있어야 한다.
/// 전부 이 저장소에 실재하는 경로다 — 가상의 반례가 아니다.
#[test]
fn source_files_named_like_secrets_are_journallable() {
    let m = matcher();
    for rel in [
        "src/styles/tokens.css",
        "src/__tests__/design_tokens.test.ts",
        "src-tauri/src/secrets.rs",
    ] {
        assert!(
            repo_root().join(rel).exists(),
            "{rel} 이 사라졌다 — 반례를 실재하는 경로로 갱신할 것"
        );
        assert!(
            !is_forbidden_path(&m, rel),
            "{rel} 은 시크릿이 아니라 소스다 — files_touched 에서 떨어지면 안 된다"
        );
    }
}

/// 좁혔다고 뚫리면 안 된다 — 자격증명 파일의 실제 꼴은 계속 막힌다.
#[test]
fn credential_shaped_paths_stay_forbidden() {
    let m = matcher();
    for rel in [
        ".env",
        "apps/web/.env.local",
        "config/access_token",
        "config/token.json",
        "config/credentials.yml",
        "deploy/service-account-secret.json",
        "certs/server.pem",
        "certs/server.key",
        ".ssh/id_ed25519",
        ".aws/credentials",
        "notes/api_key.txt",
    ] {
        assert!(is_forbidden_path(&m, rel), "{rel} 은 계속 막혀야 한다");
    }
}

/// 예외는 **확장자 축** 하나다 — `.ssh/**` 처럼 경로로 막은 자리는 그 안에
/// 소스 확장자가 들어와도 뚫리지 않는다 (경로 규칙이 뒤에 온다).
#[test]
fn path_scoped_rules_still_win_over_the_extension_carve_out() {
    let m = matcher();
    assert!(is_forbidden_path(&m, ".ssh/helper.rs"));
    assert!(is_forbidden_path(&m, ".gnupg/agent.py"));
}
