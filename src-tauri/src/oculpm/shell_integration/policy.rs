//! PowerShell 실효 실행 정책 조회 — 설치 전 확인([`super::powershell::preflight`])이 쓴다.
//!
//! # 간헐 실패에서 배운 것 (run 35893773736)
//!
//! 첫 판은 실패의 **이유를 버렸다** — 시한 초과·0 아닌 종료·정책 없는 출력이 전부
//! `None` 하나로 뭉쳐 "정책을 묻지 못했다" 만 남았고, windows 러너에서 한 번 붉었을
//! 때 원인을 로그로 가를 수 없었다. 그래서:
//!
//! - 실패는 이유를 싣는다: 띄우지 못함 / **몇 초 만에** 시한 초과 / 종료코드 +
//!   stderr 요지 / 정책 이름 없는 출력.
//! - 성공 판정은 종료코드가 아니라 **stdout 에 알려진 정책 이름이 있는가**다.
//!   답을 찍고 0 아닌 코드로 끝나도 답은 답이다.
//! - stdout·stderr 는 기다리는 동안 따로 비운다 — 파이프가 차서 자식이 멈추면
//!   그것이 곧 가짜 시한 초과가 된다.
//! - 시한은 시도당 [`ATTEMPT_TIMEOUT`], 한 번 더 묻는다. 첫 판의 20초는 테스트가
//!   병렬로 도는 러너(백신이 새로 생긴 실행 파일을 검사하는 중)에서 pwsh 콜드
//!   스타트가 넘길 수 있는 값이었다 — 그 추정이 맞는지는 이제 실패 메시지의 "몇
//!   초" 와 `execution_policy_probe_is_reliable` 의 시간 분포가 말한다.
//! - 조회 프로세스는 업데이트 확인·원격 측정을 하지 않는다 (조회에 필요 없는 일).
//!
//! 그래도 모르면 **쓰지 않는다** — 호출부가 이유와 수동 설치 안내를 돌려준다.
//!
//! # 셸은 이제 물러서는 길이다 (PR #35)
//!
//! 넉넉한 시한도 모자랐다 — 부하 걸린 러너에서 Windows PowerShell 5.1 콜드 스타트가
//! 45.1초에 끊겼고 다음 시도는 37.1초였다(`[policy-probe]`). 부팅 직후·Defender
//! 검사 중인 사용자 PC 도 같을 수 있다. 그래서 먼저 저장된 설정을 읽어 확실하면
//! 그 답을 쓰고([`super::policy_scopes`]), 확실하지 않을 때만 여기로 온다.

use std::io::Read;
use std::process::{ExitStatus, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// 시도 하나의 시한.
pub(super) const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(45);

/// `Microsoft.PowerShell.ExecutionPolicy` 의 이름들.
const KNOWN: [&str; 7] = [
    "Unrestricted",
    "RemoteSigned",
    "AllSigned",
    "Restricted",
    "Default",
    "Bypass",
    "Undefined",
];

/// 실패 이유에 싣는 stdout·stderr 요지의 길이.
const EXCERPT: usize = 300;

/// 자식이 끝난 뒤 출력 읽기를 기다리는 한도 ([`collect`]).
const READER_GRACE: Duration = Duration::from_secs(2);

/// 실효 실행 정책. 저장된 설정(레지스트리·설정 파일)으로 **확실하면** 셸을 띄우지
/// 않는다([`super::policy_scopes`]). 확실하지 않을 때만 셸에게 묻는다(한 번 더
/// 재시도). `Err` 는 두 길 모두의 이유.
pub(super) fn effective_execution_policy(shell_path: &str) -> Result<String, String> {
    let stored = match read_without_shell(shell_path) {
        Ok(policy) => return Ok(policy.to_string()),
        Err(why) => why,
    };
    tracing::info!(shell = %shell_path, reason = %stored, "저장된 설정으로 실행 정책을 확정하지 못했다 — 셸에게 묻는다");
    ask_the_shell(shell_path)
        .map_err(|shell| format!("from stored settings: {stored}; asking the shell: {shell}"))
}

/// 저장된 설정만으로 판정한다 — 셸을 띄우지 않는다.
#[cfg(windows)]
pub(super) fn read_without_shell(shell_path: &str) -> Result<&'static str, String> {
    use super::default_shell::HostOs;
    let edition = super::powershell::edition_of(HostOs::Windows, shell_path);
    let documents = directories::UserDirs::new()
        .and_then(|dirs| dirs.document_dir().map(std::path::Path::to_path_buf));
    let scopes = super::policy_registry::read_scopes(edition, shell_path, documents.as_deref());
    super::policy_scopes::effective(&scopes).map(super::policy_scopes::Policy::name)
}

