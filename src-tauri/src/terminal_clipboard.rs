//! 터미널의 클립보드 다리 (love-round 11-23) — 웹뷰가 할 수 없는 두 가지만 OS 클립보드에 직접 묻는다. 새 프로세스 ·
//! 네트워크는 없다(프로세스 안의 OS API 한 번).
//!
//! - **복사한 파일의 경로** — Finder · 탐색기에서 「복사」 한 파일을 터미널에 ⌘V 하면 브라우저의 붙여넣기 사건은
//!   경로를 주지 않는다(파일 이름 글자 · 아이콘 그림만 온다). 바깥 터미널(Terminal.app · iTerm)은 경로를 붙인다.
//!   macOS 는 pasteboard 의 `public.file-url`, Windows 는 `CF_HDROP`. Linux 데스크톱은 `text/uri-list` 로 주는데 그
//!   클립보드는 GTK 메인 스레드에서만 읽혀, 웹뷰의 붙여넣기 사건에서 읽는다(`pasteSafe.ts`).
//! - **글 쓰기** — 터미널 안의 프로그램(tmux · ssh 너머 vim)이 OSC 52 로 복사를 청할 때. WKWebView 는 사람의 키
//!   사건 밖에서 부른 `navigator.clipboard.writeText` 를 거절한다 — 출력은 키보다 늦게 온다. Linux 는 웹뷰가 쓴다.
//!
//! 3.x 코드 편집기의 붙여넣기(`commands/code/import.rs` · `clipboard_windows.rs`, 10-28 에 걷힘)를 줄여 되살렸다.

/// 한 번에 붙이는 경로 수의 상한 — 폴더째 수천 개를 골라 복사해도 입력줄이 넘치지 않게.
pub const MAX_PATHS: usize = 64;

/// 클립보드의 파일 경로들(복사한 순서). 파일이 아니면 빈 목록 — 글을 복사해 둔 ⌘V 도 정상이다.
pub fn file_paths() -> Result<Vec<String>, String> {
    let mut paths = os::file_paths()?;
    paths.truncate(MAX_PATHS);
    Ok(paths)
}

/// 글을 클립보드에 쓴다. 이 OS 에서 앱이 쓰지 않으면(Linux) `false` — 웹뷰가 쓴다.
pub fn write_text(text: &str) -> Result<bool, String> {
    os::write_text(text)
}

#[cfg(target_os = "macos")]
mod os {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL, NSPasteboardTypeString};
    use objc2_foundation::{NSString, NSURL};

    pub fn file_paths() -> Result<Vec<String>, String> {
        let pb = NSPasteboard::generalPasteboard();
        let Some(items) = pb.pasteboardItems() else {
            return Ok(Vec::new());
        };
        // SAFETY: AppKit 이 내보내는 상수 — 프로세스 동안 산다.
        let file_url = unsafe { NSPasteboardTypeFileURL };
        let mut out = Vec::new();
        for item in items.iter() {
            let Some(s) = item.stringForType(file_url) else {
                continue;
            };
            // 퍼센트 인코딩은 Foundation 이 푼다. Finder 는 파일 참조 URL(`file:///.file/id=…`)을 올리기도 해
            // 경로 URL 로 한 번 바꾼다.
            let Some(url) = NSURL::URLWithString(&s) else {
                continue;
            };
            let url = url.filePathURL().unwrap_or(url);
            if let Some(path) = url.path() {
                out.push(path.to_string());
            }
        }
        Ok(out)
    }

    pub fn write_text(text: &str) -> Result<bool, String> {
        let pb = NSPasteboard::generalPasteboard();
        // SAFETY: AppKit 이 내보내는 상수 — 프로세스 동안 산다.
        let string_type = unsafe { NSPasteboardTypeString };
        let text = NSString::from_str(text);
        // 비운 직후 다른 프로세스(클립보드 관리자)가 판을 가져가면 쓰기가 거절된다 — 한 번 더 비우고 쓴다
        // (설치본 로그 11-26: Claude 의 복사가 한 번 조용히 사라졌다).
        for _ in 0..2 {
            pb.clearContents();
            if pb.setString_forType(&text, string_type) {
                return Ok(true);
            }
        }
        Err("pasteboard refused the text".to_string())
    }
}

