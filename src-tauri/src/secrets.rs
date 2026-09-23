//! OS-native secret storage (Keychain / Credential Manager / Secret Service)
//! for API keys and other sensitive values.
//!
//! ## 저장소가 없으면 — 평문으로 물러서지 않는다 (크로스플랫폼 `#os-secrets`)
//!
//! macOS 키체인과 Windows 자격 증명 관리자는 OS 에 늘 있다. Linux 의 Secret
//! Service(GNOME Keyring·KWallet)는 **없을 수 있다** — 데스크톱 없는 배포판,
//! 타일링 WM, 세션 D-Bus 가 없는 환경. 그때 `keyring` 은 `PlatformFailure`
//! (D-Bus 이름 없음)나 `NoStorageAccess`(잠김)를 돌려주는데, 원문은
//! "Platform secure storage failure: …org.freedesktop.secrets was not provided…"
//! 같은 문장이라 사용자가 무엇을 해야 할지 알 수 없다.
//!
//! 그래서 Linux 에서 이 둘은 [`SecretError::Unavailable`] 로 바꿔 **고정 문구**
//! ([`UNAVAILABLE_PREFIX`]로 시작)를 낸다 — 프런트는 이 머리로 안내 문구 키를
//! 고른다. 설정 파일·DB 에 대신 적는 길은 **만들지 않는다**: 키가 평문으로
//! 디스크에 남는 것보다 "저장 못 함" 이 낫다. macOS·Windows 의 오류 문구는
//! `keyring` 원문 그대로다(동작 불변).

use keyring::Entry;

const SERVICE: &str = "com.kimhyunbin.ocul-pm";

/// [`SecretError::Unavailable`] 문구의 머리. 프런트 오류 사전이 이것으로 알아본다
/// (호출부가 앞에 문맥을 덧붙이기도 하므로 문장 **안**에서 찾는다).
pub const UNAVAILABLE_PREFIX: &str = "The system keyring is unavailable";

/// 비밀 저장소 오류.
#[derive(Debug)]
pub enum SecretError {
    /// OS 비밀 저장소에 닿을 수 없다 (Linux: Secret Service 제공자 없음·잠김).
    /// 다른 OS 에서는 만들어지지 않는다 — 저장소가 OS 의 일부다.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Unavailable(String),
    /// 그 밖의 `keyring` 오류 — 원문 그대로 보인다.
    Keyring(keyring::Error),
}

impl std::fmt::Display for SecretError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SecretError::Unavailable(detail) => write!(
                f,
                "{UNAVAILABLE_PREFIX} — install and unlock a Secret Service provider \
                 (GNOME Keyring or KWallet), then try again. Keys are never saved in \
                 plain text. ({detail})"
            ),
            SecretError::Keyring(e) => std::fmt::Display::fmt(e, f),
        }
    }
}

impl std::error::Error for SecretError {}

/// `keyring` 오류를 이 앱의 오류로. Linux 의 "저장소 없음/잠김" 만 갈라낸다.
fn classify(err: keyring::Error) -> SecretError {
    #[cfg(target_os = "linux")]
    if matches!(
        err,
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_)
    ) {
        return SecretError::Unavailable(err.to_string());
    }
    SecretError::Keyring(err)
}

fn entry(name: &str) -> Result<Entry, SecretError> {
    Entry::new(SERVICE, name).map_err(classify)
}

pub fn set(name: &str, value: &str) -> Result<(), SecretError> {
    entry(name)?.set_password(value).map_err(classify)
}

pub fn get(name: &str) -> Result<Option<String>, SecretError> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(classify(e)),
    }
}

pub fn has(name: &str) -> Result<bool, SecretError> {
    Ok(get(name)?.is_some())
}

