//! `oculpm-mcp` — ocul-pm 의 stdio MCP 서버 (PR-CI2, 마스터플랜 D3).
//!
//! 앱과 같은 crate 의 두 번째 바이너리로, `.oculpm/` 규격 구현(frontmatter·
//! planner 파서·redact)을 lib 에서 그대로 재사용한다. **디스크가 SSOT** —
//! 앱 프로세스와 IPC 없이 파일만 읽고 쓰므로 앱이 꺼져 있어도 동작한다.
//!
//! 사용: `oculpm-mcp --root /path/to/project`
//! 등록: 프로젝트 `.mcp.json` (Claude Code) / `claude_desktop_config.json`
//! (Claude Desktop) — 앱 설정 화면이 써 준다 (commands/mcp.rs).
//!
//! stdout 은 프로토콜 전용이다 — 사람용 로그는 전부 stderr 로.

use std::io::{BufRead, Write};

use ocul_pm_lib::oculpm::mcp::protocol::McpServer;

fn main() {
    let mut root: Option<std::path::PathBuf> = None;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--root" => root = args.next().map(std::path::PathBuf::from),
            "--version" | "-V" => {
                println!("oculpm-mcp {}", env!("CARGO_PKG_VERSION"));
                return;
            }
            other => {
                eprintln!("oculpm-mcp: unknown argument '{other}' (usage: oculpm-mcp --root <dir>)");
                std::process::exit(2);
            }
        }
    }
    let root = root
        .or_else(|| std::env::var("OCULPM_ROOT").ok().map(Into::into))
        .unwrap_or_else(|| std::env::current_dir().expect("cwd"));
    let root = root.canonicalize().unwrap_or(root);
    if !root.is_dir() {
        eprintln!("oculpm-mcp: root is not a directory: {}", root.display());
        std::process::exit(2);
    }
    eprintln!(
        "oculpm-mcp {} — root: {} (stdio 대기)",
        env!("CARGO_PKG_VERSION"),
        root.display()
    );

    let server = McpServer::new(root);
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break, // stdin 닫힘 = 클라이언트 종료
        };
        if let Some(resp) = server.handle_line(&line) {
            if writeln!(out, "{resp}").and_then(|_| out.flush()).is_err() {
                break; // stdout 닫힘
            }
        }
    }
    eprintln!("oculpm-mcp: stdin closed — exiting");
}
