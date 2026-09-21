//! `.oculpm/rollups/YYYY-Www.md` — **원본 위 한 층** (journal-scale-round
//! `{#rollup-weekly}`).
//!
//! # 왜 한 층이 필요했나
//!
//! 이 저장소는 일지 727건, 주 100건이다. 그 규모에서 "지난달에 무슨 일이
//! 있었나"를 원본으로 답하려면 400건을 읽어야 하고, 아무도 읽지 않는다.
//! 회고 화면이 2026-09-08 에 사라진 뒤로 **묶어 보는 시야**는 Today 의 7일과
//! 주간 보고(휘발성 — 클립보드로만 나간다)뿐이었다.
//!
//! 롤업은 그 자리를 파일로 채운다. 저장소에 커밋되고, 에이전트가
//! `journal_read` 로 읽고, AI 컨텍스트가 원본보다 **먼저** 본다.
//!
//! # 온디스크 계약
//!
//! ```text
//! .oculpm/rollups/2026-W38.md
//! ```
//!
//! frontmatter: `oculpm_rollup: v1` · `week` · `range: {from, to}`(workday) ·
//! `entry_count` · `entries_hash` · `generated_at` · `generator`.
//! 본문 섹션 다섯은 [`generate`] 가 소유한다.
//!
//! ## `entries_hash` — 「오래됨」의 근거
//!
//! 그 주 일지의 `relative_path` + 본문 해시를 이어 blake3 로 접은 값이다.
//! 일지가 하나 늘거나 본문이 한 글자 바뀌면 값이 달라지고, 그때 롤업은
//! 「오래됨」이 된다. **mtime 이 아니라 내용**인 이유는 체크아웃·리베이스가
//! mtime 을 흔들기 때문이다 (`journal_search` 의 디스크 정렬이 같은 이유로
//! 경로 역순을 쓴다).
//!
//! ## 스펙 판단 — `schema_version` 은 올리지 않는다
//!
//! `.oculpm/rollups/` 는 **신규 최상위 디렉터리**다. 기존 일지·플래너·논의의
//! 온디스크 모양은 한 글자도 바뀌지 않고, 이 디렉터리가 없는 프로젝트는
//! 예전과 완전히 같게 동작한다 (롤업이 0건인 것이 정상 상태다). 옛 앱이 새
//! 트리를 열어도 모르는 폴더 하나를 무시할 뿐이다.
//!
//! 같은 판정의 선례가 둘 있다 — `.oculpm/automation/`(`spec.rs` 의
//! `AutomationConfig` doc: "신규 디렉터리라 기존 온디스크 스펙이 불변이고
//! `schema_version` 을 올리지 않는다")와 `.oculpm/discussion/`. 그 규칙을
//! 여기에 그대로 적용한다.
//!
//! ## `.gitignore` 에 넣지 않는다
//!
//! 롤업은 파생물이 아니라 **SSOT 의 일부**다 (LLM 으로 만든 판은 다시 못
//! 만든다 — 같은 모델·같은 온도라도 같은 글이 안 나온다). 커밋돼서 팀이
//! 공유하고, 옛 주의 요약이 저장소 역사와 함께 남는다. 앱 관리 영역인
//! `.oculpm/index/` 와 정반대 자리다.

pub mod generate;
pub mod week;

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::cache::RollupSourceEntry;
use crate::oculpm::cas::acquire_doc_guard;
use crate::oculpm::error::OculpmError;
use crate::oculpm::paths;

/// frontmatter 의 `oculpm_rollup` 값. 모양이 바뀌면 여기가 올라간다.
pub const ROLLUP_SCHEMA: &str = "v1";

/// 그 주의 workday 경계 (포함, `YYYYMMDD`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RollupRange {
    pub from: String,
    pub to: String,
}

/// 롤업 파일의 frontmatter. serde_yaml 이 그대로 읽고 쓴다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RollupFrontmatter {
    /// 항상 [`ROLLUP_SCHEMA`].
    pub oculpm_rollup: String,
    /// ISO 주 키 — `2026-W38`.
    pub week: String,
    pub range: RollupRange,
    /// 이 롤업이 **실제로 반영한** 일지 건수 (잘라낸 수가 아니다).
    pub entry_count: u32,
    /// 그 주 일지의 경로+본문해시를 접은 blake3 hex.
    pub entries_hash: String,
    /// RFC3339 (offset 포함).
    pub generated_at: String,
    /// `deterministic` 또는 `llm:<model>`.
    pub generator: String,
}

/// 목록 한 줄 — 카드·AI 컨텍스트가 파일을 열지 않고 판단할 수 있는 만큼.
#[derive(Debug, Clone, Serialize, Type)]
pub struct RollupSummary {
    pub week: String,
    pub range: RollupRange,
    pub entry_count: u32,
    /// 그 주의 일지가 롤업 생성 이후 바뀌었다 (`entries_hash` 불일치).
    pub stale: bool,
    /// 프로젝트 루트 기준 — `.oculpm/rollups/2026-W38.md`.
    pub path: String,
    pub generator: String,
    /// 「한 주 요약」의 첫 문단. 카드가 접힌 상태로 보여 주는 한 조각.
    pub summary: String,
}

