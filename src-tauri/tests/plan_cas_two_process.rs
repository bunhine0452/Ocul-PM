//! **진짜 2-프로세스 CAS** — 플랜 하나를 서로 다른 두 OS 프로세스가 동시에
//! 고쳐도 한쪽만 이기고, 이긴 쓰기는 하나도 사라지지 않는다
//! (`v3-release` `{#cas-two-process-test}`).
//!
//! ## 왜 스레드로는 부족한가
//!
//! `plan_parallel_write.rs` 는 같은 질문을 두 가지 대역으로 물었다: 스레드
//! 여덟의 동시성과, "남이 만들어 둔 락 파일을 존중하는가". 둘 다 한 프로세스
//! 안이다. 그런데 사고 현장은 프로세스 경계다 — 앱·CLI·에이전트가 띄운 MCP
//! 서버는 서로 다른 프로세스이고, 인프로세스 뮤텍스(`plan_write_lock`)는 그
//! 경계에서 아무 것도 아니다. 락 파일을 손으로 만들어 두는 대역은 "락 파일을
//! 읽는가"만 물을 뿐, **다른 프로세스가 실제로 그 파일을 만들고 지우고
//! 그 사이에 CAS 를 통과하는가**는 묻지 못한다.
//!
//! ## 어떻게 두 프로세스를 띄우는가
//!
//! 새 크레이트를 받지 않았다. **이 테스트 실행 파일 자신을 다시 띄운다** —
//! `--pty-host` 가 같은 실행 파일을 서브커맨드로 재진입하는 것과 같은 수법이다.
//! 자식은 환경변수 하나(`OCULPM_CAS_CHILD_ROOT`)를 보고 테스트 대신
//! [`McpServer`] 루프를 돈다. 즉 `src/bin/oculpm_mcp.rs` 의 `main` 이 인자를
//! 다 읽은 뒤 하는 일과 같은 것을 하고, **에이전트가 실제로 쓰는 그 경로**
//! (`protocol::handle_line` → `mcp::tools::call_tool`)를 그대로 탄다.
//!
//! 둘째 바이너리 `oculpm-mcp` 를 `CARGO_BIN_EXE_oculpm-mcp` 로 띄우는 쪽을
//! 먼저 써 봤고 **버렸다.** 그 경로(`target/debug/oculpm-mcp`)는 cargo 가
//! uplift 해 두는 자리라, 같은 target 디렉터리에서 `cargo check` 나
//! `cargo clippy --all-targets` 가 한 번 돌면 **0바이트·실행권한 없는
//! 자리표시자**로 덮인다 (2026-09-07 실측, 재현 2/2). `cargo test` 가 다시
//! 올려 주므로 CI 의 순차 실행(clippy → test)은 무사하지만, 옆 창에서
//! `cargo check` 가 도는 개발 중에는 테스트가 EACCES 로 죽는다. 흔들리는
//! 이유가 테스트의 질문과 아무 상관이 없으면 그 테스트는 곧 무시된다.
//!
//! ## 왜 흔들리지 않는가
//!
//! 단언이 전부 **결과의 불변식**이다. 두 요청이 실제로 겹쳤는지, 어느 쪽이
//! 먼저 도착했는지에 기대지 않는다:
//!
//! - 같은 `base_hash` 로 온 둘 중 **정확히 하나**가 성공한다. 겹치면 문지기가
//!   줄을 세우고 둘째가 해시에서 지고, 안 겹치면 둘째가 그냥 해시에서 진다.
//! - 진 쪽은 파일을 **한 바이트도** 건드리지 않는다.
//! - 정직한 재시도를 붙이면 N 프로세스의 전이가 **전부** 살아남는다.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use ocul_pm_lib::oculpm::mcp::protocol::McpServer;
use serde_json::{json, Value};

const PLAN_ID: &str = "two-proc";

/// 자식 모드 스위치. 값은 자식이 섬길 프로젝트 루트다.
const CHILD_ROOT_ENV: &str = "OCULPM_CAS_CHILD_ROOT";
/// 부모가 자식을 띄울 때 거는 테스트 이름 (아래 함수와 반드시 같아야 한다).
const CHILD_TEST: &str = "serves_one_project_as_a_child_process";

