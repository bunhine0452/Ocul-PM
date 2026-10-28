//! `oculpm://` 딥링크 (Osaurus 라운드 Phase 6 #deep-link).
//!
//! 웹에서 앱으로 오는 유일한 길이다 — 그래서 **가장 좁은 문**이어야 한다.
//! 규약 하나로 요약된다: **무확인 실행 0.** 딥링크는 무엇도 실행하지 않고,
//! 앱을 포커스한 뒤 확인 시트를 띄우는 것까지만 한다. 열기는 사용자가 누른 뒤에
//! 기존 커맨드(`open_project_nav`)가 한다.
//!
//! ```text
//! oculpm://open?project=<path>&view=journal
//! ```
//!
//! 스킬·플러그인 설치 링크(`skill/install` · `plugin/install`)는 4.0 에서 번들 임포트와
//! 함께 걷었다 — 옛 링크가 와도 모르는 경로로 거절되고 아무것도 받아오지 않는다.
//!
//! 이 모듈은 **파싱만** 한다. 파싱이 순수 함수라 "어떤 링크가 통과하는가" 를
//! 창 없이 전부 단언할 수 있다 — 보안 규약은 테스트가 지킨다.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Emitter;

use crate::text::percent_decode;

pub const SCHEME: &str = "oculpm";
/// URL 전체 길이 상한 (터무니없는 입력 가드).
const MAX_URL_BYTES: usize = 2_048;

/// 확인 시트가 받는 요청. **실행이 아니라 제안**이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum DeepLink {
    /// 이미 **등록된** 프로젝트를 연다. 경로로 새 프로젝트를 추가하지 않는다.
    Open {
        project: String,
        view: Option<String>,
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
    /// 값이 규약을 어겼다 (빈 값·경로 모양 이름).
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
        "open" => {
            let project = get("project").ok_or(LinkError::Value("project is required".into()))?;
            if project.is_empty() {
                return Err(LinkError::Value("project is required".into()));
            }
            Ok(DeepLink::Open {
                project,
                view: get("view").filter(|v| is_plain_name(v)),
            })
        }
        other => Err(LinkError::Route(other.to_string())),
    }
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

