//! `workday.timezone` 의 기본값 — **시스템 IANA 시간대**, 못 구하면 `Asia/Seoul`
//! (크로스플랫폼 라운드 #oculpm-default-tz, 2026-09-28).
//!
//! 예전엔 `Asia/Seoul` 고정이라 다른 시간대 사용자의 Today·일지 날짜가 하루
//! 어긋났다 — E2E 러너(UTC)에서 드러났다. 이 값이 쓰이는 자리는 둘이다:
//!
//! - **새 프로젝트 초기화** — 생성한 config 를 그대로 `config.toml` 에 적는다.
//!   한 번 적힌 뒤로는 파일 값이 이긴다(시스템 시간대가 바뀌어도 날짜 칸이
//!   흔들리지 않는다).
//! - **빈 칸 채우기** — 손으로 고친 config 에서 `timezone` 이 빠졌을 때
//!   (`OculpmConfig::from_toml_str` 의 덧씌우기 바탕).
//!
//! 이미 파일에 적힌 시간대는 절대 바꾸지 않는다 — 여기는 기본값만 정한다.

use std::sync::OnceLock;

/// 시스템 시간대를 못 구했을 때의 기본값 — 예전 고정값과 같다.
pub const FALLBACK_TIMEZONE: &str = "Asia/Seoul";

/// 새 설정·빈 칸에 쓸 시간대.
///
/// 프로세스당 한 번만 판별한다 — config 는 MCP 호출·워처마다 다시 읽히고,
/// Windows 의 판별은 WinRT 호출이다. 앱이 도는 사이 시스템 시간대를 바꾸면
/// 다음 실행부터 따라온다 (이미 적힌 파일 값은 어차피 그대로다).
pub fn default_timezone() -> String {
    static RESOLVED: OnceLock<String> = OnceLock::new();
    RESOLVED
        .get_or_init(|| {
            resolve(
                std::env::var("TZ").ok().as_deref(),
                iana_time_zone::get_timezone().ok().as_deref(),
            )
        })
        .clone()
}

/// 후보를 순서대로 보고 **IANA 이름으로 읽히는** 첫 값을 고른다.
///
/// 1. `TZ` 환경 변수 — C 라이브러리·`chrono::Local` 이 따르는 값. POSIX 는
///    `:Area/City` 꼴도 허용한다. `EST5EDT`·`KST-9` 같은 POSIX 규칙 문자열은
///    IANA 이름이 아니라 건너뛴다.
/// 2. 운영체제 설정 (`iana-time-zone` — macOS CFTimeZone · Windows
///    `Globalization.Calendar` · Linux `/etc/localtime` 링크).
/// 3. [`FALLBACK_TIMEZONE`].
///
/// 환경을 인자로 받는 순수 함수라 테스트가 결정적이다.
pub(crate) fn resolve(tz_env: Option<&str>, system: Option<&str>) -> String {
    [tz_env.map(|s| s.strip_prefix(':').unwrap_or(s)), system]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|name| !name.is_empty() && name.parse::<chrono_tz::Tz>().is_ok())
        .map_or_else(|| FALLBACK_TIMEZONE.to_string(), str::to_string)
}

/// 테스트용 — 기본값이 시스템 시간대가 된 뒤로 **Seoul 을 가정하고 쓰인 테스트**는
/// 초기화 전에 이걸로 시간대를 못박는다 (러너는 UTC, 개발 머신은 Seoul — 못박지
/// 않으면 같은 테스트가 머신마다 다른 날짜를 본다).
#[cfg(test)]
pub(crate) async fn init_project_in_seoul(
    manager: &crate::oculpm::manager::OculpmManager,
    project_id: u32,
    root: &std::path::Path,
) {
    let path = root.join(".oculpm").join("config.toml");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut cfg = crate::oculpm::spec::OculpmConfig::default_for_new_project();
    cfg.workday.timezone = FALLBACK_TIMEZONE.to_string();
    cfg.save(&path).unwrap();
    manager.init_project(project_id, root, "ko").await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_zone_wins_when_tz_is_unset() {
        assert_eq!(resolve(None, Some("America/New_York")), "America/New_York");
        assert_eq!(resolve(None, Some("Etc/UTC")), "Etc/UTC");
    }

    #[test]
    fn tz_env_wins_over_the_system_zone() {
        assert_eq!(
            resolve(Some("Europe/Berlin"), Some("Asia/Seoul")),
            "Europe/Berlin"
        );
        // POSIX 의 `:` 접두는 벗긴다.
        assert_eq!(resolve(Some(":Asia/Tokyo"), None), "Asia/Tokyo");
    }

    /// POSIX 규칙 문자열·빈 값·쓰레기는 IANA 이름이 아니다 — 다음 후보로.
    #[test]
    fn non_iana_candidates_are_skipped() {
        assert_eq!(resolve(Some("KST-9"), Some("Europe/Paris")), "Europe/Paris");
        assert_eq!(resolve(Some(""), Some("  ")), FALLBACK_TIMEZONE);
        assert_eq!(resolve(None, Some("Not/AZone")), FALLBACK_TIMEZONE);
    }

    #[test]
    fn nothing_usable_falls_back_to_seoul() {
        assert_eq!(resolve(None, None), "Asia/Seoul");
    }

    /// 실제 환경에서 고른 값도 워크데이 해석기가 받는 이름이어야 한다 — 러너
    /// 3종(macOS·Windows·Linux)이 각자의 판별 경로로 이걸 지난다.
    #[test]
    fn the_live_default_is_a_valid_zone() {
        let tz = default_timezone();
        assert!(
            crate::oculpm::paths::WorkdayResolver::new(&tz, "00:00").is_ok(),
            "{tz}"
        );
    }

    use crate::oculpm::spec::OculpmConfig;

    /// 파일에 적힌 시간대는 기본값이 무엇이든 그대로다 — 읽기·저장 왕복까지.
    /// 시스템 시간대와 **다른** 값을 골라 기본값이 새어 들지 않음을 본다.
    #[test]
    fn a_written_timezone_is_never_replaced() {
        let written = if default_timezone() == "Pacific/Chatham" {
            "America/Anchorage"
        } else {
            "Pacific/Chatham"
        };
        let text = format!("[workday]\ntimezone = \"{written}\"\n");
        let cfg = OculpmConfig::from_toml_str(&text).unwrap();
        assert_eq!(cfg.workday.timezone, written);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, &text).unwrap();
        cfg.save(&path).unwrap();
        let reread = OculpmConfig::load(&path).unwrap();
        assert_eq!(reread.workday.timezone, written);
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains(&format!("timezone = \"{written}\"")));
    }

    /// 빈 칸(키 없음·섹션 없음)과 새 프로젝트는 기본값을 받는다.
    #[test]
    fn missing_timezone_and_new_projects_take_the_default() {
        let no_key = OculpmConfig::from_toml_str("[workday]\nday_starts_at = \"04:00\"\n").unwrap();
        assert_eq!(no_key.workday.timezone, default_timezone());
        assert_eq!(no_key.workday.day_starts_at, "04:00");

        let no_section = OculpmConfig::from_toml_str("schema_version = 1\n").unwrap();
        assert_eq!(no_section.workday.timezone, default_timezone());

        let fresh = OculpmConfig::default_for_new_project();
        assert_eq!(fresh.workday.timezone, default_timezone());
    }
}