/// Windows 밖에서는 실행 정책이 강제되지도 저장되지도 않는다 (설치도 묻지 않는다).
#[cfg(not(windows))]
pub(super) fn read_without_shell(_shell_path: &str) -> Result<&'static str, String> {
    Err("execution policies are only stored on Windows".to_string())
}

/// 셸에게 묻는다 — 실패하면 한 번 더. `Err` 는 두 번의 이유.
pub(super) fn ask_the_shell(shell_path: &str) -> Result<String, String> {
    probe_once(shell_path, ATTEMPT_TIMEOUT).or_else(|first| {
        tracing::warn!(shell = %shell_path, reason = %first, "실행 정책 조회 실패 — 한 번 더 묻는다");
        probe_once(shell_path, ATTEMPT_TIMEOUT)
            .map_err(|second| format!("1st attempt: {first}; 2nd attempt: {second}"))
    })
}

/// 한 번 묻는다. `Err` 는 사람이 읽을 이유 (영어 — 설치 오류 문구의 일부가 된다).
pub(super) fn probe_once(shell_path: &str, timeout: Duration) -> Result<String, String> {
    let started = Instant::now();
    let mut child = crate::proc::std_cmd(shell_path)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-ExecutionPolicy",
        ])
        .env("POWERSHELL_UPDATECHECK", "Off")
        .env("POWERSHELL_TELEMETRY_OPTOUT", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start it: {e}"))?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("could not wait for it: {e}"));
            }
        }
    };
    let secs = started.elapsed().as_secs_f32();
    let stdout = collect(stdout);
    let stderr = collect(stderr);
    // (collect 는 오래 기다리지 않는다 — 죽인 셸의 손자가 파이프를 쥐고 있을 수 있다.)

    let Some(status) = status else {
        return Err(format!(
            "timed out after {secs:.1}s (stderr: {:?})",
            excerpt(&stderr)
        ));
    };
    if let Some(policy) = parse_policy(&stdout) {
        return Ok(policy.to_string());
    }
    Err(format!(
        "{} after {secs:.1}s without printing a policy (stdout: {:?}, stderr: {:?})",
        describe(status),
        excerpt(&stdout),
        excerpt(&stderr)
    ))
}

/// 출력에서 정책 이름을 찾는다 — 마지막으로 나온 알려진 이름. 순수 함수.
pub(super) fn parse_policy(stdout: &str) -> Option<&'static str> {
    stdout.lines().rev().find_map(|line| {
        let word = line.trim();
        KNOWN.iter().copied().find(|k| k.eq_ignore_ascii_case(word))
    })
}

fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> Option<JoinHandle<String>> {
    let mut pipe = pipe?;
    Some(std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = pipe.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    }))
}