/// **자식 프로세스 본체.**
///
/// 평소 `cargo test` 에서는 환경변수가 없으므로 아무 일도 하지 않고 통과한다.
/// 부모가 `current_exe()` 를 `--exact <이 이름>` 으로 다시 띄우면서 변수를
/// 걸면, 그때만 stdin 의 JSON-RPC 라인을 받아 응답한다.
#[test]
fn serves_one_project_as_a_child_process() {
    let Ok(root) = std::env::var(CHILD_ROOT_ENV) else {
        return;
    };
    let server = McpServer::new(PathBuf::from(root));
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    // 하네스는 `test <이름> ... ` 를 **개행 없이** 찍고 테스트로 들어온다.
    // 그대로 두면 첫 응답이 그 줄 꼬리에 붙어, 부모의 라인 단위 파서가 첫
    // 응답을 통째로 놓치고 영원히 기다린다 (실측 — 이 파일의 첫 판이 그랬다).
    // 빈 줄 하나로 그 꼬리를 끊어 두면 이후 모든 응답이 자기 줄을 갖는다.
    writeln!(out).expect("개행 쓰기 실패");
    out.flush().expect("flush 실패");
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if let Some(resp) = server.handle_line(&line) {
            writeln!(out, "{resp}").expect("응답 쓰기 실패");
            out.flush().expect("flush 실패");
        }
    }
}

// ─── 자식 프로세스 하나 = 세션 하나 ──────────────────────────────────────────

/// 살아 있는 `oculpm-mcp` 프로세스 하나. 한 세션(= 한 에이전트)을 흉내 낸다.
struct Session {
    child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
    next_id: u64,
    label: String,
}

