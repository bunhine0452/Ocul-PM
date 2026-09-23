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
    /// PATH 에서 **먼저 찾히는** 이름 — 같은 어댑터가 판마다 이름이 다르다
    /// (LLVM 18 이 `lldb-vscode` 를 `lldb-dap` 으로 바꿨고, 배포판은 `-18` 같은
    /// 판 번호를 붙여 깐다).
    FirstOnPath { commands: &'static [&'static str] },
    /// Xcode 툴체인 — `xcrun -f <name>` 가 절대경로를 알려 준다 (macOS).
    Xcrun { name: &'static str },
    /// 인터프리터의 모듈 — `python3 -m debugpy.adapter`. 인터프리터 이름은
    /// 앞에서부터 먼저 찾히는 것.
    Module {
        runners: &'static [&'static str],
        module: &'static str,
    },
    /// 하위 명령 — `dlv dap`.
    Subcommand {
        command: &'static str,
        sub: &'static str,
    },
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

// Rust 는 전용 어댑터가 없다 — LLVM 의 lldb-dap 이 표준 경로다 (codelldb 는
// VS Code 확장 안에만 있어 조달이 불투명하다). macOS 는 Xcode 툴체인 안에 있고,
// 다른 OS 는 LLVM 설치가 PATH 에 둔다 (크로스플랫폼 W2 `#os-tools`).
#[cfg(target_os = "macos")]
const RUST_RESOLVE: Resolve = Resolve::Xcrun { name: "lldb-dap" };
#[cfg(not(target_os = "macos"))]
const RUST_RESOLVE: Resolve = Resolve::FirstOnPath {
    commands: LLDB_DAP_NAMES,
};
/// 비-mac 의 lldb-dap 이름들 — 판 번호 없는 것 먼저, 그다음 배포판의 판 번호
/// 붙은 이름(새 판부터). `lldb-vscode` 는 LLVM 17 까지의 이름이다.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub const LLDB_DAP_NAMES: &[&str] = &[
    "lldb-dap",
    "lldb-vscode",
    "lldb-dap-20",
    "lldb-dap-19",
    "lldb-dap-18",
    "lldb-vscode-17",
    "lldb-vscode-16",
    "lldb-vscode-15",
    "lldb-vscode-14",
];
#[cfg(target_os = "macos")]
// macOS 문구는 예전 그대로 (D3 — 화면 문자열도 macOS 는 불변).
const RUST_INSTALL_HINT: &str = "xcode-select --install (macOS) · apt install lldb (Linux)";
#[cfg(all(unix, not(target_os = "macos")))]
const RUST_INSTALL_HINT: &str = "apt install lldb-18 (lldb-dap) — 또는 PATH 에 lldb-dap";
#[cfg(windows)]
const RUST_INSTALL_HINT: &str =
    "winget install LLVM.LLVM (lldb-dap.exe 가 PATH 나 Program Files\\LLVM\\bin 에 있어야 합니다)";

// Windows 의 `python3` 는 흔히 **Microsoft Store 별칭**이다 — 파이썬이 없으면
// 스토어 창을 띄운다. 설치본이 두는 런처(`py`)와 `python` 을 본다.
#[cfg(not(windows))]
const PYTHON_RUNNERS: &[&str] = &["python3"];
#[cfg(windows)]
const PYTHON_RUNNERS: &[&str] = &["py", "python"];
#[cfg(not(windows))]
const PYTHON_INSTALL_HINT: &str = "python3 -m pip install debugpy";
#[cfg(windows)]
const PYTHON_INSTALL_HINT: &str = "py -m pip install debugpy";

/// 지원 어댑터. 설치 여부는 여기서 따지지 않는다 — [`resolve_adapter`] 가 답한다.
pub const ADAPTERS: &[AdapterSpec] = &[
    AdapterSpec {
        language_id: "rust",
        adapter_id: "lldb",
        resolve: RUST_RESOLVE,
        install_hint: RUST_INSTALL_HINT,
    },
    AdapterSpec {
        language_id: "python",
        adapter_id: "debugpy",
        resolve: Resolve::Module {
            runners: PYTHON_RUNNERS,
            module: "debugpy.adapter",
        },
        install_hint: PYTHON_INSTALL_HINT,
    },
    AdapterSpec {
        language_id: "go",
        adapter_id: "go",
        resolve: Resolve::Subcommand {
            command: "dlv",
            sub: "dap",
        },
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
            let program = find_program(command).await?;
            Some(AdapterCommand {
                program,
                args: Vec::new(),
            })
        }
        Resolve::FirstOnPath { commands } => {
            let program = first_program(commands).await?;
            Some(AdapterCommand {
                program,
                args: Vec::new(),
            })
        }
        Resolve::Subcommand { command, sub } => {
            let program = find_program(command).await?;
            Some(AdapterCommand {
                program,
                args: vec![sub.to_string()],
            })
        }
        Resolve::Module { runners, module } => {
            let program = first_program(runners).await?;
            // 모듈이 실제로 있는지는 여기서 확인하지 않는다 — 띄워 보면
            // 즉시 죽고, 그 죽음이 설치 안내로 이어진다 (확인 한 번을 더
            // 돌리면 파이썬 기동 비용만 두 배가 된다).
            Some(AdapterCommand {
                program,
                args: vec!["-m".to_string(), module.to_string()],
            })
        }
        Resolve::Xcrun { name } => xcrun_find(name).await.map(|program| AdapterCommand {
            program,
            args: Vec::new(),
        }),
    }
}

