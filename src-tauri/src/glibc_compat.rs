//! glibc 2.38 미만에서 ONNX Runtime 정적 라이브러리를 링크하기 위한 호환 심볼
//! (크로스플랫폼 W1 · Linux 한정 — `lib.rs` 에서 `target_os = "linux"` +
//! `target_env = "gnu"` 로만 들어온다).
//!
//! ## 왜
//!
//! `fastembed` → `ort` 가 내려받는 사전 빌드 ONNX Runtime(pyke `ms@1.24.2`,
//! `x86_64-unknown-linux-gnu`)은 glibc 2.38+ 에서 빌드됐다. glibc 2.38 부터
//! `<stdlib.h>` 는 C23 모드에서 `strtol` 계열을 `__isoc23_strtol` 로 **이름을
//! 바꿔** 부르므로, 그 아카이브의 `parser.cc.o`·`allocation_planner.cc.o` 등은
//! `__isoc23_strtol`·`__isoc23_strtoll`·`__isoc23_strtoull` 를 참조한다.
//! 릴리스 glibc 하한으로 고른 ubuntu-22.04(glibc 2.35, D10)에는 이 심볼이 없어
//! 앱·테스트 바이너리 링크가 `undefined symbol: __isoc23_strtoull` 로 실패했다
//! (portability run 35875320559). `cargo check`·`clippy` 는 링크하지 않아 못 봤다.
//!
//! ## 무엇이 다른가
//!
//! C23 판은 기수 0·2 에서 `0b`/`0B` 접두를 받아들이는 것만 다르다. 여기서는
//! 옛 판(`strtol`)으로 넘긴다 — ONNX Runtime 은 이 함수들을 텍스트 형식 파서와
//! 설정 값 파싱(10진)에 쓰고, 앱은 protobuf 모델만 싣는다. glibc 2.38+ 에서
//! 돌 때도 실행 파일의 정의가 먼저 잡힐 뿐 뜻은 같다.
//!
//! 판단은 오케스트레이터가 바꿀 수 있다: Linux 빌드 호스트를 ubuntu-24.04 로
//! 올리면(glibc 하한 2.39) 이 모듈은 필요 없다 — 그 대신 Ubuntu 22.04·Debian 12
//! 사용자를 잃는다.

use std::os::raw::{c_char, c_int, c_long, c_longlong, c_ulonglong};

/// C23 `strtol` — 옛 `strtol` 로 넘긴다.
///
/// # Safety
/// `strtol(3)` 과 같다: `nptr` 은 NUL 로 끝나는 유효한 문자열, `endptr` 는 null
/// 이거나 쓸 수 있는 포인터여야 한다.
#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtol(
    nptr: *const c_char,
    endptr: *mut *mut c_char,
    base: c_int,
) -> c_long {
    libc::strtol(nptr, endptr, base)
}

/// C23 `strtoll` — 옛 `strtoll` 로 넘긴다.
///
/// # Safety
/// `strtoll(3)` 과 같다.
#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtoll(
    nptr: *const c_char,
    endptr: *mut *mut c_char,
    base: c_int,
) -> c_longlong {
    libc::strtoll(nptr, endptr, base)
}

/// C23 `strtoull` — 옛 `strtoull` 로 넘긴다.
///
/// # Safety
/// `strtoull(3)` 과 같다.
#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtoull(
    nptr: *const c_char,
    endptr: *mut *mut c_char,
    base: c_int,
) -> c_ulonglong {
    libc::strtoull(nptr, endptr, base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    /// ubuntu 러너에서 돈다 — 심볼이 링크되고 10진·16진·부호·끝 포인터가 옛 판과 같다.
    #[test]
    fn isoc23_shims_parse_like_the_classic_functions() {
        let s = CString::new("-42rest").unwrap();
        let mut end: *mut c_char = std::ptr::null_mut();
        let v = unsafe { __isoc23_strtol(s.as_ptr(), &mut end, 10) };
        assert_eq!(v, -42);
        let consumed = end as usize - s.as_ptr() as usize;
        assert_eq!(consumed, 3, "끝 포인터는 파싱을 멈춘 자리");

        let s = CString::new("9223372036854775807").unwrap();
        assert_eq!(
            unsafe { __isoc23_strtoll(s.as_ptr(), std::ptr::null_mut(), 10) },
            i64::MAX
        );
        let s = CString::new("0xff").unwrap();
        assert_eq!(
            unsafe { __isoc23_strtoull(s.as_ptr(), std::ptr::null_mut(), 16) },
            255
        );
    }
}
