//! Windows 클립보드의 파일 목록 — 탐색기 "복사" 가 올리는 `CF_HDROP`
//! (크로스플랫폼 W2 `#os-tools`, macOS 의 `public.file-url` 판).
//!
//! `CF_HDROP` 는 `DROPFILES` 머리 + 널로 끝나는 UTF-16 경로들 + 끝 널이다.
//! 읽기는 셸의 `DragQueryFileW` 가 풀어 준다 — 구조를 손으로 걷지 않는다.

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;

use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
};
use windows_sys::Win32::System::Ole::CF_HDROP;
use windows_sys::Win32::UI::Shell::DragQueryFileW;

/// 다른 프로세스가 클립보드를 잠깐 열고 있을 수 있다(클립보드 관리자·원격
/// 데스크톱). 몇 번 다시 두드린다.
const OPEN_ATTEMPTS: u32 = 10;
const OPEN_BACKOFF: std::time::Duration = std::time::Duration::from_millis(20);

/// 연 클립보드는 어떤 길로 나가든 닫는다 — 안 닫으면 **다른 앱 전부**의 복사가 막힌다.
struct OpenedClipboard;

impl OpenedClipboard {
    fn open() -> Result<Self, String> {
        for _ in 0..OPEN_ATTEMPTS {
            // SAFETY: 창 없이(null) 연다 — 현재 작업에 클립보드를 묶는다.
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return Ok(Self);
            }
            std::thread::sleep(OPEN_BACKOFF);
        }
        Err("The clipboard is busy in another app — try pasting again.".to_string())
    }
}

impl Drop for OpenedClipboard {
    fn drop(&mut self) {
        // SAFETY: `open` 이 성공했을 때만 이 값이 있다.
        unsafe {
            CloseClipboard();
        }
    }
}

/// 클립보드의 파일 경로들. 파일이 아닌 것(글자)이 들어 있으면 빈 목록이다.
pub(super) fn file_paths() -> Result<Vec<PathBuf>, String> {
    // SAFETY: 형식 조회는 클립보드를 열지 않아도 된다.
    if unsafe { IsClipboardFormatAvailable(u32::from(CF_HDROP)) } == 0 {
        return Ok(Vec::new());
    }
    let _open = OpenedClipboard::open()?;
    // SAFETY: 클립보드가 열려 있는 동안만 핸들이 유효하다 — `_open` 이 쥐고 있다.
    let hdrop = unsafe { GetClipboardData(u32::from(CF_HDROP)) };
    if hdrop.is_null() {
        return Ok(Vec::new());
    }
    // SAFETY: `hdrop` 은 CF_HDROP 데이터 — `DragQueryFileW` 가 읽는 바로 그 모양이다.
    // 0xFFFFFFFF 는 "파일 수를 달라" 는 약속된 값이다.
    let count = unsafe { DragQueryFileW(hdrop, u32::MAX, std::ptr::null_mut(), 0) };
    let mut out = Vec::with_capacity(count as usize);
    for i in 0..count {
        // SAFETY: 버퍼 없이 부르면 필요한 길이(널 제외)를 돌려준다.
        let len = unsafe { DragQueryFileW(hdrop, i, std::ptr::null_mut(), 0) };
        let mut buf = vec![0u16; len as usize + 1];
        // SAFETY: `buf` 는 len + 1(널) 칸이다.
        let got = unsafe { DragQueryFileW(hdrop, i, buf.as_mut_ptr(), buf.len() as u32) };
        buf.truncate(got as usize);
        out.push(PathBuf::from(OsString::from_wide(&buf)));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::UI::Shell::DROPFILES;

    /// 탐색기가 하는 그대로 `CF_HDROP` 를 올린다.
    fn put_files_on_clipboard(paths: &[PathBuf]) {
        let mut wide: Vec<u16> = Vec::new();
        for p in paths {
            wide.extend(p.as_os_str().encode_wide());
            wide.push(0);
        }
        wide.push(0);
        let header = std::mem::size_of::<DROPFILES>();
        let bytes = header + wide.len() * 2;
        unsafe {
            let mem = GlobalAlloc(GMEM_MOVEABLE, bytes);
            assert!(!mem.is_null(), "GlobalAlloc");
            let ptr = GlobalLock(mem) as *mut u8;
            assert!(!ptr.is_null(), "GlobalLock");
            let df = DROPFILES {
                pFiles: header as u32,
                pt: POINT { x: 0, y: 0 },
                fNC: 0,
                fWide: 1,
            };
            std::ptr::copy_nonoverlapping((&df as *const DROPFILES).cast::<u8>(), ptr, header);
            std::ptr::copy_nonoverlapping(
                wide.as_ptr().cast::<u8>(),
                ptr.add(header),
                wide.len() * 2,
            );
            GlobalUnlock(mem);
            let _open = OpenedClipboard::open().expect("클립보드 열기");
            assert_ne!(EmptyClipboard(), 0, "EmptyClipboard");
            // 성공하면 메모리는 시스템 것이 된다 — 우리가 해제하지 않는다.
            assert!(
                !SetClipboardData(u32::from(CF_HDROP), mem).is_null(),
                "SetClipboardData"
            );
        }
    }

    /// 탐색기에서 파일 두 개(공백·한글 이름 포함)를 복사한 뒤 붙여넣기 —
    /// 경로가 그대로 돌아온다. 이 테스트는 **이 기계의 클립보드를 덮어쓴다**
    /// (Windows 러너 전용으로 돈다).
    #[test]
    fn explorer_copied_files_come_back_as_paths() {
        let tmp = tempfile::TempDir::new().unwrap();
        let a = tmp.path().join("보고서 초안.md");
        let b = tmp.path().join("pack");
        std::fs::write(&a, b"x").unwrap();
        std::fs::create_dir_all(&b).unwrap();

        put_files_on_clipboard(&[a.clone(), b.clone()]);
        assert_eq!(file_paths().unwrap(), vec![a, b]);
    }
}