#[cfg(windows)]
mod os {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::{CF_HDROP, CF_UNICODETEXT};
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    /// 다른 프로세스(클립보드 관리자 · 원격 데스크톱)가 잠깐 열고 있을 수 있다 — 몇 번 다시 두드린다.
    const OPEN_ATTEMPTS: u32 = 10;
    const OPEN_BACKOFF: std::time::Duration = std::time::Duration::from_millis(20);

    /// 연 클립보드는 어떤 길로 나가든 닫는다 — 안 닫으면 다른 앱 전부의 복사가 막힌다.
    struct Opened;

    impl Opened {
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

    impl Drop for Opened {
        fn drop(&mut self) {
            // SAFETY: `open` 이 성공했을 때만 이 값이 있다.
            unsafe {
                CloseClipboard();
            }
        }
    }

    pub fn file_paths() -> Result<Vec<String>, String> {
        // SAFETY: 형식 조회는 클립보드를 열지 않아도 된다.
        if unsafe { IsClipboardFormatAvailable(u32::from(CF_HDROP)) } == 0 {
            return Ok(Vec::new());
        }
        let _open = Opened::open()?;
        // SAFETY: 클립보드가 열려 있는 동안만 핸들이 유효하다 — `_open` 이 쥐고 있다.
        let hdrop = unsafe { GetClipboardData(u32::from(CF_HDROP)) };
        if hdrop.is_null() {
            return Ok(Vec::new());
        }
        // SAFETY: `hdrop` 은 CF_HDROP 데이터. 0xFFFFFFFF 는 「파일 수를 달라」 는 약속된 값이다.
        let count = unsafe { DragQueryFileW(hdrop, u32::MAX, std::ptr::null_mut(), 0) };
        let mut out = Vec::new();
        for i in 0..count.min(super::MAX_PATHS as u32) {
            // SAFETY: 버퍼 없이 부르면 필요한 길이(널 제외)를 돌려준다.
            let len = unsafe { DragQueryFileW(hdrop, i, std::ptr::null_mut(), 0) };
            let mut buf = vec![0u16; len as usize + 1];
            // SAFETY: `buf` 는 len + 1(널) 칸이다.
            let got = unsafe { DragQueryFileW(hdrop, i, buf.as_mut_ptr(), buf.len() as u32) };
            buf.truncate(got as usize);
            out.push(OsString::from_wide(&buf).to_string_lossy().into_owned());
        }
        Ok(out)
    }

    pub fn write_text(text: &str) -> Result<bool, String> {
        let wide: Vec<u16> = std::ffi::OsStr::new(text)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let bytes = wide.len() * 2;
        let _open = Opened::open()?;
        // SAFETY: 연 클립보드 위에서 비우고, 옮길 수 있는 전역 메모리에 널로 끝나는 UTF-16 을 담아 넘긴다.
        // SetClipboardData 가 성공하면 메모리는 시스템 것이 되고, 실패하면 우리가 푼다.
        unsafe {
            if EmptyClipboard() == 0 {
                return Err("could not empty the clipboard".to_string());
            }
            let mem = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if mem.is_null() {
                return Err("GlobalAlloc failed".to_string());
            }
            let ptr = GlobalLock(mem) as *mut u16;
            if ptr.is_null() {
                GlobalFree(mem);
                return Err("GlobalLock failed".to_string());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
            GlobalUnlock(mem);
            if SetClipboardData(u32::from(CF_UNICODETEXT), mem).is_null() {
                GlobalFree(mem);
                return Err("SetClipboardData failed".to_string());
            }
        }
        Ok(true)
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod os {
    /// Linux — 웹뷰의 붙여넣기 사건이 `text/uri-list` 를 읽는다(머리말).
    pub fn file_paths() -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }

    /// Linux — 웹뷰가 `navigator.clipboard` 로 쓴다.
    pub fn write_text(_text: &str) -> Result<bool, String> {
        Ok(false)
    }
}