/// 파일 한 판 (본문 포함) — 모달이 렌더한다.
#[derive(Debug, Clone, Serialize, Type)]
pub struct RollupDoc {
    pub summary: RollupSummary,
    pub body_markdown: String,
    /// 이번 호출이 모델을 실제로 썼는가 (읽기에서는 `generator` 에서 파생).
    pub used_llm: bool,
    /// 폴백 사유 등 사용자에게 알릴 한 줄.
    pub note: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// 해시 · 직렬화
// ─────────────────────────────────────────────────────────────────────────────

/// 그 주 일지의 지문. 경로로 정렬해 **입력 순서와 무관**하게 만든다 —
/// 캐시 질의의 정렬이 바뀌었다고 멀쩡한 롤업이 「오래됨」이 되면 안 된다.
pub fn entries_hash(entries: &[RollupSourceEntry]) -> String {
    let mut pairs: Vec<(&str, &str)> = entries
        .iter()
        .map(|e| (e.relative_path.as_str(), e.body_md_hash.as_str()))
        .collect();
    pairs.sort_unstable();
    let mut hasher = blake3::Hasher::new();
    for (path, hash) in pairs {
        hasher.update(path.as_bytes());
        hasher.update(b"\n");
        hasher.update(hash.as_bytes());
        hasher.update(b"\n");
    }
    hasher.finalize().to_hex().to_string()
}

/// frontmatter + 본문 → 파일 내용.
pub fn render(fm: &RollupFrontmatter, body: &str) -> Result<String, OculpmError> {
    let yaml = serde_yaml::to_string(fm)
        .map_err(|e| OculpmError::InvalidConfig(format!("rollup frontmatter 직렬화 실패: {e}")))?;
    Ok(format!("---\n{}---\n\n{}\n", yaml, body.trim_end()))
}

/// 파일 내용 → (frontmatter, 본문). frontmatter 가 없거나 모양이 아니면 `None`.
pub fn parse(text: &str) -> Option<(RollupFrontmatter, String)> {
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    let (yaml, after) = rest.split_at(end);
    let fm: RollupFrontmatter = serde_yaml::from_str(yaml).ok()?;
    let body = after.trim_start_matches("\n---").trim_start_matches('\n');
    Some((fm, body.to_string()))
}

/// 「한 주 요약」 섹션의 첫 문단. 섹션을 못 찾으면 본문의 첫 문단.
pub fn first_paragraph(body: &str) -> String {
    let after = body
        .find(generate::SECTION_SUMMARY)
        .map(|i| &body[i + generate::SECTION_SUMMARY.len()..])
        .unwrap_or(body);
    for chunk in after.split("\n\n") {
        let text = chunk.trim();
        if text.is_empty() || text.starts_with('#') {
            continue;
        }
        return text.replace('\n', " ");
    }
    String::new()
}

// ─────────────────────────────────────────────────────────────────────────────
// 디스크
// ─────────────────────────────────────────────────────────────────────────────

/// 롤업 한 판을 원자적으로 쓴다.
///
/// 문지기는 [`acquire_doc_guard`] — 플랜·논의가 쓰는 **바로 그 크로스프로세스
/// 문지기**다. 일지 쓰기 가드와 겹치지 않는다: 이 문지기는 지키는 파일
/// 옆(`.2026-W38.md.lock`)에 서고, 롤업은 일지와 다른 파일이라 두 쓰기가 서로를
/// 기다릴 이유가 없다. "롤업 전용 가드 하나" 라는 요구는 파일 단위 문지기가
/// 이미 만족시킨다 — 같은 주를 둘이 동시에 만들면 한쪽이 기다린다.
pub fn write(root: &Path, fm: &RollupFrontmatter, body: &str) -> Result<(), OculpmError> {
    let path = paths::rollup_path(root, &fm.week);
    std::fs::create_dir_all(paths::rollups_root(root)).map_err(|source| OculpmError::Io {
        path: paths::rollups_root(root),
        source,
    })?;
    let _guard = acquire_doc_guard(&path)
        .map_err(|e| OculpmError::InvalidConfig(format!("롤업 파일을 잠그지 못했어요: {e}")))?;
    let text = render(fm, body)?;
    write_atomic(&path, text.as_bytes())
}

/// 디스크의 롤업 전부 — 주 내림차순(최신 먼저). 깨진 파일은 조용히 건너뛴다
/// (읽을 수 없는 한 장이 목록 전체를 죽이면 안 된다).
pub fn read_all(root: &Path) -> Vec<(RollupFrontmatter, String)> {
    let dir = paths::rollups_root(root);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<(RollupFrontmatter, String)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        // 점으로 시작하는 이름은 문지기의 락 파일이다 — 문서가 아니다.
        if path
            .file_name()
            .and_then(|s| s.to_str())
            .is_none_or(|n| n.starts_with('.'))
        {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        if let Some(parsed) = parse(&text) {
            out.push(parsed);
        }
    }
    out.sort_by(|a, b| b.0.week.cmp(&a.0.week));
    out
}

/// 한 주의 롤업.
pub fn read_one(root: &Path, week: &str) -> Option<(RollupFrontmatter, String)> {
    let text = std::fs::read_to_string(paths::rollup_path(root, week)).ok()?;
    parse(&text)
}

/// frontmatter + 본문 + 현재 지문 → 목록 한 줄.
pub fn summarize(fm: &RollupFrontmatter, body: &str, current_hash: Option<&str>) -> RollupSummary {
    RollupSummary {
        week: fm.week.clone(),
        range: fm.range.clone(),
        entry_count: fm.entry_count,
        // 현재 지문을 모르면 「오래됨」이라고 말하지 않는다 — 모르는 것과
        // 아닌 것은 다르고, 거짓 배지는 배지를 통째로 못 믿게 만든다.
        stale: current_hash.is_some_and(|h| h != fm.entries_hash),
        path: paths::rollup_rel(&fm.week),
        generator: fm.generator.clone(),
        summary: first_paragraph(body),
    }
}

#[cfg(test)]
mod tests;
