//! Minimal GitHub REST API client. Currently used to verify the user's PAT and
//! fetch profile metadata. Extend with PR/issue/commit fetchers as needed.

use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.github.com";
const USER_AGENT: &str = concat!("ocul-pm/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GithubUser {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GithubRateLimit {
    pub limit: u32,
    pub remaining: u32,
    /// Unix timestamp when the window resets.
    pub reset: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GithubVerifyResult {
    pub user: GithubUser,
    pub rate_limit: GithubRateLimit,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GithubRelease {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
    pub draft: bool,
    pub prerelease: bool,
    pub author_login: Option<String>,
}

/// Raw shape returned by the REST API — narrowed to the fields we care about.
#[derive(Debug, Deserialize)]
struct ReleaseRaw {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
    author: Option<AuthorRaw>,
}

#[derive(Debug, Deserialize)]
struct AuthorRaw {
    login: String,
}

fn auth_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .expect("reqwest client build")
}

fn read_u32(headers: &HeaderMap, name: &str) -> u32 {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn read_i32(headers: &HeaderMap, name: &str) -> i32 {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn rate_limit_from(headers: &HeaderMap) -> GithubRateLimit {
    GithubRateLimit {
        limit: read_u32(headers, "x-ratelimit-limit"),
        remaining: read_u32(headers, "x-ratelimit-remaining"),
        reset: read_i32(headers, "x-ratelimit-reset"),
    }
}

/// Hits `GET /user` to confirm the token is valid and grab the user profile.
pub async fn verify_token(token: &str) -> Result<GithubVerifyResult, String> {
    let resp = auth_client()
        .get(format!("{API_BASE}/user"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("Authorization", format!("Bearer {}", token.trim()))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = resp.status();
    let headers = resp.headers().clone();

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let detail = if status.as_u16() == 401 {
            "Token rejected (401). Make sure the PAT has the `read:user` scope."
                .to_string()
        } else {
            format!("GitHub returned {}: {}", status, body)
        };
        return Err(detail);
    }

    let user: GithubUser = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse /user response: {e}"))?;

    Ok(GithubVerifyResult {
        user,
        rate_limit: rate_limit_from(&headers),
    })
}

/// Fetches up to `per_page` releases for a repo (latest first). Works for
/// public repos without a token; private repos need `repo` scope on the PAT.
pub async fn list_releases(
    owner: &str,
    repo: &str,
    per_page: u32,
    token: Option<&str>,
) -> Result<Vec<GithubRelease>, String> {
    let url = format!(
        "{API_BASE}/repos/{owner}/{repo}/releases?per_page={}",
        per_page.clamp(1, 100)
    );
    let mut req = auth_client()
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {}", t.trim()));
    }

    let resp = req.send().await.map_err(|e| format!("Network error: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(if status.as_u16() == 404 {
            format!("Repo {owner}/{repo} not found (404). Private repos require a token with `repo` scope.")
        } else {
            format!("GitHub returned {}: {}", status, body)
        });
    }

    let raw: Vec<ReleaseRaw> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse releases: {e}"))?;

    Ok(raw
        .into_iter()
        .map(|r| GithubRelease {
            tag_name: r.tag_name,
            name: r.name,
            body: r.body,
            html_url: r.html_url,
            published_at: r.published_at,
            draft: r.draft,
            prerelease: r.prerelease,
            author_login: r.author.map(|a| a.login),
        })
        .collect())
}
