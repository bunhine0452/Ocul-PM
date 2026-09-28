//! 세션을 끝낼 때 **누가 남는가** — Windows Job 종료의 판정 (#pty-job-gui-children).
//!
//! 결정: 셸에서 띄운 **GUI 서브시스템 프로그램**(처음 띄운 `code .` 의 VS Code, `start
//! notepad`)은 세션이 끝나도 살고, **콘솔 프로그램**은 끝난다. macOS 와 같은 결과다 —
//! 거기서는 PTY 가 닫히며 그 터미널에 붙은 것만 SIGHUP 을 받고, 창을 띄운 앱은 터미널과
//! 무관하게 산다.
//!
//! "GUI 쪽" 은 GUI 프로그램 하나가 아니라 **그 아래 가지 전체**다. VS Code 는 제 통합
//! 터미널의 셸·언어 서버·git 을 콘솔 프로그램으로 띄운다 — 그것까지 끝내면 창만 남은
//! VS Code 가 된다. 그래서 판정은 조상 사슬로 한다: 자기 자신이나 (Job 안의) 조상 중에 GUI
//! 프로그램이 있으면 남기고, 사슬이 셸까지 전부 콘솔이면 끝낸다.
//!
//! 모르는 것은 **끝낸다** — 서브시스템을 못 읽었거나(권한·파일이 사라짐) 조상이 이미 끝나
//! 사슬이 끊긴 것. 예전 동작(트리 전체 종료)과 같은 쪽으로 틀려야 "Kill 뒤 콘솔 자식 0" 이
//! 깨지지 않는다.
//!
//! 이 파일은 판정만 한다(순수 함수 — 어느 OS 에서든 테스트가 돈다). 프로세스 목록을 모으고
//! 실제로 끝내는 것은 `host/windows/job.rs` 다.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// PE 선택 헤더의 `Subsystem` — `IMAGE_SUBSYSTEM_WINDOWS_GUI`.
pub(crate) const SUBSYSTEM_WINDOWS_GUI: u16 = 2;

/// Job 안의 프로세스 하나.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Member {
    pub pid: u32,
    /// 부모 pid — 이미 끝났을 수도, 재사용됐을 수도 있다([`condemned`] 가 가린다).
    pub parent: u32,
    /// 생성 시각(FILETIME 100ns). 부모는 자식보다 먼저 태어났어야 부모다.
    pub born: u64,
    /// 실행 파일이 GUI 서브시스템이다. 못 읽었으면 `false`(모름 = 콘솔 쪽).
    pub gui: bool,
}

/// 끝낼 프로세스 — 자기와 Job 안의 조상 중 GUI 가 하나도 없는 것.
///
/// 조상은 **같은 Job 안에서, 자식보다 먼저 태어난** 부모만 따라간다. 부모 pid 는
/// 재사용되므로, 자식보다 늦게 태어난 "부모" 는 같은 번호를 받은 남이다.
pub(crate) fn condemned(members: &[Member]) -> Vec<u32> {
    let by_pid: HashMap<u32, &Member> = members.iter().map(|m| (m.pid, m)).collect();
    members
        .iter()
        .filter(|m| !gui_rooted(m, &by_pid))
        .map(|m| m.pid)
        .collect()
}

fn gui_rooted(member: &Member, by_pid: &HashMap<u32, &Member>) -> bool {
    let mut at = member;
    // 순환(재사용된 pid 가 꼬인 것) 방어 — 사슬은 구성원 수보다 길 수 없다.
    for _ in 0..=by_pid.len() {
        if at.gui {
            return true;
        }
        match by_pid.get(&at.parent) {
            Some(parent) if parent.pid != at.pid && parent.born <= at.born => at = parent,
            _ => return false,
        }
    }
    false
}

/// 실행 파일의 PE `Subsystem`. PE 가 아니거나 읽지 못하면 `None`.
pub(crate) fn subsystem_of(path: &Path) -> Option<u16> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut dos = [0u8; 64];
    file.read_exact(&mut dos).ok()?;
    let at = pe_header_offset(&dos)?;
    file.seek(SeekFrom::Start(u64::from(at))).ok()?;
    // 서명 4 + COFF 헤더 20 + 선택 헤더의 Subsystem 까지(68 + 2).
    let mut pe = [0u8; 4 + 20 + 70];
    file.read_exact(&mut pe).ok()?;
    subsystem_in(&pe)
}

/// DOS 헤더의 `e_lfanew` — `MZ` 로 시작하지 않으면 `None`.
fn pe_header_offset(dos: &[u8; 64]) -> Option<u32> {
    (dos[..2] == *b"MZ").then(|| u32::from_le_bytes([dos[60], dos[61], dos[62], dos[63]]))
}

