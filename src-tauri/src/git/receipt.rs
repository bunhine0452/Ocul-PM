//! PR 영수증 (11-02) — 이 가지가 기준 가지에서 갈라진 뒤의 일을 **기록과 대조**한다.
//!
//! 변경 화면의 「영수증 복사」가 이것을 마크다운으로 바꿔 클립보드에 넣는다(`features/diff/receipt.ts`).
//! PR 리뷰어가 Ocul 없이도 「무엇을 했고 · 무엇으로 확인했고 · 어느 변경이 기록에 없는지」를 본다.
//! git 은 읽기만 한다(`diff` · `ls-files` · `rev-parse` · `merge-base` · `rev-list`) — 쓰기 0 · 네트워크 0.
//! 경로는 `-z` 로 받는다 — 한글 파일명이 `core.quotepath` 로 따옴표 · 8진수가 되지 않게.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Serialize;

use super::race::run;

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct ReceiptJournal {
    /// 일지 루트 기준 (`20261102/Bugs/…md`).
    pub path: String,
    pub title: String,
    /// `bug` · `feature` · `refactor` · `error` · `chore`.
    pub kind: String,
    /// 검증 칸 증거 등급 (`oculpm::evidence`, 2 = 돌린 명령).
    pub evidence: u8,
    /// 검증 칸의 끝 줄 — 결과가 보통 거기 있다.
    pub proof: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct Receipt {
    pub branch: String,
    /// 기준 — `origin/main` · `main` … 못 찾으면 빈 글자(그때는 커밋 전 변경만).
    pub base_label: String,
    pub commits: u32,
    /// 기록 폴더(`.oculpm/`) 밖에서 바뀐 파일 수.
    pub files: u32,
    pub journals: Vec<ReceiptJournal>,
    /// 바뀌었는데 이 가지의 어느 일지 `files_touched` 에도 없는 파일.
    pub unrecorded: Vec<String>,
}

const BASES: &[&str] = &["origin/main", "main", "origin/master", "master"];

/// 기준 가지와 갈라진 커밋. 지금 가지가 기준 자체면 그 위의 올리지 않은 커밋만 남는다.
fn base_of(root: &Path) -> Option<(String, String)> {
    let head_ref = run(
        root,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
    let candidates = head_ref
        .iter()
        .map(String::as_str)
        .chain(BASES.iter().copied());
    for r in candidates {
        let spec = format!("{r}^{{commit}}");
        if run(root, &["rev-parse", "--verify", "--quiet", &spec]).is_err() {
            continue;
        }
        if let Ok(sha) = run(root, &["merge-base", "HEAD", r]) {
            return Some((r.to_string(), sha.trim().to_string()));
        }
    }
    None
}

fn nul_list(s: &str) -> impl Iterator<Item = String> + '_ {
    s.split('\0').filter(|p| !p.is_empty()).map(str::to_string)
}

pub fn build(root: &Path) -> Result<Receipt, String> {
    let branch = run(root, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    let base = base_of(root);
    let against = base.as_ref().map(|(_, sha)| sha.as_str()).unwrap_or("HEAD");
    let commits = base
        .as_ref()
        .and_then(|(_, sha)| run(root, &["rev-list", "--count", &format!("{sha}..HEAD")]).ok())
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or(0);
    let mut changed: BTreeSet<String> =
        nul_list(&run(root, &["diff", "--name-only", "-z", against])?).collect();
    changed.extend(nul_list(&run(
        root,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?));

    let mut journals = Vec::new();
    let mut recorded: BTreeSet<String> = BTreeSet::new();
    for rel in &changed {
        let Some(jrel) = rel.strip_prefix(".oculpm/journal/") else {
            continue;
        };
        if !jrel.ends_with(".md") {
            continue;
        }
        // 지운 일지는 diff 에 이름만 남는다 — 디스크에 있는 것만 영수증에 싣는다.
        let Ok(raw) = std::fs::read_to_string(root.join(rel)) else {
            continue;
        };
        let (fm, body) = crate::oculpm::frontmatter::parse_frontmatter_and_body(&raw);
        let Some(fm) = fm.parsed else { continue };
        recorded.extend(fm.files_touched.iter().map(|f| f.path.clone()));
        journals.push(ReceiptJournal {
            path: jrel.to_string(),
            title: crate::oculpm::markdown::parse_body(&body).title,
            kind: serde_json::to_value(fm.entry_type)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
            evidence: crate::oculpm::evidence::evidence_level(&body),
            proof: crate::oculpm::evidence::verification_section(&body)
                .and_then(super::race::proof_line),
        });
    }
    journals.sort_by(|a, b| a.path.cmp(&b.path));
    let work: Vec<&String> = changed
        .iter()
        .filter(|p| !p.starts_with(".oculpm/"))
        .collect();
    let unrecorded = work
        .iter()
        .filter(|p| !recorded.contains(p.as_str()))
        .map(|p| p.to_string())
        .collect();
    Ok(Receipt {
        branch,
        base_label: base.map(|(label, _)| label).unwrap_or_default(),
        commits,
        files: work.len() as u32,
        journals,
        unrecorded,
    })
}

#[cfg(test)]
#[path = "receipt_tests.rs"]
mod tests;