pub fn delete(name: &str) -> Result<(), SecretError> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(classify(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dbus_missing() -> keyring::Error {
        keyring::Error::PlatformFailure(Box::new(std::io::Error::other(
            "org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.secrets \
             was not provided by any .service files",
        )))
    }

    /// Linux 의 "저장소 없음" 은 할 일을 말하는 고정 문구가 된다. 다른 OS 는
    /// `keyring` 원문 그대로 — macOS·Windows 의 오류 문구는 바뀌지 않는다.
    #[test]
    fn a_missing_secret_service_reads_as_an_instruction_on_linux_only() {
        let raw = dbus_missing().to_string();
        let shown = classify(dbus_missing()).to_string();
        if cfg!(target_os = "linux") {
            assert!(shown.starts_with(UNAVAILABLE_PREFIX), "{shown}");
            assert!(shown.contains("GNOME Keyring"), "{shown}");
            assert!(shown.contains("plain text"), "{shown}");
            assert!(
                shown.contains("org.freedesktop.secrets"),
                "원인 원문도 남는다: {shown}"
            );
        } else {
            assert_eq!(shown, raw);
        }
    }

    /// 잠김(`NoStorageAccess`)도 Linux 에서는 같은 안내다. 그 밖의 오류는 어느
    /// OS 에서든 원문 그대로.
    #[test]
    fn only_storage_failures_are_reclassified() {
        let locked = keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("locked")));
        assert_eq!(
            matches!(classify(locked), SecretError::Unavailable(_)),
            cfg!(target_os = "linux")
        );
        for other in [
            keyring::Error::NoEntry,
            keyring::Error::TooLong("user".into(), 8),
            keyring::Error::Invalid("service".into(), "empty".into()),
        ] {
            let raw = other.to_string();
            let classified = classify(other);
            assert!(matches!(classified, SecretError::Keyring(_)));
            assert_eq!(classified.to_string(), raw);
        }
    }

    /// 실제 저장소 — 읽기만 한다(없는 이름). Linux 러너에는 Secret Service 가
    /// 없는 것이 보통이라 그때는 `Unavailable` 이 나와야 하고, **쓰기도 실패해야**
    /// 한다(평문 대체 저장이 없다는 증거). 저장소가 있는 기계에서는 아무것도 쓰지
    /// 않고 끝난다.
    #[cfg(target_os = "linux")]
    #[test]
    fn without_a_secret_service_nothing_is_saved_anywhere() {
        // D-Bus 활성화가 프롬프트를 기다리며 매달릴 수 있다 — 잡 시한(60분)을
        // 통째로 먹지 않게 스레드에서 돌려 20초만 기다린다.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let name = format!("oculpm-port-probe-{}", uuid::Uuid::new_v4());
            let outcome = match get(&name) {
                Ok(None) => Ok("Secret Service 가 있다 — 쓰기 검사는 건너뜀".to_string()),
                Ok(Some(_)) => Err("없는 이름에서 값이 나왔다".to_string()),
                Err(SecretError::Unavailable(_)) => match set(&name, "probe-value") {
                    Ok(()) => Err("저장소가 없는데 저장이 성공했다".to_string()),
                    Err(e) if e.to_string().starts_with(UNAVAILABLE_PREFIX) => match get(&name) {
                        Err(SecretError::Unavailable(_)) => Ok("저장소 없음 — 명확한 오류".into()),
                        other => Err(format!("저장 실패 뒤 읽기: {other:?}")),
                    },
                    Err(e) => Err(format!("분류되지 않은 저장 오류: {e}")),
                },
                Err(e) => Err(format!("분류되지 않은 저장소 오류: {e}")),
            };
            let _ = tx.send(outcome);
        });
        match rx.recv_timeout(std::time::Duration::from_secs(20)) {
            Ok(Ok(note)) => {
                eprintln!("{note}");
                // CI 러너(데스크톱 세션 없음)에서는 "저장소 없음" 갈래를 **실제로**
                // 지나야 한다 — 저장소가 있는 갈래로 초록이 되면 검증이 안 된 것이다.
                if std::env::var_os("CI").is_some() {
                    assert!(
                        note.starts_with("저장소 없음"),
                        "CI 러너에 Secret Service 가 있다 — 없음 갈래가 검증되지 않았다: {note}"
                    );
                }
            }
            Ok(Err(why)) => panic!("{why}"),
            Err(_) => panic!("Secret Service 가 20초 안에 답하지 않았다"),
        }
    }
}
