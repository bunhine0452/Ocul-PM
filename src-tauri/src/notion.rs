//! PR-CI7 — Notion 내보내기 v1 (docs/claude-integration/00-master-plan.md D6).
//!
//! 공식 Notion MCP 는 OAuth 전용이라 데스크탑 앱의 무인 내보내기에 부적합 —
//! 사용자가 워크스페이스에서 발급한 **internal integration token** 을 키체인
//! ([`NOTION_TOKEN_SECRET`], `secrets.rs` 규약 — DB/localStorage 금지)에 두고
//! REST 로 **페이지 단위** 생성만 한다 (블록 CRUD 없음 전제와 정합). 자동
//! 동기화가 아니라 회고 화면의 명시적 버튼으로만 호출된다.
//!
//! 마크다운→블록 변환은 의도적으로 손실 허용(v1): 헤딩/불릿/번호/인용/코드
//! 펜스/구분선만 구조화하고 나머지는 문단으로 보낸다. Notion 제한(요청당
//! children 100, rich_text 2000자)은 상한·분할로 방어한다.

use serde_json::{json, Value};

/// 키체인 시크릿 이름 — 기존 `secret_set`/`secret_verify` 커맨드로 관리된다.
pub const NOTION_TOKEN_SECRET: &str = "notion_api_key";
/// 부모 페이지 설정 키 (SQLite settings — 시크릿 아님).
pub const NOTION_PARENT_SETTING: &str = "notion_parent_page_id";
const NOTION_VERSION: &str = "2022-06-28";
const API_BASE: &str = "https://api.notion.com/v1";
/// 페이지 생성 1회의 블록 상한 (Notion children 100 제한 아래 여유).
const MAX_BLOCKS: usize = 95;
/// rich_text 한 조각의 문자 상한 (Notion 2000 제한 아래 여유).
const MAX_TEXT_CHARS: usize = 1900;

// ─────────────────────────────────────────────────────────────────────────────
// 마크다운 → Notion 블록 (pure)
// ─────────────────────────────────────────────────────────────────────────────

/// plain text 조각들을 rich_text 배열로 (2000자 제한 분할).
fn rich_text(text: &str) -> Value {
    let mut parts = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        parts.push(json!({ "type": "text", "text": { "content": "" } }));
    }
    for chunk in chars.chunks(MAX_TEXT_CHARS) {
        let s: String = chunk.iter().collect();
        parts.push(json!({ "type": "text", "text": { "content": s } }));
    }
    Value::Array(parts)
}

fn block(kind: &str, text: &str) -> Value {
    json!({ "object": "block", "type": kind, kind: { "rich_text": rich_text(text) } })
}

/// 코드펜스 언어 → Notion `code.language` (미지의 언어는 plain text 폴백 —
/// Notion 이 미지원 언어명을 400 으로 거부한다).
fn code_language(fence: &str) -> &'static str {
    match fence.trim().to_lowercase().as_str() {
        "rust" | "rs" => "rust",
        "ts" | "typescript" | "tsx" => "typescript",
        "js" | "javascript" | "jsx" => "javascript",
        "py" | "python" => "python",
        "sh" | "bash" | "zsh" | "shell" => "shell",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "markdown", // Notion 에 toml 이 없다 — 가장 가까운 렌더로.
        "sql" => "sql",
        "go" => "go",
        "md" | "markdown" => "markdown",
        "html" => "html",
        "css" => "css",
        _ => "plain text",
    }
}