impl Session {
    fn spawn(root: &Path, label: &str) -> Session {
        let exe = std::env::current_exe().expect("current_exe");
        let mut child = Command::new(exe)
            // libtest 를 이 테스트 하나로 좁힌다 — 자식은 서버 루프만 돈다.
            // `--nocapture` 가 없으면 하네스가 stdout 을 가로채 프로토콜이
            // 부모에게 닿지 않는다.
            .args([CHILD_TEST, "--exact", "--nocapture", "--test-threads=1"])
            .env(CHILD_ROOT_ENV, root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("자식 프로세스를 띄우지 못했다");
        let stdin = child.stdin.take().expect("stdin");
        let out = BufReader::new(child.stdout.take().expect("stdout"));
        Session {
            child,
            stdin,
            out,
            next_id: 1,
            label: label.to_string(),
        }
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }

    /// 요청만 보낸다 — 답을 기다리지 않는다. 두 세션을 겹치려면 둘 다 보낸
    /// **뒤에** 읽어야 한다. 첫 답을 기다렸다가 둘째를 보내면 그건 그냥 순차
    /// 호출이고, 이 파일이 물으려는 것이 아니다.
    fn send(&mut self, tool: &str, args: Value) {
        let id = self.next_id;
        self.next_id += 1;
        let line = json!({
            "jsonrpc": "2.0", "id": id, "method": "tools/call",
            "params": { "name": tool, "arguments": args }
        })
        .to_string();
        writeln!(self.stdin, "{line}").expect("요청 쓰기 실패");
        self.stdin.flush().expect("flush 실패");
    }

    /// 한 응답을 읽어 `structuredContent` 또는 도구 오류 문장으로 돌려준다.
    fn recv(&mut self) -> Result<Value, String> {
        // 자식의 stdout 앞머리에는 libtest 가 찍는 줄("running 1 test" 등)이
        // 섞인다. 프로토콜 라인은 반드시 `{` 로 시작하므로 그것만 고른다 —
        // 하네스 문구에 의존하지 않는 판정이다.
        let line = loop {
            let mut line = String::new();
            let n = self.out.read_line(&mut line).expect("응답 읽기 실패");
            if n == 0 {
                let label = self.label.clone();
                let err = self.stderr();
                panic!("{label}: 서버가 답 없이 죽었다\n{err}");
            }
            if line.trim_start().starts_with('{') {
                break line;
            }
        };
        let v: Value = serde_json::from_str(&line).expect("응답이 JSON 이 아니다");
        if let Some(e) = v.get("error") {
            panic!("{}: JSON-RPC 오류 {e}", self.label);
        }
        let result = &v["result"];
        if result["isError"] == Value::Bool(true) {
            return Err(result["content"][0]["text"]
                .as_str()
                .unwrap_or("")
                .to_string());
        }
        Ok(result["structuredContent"].clone())
    }

    fn call(&mut self, tool: &str, args: Value) -> Result<Value, String> {
        self.send(tool, args);
        self.recv()
    }

    /// 이 세션이 **자기 프로세스 안에서** 읽은 해시. 부모가 대신 읽어 주면
    /// 프로세스 경계가 한 겹 사라진다.
    fn hash(&mut self) -> String {
        let out = self
            .call("plan_status", json!({ "plan_id": PLAN_ID }))
            .expect("plan_status 실패");
        out["plans"][0]["hash"].as_str().expect("hash").to_string()
    }

    /// 죽은 자식의 stderr — 실패 메시지에만 쓴다 (여기서는 이미 EOF 다).
    fn stderr(&mut self) -> String {
        let mut buf = String::new();
        if let Some(mut e) = self.child.stderr.take() {
            use std::io::Read as _;
            let _ = e.read_to_string(&mut buf);
        }
        buf
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // 테스트가 패닉해도 자식을 남기지 않는다.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// ─── 픽스처 ──────────────────────────────────────────────────────────────────

/// 항목 `n` 개짜리 활성 플랜. `.oculpm/` 이 있어야 자식이 이 자리를 추적
/// 프로젝트로 읽는다.
fn seed(root: &Path, items: usize) {
    let dir = root.join(".oculpm/planner");
    std::fs::create_dir_all(&dir).unwrap();
    let mut md = format!(
        "---\noculpm_plan: v1\nid: {PLAN_ID}\ntitle: \"두 프로세스\"\nstatus: active\n\
         created: 2026-09-07\nupdated: 2026-09-07\nowner: claude-code\n---\n\n## Phase 1 {{#p1}}\n"
    );
    for i in 0..items {
        md.push_str(&format!("- [ ] 항목 {i} {{#it-{i}}}\n"));
    }
    md.push_str(
        "\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n\
         |---|---|---|---|---|---|\n<!-- oculpm:plan-log end -->\n",
    );
    std::fs::write(dir.join(format!("{PLAN_ID}.md")), md).unwrap();
}

fn plan_path(root: &Path) -> PathBuf {
    root.join(".oculpm/planner").join(format!("{PLAN_ID}.md"))
}

fn lock_path(root: &Path) -> PathBuf {
    root.join(".oculpm/planner")
        .join(format!(".{PLAN_ID}.md.lock"))
}

fn update_args(item: &str, hash: &str, agent: &str) -> Value {
    json!({
        "plan_id": PLAN_ID, "item_id": item, "status": "done",
        "base_hash": hash, "agent_id": agent
    })
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

/// **두 프로세스가 같은 해시로 오면 정확히 하나만 이긴다** — 그리고 진 쪽은
/// 파일을 건드리지 않는다.
///
/// 타이밍에 기대지 않는다: 두 요청이 겹쳤든 안 겹쳤든 성공은 정확히 하나다.
/// 겹쳤으면 파일 문지기가 줄을 세우고 둘째가 해시 대조에서 지고, 안 겹쳤으면
/// 둘째가 곧바로 해시에서 진다. 어느 쪽이 이기는지는 단언하지 않는다 — 그것이
/// 곧 OS 스케줄러에 기대는 일이다.
#[test]
fn two_processes_with_the_same_base_hash_leave_exactly_one_winner() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    seed(root, 2);

    let mut a = Session::spawn(root, "A");
    let mut b = Session::spawn(root, "B");
    // 진짜 남남인가 — 이 파일의 전제.
    assert_ne!(a.pid(), b.pid(), "같은 프로세스다");
    assert_ne!(a.pid(), std::process::id(), "테스트 프로세스 자신이다");

    // 두 세션이 같은 순간에 같은 내용을 읽었다 (각자 자기 프로세스에서).
    let ha = a.hash();
    let hb = b.hash();
    assert_eq!(ha, hb, "아직 아무도 안 썼는데 해시가 다르다");

    let before = std::fs::read_to_string(plan_path(root)).unwrap();

    // 둘 다 보낸 뒤에 읽는다 — 겹칠 기회를 준다.
    a.send("plan_update", update_args("it-0", &ha, "session-a"));
    b.send("plan_update", update_args("it-1", &hb, "session-b"));
    let ra = a.recv();
    let rb = b.recv();

    let (won, lost_err, winner_item, loser_item) = match (&ra, &rb) {
        (Ok(_), Err(e)) => ("A", e.clone(), "it-0", "it-1"),
        (Err(e), Ok(_)) => ("B", e.clone(), "it-1", "it-0"),
        (Ok(_), Ok(_)) => panic!("둘 다 이겼다 — 한쪽 쓰기가 조용히 덮였다"),
        (Err(x), Err(y)) => panic!("둘 다 졌다 — 아무도 못 쓴다: {x} / {y}"),
    };

    // 진 쪽은 조용히 실패하지 않는다: CLI exit 5 를 가르는 표지 + 다음 행동.
    assert!(
        lost_err.starts_with("write-conflict:"),
        "{won} 이 이겼고 진 쪽 오류에 표지가 없다: {lost_err}"
    );
    assert!(lost_err.contains("plan_status"), "{lost_err}");

    let md = std::fs::read_to_string(plan_path(root)).unwrap();
    assert!(
        md.contains(&format!("- [x] 항목 {} ", &winner_item[3..])),
        "이긴 전이가 파일에 없다:\n{md}"
    );
    assert!(
        md.contains(&format!("- [ ] 항목 {} ", &loser_item[3..])),
        "진 쪽이 파일을 건드렸다:\n{md}"
    );
    assert_ne!(md, before, "이겼는데도 파일이 그대로다");

    // 진 쪽이 새 해시로 다시 오면 통과하고, 앞의 전이는 그대로 남는다.
    let (loser, name) = if won == "A" {
        (&mut b, "B")
    } else {
        (&mut a, "A")
    };
    let fresh = loser.hash();
    loser
        .call("plan_update", update_args(loser_item, &fresh, "retry"))
        .unwrap_or_else(|e| panic!("{name}: 다시 읽은 해시로도 거부됐다: {e}"));
    let md = std::fs::read_to_string(plan_path(root)).unwrap();
    assert!(
        md.contains("- [x] 항목 0 ") && md.contains("- [x] 항목 1 "),
        "{md}"
    );

    // 문지기는 자기 뒤를 치운다 — 락 파일이 남으면 다음 세션이 2초를 기다린다.
    assert!(!lock_path(root).exists(), "락 파일이 남았다");
}

/// **N 프로세스가 정직하게 재시도하면 전이가 하나도 안 사라진다.**
///
/// `plan_parallel_write.rs` 의 스레드판과 같은 질문을 프로세스 경계에서 다시
/// 묻는다. 성공 **횟수**가 아니라 **파일 내용**을 세는 것이 요점이다 — 락이
/// 없거나 대조와 쓰기 사이가 열려 있으면 "아무도 실패하지 않았는데 글리프는
/// 그대로" 가 된다.
#[test]
fn six_processes_retrying_honestly_lose_no_write() {
    const SESSIONS: usize = 6;
    /// 재시도 상한. 결과의 불변식만 단언하므로 이 숫자는 "언젠가는 끝난다" 를
    /// 보장하는 안전핀일 뿐이다 — 넉넉히 준다 (CI 가 느려도 흔들리지 않게).
    const MAX_ATTEMPTS: u32 = 80;

    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    seed(&root, SESSIONS);

    let barrier = std::sync::Arc::new(std::sync::Barrier::new(SESSIONS));
    let handles: Vec<_> = (0..SESSIONS)
        .map(|i| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let item = format!("it-{i}");
                let mut s = Session::spawn(&root, &item);
                let pid = s.pid();
                barrier.wait(); // 여섯 프로세스가 다 뜬 뒤에 같이 달린다
                for attempt in 0..MAX_ATTEMPTS {
                    // 읽기·쓰기가 **같은 프로세스 안에서** 짝을 이룬다 —
                    // CAS 프로토콜이 실제로 쓰이는 모습 그대로.
                    let hash = s.hash();
                    match s.call("plan_update", update_args(&item, &hash, &item)) {
                        Ok(_) => return pid,
                        Err(e) => {
                            assert!(e.starts_with("write-conflict:"), "충돌이 아닌 실패: {e}");
                            std::thread::sleep(std::time::Duration::from_millis(
                                (2 * attempt).min(50) as u64,
                            ));
                        }
                    }
                }
                panic!("{item}: {MAX_ATTEMPTS}번 재시도해도 못 썼다");
            })
        })
        .collect();

