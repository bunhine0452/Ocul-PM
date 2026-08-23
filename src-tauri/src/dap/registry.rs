//! 언어 → 디버그 어댑터, 그리고 **조달 전략**
//! (docs/dap/00-master-plan.md #adapter-procurement).
//!
//! LSP 레지스트리와 모양이 다른 이유가 여기 있다. 언어 서버는 넷 다 PATH 위의
//! 실행 파일이었지만, 디버그 어댑터는 그런 것이 오히려 적다:
//!
//! - `lldb-dap` 은 **Xcode 툴체인** 안에 있다 (`xcrun -f lldb-dap`). PATH 엔 없다.
//! - `debugpy` 는 실행 파일이 아니라 **파이썬 모듈**이다.
//! - `dlv` 는 `dlv dap` 이라는 **하위 명령**으로 어댑터가 된다.
//!
//! 그래서 `command: &str` 하나가 아니라 전략을 값으로 든다.

use std::path::PathBuf;

/// 어댑터 실행 파일을 어떻게 찾는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolve {
    /// PATH 에서 이름으로 (LSP 와 같은 길).
    Path { command: &'static str },
    /// Xcode 툴체인 — `xcrun -f <name>` 가 절대경로를 알려 준다.
    Xcrun { name: &'static str },
    /// 인터프리터의 모듈 — `python3 -m debugpy.adapter`.
    Module { runner: &'static str, module: &'static str },
    /// 하위 명령 — `dlv dap`.
    Subcommand { command: &'static str, sub: &'static str },
}

/// 하나의 디버그 어댑터를 어떻게 띄우는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdapterSpec {
    /// 우리 쪽 키이자 UI 라벨 (`rust` · `python` …).
    pub language_id: &'static str,
    /// `initialize` 의 `adapterID` — 어댑터가 자기 이름으로 받는다.
    pub adapter_id: &'static str,
    pub resolve: Resolve,
    /// 미설치일 때 그대로 보여 줄 설치 방법. 자동 설치는 하지 않는다.
    pub install_hint: &'static str,
}

/// 지원 어댑터. 설치 여부는 여기서 따지지 않는다 — [`resolve_adapter`] 가 답한다.
pub const ADAPTERS: &[AdapterSpec] = &[
    AdapterSpec {
        language_id: "rust",
        adapter_id: "lldb",
        // Rust 는 전용 어댑터가 없다 — LLVM 의 lldb-dap 이 표준 경로다
        // (codelldb 는 VS Code 확장 안에만 있어 조달이 불투명하다).
        resolve: Resolve::Xcrun { name: "lldb-dap" },
        install_hint: "xcode-select --install (macOS) · apt install lldb (Linux)",
    },
    AdapterSpec {
        language_id: "python",
        adapter_id: "debugpy",
        resolve: Resolve::Module { runner: "python3", module: "debugpy.adapter" },
        install_hint: "python3 -m pip install debugpy",
    },
    AdapterSpec {
        language_id: "go",
        adapter_id: "go",
        resolve: Resolve::Subcommand { command: "dlv", sub: "dap" },
        install_hint: "go install github.com/go-delve/delve/cmd/dlv@latest",
    },
];

/// 확장자 → 어댑터. LSP 의 `spec_for_path` 와 대응하지만 목록이 더 좁다 —
/// 하이라이트도 언어 서버도 있지만 **디버그는 안 되는** 언어가 많다.
pub fn adapter_for_path(path: &std::path::Path) -> Option<&'static AdapterSpec> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let language_id = match ext.as_str() {
        "rs" => "rust",
        "py" | "pyi" => "python",
        "go" => "go",
        _ => return None,
    };
    ADAPTERS.iter().find(|a| a.language_id == language_id)
}

pub fn adapter_by_id(language_id: &str) -> Option<&'static AdapterSpec> {
    ADAPTERS.iter().find(|a| a.language_id == language_id)
}