/// 마크다운을 Notion 블록 배열로 바꾼다. [`MAX_BLOCKS`] 초과분은 잘라내고
/// 안내 문단을 남긴다 (조용한 절단 금지).
pub fn markdown_to_blocks(markdown: &str) -> Vec<Value> {
    let mut blocks: Vec<Value> = Vec::new();
    let mut lines = markdown.lines().peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim_end();
        let lead = trimmed.trim_start();
        if lead.is_empty() {
            continue;
        }
        // 코드펜스 — 닫힘까지 통째로 code 블록.
        if let Some(fence) = lead.strip_prefix("```") {
            let mut body = String::new();
            for code_line in lines.by_ref() {
                if code_line.trim_start().starts_with("```") {
                    break;
                }
                body.push_str(code_line);
                body.push('\n');
            }
            blocks.push(json!({
                "object": "block",
                "type": "code",
                "code": { "rich_text": rich_text(body.trim_end()), "language": code_language(fence) }
            }));
        } else if lead == "---" || lead == "***" {
            blocks.push(json!({ "object": "block", "type": "divider", "divider": {} }));
        } else if let Some(h) = lead.strip_prefix("### ") {
            blocks.push(block("heading_3", h));
        } else if let Some(h) = lead.strip_prefix("## ") {
            blocks.push(block("heading_2", h));
        } else if let Some(h) = lead.strip_prefix("# ") {
            blocks.push(block("heading_1", h));
        } else if let Some(item) = lead.strip_prefix("- ").or_else(|| lead.strip_prefix("* ")) {
            blocks.push(block("bulleted_list_item", item));
        } else if let Some(q) = lead.strip_prefix("> ") {
            blocks.push(block("quote", q));
        } else if is_numbered_item(lead) {
            let item = lead.splitn(2, ". ").nth(1).unwrap_or(lead);
            blocks.push(block("numbered_list_item", item));
        } else {
            // 표를 포함한 나머지는 문단 폴백 (v1 손실 허용 — 원문 줄 보존).
            blocks.push(block("paragraph", lead));
        }
        if blocks.len() >= MAX_BLOCKS {
            blocks.push(block("paragraph", "… (Notion 내보내기 길이 제한으로 뒷부분이 잘렸습니다)"));
            break;
        }
    }
    if blocks.is_empty() {
        blocks.push(block("paragraph", "(내용 없음)"));
    }
    blocks
}

fn is_numbered_item(s: &str) -> bool {
    let Some((num, rest)) = s.split_once(". ") else { return false };
    !num.is_empty() && num.len() <= 3 && num.bytes().all(|b| b.is_ascii_digit()) && !rest.is_empty()
}

/// 사용자가 붙여넣은 페이지 URL/ID 를 대시 UUID 로 정규화한다.
/// `https://www.notion.so/워크스페이스/제목-<32hex>` · 대시 유무 UUID 전부 수용.
pub fn normalize_page_id(input: &str) -> Option<String> {
    let cleaned = input.trim();
    // URL 이면 마지막 경로 조각, 쿼리 제거.
    let tail = cleaned
        .rsplit('/')
        .next()
        .unwrap_or(cleaned)
        .split('?')
        .next()
        .unwrap_or(cleaned);
    let hex: String = tail
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_lowercase();
    if hex.len() < 32 {
        return None;
    }
    let id = &hex[hex.len() - 32..];
    Some(format!(
        "{}-{}-{}-{}-{}",
        &id[0..8],
        &id[8..12],
        &id[12..16],
        &id[16..20],
        &id[20..32]
    ))
}

/// 페이지 생성 요청 본문 (pure — 테스트 대상).
pub fn build_page_payload(parent_page_id: &str, title: &str, blocks: Vec<Value>) -> Value {
    json!({
        "parent": { "page_id": parent_page_id },
        "properties": { "title": { "title": rich_text(title) } },
        "children": blocks,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// REST 클라이언트 (얇게 — 호출은 commands 가 조합)
// ─────────────────────────────────────────────────────────────────────────────

fn http(token: &str) -> Result<reqwest::Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    let auth = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| "토큰에 쓸 수 없는 문자가 있습니다".to_string())?;
    headers.insert(reqwest::header::AUTHORIZATION, auth);
    headers.insert(
        "Notion-Version",
        reqwest::header::HeaderValue::from_static(NOTION_VERSION),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())
}

/// 에러 본문에서 Notion 의 `message` 를 꺼내 사람이 읽을 에러로.
fn api_error(status: reqwest::StatusCode, body: &str) -> String {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(200).collect());
    format!("Notion API {status}: {msg}")
}

