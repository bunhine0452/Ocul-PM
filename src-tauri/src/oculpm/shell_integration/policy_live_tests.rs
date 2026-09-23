//! 실행 정책 판정을 **진짜 셸의 답**과 맞대 본다 (windows 러너 — D1).
//!
//! - 저장된 설정으로 읽은 값 == `Get-ExecutionPolicy` 의 답. 셸 조회의 **속도**가
//!   아니라 **판정 일치**를 본다 — 시한은 넉넉히, 병렬 부하 흉내는 없다.
//! - 저장된 설정 읽기를 되풀이해도 늘 같은 답이고 빠르다 (레지스트리·파일 읽기뿐).
//! - 셸 조회는 이제 물러서는 길이다 — 걸린 시간만 `[policy-probe]` 로 남기고 단언하지
//!   않는다 (PR #35 에서 부하 걸린 러너의 5.1 콜드 스타트가 45초를 넘었다).
//!
//! 결과는 캡처되지 않는 stderr 로 남겨, 통과한 CI 로그에서도 읽힌다.

use std::io::Write as _;
use std::time::Instant;

use super::live_tests::powershells;
use super::policy;

/// 판정 일치 테스트의 셸 조회 시한 — 속도가 아니라 답을 본다.
#[cfg(windows)]
const PATIENT: std::time::Duration = std::time::Duration::from_secs(180);

fn note(line: String) {
    let _ = writeln!(std::io::stderr(), "{line}");
}

/// 저장된 설정으로 읽은 값이 셸의 답과 같다. CI 러너에서는 셸 없이 **확정**돼야
/// 한다 — 5.1 은 레지스트리, pwsh 7 은 `$PSHOME\powershell.config.json`.
#[cfg(windows)]
#[test]
fn stored_policy_agrees_with_get_executionpolicy() {
    let ci = std::env::var_os("CI").is_some();
    for shell in powershells() {
        let stored = policy::read_without_shell(&shell);
        note(format!("[policy-read] {shell}: {stored:?}"));
        let asked = policy::probe_once(&shell, PATIENT)
            .or_else(|_| policy::probe_once(&shell, PATIENT))
            .unwrap_or_else(|e| panic!("{shell}: 셸에게도 묻지 못했다 — {e}"));
        note(format!("[policy-shell] {shell}: {asked}"));
        match stored {
            Ok(policy) => assert_eq!(
                policy, asked,
                "{shell}: 저장된 설정의 판정과 셸의 답이 다르다"
            ),
            Err(why) => assert!(
                !ci,
                "{shell}: 러너에서 저장된 설정으로 확정하지 못했다 — {why} (셸의 답: {asked})"
            ),
        }
    }
}

/// 저장된 설정 읽기는 되풀이해도 같은 답이고 셸 조회처럼 느려지지 않는다.
#[cfg(windows)]
#[test]
fn stored_policy_read_is_fast_and_stable() {
    for shell in powershells() {
        let started = Instant::now();
        let reads: Vec<_> = (0..20)
            .map(|_| policy::read_without_shell(&shell))
            .collect();
        let took = started.elapsed();
        note(format!(
            "[policy-read] {shell}: 20 reads in {:.0}ms → {:?}",
            took.as_secs_f64() * 1000.0,
            reads[0]
        ));
        assert!(
            reads.iter().all(|r| r == &reads[0]),
            "{shell}: 읽을 때마다 답이 다르다 — {reads:?}"
        );
        assert!(
            took < std::time::Duration::from_secs(5),
            "{shell}: 레지스트리·파일 읽기 20번이 {took:?} — 셸을 띄우고 있다"
        );
    }
}

/// 셸 조회의 시간 분포만 남긴다 (단언하지 않는다 — 물러서는 길이다).
#[test]
fn shell_policy_probe_timings() {
    if !cfg!(windows) && std::env::var_os("OCULPM_TEST_PWSH").is_none() {
        eprintln!("skip: 실행 정책은 Windows 에서만 묻는다");
        return;
    }
    for shell in powershells() {
        let line = (0..3)
            .map(|_| {
                let started = Instant::now();
                let result = policy::probe_once(&shell, policy::ATTEMPT_TIMEOUT);
                let secs = started.elapsed().as_secs_f32();
                match result {
                    Ok(p) => format!("{secs:.1}s {p}"),
                    Err(e) => format!("{secs:.1}s ERR {e}"),
                }
            })
            .collect::<Vec<_>>()
            .join(" | ");
        note(format!("[policy-probe] {shell}: {line}"));
    }
}