    let pids: Vec<u32> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    let unique: std::collections::HashSet<u32> = pids.iter().copied().collect();
    assert_eq!(unique.len(), SESSIONS, "프로세스가 겹쳤다: {pids:?}");
    assert!(!unique.contains(&std::process::id()), "{pids:?}");

    let md = std::fs::read_to_string(plan_path(&root)).unwrap();
    for i in 0..SESSIONS {
        // ① 전이가 살아 있다 — 덮였으면 `[ ]` 로 남는다.
        assert!(
            md.contains(&format!("- [x] 항목 {i} ")),
            "항목 {i} 유실:\n{md}"
        );
        // ② plan-log 행도 — 행 하나가 사라지는 것이 사고의 원래 모습이었다.
        assert!(
            md.contains(&format!("| #it-{i} | it-{i} |")),
            "plan-log 행 {i} 유실:\n{md}"
        );
    }

    // ③ 반쪽 파일이 남지 않았다 — 일곱째 프로세스가 규격대로 읽는다.
    let mut reader = Session::spawn(&root, "reader");
    let status = reader
        .call("plan_status", json!({ "plan_id": PLAN_ID, "view": "full" }))
        .unwrap();
    assert!(status.get("warnings").is_none(), "{status}");
    assert_eq!(status["plans"][0]["progress"]["done"], SESSIONS);
    assert!(!lock_path(&root).exists(), "락 파일이 남았다");
}
