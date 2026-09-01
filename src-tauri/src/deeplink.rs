//! `oculpm://` 딥링크 (Osaurus 라운드 Phase 6 #deep-link).
//!
//! 웹에서 앱으로 오는 유일한 길이다 — 그래서 **가장 좁은 문**이어야 한다.
//! 규약 하나로 요약된다: **무확인 실행 0.** 딥링크는 무엇도 실행하지 않고,
//! 앱을 포커스한 뒤 확인 시트를 띄우는 것까지만 한다. 실제 설치는 사용자가
//! 누른 뒤 기존 커맨드(`plugin_import`·`theme_import`·…)가 한다.
//!
//! ```text
//! oculpm://skill/install?source=<owner/repo>&name=<skill>
//! oculpm://theme/install?url=<https…json>
//! oculpm://plugin/install?source=<owner/repo>
//! oculpm://open?project=<path>&view=journal&entry=<path>
//! ```
//!
//! 이 모듈은 **파싱만** 한다. 파싱이 순수 함수라 "어떤 링크가 통과하는가" 를
//! 창 없이 전부 단언할 수 있다 — 보안 규약은 테스트가 지킨다.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Emitter;

pub const SCHEME: &str = "oculpm";
/// 테마 파일을 받아올 수 있는 호스트. https 인 것만으로는 부족하다 —
/// 임의 서버가 우리 앱에 파일을 밀어 넣는 길을 열어 두지 않는다.
pub const THEME_HOSTS: &[&str] = &["oculpm.com", "www.oculpm.com", "raw.githubusercontent.com"];
/// URL 전체 길이 상한 (터무니없는 입력 가드).
const MAX_URL_BYTES: usize = 2_048;

/// 확인 시트가 받는 요청. **실행이 아니라 제안**이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum DeepLink {
    /// 번들에서 스킬 하나만 (`name` 이 없으면 번들 전체와 같다).
    SkillInstall {
        source: String,
        name: Option<String>,
    },
    ThemeInstall {
        url: String,
    },
    PluginInstall {
        source: String,
    },
    /// 이미 **등록된** 프로젝트를 연다. 경로로 새 프로젝트를 추가하지 않는다.
    Open {
        project: String,
        view: Option<String>,
        entry: Option<String>,
    },
}

/// 프런트가 받는 이벤트. 앱이 이미 떠 있으면 기존 창으로 라우팅된다.
#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
pub struct DeepLinkReceived(pub DeepLink);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    /// 우리 스킴이 아니다.
    Scheme,
    /// 아는 경로가 아니다.
    Route(String),
    /// 값이 규약을 어겼다 (임의 URL·owner/repo 아님·화이트리스트 밖).
    Value(String),
}

/// 텍스트 한 줄 → 요청. **여기를 통과하지 못하면 앱은 아무 일도 하지 않는다.**
pub fn parse(raw: &str) -> Result<DeepLink, LinkError> {
    if raw.len() > MAX_URL_BYTES {
        return Err(LinkError::Value("url too long".into()));
    }
    let rest = raw
        .strip_prefix(&format!("{SCHEME}://"))
        .ok_or(LinkError::Scheme)?;

    let (path, query) = match rest.split_once('?') {
        Some((p, q)) => (p, q),
        None => (rest, ""),
    };
    let path = path.trim_end_matches('/');
    let params = parse_query(query);
    let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());

    match path {
        "skill/install" => Ok(DeepLink::SkillInstall {
            source: github_source(get("source"))?,
            name: get("name").filter(|n| is_plain_name(n)),
        }),
        "plugin/install" => Ok(DeepLink::PluginInstall {
            source: github_source(get("source"))?,
        }),
        "theme/install" => Ok(DeepLink::ThemeInstall {
            url: theme_url(get("url"))?,
        }),
        "open" => {
            let project = get("project").ok_or(LinkError::Value("project is required".into()))?;
            if project.is_empty() {
                return Err(LinkError::Value("project is required".into()));
            }
            Ok(DeepLink::Open {
                project,
                view: get("view").filter(|v| is_plain_name(v)),
                entry: get("entry"),
            })
        }
        other => Err(LinkError::Route(other.to_string())),
    }
}