/// 토큰 검증 — `GET /users/me`. 성공 시 통합(봇) 이름.
pub async fn verify_token(token: &str) -> Result<String, String> {
    let res = http(token)?
        .get(format!("{API_BASE}/users/me"))
        .send()
        .await
        .map_err(|e| format!("Notion 연결 실패: {e}"))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(v.get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("Notion 통합")
        .to_string())
}

/// 부모 페이지 아래 새 페이지 생성 — 성공 시 페이지 URL.
pub async fn create_page(
    token: &str,
    parent_page_id: &str,
    title: &str,
    markdown: &str,
) -> Result<String, String> {
    let payload = build_page_payload(parent_page_id, title, markdown_to_blocks(markdown));
    let res = http(token)?
        .post(format!("{API_BASE}/pages"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Notion 연결 실패: {e}"))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    v.get("url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Notion 응답에 페이지 URL 이 없습니다".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_maps_structures_and_falls_back_to_paragraph() {
        let md = "# 제목\n\n## 섹션\n\n- 항목 하나\n1. 번호 항목\n> 인용\n\n---\n\n| a | b |\n\n본문 문단\n\n```rust\nfn main() {}\n```\n";
        let blocks = markdown_to_blocks(md);
        let kinds: Vec<&str> = blocks
            .iter()
            .map(|b| b.get("type").and_then(Value::as_str).unwrap())
            .collect();
        assert_eq!(
            kinds,
            vec![
                "heading_1",
                "heading_2",
                "bulleted_list_item",
                "numbered_list_item",
                "quote",
                "divider",
                "paragraph", // 표 행 폴백
                "paragraph",
                "code",
            ]
        );
        let code = blocks.last().unwrap();
        assert_eq!(code["code"]["language"], "rust");
        assert_eq!(code["code"]["rich_text"][0]["text"]["content"], "fn main() {}");
    }

    #[test]
    fn caps_blocks_and_appends_truncation_notice() {
        let md = (0..200).map(|i| format!("- {i}\n")).collect::<String>();
        let blocks = markdown_to_blocks(&md);
        assert_eq!(blocks.len(), MAX_BLOCKS + 1);
        let last = blocks.last().unwrap();
        assert!(last["paragraph"]["rich_text"][0]["text"]["content"]
            .as_str()
            .unwrap()
            .contains("잘렸습니다"));
    }

    #[test]
    fn long_text_splits_into_multiple_rich_text_parts() {
        let long = "가".repeat(4000);
        let blocks = markdown_to_blocks(&long);
        let parts = blocks[0]["paragraph"]["rich_text"].as_array().unwrap();
        assert_eq!(parts.len(), 3, "1900자 단위 분할");
        // 문자 기준 분할이라 멀티바이트가 깨지지 않는다.
        assert_eq!(parts[0]["text"]["content"].as_str().unwrap().chars().count(), 1900);
    }

    #[test]
    fn normalize_page_id_accepts_urls_and_bare_ids() {
        let dashed = "12345678-90ab-cdef-1234-567890abcdef";
        assert_eq!(normalize_page_id(dashed).as_deref(), Some(dashed));
        assert_eq!(
            normalize_page_id("1234567890abcdef1234567890abcdef").as_deref(),
            Some(dashed)
        );
        assert_eq!(
            normalize_page_id("https://www.notion.so/acme/회고-모음-1234567890abcdef1234567890abcdef?pvs=4")
                .as_deref(),
            Some(dashed)
        );
        assert_eq!(normalize_page_id("짧음"), None);
        assert_eq!(normalize_page_id(""), None);
    }

    #[test]
    fn page_payload_shape() {
        let p = build_page_payload("id-1", "회고 7/14–7/20", vec![block("paragraph", "x")]);
        assert_eq!(p["parent"]["page_id"], "id-1");
        assert_eq!(
            p["properties"]["title"]["title"][0]["text"]["content"],
            "회고 7/14–7/20"
        );
        assert_eq!(p["children"].as_array().unwrap().len(), 1);
    }
}
