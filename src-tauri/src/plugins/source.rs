//! 번들 출처 — GitHub `owner/repo` 또는 로컬 zip (Osaurus 라운드 Phase 6).
//!
//! **임의 URL 을 받지 않는다.** 딥링크(`oculpm://plugin/install?source=…`)가
//! 같은 파서를 쓰므로, 여기서 `owner/repo` 형태만 통과시키면 웹에서 오는
//! 입력도 같은 좁은 문을 지난다.

use serde::{Deserialize, Serialize};
use specta::Type;

/// GitHub 비인증 레이트 리밋 (시간당). 초과 시 언제 풀리는지 보여 준다.
pub const GITHUB_ANON_LIMIT: u32 = 60;
/// 다운로드 바이트 상한 — 압축 상태 기준. 풀린 뒤 상한은 `archive` 가 본다.
pub const MAX_DOWNLOAD_BYTES: u64 = 16 * 1024 * 1024;
/// 시도하는 기본 브랜치 순서.
const BRANCHES: [&str; 2] = ["main", "master"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GithubSource {
    pub owner: String,
    pub repo: String,
}

impl GithubSource {
    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }
    pub fn zip_url(&self, branch: &str) -> String {
        format!(
            "https://codeload.github.com/{}/{}/zip/refs/heads/{branch}",
            self.owner, self.repo
        )
    }
}

/// `owner/repo` 만 받는다. URL·경로·`..`·와일드카드는 전부 거절이다.
pub fn parse_github(raw: &str) -> Option<GithubSource> {
    let trimmed = raw.trim().trim_end_matches('/');
    let mut parts = trimmed.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let ok = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
            && s != "."
            && s != ".."
    };
    (ok(owner) && ok(repo)).then(|| GithubSource {
        owner: owner.to_string(),
        repo: repo.to_string(),
    })
}

#[derive(Debug)]
pub enum FetchError {
    /// 저장소를 못 찾았다 (혹은 비공개).
    NotFound(String),
    /// GitHub 레이트 리밋. `retry_after_secs` 가 있으면 언제 풀리는지 안다.
    RateLimited {
        retry_after_secs: Option<u64>,
    },
    TooLarge(u64),
    Network(String),
}

impl FetchError {
    pub fn code(&self) -> &'static str {
        match self {
            FetchError::NotFound(_) => "bundle_not_found",
            FetchError::RateLimited { .. } => "github_rate_limited",
            FetchError::TooLarge(_) => "bundle_too_large",
            FetchError::Network(_) => "bundle_network",
        }
    }
    pub fn detail(&self) -> String {
        match self {
            FetchError::NotFound(s) => format!("repository not found or private: {s}"),
            FetchError::RateLimited { retry_after_secs } => match retry_after_secs {
                Some(s) => format!("GitHub rate limit reached; retry in {s}s"),
                None => {
                    format!("GitHub rate limit reached ({GITHUB_ANON_LIMIT}/hour without a token)")
                }
            },
            FetchError::TooLarge(n) => format!("{n} bytes exceeds the download limit"),
            FetchError::Network(e) => format!("download failed: {e}"),
        }
    }
}

/// 기본 브랜치(main → master)를 차례로 시도해 zip 바이트를 받는다.
pub async fn fetch_github_zip(src: &GithubSource) -> Result<Vec<u8>, FetchError> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("ocul-pm/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| FetchError::Network(e.to_string()))?;

    let mut last = FetchError::NotFound(src.slug());
    for branch in BRANCHES {
        match try_branch(&client, src, branch).await {
            Ok(bytes) => return Ok(bytes),
            // 레이트 리밋·크기는 브랜치를 바꿔도 같다 — 즉시 포기한다.
            Err(e @ (FetchError::RateLimited { .. } | FetchError::TooLarge(_))) => return Err(e),
            Err(e) => last = e,
        }
    }
    Err(last)
}

async fn try_branch(
    client: &reqwest::Client,
    src: &GithubSource,
    branch: &str,
) -> Result<Vec<u8>, FetchError> {
    let res = client
        .get(src.zip_url(branch))
        .send()
        .await
        .map_err(|e| FetchError::Network(e.to_string()))?;

    if res.status() == reqwest::StatusCode::FORBIDDEN
        || res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        let retry_after_secs = res
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok());
        return Err(FetchError::RateLimited { retry_after_secs });
    }
    if !res.status().is_success() {
        return Err(FetchError::NotFound(format!(
            "{} ({})",
            src.slug(),
            res.status()
        )));
    }
    // Content-Length 가 있으면 받기 전에 자른다.
    if let Some(len) = res.content_length() {
        if len > MAX_DOWNLOAD_BYTES {
            return Err(FetchError::TooLarge(len));
        }
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| FetchError::Network(e.to_string()))?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(FetchError::TooLarge(bytes.len() as u64));
    }
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_owner_slash_repo() {
        assert_eq!(
            parse_github("bunhine0452/Ocul-PM").map(|s| s.slug()),
            Some("bunhine0452/Ocul-PM".into())
        );
        assert!(
            parse_github("owner/repo/").is_some(),
            "a trailing slash is fine"
        );
        for bad in [
            "https://github.com/o/r",
            "owner",
            "owner/repo/extra",
            "../../etc",
            "owner/",
            "/repo",
            "own er/repo",
            "owner/re*po",
        ] {
            assert!(parse_github(bad).is_none(), "{bad} must be refused");
        }
    }

    #[test]
    fn builds_a_codeload_url_and_never_an_arbitrary_one() {
        let s = parse_github("o/r").unwrap();
        assert_eq!(
            s.zip_url("main"),
            "https://codeload.github.com/o/r/zip/refs/heads/main"
        );
    }

    #[test]
    fn rate_limit_says_when_it_lifts_when_github_tells_us() {
        let with = FetchError::RateLimited {
            retry_after_secs: Some(120),
        };
        assert!(with.detail().contains("120s"));
        let without = FetchError::RateLimited {
            retry_after_secs: None,
        };
        assert!(without.detail().contains("60/hour"));
    }
}