/// 읽기 스레드의 결과. 자식이 끝나면 파이프가 닫혀 곧 끝나지만, 자식이 띄운 손자가
/// 파이프를 물려받아 쥐고 있으면 끝나지 않는다 — [`READER_GRACE`] 만 기다리고
/// 못 받은 출력은 빈 것으로 둔다 (스레드는 손자가 끝날 때 스스로 끝난다).
fn collect(handle: Option<JoinHandle<String>>) -> String {
    let Some(handle) = handle else {
        return String::new();
    };
    let deadline = Instant::now() + READER_GRACE;
    while !handle.is_finished() {
        if Instant::now() > deadline {
            return String::new();
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    handle.join().unwrap_or_default()
}

fn describe(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("exited with code {code}"),
        None => format!("ended by {status}"),
    }
}

/// 공백을 접고 앞부분만.
fn excerpt(text: &str) -> String {
    let folded = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut cut: String = folded.chars().take(EXCERPT).collect();
    if folded.chars().count() > EXCERPT {
        cut.push('…');
    }
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_policy_is_the_last_known_name_in_the_output() {
        assert_eq!(parse_policy("RemoteSigned\r\n"), Some("RemoteSigned"));
        assert_eq!(parse_policy("restricted"), Some("Restricted"));
        assert_eq!(
            parse_policy("WARNING: something noisy\r\n  AllSigned  \r\n\r\n"),
            Some("AllSigned")
        );
        assert_eq!(parse_policy(""), None);
        assert_eq!(parse_policy("Get-ExecutionPolicy: not recognized"), None);
    }

    #[test]
    fn excerpts_fold_whitespace_and_stay_short() {
        assert_eq!(excerpt("  a\r\n  b  "), "a b");
        let long = "x".repeat(EXCERPT + 10);
        assert_eq!(excerpt(&long).chars().count(), EXCERPT + 1);
    }

    #[test]
    fn a_missing_shell_says_it_could_not_start() {
        let err = probe_once("/definitely/not/a/pwsh-7f3a", Duration::from_secs(5)).unwrap_err();
        assert!(err.starts_with("could not start it:"), "{err}");
    }

    /// 가짜 셸 — 받은 인자는 무시하고 `body` 를 돈다.
    fn fake_shell(dir: &std::path::Path, body_unix: &str, body_windows: &str) -> String {
        if cfg!(windows) {
            let path = dir.join("fake-pwsh.cmd");
            std::fs::write(&path, format!("@echo off\r\n{body_windows}\r\n")).unwrap();
            path.display().to_string()
        } else {
            let path = dir.join("fake-pwsh");
            std::fs::write(&path, format!("#!/bin/sh\n{body_unix}\n")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            path.display().to_string()
        }
    }

    /// 답을 찍었으면 종료코드가 0 이 아니어도 답이다.
    #[test]
    fn a_printed_policy_wins_over_the_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let shell = fake_shell(
            dir.path(),
            "echo RemoteSigned; exit 3",
            "echo RemoteSigned\r\nexit /b 3",
        );
        assert_eq!(
            probe_once(&shell, Duration::from_secs(30)).as_deref(),
            Ok("RemoteSigned")
        );
    }

    /// 답이 없으면 종료코드와 stderr 요지를 싣는다.
    #[test]
    fn no_policy_reports_the_exit_code_and_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let shell = fake_shell(
            dir.path(),
            "echo 'boom: profile store locked' >&2; exit 5",
            "echo boom: profile store locked 1>&2\r\nexit /b 5",
        );
        let err = probe_once(&shell, Duration::from_secs(30)).unwrap_err();
        assert!(err.contains("exited with code 5"), "{err}");
        assert!(err.contains("boom: profile store locked"), "{err}");
    }

    /// 시한 초과는 몇 초 만인지와 함께 — 매달린 자식은 죽인다.
    #[test]
    fn a_hung_shell_times_out_with_the_elapsed_time() {
        let dir = tempfile::tempdir().unwrap();
        let shell = fake_shell(dir.path(), "sleep 30", "ping -n 31 127.0.0.1 >nul");
        let started = Instant::now();
        let err = probe_once(&shell, Duration::from_millis(500)).unwrap_err();
        assert!(err.starts_with("timed out after"), "{err}");
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "시한 뒤에도 기다렸다"
        );
    }
}