/// 어댑터를 어떻게 띄울지 — 실행 파일 + 인자.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// 전략대로 어댑터를 찾는다. 못 찾으면 `None` — 호출자가 `install_hint` 를 보여 준다.
///
/// `xcrun` 갈래만 별도 프로세스를 한 번 돌린다. 나머지는 LSP 와 같은 조달 기계
/// (`acp::env::resolve_binary` — 로그인 셸 PATH)를 그대로 쓴다: 패키징된 `.app`
/// 은 Finder 의 빈약한 PATH 로 뜬다는 그 함정이 여기에도 그대로 있다.
pub async fn resolve_adapter(spec: &AdapterSpec) -> Option<AdapterCommand> {
    match spec.resolve {
        Resolve::Path { command } => {
            let (program, _) = crate::acp::env::resolve_binary(command).await?;
            Some(AdapterCommand { program: PathBuf::from(program), args: Vec::new() })
        }
        Resolve::Subcommand { command, sub } => {
            let (program, _) = crate::acp::env::resolve_binary(command).await?;
            Some(AdapterCommand {
                program: PathBuf::from(program),
                args: vec![sub.to_string()],
            })
        }
        Resolve::Module { runner, module } => {
            let (program, _) = crate::acp::env::resolve_binary(runner).await?;
            // 모듈이 실제로 있는지는 여기서 확인하지 않는다 — 띄워 보면
            // 즉시 죽고, 그 죽음이 설치 안내로 이어진다 (확인 한 번을 더
            // 돌리면 파이썬 기동 비용만 두 배가 된다).
            Some(AdapterCommand {
                program: PathBuf::from(program),
                args: vec!["-m".to_string(), module.to_string()],
            })
        }
        Resolve::Xcrun { name } => xcrun_find(name).await.map(|program| AdapterCommand {
            program,
            args: Vec::new(),
        }),
    }
}

/// `xcrun -f <name>` — Xcode 툴체인 안의 절대경로. 툴체인이 없으면 실패한다.
async fn xcrun_find(name: &str) -> Option<PathBuf> {
    let out = tokio::process::Command::new("xcrun")
        .arg("-f")
        .arg(name)
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8(out.stdout).ok()?.trim());
    path.is_file().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn maps_extensions_to_adapters() {
        assert_eq!(adapter_for_path(Path::new("src/main.rs")).unwrap().language_id, "rust");
        assert_eq!(adapter_for_path(Path::new("a/b.py")).unwrap().language_id, "python");
        assert_eq!(adapter_for_path(Path::new("cmd/main.go")).unwrap().language_id, "go");
        // 하이라이트도 언어 서버도 있지만 디버그는 안 되는 것들.
        assert!(adapter_for_path(Path::new("app.ts")).is_none());
        assert!(adapter_for_path(Path::new("styles.css")).is_none());
        assert!(adapter_for_path(Path::new("README.md")).is_none());
        assert!(adapter_for_path(Path::new("no-extension")).is_none());
    }

    #[test]
    fn every_adapter_carries_an_install_hint() {
        // 자동 설치를 하지 않기로 한 이상, 미설치 안내가 비면 사용자는 막힌다.
        for spec in ADAPTERS {
            assert!(!spec.install_hint.is_empty(), "{}", spec.language_id);
            assert!(!spec.adapter_id.is_empty(), "{}", spec.language_id);
            assert!(adapter_by_id(spec.language_id).is_some());
        }
    }

    /// 이 기계에서 실제로 찾히는지 — 툴체인이 없는 CI 에서는 건너뛴다.
    #[tokio::test]
    async fn resolves_lldb_dap_from_the_xcode_toolchain_when_present() {
        let spec = adapter_by_id("rust").unwrap();
        match resolve_adapter(spec).await {
            Some(cmd) => {
                // PATH 가 아니라 툴체인 절대경로로 나와야 한다.
                assert!(cmd.program.is_absolute(), "{cmd:?}");
                assert!(cmd.program.ends_with("lldb-dap"), "{cmd:?}");
                assert!(cmd.args.is_empty());
            }
            None => eprintln!("lldb-dap 없음 — 건너뜀"),
        }
    }
}
