//! 확인 명령 후보 — 프로젝트 루트의 매니페스트에서 **통과/실패를 내는 명령**을 결정적으로
//! 고른다 (어떤 프로젝트여도, 2026-10-28).
//!
//! 두 자리가 쓴다: `plan_create` 가 `check` 를 못 받았을 때의 기본값, 그리고 플러그인
//! 시작 훅 `plan-context.sh` 가 확인 명령 없는 플랜(또는 플랜 없는 프로젝트)에 싣는 후보.
//! 훅은 순수 sh 라 이 함수를 부르지 못하므로 규칙을 **따로 적는다** — 둘은 공유 계약이다.
//! 한쪽만 고치면 훅이 보인 후보와 플랜에 적힌 기본값이 갈린다 (`parity` 테스트가 sh 본문의
//! 규칙 글자를 문다).
//!
//! 규칙(루트 한 단계만 · 네트워크 0 · 실행 0):
//! - `package.json` 에 `"test":` 키 → 락파일로 러너: pnpm-lock.yaml → `pnpm test` ·
//!   yarn.lock → `yarn test` · bun.lock(b) → `bun test` · 없으면 `npm test`
//! - `Cargo.toml` → `cargo test`
//! - `pyproject.toml` 또는 `pytest.ini` → `pytest`
//! - `go.mod` → `go test ./...`
//! - `Makefile` 에 `test:` 타깃 → `make test`
//!
//! 틀릴 수 있다 — 그래서 기본값으로 적을 때 `warnings` 로 알리고, 플랜 본문의 한 줄이라
//! 사람이든 에이전트든 바로 고친다. 모노레포(src-tauri/Cargo.toml 같은 하위)는 보지 않는다:
//! 하위를 훑기 시작하면 후보가 늘어 「어느 것」이 다시 질문이 된다.

use std::path::Path;

/// 매니페스트 읽기 상한 — 정상 매니페스트는 이보다 훨씬 작다.
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// 후보 목록(문서 순서 고정). 없으면 빈 벡터.
pub fn candidates(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let has = |name: &str| root.join(name).is_file();

    if let Some(pkg) = read_small(&root.join("package.json")) {
        if has_test_key(&pkg) {
            let runner = if has("pnpm-lock.yaml") {
                "pnpm"
            } else if has("yarn.lock") {
                "yarn"
            } else if has("bun.lock") || has("bun.lockb") {
                "bun"
            } else {
                "npm"
            };
            out.push(format!("{runner} test"));
        }
    }
    if has("Cargo.toml") {
        out.push("cargo test".to_string());
    }
    if has("pyproject.toml") || has("pytest.ini") {
        out.push("pytest".to_string());
    }
    if has("go.mod") {
        out.push("go test ./...".to_string());
    }
    if let Some(mk) = read_small(&root.join("Makefile")) {
        if mk.lines().any(|l| {
            l.strip_prefix("test")
                .is_some_and(|rest| rest.trim_start().starts_with(':'))
        }) {
            out.push("make test".to_string());
        }
    }
    out
}

/// 후보를 한 줄 확인 명령으로 — 둘 이상이면 `&&` 로 잇는다 (하나라도 빨가면 실패).
pub fn default_check(root: &Path) -> Option<String> {
    let c = candidates(root);
    if c.is_empty() {
        None
    } else {
        Some(c.join(" && "))
    }
}

/// `"test"` 뒤에 공백만 두고 `:` 가 오는 자리가 있는가 — sh 의 `grep -E '"test"[[:space:]]*:'`
/// 와 같은 판정. JSON 파싱을 하지 않는 이유도 그것이다: 훅과 **같은 글자**를 봐야 같은 답을 낸다.
fn has_test_key(raw: &str) -> bool {
    raw.match_indices("\"test\"")
        .any(|(i, m)| raw[i + m.len()..].trim_start().starts_with(':'))
}

fn read_small(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn touch(dir: &TempDir, name: &str, body: &str) {
        std::fs::write(dir.path().join(name), body).unwrap();
    }

    #[test]
    fn nothing_detected_is_none_not_a_guess() {
        let dir = TempDir::new().unwrap();
        assert!(candidates(dir.path()).is_empty());
        assert_eq!(default_check(dir.path()), None);
    }

    #[test]
    fn node_runner_follows_the_lockfile_and_needs_a_test_script() {
        let dir = TempDir::new().unwrap();
        touch(
            &dir,
            "package.json",
            r#"{"scripts":{"build":"vite build"}}"#,
        );
        assert!(
            candidates(dir.path()).is_empty(),
            "test 스크립트가 없으면 후보도 없다"
        );
        touch(
            &dir,
            "package.json",
            r#"{"scripts":{ "test" : "vitest run"}}"#,
        );
        assert_eq!(candidates(dir.path()), vec!["npm test"]);
        touch(&dir, "pnpm-lock.yaml", "");
        assert_eq!(candidates(dir.path()), vec!["pnpm test"]);
    }

    #[test]
    fn several_manifests_join_with_and_in_document_order() {
        let dir = TempDir::new().unwrap();
        touch(&dir, "package.json", r#"{"scripts":{"test":"vitest"}}"#);
        touch(&dir, "yarn.lock", "");
        touch(&dir, "Cargo.toml", "[package]\nname = \"x\"\n");
        touch(&dir, "pytest.ini", "[pytest]\n");
        touch(&dir, "go.mod", "module x\n");
        touch(&dir, "Makefile", "build:\n\tcc\n\ntest :\n\tpytest\n");
        assert_eq!(
            default_check(dir.path()).as_deref(),
            Some("yarn test && cargo test && pytest && go test ./... && make test")
        );
    }

    #[test]
    fn makefile_needs_a_real_test_target() {
        let dir = TempDir::new().unwrap();
        touch(&dir, "Makefile", "testing:\n\techo\n# test: not a target\n");
        assert!(candidates(dir.path()).is_empty());
    }

    /// 훅 sh 와의 **공유 계약** — 규칙을 바꾸면 양쪽을 함께 바꾸라고 여기서 문다.
    /// (본문을 돌리는 통합 테스트는 `tests/plugin_hook_no_plan.rs`.)
    #[test]
    fn parity_with_the_start_hook_script() {
        let sh = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../plugin/oculpm/hooks/plan-context.sh"),
        )
        .unwrap();
        for needle in [
            r#"'"test"[[:space:]]*:'"#,
            "pnpm-lock.yaml",
            "yarn.lock",
            "bun.lock",
            r#"add_cand "cargo test""#,
            r#"add_cand "pytest""#,
            r#"add_cand "go test ./...""#,
            r#"'^test[[:space:]]*:'"#,
            "check_infer.rs",
        ] {
            assert!(
                sh.contains(needle),
                "plan-context.sh 에 {needle} 가 없다 — 감지 규칙이 갈렸다"
            );
        }
    }
}
