//! **진짜 N-프로세스 일지 생성** — 같은 분·종류·slug 로 여러 OS 프로세스가
//! 동시에 일지를 써도 하나도 덮이지 않는다
//! (`astra-feedback-round` `{#journal-create-excl}`, B04/B05).
//!
//! ## 무엇이 사고였나
//!
//! 쓰기 진입점 셋(MCP `journal_write` · 앱 수동 작성 · git 백필)은 이름을
//! `exists()` 스캔으로 고른 뒤(`base.md`, `base__2.md`, …) `write_atomic`
//! (tmp → `rename`) 으로 게시했다. 스캔과 `rename` 사이가 열려 있어서, 앱과
//! MCP 서버 — 또는 병렬 에이전트 세션이 띄운 MCP 서버 둘 — 가 같은 순간
//! `base.md` 를 비었다고 보면 뒤의 `rename` 이 앞의 일지를 소리 없이 바꿔쳤다.
//! 인프로세스 뮤텍스는 프로세스 경계에서 아무것도 아니므로, 고침은 이름
//! 선점 자체를 원자적으로 만드는 것이다 (`atomic_io::write_atomic_new` —
//! `hard_link` 는 목적지가 있으면 `EEXIST`; `manager::create_journal_file` 이
//! 그 거부를 다음 번호로 읽는다).
//!
//! ## 어떻게 여러 프로세스를 띄우는가
//!
//! `plan_cas_two_process.rs` 의 수법 그대로 — **이 테스트 실행 파일 자신을
//! 다시 띄운다.** 자식은 환경변수 하나(`OCULPM_JOURNAL_CHILD_ROOT`)를 보고
//! 테스트 대신 [`McpServer`] 루프를 돌아, 에이전트가 실제로 타는 경로
//! (`protocol::handle_line` → `tools::call_tool` → `journal_write`)를 그대로
//! 탄다. `CARGO_BIN_EXE_oculpm-mcp` 에 기대지 않는 이유도 그 파일의 문서에
//! 있다 (옆 창의 `cargo check` 가 그 자리를 0바이트 자리표시자로 덮는다).
//!
//! ## 왜 흔들리지 않는가
//!
//! 단언이 전부 **결과의 불변식**이다. 요청이 실제로 겹쳤는지, 분 경계를
//! 넘었는지에 기대지 않는다:
//!
//! - 요청 수만큼 파일이 있다 — 하나라도 덮였으면 수가 모자란다.
//! - 모든 본문 표식이 어딘가에 있다 — 덮이면 그 표식이 사라진다.
//! - 응답이 돌려준 경로가 전부 다르고 전부 존재한다.
//! - `.tmp` 가 남지 않았다.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use ocul_pm_lib::oculpm::manager::create_journal_file;
use ocul_pm_lib::oculpm::mcp::protocol::McpServer;
use serde_json::{json, Value};

/// 자식 모드 스위치. 값은 자식이 섬길 프로젝트 루트다.
const CHILD_ROOT_ENV: &str = "OCULPM_JOURNAL_CHILD_ROOT";
/// 부모가 자식을 띄울 때 거는 테스트 이름 (아래 함수와 반드시 같아야 한다).
const CHILD_TEST: &str = "serves_one_project_as_a_child_process";

/// **자식 프로세스 본체.** 평소 `cargo test` 에서는 환경변수가 없으므로 아무
/// 일도 하지 않고 통과한다. 부모가 `current_exe()` 를 `--exact <이 이름>` 으로
/// 다시 띄우면서 변수를 걸면, 그때만 stdin 의 JSON-RPC 라인을 받아 응답한다.
#[test]
fn serves_one_project_as_a_child_process() {
    let Ok(root) = std::env::var(CHILD_ROOT_ENV) else {
        return;
    };
    let server = McpServer::new(PathBuf::from(root));
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    // 하네스가 `test <이름> ... ` 를 개행 없이 찍고 들어오므로 빈 줄 하나로
    // 그 꼬리를 끊는다 — 안 그러면 첫 응답이 그 줄에 붙어 부모가 놓친다.
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

    /// 요청만 보낸다 — 답을 기다리지 않는다. 여러 프로세스를 겹치려면 전부
    /// 보낸 **뒤에** 읽어야 한다.
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
        // libtest 가 찍는 줄("running 1 test" 등)이 섞인다 — 프로토콜 라인은
        // 반드시 `{` 로 시작하므로 그것만 고른다.
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
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// ─── 픽스처 ──────────────────────────────────────────────────────────────────

/// `.oculpm/` 만 있으면 자식이 이 자리를 추적 프로젝트로 읽는다 (설정은 기본값).
fn seed(root: &Path) {
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
}

fn journal_root(root: &Path) -> PathBuf {
    root.join(".oculpm").join("journal")
}

/// `dir` 아래(재귀)의 파일 전부 — `.md` 와 `.tmp` 를 가르는 데 쓴다.
fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(files_under(&p));
        } else {
            out.push(p);
        }
    }
    out
}