/// 이름 하나를 PATH(프로세스 → 로그인 셸)에서 찾아 **절대경로**로.
///
/// 절대경로여야 하는 이유: 어댑터는 자식 PATH 를 바꿔(`.env("PATH", …)`) 띄우는데
/// `proc` 창구의 PATHEXT 해석은 **부모** PATH 를 본다 — 맨 이름을 넘기면 Windows
/// 에서 엉뚱한 자리를 뒤진다. Windows 는 `<이름>.exe` 를 먼저 본다: PATH 에는
/// 확장자 없는 셸 스크립트(Git Bash·npm 이 까는 것)가 같은 이름으로 있을 수 있고,
/// 그것은 CreateProcess 로 띄울 수 없다.
async fn find_program(name: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    if let Some((program, _)) = crate::acp::env::resolve_binary(&format!("{name}.exe")).await {
        return Some(program);
    }
    crate::acp::env::resolve_binary(name)
        .await
        .map(|(program, _)| program)
}

/// 여러 이름 중 먼저 찾히는 것. Windows 는 PATH 에 없을 때 LLVM 설치 관리자의
/// 기본 자리(`%ProgramFiles%\LLVM\bin`)도 본다 — 설치 관리자가 PATH 추가를
/// 묻고, 기본값이 "추가 안 함" 이다.
async fn first_program(names: &[&str]) -> Option<PathBuf> {
    for name in names {
        if let Some(program) = find_program(name).await {
            return Some(program);
        }
    }
    #[cfg(windows)]
    if let Some(bin) =
        std::env::var_os("ProgramFiles").map(|pf| PathBuf::from(pf).join("LLVM").join("bin"))
    {
        for name in names {
            let candidate = bin.join(format!("{name}.exe"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// `xcrun -f <name>` — Xcode 툴체인 안의 절대경로. 툴체인이 없으면 실패한다.
async fn xcrun_find(name: &str) -> Option<PathBuf> {
    let out = crate::proc::tokio_cmd("xcrun")
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
        assert_eq!(
            adapter_for_path(Path::new("src/main.rs"))
                .unwrap()
                .language_id,
            "rust"
        );
        assert_eq!(
            adapter_for_path(Path::new("a/b.py")).unwrap().language_id,
            "python"
        );
        assert_eq!(
            adapter_for_path(Path::new("cmd/main.go"))
                .unwrap()
                .language_id,
            "go"
        );
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
                // 맨 이름이 아니라 절대경로로 나와야 한다 (자식 PATH 를 바꿔 띄운다).
                assert!(cmd.program.is_absolute(), "{cmd:?}");
                let stem = cmd.program.file_stem().unwrap().to_string_lossy();
                if cfg!(target_os = "macos") {
                    assert!(cmd.program.ends_with("lldb-dap"), "{cmd:?}");
                } else {
                    assert!(LLDB_DAP_NAMES.contains(&stem.as_ref()), "{cmd:?}");
                }
                if cfg!(windows) {
                    assert_eq!(cmd.program.extension().unwrap(), "exe", "{cmd:?}");
                }
                assert!(cmd.args.is_empty());
            }
            None => eprintln!("lldb-dap 없음 — 건너뜀"),
        }
    }

    /// 비-mac 은 xcrun 이 없다 — 러스트 어댑터는 PATH 에서 lldb-dap 계열을 찾는다.
    /// macOS 는 여전히 Xcode 툴체인이다 (동작 불변).
    #[test]
    fn rust_adapter_procurement_follows_the_os() {
        let spec = adapter_by_id("rust").unwrap();
        if cfg!(target_os = "macos") {
            assert_eq!(spec.resolve, Resolve::Xcrun { name: "lldb-dap" });
        } else {
            assert_eq!(
                spec.resolve,
                Resolve::FirstOnPath {
                    commands: LLDB_DAP_NAMES
                }
            );
            assert_eq!(LLDB_DAP_NAMES[0], "lldb-dap", "새 이름이 먼저다");
            assert!(
                !spec.install_hint.contains("xcode"),
                "{}",
                spec.install_hint
            );
        }
    }

    /// Windows 에서 `python3` 를 부르면 파이썬이 없을 때 스토어 창이 뜬다.
    #[test]
    fn python_runner_avoids_the_windows_store_alias() {
        let Resolve::Module { runners, module } = adapter_by_id("python").unwrap().resolve else {
            panic!("python 은 모듈 어댑터다");
        };
        assert_eq!(module, "debugpy.adapter");
        if cfg!(windows) {
            assert_eq!(runners, &["py", "python"]);
        } else {
            assert_eq!(runners, &["python3"]);
        }
    }

    /// PATH 에서 찾은 것은 절대경로다 — 러너마다 있는 `cargo` 로 확인한다
    /// (Windows 는 `cargo.exe` 로 나와야 한다).
    #[tokio::test]
    async fn find_program_returns_an_absolute_path_with_the_platform_extension() {
        let Some(cargo) = find_program("cargo").await else {
            eprintln!("cargo 가 PATH 에 없음 — 건너뜀");
            return;
        };
        assert!(cargo.is_absolute(), "{cargo:?}");
        assert_eq!(cargo.file_stem().unwrap(), "cargo");
        if cfg!(windows) {
            assert_eq!(cargo.extension().unwrap(), "exe", "{cargo:?}");
        }
    }
}