/// `owner/repo` 만. URL 을 넣으면 거절이다 — 이 한 줄이 "임의 URL 실행 금지"
/// 규약의 전부다. `plugins::source` 와 **같은 파서**를 쓴다.
fn github_source(raw: Option<String>) -> Result<String, LinkError> {
    let raw = raw.ok_or(LinkError::Value("source is required".into()))?;
    crate::plugins::source::parse_github(&raw)
        .map(|s| s.slug())
        .ok_or(LinkError::Value(format!("expected owner/repo, got: {raw}")))
}

fn theme_url(raw: Option<String>) -> Result<String, LinkError> {
    let raw = raw.ok_or(LinkError::Value("url is required".into()))?;
    validate_theme_url(&raw)
}

/// https + 호스트 화이트리스트. 스킴만 보면 임의 서버가 통과한다.
///
/// 딥링크와 `theme_import_url` 이 **같은 문**을 지난다 (Phase 8
/// `#landing-themes`) — 검사가 둘이면 하나는 반드시 뒤처진다.
pub fn validate_theme_url(raw: &str) -> Result<String, LinkError> {
    if raw.len() > MAX_URL_BYTES {
        return Err(LinkError::Value("url too long".into()));
    }
    let rest = raw
        .strip_prefix("https://")
        .ok_or(LinkError::Value("theme url must be https".into()))?;
    let host = rest
        .split('/')
        .next()
        .unwrap_or_default()
        .split('@')
        .next_back()
        .unwrap_or_default();
    // 포트·대문자 변종까지 같은 판정을 받게 정규화한다.
    let host = host
        .split(':')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !THEME_HOSTS.contains(&host.as_str()) {
        return Err(LinkError::Value(format!("host not allowed: {host}")));
    }
    Ok(raw.to_string())
}

/// 경로·구분자·제어문자가 없는 단순 이름인가.
fn is_plain_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && s != "."
        && s != ".."
}

fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|p| !p.is_empty())
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            Some((percent_decode(k), percent_decode(v)))
        })
        .collect()
}