/// 프로세스 인자에서 우리 링크를 고른다 (Windows·Linux).
///
/// 두 OS 는 `oculpm://…` 를 **새 프로세스의 인자**로 넘긴다 — 설치 관리자가
/// 등록한 명령이 `"<exe>" "%1"`(Windows 레지스트리) / `Exec=<exe> %u`(Linux
/// `.desktop`)이다. 앱이 이미 떠 있으면 그 새 프로세스는 single-instance 가
/// 곧바로 끝내고 인자만 첫 인스턴스에 넘기므로, 링크는 여기서 건져야 한다.
/// (macOS 는 인자가 아니라 Apple Event 로 온다 — 플러그인의 `on_open_url`.)
///
/// 첫 인자는 실행 파일 경로라 건너뛴다. 스킴은 대소문자를 가리지 않고 읽되
/// 소문자로 고쳐 [`parse`] 에 넘긴다 — 확인 시트를 여는 것까지가 이 함수의 몫이
/// 아니라, **거절도 [`parse`] 한 곳**이 한다. 순수 함수라 세 OS 에서 테스트한다.
pub fn links_in_argv<S: AsRef<str>>(argv: &[S]) -> Vec<String> {
    let prefix = format!("{SCHEME}://");
    argv.iter()
        .skip(1)
        .map(|arg| arg.as_ref().trim())
        .filter_map(|arg| {
            let head = arg.get(..prefix.len())?;
            head.eq_ignore_ascii_case(&prefix)
                .then(|| format!("{prefix}{}", &arg[prefix.len()..]))
        })
        .collect()
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

    /// 회귀 (2026-09-07 감사) — 쿼리 디코더가 `%` 뒤의 멀티바이트 문자에서
    /// 패닉했다. **웹페이지가 링크 한 줄로 유발할 수 있는** 자리였다: 딥링크는
    /// `on_open_url` 콜백에서 파싱되므로 앱이 떠 있기만 하면 닿는다.
    ///
    /// 파싱 결과가 무엇이든 상관없다 — 이 테스트가 지키는 것은 "죽지 않는다"
    /// 하나다.
    #[test]
    fn a_crafted_query_cannot_panic_the_parser() {
        for raw in [
            "oculpm://open?project=%한",
            "oculpm://open?project=%한x&view=journal",
            "oculpm://open?project=ok&entry=%🙂",
            "oculpm://open?%한=%한",
        ] {
            let _ = parse(raw);
        }
        // 정상 이스케이프는 여전히 풀린다.
        let link = parse("oculpm://open?project=%2Ftmp%2Fp").unwrap();
        assert_eq!(
            link,
            DeepLink::Open {
                project: "/tmp/p".into(),
                view: None
            }
        );
    }

    #[test]
    fn parses_the_one_documented_route() {
        assert_eq!(
            parse("oculpm://open?project=%2FUsers%2Fme%2Fproj&view=journal").unwrap(),
            DeepLink::Open {
                project: "/Users/me/proj".into(),
                view: Some("journal".into()),
            }
        );
    }

    /// 4.0 에서 걷은 설치 링크 — 옛 랜딩·웹의 링크가 와도 모르는 경로로 거절된다.
    #[test]
    fn the_retired_install_routes_are_unknown() {
        for retired in [
            "oculpm://plugin/install?source=owner/repo",
            "oculpm://skill/install?source=o/r&name=run-evals",
        ] {
            assert!(
                matches!(parse(retired), Err(LinkError::Route(_))),
                "{retired} must be refused"
            );
        }
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
        // 원격 테마 설치(`theme/install`)는 2026-10-24 에 걷었다 — 옛 랜딩의
        // 링크가 와도 모르는 경로로 거절되고 아무것도 받아오지 않는다.
        assert!(matches!(
            parse("oculpm://theme/install?url=https://oculpm.com/themes/ink.json").unwrap_err(),
            LinkError::Route(_)
        ));
    }

    #[test]
    fn drops_a_view_that_is_not_a_plain_word() {
        let link = parse("oculpm://open?project=%2Fp&view=../../evil").unwrap();
        assert_eq!(
            link,
            DeepLink::Open {
                project: "/p".into(),
                view: None
            },
            "a path-shaped view is dropped, not carried through"
        );
    }

    #[test]
    fn open_needs_a_project_and_never_invents_one() {
        assert!(parse("oculpm://open?view=journal").is_err());
        assert!(parse("oculpm://open?project=").is_err());
    }

    /// Windows 레지스트리 명령 `"<exe>" "%1"` 과 Linux `Exec=<exe> %u` 가 만드는
    /// 인자 — 두 번째 인스턴스가 첫 인스턴스에 넘기는 모양 그대로.
    #[test]
    fn links_are_picked_from_a_second_instance_argv() {
        let windows = [
            r"C:\Users\kim\AppData\Local\Ocul-PM\ocul-pm.exe",
            "oculpm://open?project=C%3A%5Cwork%5Capp&view=journal",
        ];
        assert_eq!(
            links_in_argv(&windows),
            vec!["oculpm://open?project=C%3A%5Cwork%5Capp&view=journal".to_string()]
        );
        // 그 결과가 그대로 파서를 통과한다 — 경로는 퍼센트 디코딩된다.
        assert_eq!(
            parse(&links_in_argv(&windows)[0]).unwrap(),
            DeepLink::Open {
                project: r"C:\work\app".into(),
                view: Some("journal".into()),
            }
        );

        let linux = ["/usr/bin/ocul-pm", "oculpm://open?project=%2Fp"];
        assert_eq!(
            links_in_argv(&linux),
            vec!["oculpm://open?project=%2Fp".to_string()]
        );
    }

    #[test]
    fn argv_without_a_link_yields_nothing() {
        // 평범한 두 번째 실행 · 앱이 쓰는 플래그 · 다른 스킴 · 빈 인자.
        for argv in [
            vec!["/usr/bin/ocul-pm"],
            vec!["ocul-pm.exe", "--pty-host"],
            vec!["ocul-pm", "https://oculpm.com/x", "", "oculpm:/open"],
            vec![],
        ] {
            assert!(links_in_argv(&argv).is_empty(), "{argv:?}");
        }
    }

    /// 실행 파일 자리(첫 인자)는 링크처럼 생겨도 보지 않는다. 스킴 대소문자는
    /// 풀어 주되, **판정은 여전히 `parse` 가** 한다 — 모르는 경로는 거절된다.
    #[test]
    fn argv_scheme_is_case_insensitive_and_parse_still_decides() {
        let argv = [
            "oculpm://open?project=exe-slot",
            "OCULPM://open?project=%2Fp",
            "  Oculpm://run/shell?cmd=rm  ",
            "oculpm://한글",
        ];
        let links = links_in_argv(&argv);
        assert_eq!(
            links,
            vec![
                "oculpm://open?project=%2Fp".to_string(),
                "oculpm://run/shell?cmd=rm".to_string(),
                "oculpm://한글".to_string(),
            ]
        );
        assert!(parse(&links[0]).is_ok());
        assert!(matches!(parse(&links[1]), Err(LinkError::Route(_))));
        assert!(parse(&links[2]).is_err());
    }

    #[test]
    fn a_url_over_the_length_cap_is_refused_before_parsing() {
        let long = format!("oculpm://open?project={}", "a".repeat(MAX_URL_BYTES));
        assert!(matches!(parse(&long), Err(LinkError::Value(_))));
    }
}