/// `PE\0\0` 서명부터의 바이트에서 `Subsystem` 을 읽는다. PE32·PE32+ 모두 선택 헤더의
/// 68 바이트 자리다.
fn subsystem_in(pe: &[u8]) -> Option<u16> {
    if pe.get(..4)? != b"PE\0\0" {
        return None;
    }
    let optional = pe.get(24..)?;
    // 선택 헤더 매직: 0x10b(PE32) · 0x20b(PE32+).
    let magic = u16::from_le_bytes([*optional.first()?, *optional.get(1)?]);
    if magic != 0x10b && magic != 0x20b {
        return None;
    }
    Some(u16::from_le_bytes([*optional.get(68)?, *optional.get(69)?]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(pid: u32, parent: u32, born: u64, gui: bool) -> Member {
        Member {
            pid,
            parent,
            born,
            gui,
        }
    }

    fn sorted(mut v: Vec<u32>) -> Vec<u32> {
        v.sort_unstable();
        v
    }

    /// 셸(10) 아래 — 포그라운드 콘솔(11), 새 콘솔로 띄운 콘솔(12), GUI(13) 와 그 콘솔
    /// 자식(14, VS Code 의 통합 터미널 셸 같은 것), GUI 가 띄운 GUI(15).
    #[test]
    fn console_branches_end_and_gui_branches_stay() {
        let members = [
            m(10, 1, 100, false),
            m(11, 10, 110, false),
            m(12, 10, 120, false),
            m(13, 10, 130, true),
            m(14, 13, 140, false),
            m(15, 13, 150, true),
        ];
        assert_eq!(sorted(condemned(&members)), [10, 11, 12]);
    }

    /// `code .` 의 모양 — 콘솔 사이(`code.cmd` → cmd)를 지나 뜬 GUI 는 그 콘솔 부모가
    /// 끝나 있어도 제 자신이 GUI 라 남는다.
    #[test]
    fn a_gui_whose_console_launcher_already_exited_stays() {
        let members = [
            m(10, 1, 100, false),
            m(20, 19, 200, true),
            m(21, 20, 210, false),
        ];
        assert_eq!(condemned(&members), [10]);
    }

    /// 부모가 끝나 사슬이 끊긴 콘솔은 모른다 — 끝낸다(예전 동작 쪽으로).
    #[test]
    fn a_console_orphan_with_a_broken_chain_ends() {
        let members = [m(10, 1, 100, false), m(30, 29, 300, false)];
        assert_eq!(sorted(condemned(&members)), [10, 30]);
    }

    /// 재사용된 pid — 자식보다 **늦게** 태어난 GUI 는 그 자식의 부모가 아니다.
    #[test]
    fn a_reused_parent_pid_born_later_is_not_the_parent() {
        let members = [m(40, 41, 400, false), m(41, 1, 500, true)];
        assert_eq!(condemned(&members), [40]);
    }

    /// 꼬인 순환도 끝난다(무한 루프가 아니다).
    #[test]
    fn a_parent_cycle_terminates() {
        let members = [m(50, 51, 500, false), m(51, 50, 500, false)];
        assert_eq!(sorted(condemned(&members)), [50, 51]);
        let own_parent = [m(60, 60, 600, false)];
        assert_eq!(condemned(&own_parent), [60]);
    }

    /// 최소 PE 헤더 — `e_lfanew` 자리에 PE 서명, 선택 헤더 68 자리에 Subsystem.
    fn image(magic: u16, subsystem: u16, pe_at: u32) -> Vec<u8> {
        let mut bytes = vec![0u8; pe_at as usize + 4 + 20 + 96];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[60..64].copy_from_slice(&pe_at.to_le_bytes());
        let pe = pe_at as usize;
        bytes[pe..pe + 4].copy_from_slice(b"PE\0\0");
        let opt = pe + 24;
        bytes[opt..opt + 2].copy_from_slice(&magic.to_le_bytes());
        bytes[opt + 68..opt + 70].copy_from_slice(&subsystem.to_le_bytes());
        bytes
    }

    #[test]
    fn reads_the_subsystem_of_pe32_and_pe32_plus() {
        let dir = tempfile::tempdir().unwrap();
        for (name, magic, subsystem, pe_at) in [
            ("gui64.exe", 0x20b, SUBSYSTEM_WINDOWS_GUI, 0x80),
            ("cui64.exe", 0x20b, 3, 0xf8),
            ("gui32.exe", 0x10b, SUBSYSTEM_WINDOWS_GUI, 0x100),
        ] {
            let path = dir.path().join(name);
            std::fs::write(&path, image(magic, subsystem, pe_at)).unwrap();
            assert_eq!(subsystem_of(&path), Some(subsystem), "{name}");
        }
    }

    #[test]
    fn non_pe_and_truncated_files_have_no_subsystem() {
        let dir = tempfile::tempdir().unwrap();
        let cases: [(&str, Vec<u8>); 4] = [
            ("script.cmd", b"@echo off\r\n".to_vec()),
            ("short.exe", b"MZ".to_vec()),
            ("cut.exe", image(0x20b, 2, 0x80)[..0x90].to_vec()),
            ("rom.exe", image(0x107, 2, 0x80)),
        ];
        for (name, bytes) in cases {
            let path = dir.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(subsystem_of(&path), None, "{name}");
        }
        assert_eq!(subsystem_of(&dir.path().join("missing.exe")), None);
    }

    /// 실제 실행 파일 — cmd·ping 은 콘솔, notepad·winver 는 GUI 다.
    #[cfg(windows)]
    #[test]
    fn windows_system_binaries_have_the_expected_subsystem() {
        let system = std::path::PathBuf::from(
            std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into()),
        )
        .join("System32");
        assert_eq!(subsystem_of(&system.join("cmd.exe")), Some(3));
        assert_eq!(subsystem_of(&system.join("PING.EXE")), Some(3));
        let guis: Vec<_> = ["notepad.exe", "winver.exe"]
            .into_iter()
            .map(|n| system.join(n))
            .filter(|p| p.is_file())
            .collect();
        assert!(!guis.is_empty(), "System32 에 notepad·winver 가 둘 다 없다");
        for gui in guis {
            assert_eq!(subsystem_of(&gui), Some(SUBSYSTEM_WINDOWS_GUI), "{gui:?}");
        }
    }
}
