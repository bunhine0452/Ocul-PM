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

use std::io::{BufRead, Read, Write};

use ocul_pm_lib::oculpm::mcp::protocol::{oversized_line_response, McpServer, MAX_LINE_BYTES};

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
    let mut reader = stdin.lock();
    // 라인 크기 상한 — `lines()` 는 무한 append 라 거대 라인이 메모리를 먹는다.
    // 바이트 단위로 상한까지만 읽고, 초과분은 개행까지 버린 뒤 에러 응답.
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        let n = match reader.by_ref().take(MAX_LINE_BYTES).read_until(b'\n', &mut buf) {
            Ok(0) => break, // stdin 닫힘 = 클라이언트 종료
            Ok(n) => n,
            Err(_) => break,
        };
        let oversized = n as u64 >= MAX_LINE_BYTES && buf.last() != Some(&b'\n');
        let resp = if oversized {
            // read_until 은 개행에서 멈추므로 다음 메시지를 침범하지 않는다.
            let mut discard: Vec<u8> = Vec::with_capacity(8192);
            loop {
                discard.clear();
                match reader.by_ref().take(8192).read_until(b'\n', &mut discard) {
                    Ok(0) | Err(_) => break,
                    Ok(_) if discard.last() == Some(&b'\n') => break,
                    Ok(_) => {}
                }
            }
            Some(oversized_line_response())
        } else {
            server.handle_line(&String::from_utf8_lossy(&buf))
        };
        if let Some(resp) = resp {
            if writeln!(out, "{resp}").and_then(|_| out.flush()).is_err() {
                break; // stdout 닫힘
            }
        }
    }
    eprintln!("oculpm-mcp: stdin closed — exiting");
}