fn md_files(dir: &Path) -> Vec<PathBuf> {
    files_under(dir)
        .into_iter()
        .filter(|p| p.extension().is_some_and(|e| e == "md"))
        .collect()
}

fn tmp_litter(dir: &Path) -> Vec<PathBuf> {
    files_under(dir)
        .into_iter()
        .filter(|p| p.extension().is_some_and(|e| e == "tmp"))
        .collect()
}

fn write_args(marker: &str) -> Value {
    json!({
        "type": "bug",
        "slug": "same-name",
        "title": "같은 이름",
        "body_markdown": format!("## 발생 원인\n\n{marker}\n\n## 해결 방법\n\n배타적 생성.\n"),
    })
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

/// **N 프로세스가 같은 분·종류·slug 로 동시에 써도 일지가 하나도 안 사라진다.**
///
/// 여덟 자식에게 요청을 **전부 보낸 뒤** 답을 읽는다 — 겹칠 기회를 준다. 세
/// 라운드를 돌아 기회를 더 준다. 단언은 겹쳤는지와 무관한 불변식뿐이다.
#[test]
fn n_processes_writing_the_same_name_lose_no_entry() {
    const SESSIONS: usize = 8;
    const ROUNDS: usize = 3;

    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    seed(root);

    let mut sessions: Vec<Session> = (0..SESSIONS)
        .map(|i| Session::spawn(root, &format!("S{i}")))
        .collect();
    let pids: HashSet<u32> = sessions.iter().map(Session::pid).collect();
    assert_eq!(pids.len(), SESSIONS, "프로세스가 겹쳤다");
    assert!(
        !pids.contains(&std::process::id()),
        "테스트 프로세스 자신이다"
    );

    let mut markers: Vec<String> = Vec::new();
    let mut returned: Vec<String> = Vec::new();
    for round in 0..ROUNDS {
        let batch: Vec<String> = (0..SESSIONS)
            .map(|i| format!("marker-r{round}-s{i}-{}", uuid::Uuid::new_v4()))
            .collect();
        for (s, m) in sessions.iter_mut().zip(&batch) {
            s.send("journal_write", write_args(m));
        }
        for s in sessions.iter_mut() {
            let out = s
                .recv()
                .unwrap_or_else(|e| panic!("{}: journal_write 실패: {e}", s.label));
            returned.push(out["path"].as_str().expect("path").to_string());
        }
        markers.extend(batch);
    }
    let expected = SESSIONS * ROUNDS;

    // ① 응답 경로가 전부 다르고 전부 실재한다.
    let distinct: HashSet<&String> = returned.iter().collect();
    assert_eq!(
        distinct.len(),
        expected,
        "같은 경로를 둘이 받았다: {returned:?}"
    );
    for rel in &returned {
        assert!(root.join(rel).is_file(), "응답 경로가 없다: {rel}");
    }

    // ② 파일 수 == 요청 수 — 덮였으면 모자란다.
    let files = md_files(&journal_root(root));
    assert_eq!(files.len(), expected, "{files:?}");

    // ③ 본문 표식이 전부 살아 있다 — 덮이면 그 표식이 사라진다.
    let all: String = files
        .iter()
        .map(|p| std::fs::read_to_string(p).unwrap())
        .collect();
    for m in &markers {
        assert!(all.contains(m), "표식 유실: {m}");
    }

    // ④ tmp 찌꺼기 없음.
    assert!(tmp_litter(&journal_root(root)).is_empty());
}

/// **같은 프로세스 안, 같은 `base` 로 열여섯 스레드** — 이름은 정확히
/// `base.md`, `base__2.md`, …, `base__16.md` 다. 배타적 생성은 파일을 지우지
/// 않으므로 잡힌 이름은 항상 후보 목록의 앞머리다: 어떤 순서로 겹쳤든
/// 결과가 같다.
#[test]
fn sixteen_threads_take_consecutive_suffixes_and_lose_no_body() {
    const THREADS: usize = 16;
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("Bugs");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(THREADS));

    let handles: Vec<_> = (0..THREADS)
        .map(|i| {
            let target = target.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let body = format!("marker-{i}\n");
                barrier.wait();
                let (abs, name) =
                    create_journal_file(&target, "1200_bug_same", body.as_bytes()).unwrap();
                assert_eq!(abs, target.join(&name));
                (name, body)
            })
        })
        .collect();
    let got: Vec<(String, String)> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    let names: HashSet<&str> = got.iter().map(|(n, _)| n.as_str()).collect();
    let mut want: HashSet<String> = (2..=THREADS)
        .map(|n| format!("1200_bug_same__{n}.md"))
        .collect();
    want.insert("1200_bug_same.md".to_string());
    assert_eq!(
        names,
        want.iter().map(String::as_str).collect::<HashSet<_>>()
    );
    for (name, body) in &got {
        assert_eq!(&std::fs::read_to_string(target.join(name)).unwrap(), body);
    }
    assert_eq!(md_files(&target).len(), THREADS);
    assert!(tmp_litter(&target).is_empty());
}
