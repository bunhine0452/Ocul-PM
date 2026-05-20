//! Minimal GitHub REST API client. Currently used to verify the user's PAT and
//! fetch profile metadata. Extend with PR/issue/commit fetchers as needed.

use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.github.com";
const USER_AGENT: &str = concat!("ai-pm/", env!("CARGO_PKG_VERSION"));

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
