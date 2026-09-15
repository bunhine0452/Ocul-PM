//! 디스크 → 캐시 투영의 읽기 쪽 — 프론트매터·본문 파싱, 본문 마스킹, 그리고
//! 확인 해시의 기준이 되는 **마스킹 전** 본문 해시 ({#reviewed-hash}).
//!
//! `cache/mod.rs` 의 단일 `impl JournalCache` 에서 갈라 나온 조각이다 — 파일
//! 크기 래칫이 그 파일을 짚었고, 투영은 쓰기(`write.rs`)와 재색인(`reindex.rs`)
//! 이 같이 쓰는 경계가 뚜렷한 덩어리다.

use super::*;

impl<'a> JournalCache<'a> {
    /// Parse a journal file's raw text for projection into the cache, masking
    /// secrets in the **body only** — never the YAML frontmatter, where a
    /// `[REDACTED]` placeholder would parse as a flow sequence (`['REDACTED']`)
    /// and degrade the row to an unparseable `chore` (dev-report §2 / R1). The
    /// at-write writers (`create_manual_journal_entry` / `update_journal_entry_body`)
    /// already mask only the body for the same reason.
    ///
    /// Returns a [`Projected`] — frontmatter, masked body, full-text for the
    /// body-hash gate, redacted span count, and the **pre-mask** body hash the
    /// `verified_hash` check compares against. This is the **single producer**
    /// of the cache's `full_text`, so the body-hash basis is consistent across
    /// every projection path. When nothing is masked it returns `raw` verbatim,
    /// so a no-secret file projects byte-identically to the non-redacting path
    /// (the no-churn mtime fast path in [`upsert_entry`][Self::upsert_entry]
    /// still holds); only when a secret is actually replaced does it rebuild a
    /// deterministic `---\n<frontmatter>\n---\n<masked body>` so re-scans stay
    /// stable.
    pub(crate) fn project_text(&self, raw: &str) -> Projected {
        let (parsed, body_text) = parse_frontmatter_and_body(raw);
        // 확인 해시의 기준은 마스킹 **전** 디스크 본문이다 — `set_journal_verified`
        // 가 해시한 것이 그것이고, 마스킹된 투영을 해시하면 비밀이 들어 있는
        // 일지는 확인하자마자 거짓 「다시 검토」가 된다.
        let disk_body_hash = verified_body_hash(&body_text);
        if self.redact.is_empty() {
            let body = parse_body(&body_text);
            return Projected {
                parsed,
                body,
                full_text: raw.to_string(),
                redacted: 0,
                disk_body_hash,
            };
        }
        let (masked_body, hits) = crate::oculpm::redact::redact_text(&body_text, &self.redact);
        if hits.is_empty() {
            // No secret in the body → identical projection to the non-redacting
            // path (full_text == raw keeps the hash basis stable).
            let body = parse_body(&body_text);
            return Projected {
                parsed,
                body,
                full_text: raw.to_string(),
                redacted: 0,
                disk_body_hash,
            };
        }
        let full_text = if parsed.raw_yaml.is_empty() {
            masked_body.clone()
        } else {
            format!("---\n{}\n---\n{}", parsed.raw_yaml, masked_body)
        };
        let body = parse_body(&masked_body);
        Projected {
            parsed,
            body,
            full_text,
            redacted: hits.len(),
            disk_body_hash,
        }
    }
}

/// 디스크 파일 하나를 캐시 행으로 투영하려고 읽어 둔 것 — [`JournalCache::project_text`]
/// 가 만들고 [`JournalCache::upsert_projected`] 가 쓴다.
pub(crate) struct Projected {
    pub parsed: ParsedFrontmatter,
    /// 마스킹된 본문 — 캐시에 들어가는 쪽.
    pub body: ParsedBody,
    /// body-hash 게이트용 전문 (마스킹이 일어났으면 재조립본).
    pub full_text: String,
    pub redacted: usize,
    /// 마스킹 **전** 디스크 본문의 [`verified_body_hash`] — `verified_hash` 와
    /// 비교해 `verified_stale` 를 정한다.
    pub disk_body_hash: String,
}
