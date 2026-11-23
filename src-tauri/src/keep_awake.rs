//! 잠자기 막기 — Claude 가 일하는 동안 기기가 잠들지 않게 (love-round L6, 11-23 사용자 결정).
//!
//! 오래 일하는 Claude 를 걸어 두고 자리를 비우면 노트북이 잠들어 PTY 가 멈췄다. 설정 「잠자기 막기」(`keep_awake`,
//! 기본 꺼짐)가 켜져 있고 **일하는(OSC 7501 working) 세션이 하나 이상일 때만** OS 에 단언을 잡고, 0 이 되면 바로
//! 푼다. 앱을 끌 때도 푼다(`teardown_for_exit`) — 프로세스가 끝나면 OS 도 거둔다.
//!
//! - macOS: IOKit `IOPMAssertionCreateWithName(PreventUserIdleSystemSleep)` — 프로세스 안 API. 화면은 꺼질 수 있다.
//! - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` — 부른 **스레드**에 걸리므로 앱이 사는
//!   동안 사는 메인 스레드에서 건다.
//! - Linux: 프로세스 안에서 막는 길이 없다(systemd-inhibit 은 보조 프로세스다 — 새 자식 프로세스 금지). 설정 행이
//!   「이 OS 에서는 아직 안 돼요」 라고 말한다.
//!
//! 새 자식 프로세스 · 네트워크는 없다. 언제 다시 셀지는 이미 나가는 `TermSessionsChanged` 를 듣는다(상태 · 끝남마다).
//! claude 가 `state=clear` 없이 죽어 낡은 working 이 남는 칸은 사건이 오지 않으니, 잡고 있는 동안만
//! [`WATCH_EVERY`] 마다 다시 센다 — 그 칸은 셸이 다시 앞이라 세지 않는다(`TermSessions::working_all`).

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use crate::commands::terminal::TermSessionsChanged;
use crate::terminal::TermSessions;

/// 설정 키 — 프런트 `KEYS.keepAwake` 와 같다.
pub const KEY: &str = "keep_awake";

/// 이 OS 가 프로세스 안에서 잠자기를 막을 수 있나 — 프런트도 같은 표를 쓴다(`keepAwakeSupported`).
pub const SUPPORTED: bool = cfg!(any(target_os = "macos", windows));

/// 잡고 있는 동안 다시 세는 간격 — 사건 없이 낡은 working(죽은 claude)을 거두는 그물.
const WATCH_EVERY: Duration = Duration::from_secs(30);

/// 저장된 값 → 켜짐. 「on」 일 때만 — 모르는 값 · 없음은 꺼짐(기본 꺼짐).
pub fn enabled_from(raw: Option<&str>) -> bool {
    raw.map(str::trim) == Some("on")
}

/// 다음 걸음.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Hold,
    Release,
    Stay,
}

/// 켜져 있고 일하는 세션이 하나 이상이면 잡고, 아니면 푼다. 이미 그 꼴이면 그대로.
pub fn step(held: bool, enabled: bool, working: u32) -> Step {
    match (held, enabled && working > 0) {
        (false, true) => Step::Hold,
        (true, false) => Step::Release,
        _ => Step::Stay,
    }
}

#[derive(Default)]
struct State {
    enabled: bool,
    held: Option<platform::Hold>,
    watching: bool,
}

/// 앱 상태 — 설정과 지금 잡은 단언.
#[derive(Default)]
pub struct KeepAwake {
    inner: Mutex<State>,
}

impl KeepAwake {
    fn apply(&self, app: &AppHandle, working: impl FnOnce() -> u32) {
        let Ok(mut st) = self.inner.lock() else {
            return;
        };
        // 꺼져 있고 잡은 것도 없으면 세지 않는다 — 사건마다 세션을 재지 않게.
        if !st.enabled && st.held.is_none() {
            return;
        }
        match step(st.held.is_some(), st.enabled, working()) {
            Step::Hold => {
                st.held = platform::hold(app);
                if st.held.is_some() && !st.watching {
                    st.watching = true;
                    let app = app.clone();
                    std::thread::spawn(move || watch(app));
                }
            }
            Step::Release => {
                if let Some(h) = st.held.take() {
                    platform::release(app, h);
                }
            }
            Step::Stay => {}
        }
    }

    /// 설정을 바꿨다(또는 기동 때 읽었다) — 곧바로 다시 센다.
    pub fn set_enabled(&self, app: &AppHandle, on: bool) {
        if let Ok(mut st) = self.inner.lock() {
            st.enabled = on;
        }
        sync(app);
    }

    /// 앱을 끈다 — 잡은 것을 푼다.
    pub fn release_all(&self, app: &AppHandle) {
        if let Some(h) = self.inner.lock().ok().and_then(|mut st| st.held.take()) {
            platform::release(app, h);
        }
    }
}

/// 다시 센다 — 일하는 세션 수로 잡거나 푼다.
pub fn sync(app: &AppHandle) {
    if !SUPPORTED {
        return;
    }
    let Some(me) = app.try_state::<KeepAwake>() else {
        return;
    };
    me.apply(app, || {
        app.try_state::<TermSessions>()
            .map(|t| t.working_all())
            .unwrap_or(0)
    });
}