/// 최소 퍼센트 디코딩. `+` 는 공백으로 보지 않는다 — 경로에 `+` 가 들어가면
/// 그대로 `+` 여야 한다.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 링크 하나를 프런트로 넘긴다. **여기서 무엇도 실행하지 않는다** — 창을
/// 앞으로 불러오고 확인 시트를 띄우게 하는 것이 전부다.
pub fn dispatch(app: &tauri::AppHandle, raw: &str) {
    let link = match parse(raw) {
        Ok(link) => link,
        Err(e) => {
            tracing::warn!(url = raw, error = ?e, "deep link refused");
            return;
        }
    };
    // 앱을 앞으로 부른다 — 확인 시트가 배경 창에서 조용히 뜨면 «무확인» 과
    // 다를 바 없다. 포커스 창이 없으면 아무 창이나 하나 세운다.
    use tauri::Manager;
    let label = crate::commands::window::focused_app_window(app);
    let window = label
        .and_then(|l| app.get_webview_window(&l))
        .or_else(|| app.webview_windows().values().next().cloned());
    if let Some(window) = window {
        let _ = window.set_focus();
    }
    let _ = app.emit("deep-link-received", DeepLinkReceived(link));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_four_documented_routes() {
        assert_eq!(
            parse("oculpm://plugin/install?source=owner/repo").unwrap(),
            DeepLink::PluginInstall {
                source: "owner/repo".into()
            }
        );
        assert_eq!(
            parse("oculpm://skill/install?source=o/r&name=run-evals").unwrap(),
            DeepLink::SkillInstall {
                source: "o/r".into(),
                name: Some("run-evals".into())
            }
        );
        assert_eq!(
            parse("oculpm://theme/install?url=https://oculpm.com/themes/nord.json").unwrap(),
            DeepLink::ThemeInstall {
                url: "https://oculpm.com/themes/nord.json".into()
            }
        );
        assert_eq!(
            parse("oculpm://open?project=%2FUsers%2Fme%2Fproj&view=journal").unwrap(),
            DeepLink::Open {
                project: "/Users/me/proj".into(),
                view: Some("journal".into()),
                entry: None,
            }
        );
    }

    #[test]
    fn refuses_an_arbitrary_url_as_a_source() {
        for bad in [
            "oculpm://plugin/install?source=https://evil.test/x.zip",
            "oculpm://plugin/install?source=../../etc",
            "oculpm://plugin/install?source=o/r/extra",
            "oculpm://plugin/install",
            "oculpm://skill/install?source=",
        ] {
            assert!(
                matches!(parse(bad), Err(LinkError::Value(_))),
                "{bad} must be refused"
            );
        }
    }

    /// `theme_import_url` 은 딥링크를 지나지 않고도 불릴 수 있는 커맨드다
    /// (프런트가 승인 뒤에만 부르지만, 그건 규율이지 구조가 아니다).
    /// 그래서 **같은 검사기**를 커맨드 쪽에서도 다시 지난다 (Phase 8).
    #[test]
    fn validate_theme_url_is_the_same_gate_the_deep_link_uses() {
        assert!(validate_theme_url("https://oculpm.com/themes/ink.json").is_ok());
        assert!(validate_theme_url("http://oculpm.com/themes/ink.json").is_err());
        assert!(validate_theme_url("https://evil.test/ink.json").is_err());
        assert!(validate_theme_url("https://oculpm.com@evil.test/ink.json").is_err());
        assert!(validate_theme_url(&format!("https://oculpm.com/{}", "a".repeat(4096))).is_err());
    }

    #[test]
    fn theme_urls_must_be_https_and_on_the_allowlist() {
        assert!(parse("oculpm://theme/install?url=http://oculpm.com/a.json").is_err());
        assert!(parse("oculpm://theme/install?url=https://evil.test/a.json").is_err());
        assert!(parse("oculpm://theme/install?url=file:///etc/passwd").is_err());
        // 자격증명 트릭 — `@` 앞은 사용자 정보이고 진짜 호스트는 그 뒤다.
        assert!(parse("oculpm://theme/install?url=https://oculpm.com@evil.test/a.json").is_err());
        assert!(parse("oculpm://theme/install?url=https://OCULPM.com:443/a.json").is_ok());
        assert!(parse(
            "oculpm://theme/install?url=https://raw.githubusercontent.com/o/r/main/t.json"
        )
        .is_ok());
    }

    #[test]
    fn refuses_a_foreign_scheme_and_an_unknown_route() {
        assert_eq!(
            parse("https://oculpm.com/x").unwrap_err(),
            LinkError::Scheme
        );
        assert!(matches!(
            parse("oculpm://run/shell?cmd=rm").unwrap_err(),
            LinkError::Route(_)
        ));
    }

    #[test]
    fn drops_a_name_or_view_that_is_not_a_plain_word() {
        let link = parse("oculpm://skill/install?source=o/r&name=../../evil").unwrap();
        assert_eq!(
            link,
            DeepLink::SkillInstall {
                source: "o/r".into(),
                name: None
            },
            "a path-shaped name is dropped, not carried through"
        );
    }

    #[test]
    fn open_needs_a_project_and_never_invents_one() {
        assert!(parse("oculpm://open?view=journal").is_err());
        assert!(parse("oculpm://open?project=").is_err());
    }

    #[test]
    fn a_url_over_the_length_cap_is_refused_before_parsing() {
        let long = format!("oculpm://open?project={}", "a".repeat(MAX_URL_BYTES));
        assert!(matches!(parse(&long), Err(LinkError::Value(_))));
    }
}
