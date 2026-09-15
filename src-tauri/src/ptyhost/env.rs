//! 셸에 물려주는 환경의 위생 — 앱이 **자기 프로세스를 위해** 건 변수는 사용자의
//! 셸에 새면 안 된다.

use std::ffi::OsStr;

use portable_pty::CommandBuilder;

/// 셸 커맨드의 출발점 — 호스트 환경을 물려받되 앱 전용 변수는 걷은 상태.
pub fn shell_command(shell: impl AsRef<OsStr>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(shell);
    scrub_app_malloc_env(&mut cmd);
    cmd
}

/// GUI 프로세스에 걸린 `MallocLargeCache=0`(LaunchServices 기동이면 번들
/// `Info.plist` 의 `LSEnvironment`, 그 밖에는 `main.rs` 의
/// `reexec_with_malloc_tuning`)은 이 호스트까지 물려받지만, 사용자가 그 셸에서
/// 돌리는 프로그램의 malloc 까지 바꿀 이유는 없다. 표식이 있을 때만 걷는다 —
/// 사용자가 직접 건 값은 존중.
pub fn scrub_app_malloc_env(cmd: &mut CommandBuilder) {
    if std::env::var_os("OCULPM_MALLOC_TUNED").is_some() {
        cmd.env_remove("MallocLargeCache");
        cmd.env_remove("OCULPM_MALLOC_TUNED");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubs_only_under_the_marker() {
        // 표식이 없으면 손대지 않는다 — 사용자가 직접 건 값.
        std::env::remove_var("OCULPM_MALLOC_TUNED");
        let mut cmd = CommandBuilder::new("sh");
        cmd.env("MallocLargeCache", "0");
        scrub_app_malloc_env(&mut cmd);
        assert_eq!(
            cmd.get_env("MallocLargeCache").map(|v| v.to_os_string()),
            Some("0".into())
        );

        std::env::set_var("OCULPM_MALLOC_TUNED", "1");
        let mut cmd = CommandBuilder::new("sh");
        cmd.env("MallocLargeCache", "0");
        cmd.env("OCULPM_MALLOC_TUNED", "1");
        scrub_app_malloc_env(&mut cmd);
        assert!(cmd.get_env("MallocLargeCache").is_none());
        assert!(cmd.get_env("OCULPM_MALLOC_TUNED").is_none());
        std::env::remove_var("OCULPM_MALLOC_TUNED");
    }
}