/// 잡고 있는 동안만 도는 그물 — 풀리면 끝난다.
fn watch(app: AppHandle) {
    loop {
        std::thread::sleep(WATCH_EVERY);
        sync(&app);
        let Some(me) = app.try_state::<KeepAwake>() else {
            return;
        };
        let Ok(mut st) = me.inner.lock() else {
            return;
        };
        if st.held.is_none() {
            st.watching = false;
            return;
        }
    }
}

/// 기동 — 상태를 두고, 저장된 설정을 읽고, 세션 사건을 듣는다.
pub fn install(app: &AppHandle) {
    app.manage(KeepAwake::default());
    if !SUPPORTED {
        return;
    }
    let handle = app.clone();
    TermSessionsChanged::listen_any(app, move |_| sync(&handle));
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(db) = handle.try_state::<crate::db::Db>() else {
            return;
        };
        match db.settings_get(KEY.to_string()).await {
            Ok(raw) => {
                if let Some(me) = handle.try_state::<KeepAwake>() {
                    me.set_enabled(&handle, enabled_from(raw.as_deref()));
                }
            }
            // 읽지 못하면 꺼짐(기본)으로 둔다 — 켜 둔 사람이 왜 잠드는지 로그에서 찾게 남긴다.
            Err(e) => {
                tracing::warn!(target: "keep_awake", error = %e, "잠자기 막기 설정을 읽지 못해 꺼짐으로 둠")
            }
        }
    });
}

/// 설정 쓰기가 이 키면 — `settings_set` · `settings_set_many` 가 부른다.
pub fn on_setting(app: &AppHandle, key: &str, value: &str) {
    if key != KEY {
        return;
    }
    if let Some(me) = app.try_state::<KeepAwake>() {
        me.set_enabled(app, enabled_from(Some(value)));
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::c_void;

    use objc2_foundation::NSString;
    use tauri::AppHandle;

    type IOPMAssertionID = u32;
    /// `kIOPMAssertionLevelOn`.
    const LEVEL_ON: u32 = 255;
    /// `kIOReturnSuccess`.
    const SUCCESS: i32 = 0;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        /// `CFStringRef` 자리에 `NSString` 을 넘긴다 — 둘은 무료 교량(toll-free bridged)이다.
        fn IOPMAssertionCreateWithName(
            assertion_type: *const c_void,
            level: u32,
            name: *const c_void,
            id: *mut IOPMAssertionID,
        ) -> i32;
        fn IOPMAssertionRelease(id: IOPMAssertionID) -> i32;
    }

    pub(super) struct Hold(IOPMAssertionID);

    pub(super) fn hold(_app: &AppHandle) -> Option<Hold> {
        create()
    }

    /// 단언을 만든다 — 프로세스 어느 스레드에서나 된다(시험도 이것을 부른다).
    pub(super) fn create() -> Option<Hold> {
        let kind = NSString::from_str("PreventUserIdleSystemSleep");
        let name = NSString::from_str("Ocul: Claude is working");
        let mut id: IOPMAssertionID = 0;
        // SAFETY: 두 문자열은 이 호출 동안 살아 있고, `id` 는 쓸 수 있는 자리다. IOKit 은 문자열을 복사한다.
        let rc = unsafe {
            IOPMAssertionCreateWithName(
                (&*kind as *const NSString).cast(),
                LEVEL_ON,
                (&*name as *const NSString).cast(),
                &mut id,
            )
        };
        if rc != SUCCESS {
            tracing::warn!(target: "keep_awake", rc, "잠자기 막기 단언을 잡지 못함");
            return None;
        }
        tracing::info!(target: "keep_awake", "잠자기 막기 — 잡음");
        Some(Hold(id))
    }

    pub(super) fn release(_app: &AppHandle, h: Hold) {
        destroy(h);
    }

    /// 단언을 푼다 — 성공했나.
    pub(super) fn destroy(h: Hold) -> bool {
        // SAFETY: `create` 가 받은 id 를 한 번만 푼다(`Hold` 는 복사되지 않는다).
        let rc = unsafe { IOPMAssertionRelease(h.0) };
        tracing::info!(target: "keep_awake", rc, "잠자기 막기 — 풂");
        rc == SUCCESS
    }
}

#[cfg(windows)]
mod platform {
    use tauri::AppHandle;
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    pub(super) struct Hold;

    /// 부른 스레드에 걸린다 — 앱이 사는 동안 사는 메인 스레드로 넘긴다.
    pub(super) fn hold(app: &AppHandle) -> Option<Hold> {
        // SAFETY: 플래그만 넘기는 호출이다.
        let sent = app.run_on_main_thread(|| unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        });
        match sent {
            Ok(()) => Some(Hold),
            Err(e) => {
                tracing::warn!(target: "keep_awake", error = %e, "잠자기 막기를 메인 스레드로 넘기지 못함");
                None
            }
        }
    }

    pub(super) fn release(app: &AppHandle, _h: Hold) {
        // SAFETY: 플래그만 넘기는 호출이다. 앱이 끝나는 중이라 넘기지 못해도 프로세스가 끝나면 OS 가 거둔다.
        let _ = app.run_on_main_thread(|| unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        });
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use tauri::AppHandle;

    pub(super) struct Hold;

    pub(super) fn hold(_app: &AppHandle) -> Option<Hold> {
        None
    }

    pub(super) fn release(_app: &AppHandle, _h: Hold) {}
}

#[cfg(test)]
#[path = "keep_awake_tests.rs"]
mod tests;
