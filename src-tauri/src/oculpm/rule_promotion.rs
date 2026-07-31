//! PR-CI4 — 실패→규칙 승격 루프 (docs/claude-integration/00-master-plan.md D5,
//! 스키마는 03-rules-hub-ui-spec.md §1 의 `paths` 가 정답).
//!
//! 쌓인 error/bug 일지에서 **결정적으로** 반복 실패 클러스터(규칙 후보)를
//! 뽑고, 사용자가 요청하면 그 증거로 LLM 규칙 초안을 만든다. 승인은 이 모듈
//! 밖 — 프런트가 기존 `rules_save`(CI3) 를 명시적으로 호출할 때만 파일이
//! 생기며, **이 모듈에는 `.claude/rules` 를 쓰는 코드 경로 자체가 없다**
//! (draft=AI, decision=사람 — 자동 적용 금지의 구조적 보장).
//!
//! 후보 추출 (LLM 없음):
//! - error/bug 일지의 `files_touched` 디렉터리를 최대 [`AREA_DEPTH`] 세그먼트로
//!   자른 "영역(area)" 으로 클러스터링, 한 영역에 서로 다른 실패 일지가
//!   [`MIN_CLUSTER`]건 이상이면 후보.
//! - 이미 그 영역을 다루는 규칙이 있으면 억제: 기존 프로젝트 규칙의 `paths`
//!   가 영역을 덮거나, 본문에 `<!-- oculpm:promoted-from <key> -->` 마커가
//!   있으면 (승인된 후보의 재등장 방지).
//!
//! 초안 증거: 클러스터 일지의 본문(디스크, redact 통과)과 entry_diffs 사이드카
//! 의 실제 변경 파일 목록(paths 추론 근거). 초안은 저장용 `content` 까지
//! 조립해 돌려주고, 프런트는 그대로 `rules_save` 에 넘긴다.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::oculpm::cache::RangeEntry;
use crate::oculpm::entry_diffs;
use crate::oculpm::redact;
use crate::oculpm::rules::{self, RuleEntry};

/// 한 영역이 후보가 되기 위한 최소 실패 일지 수.
const MIN_CLUSTER: usize = 2;
/// 후보 나열 상한 (많으면 노이즈 — 상위만).
const CANDIDATE_CAP: usize = 6;
/// 영역 = 파일의 디렉터리 경로를 이 세그먼트 수까지로 자른 것.
const AREA_DEPTH: usize = 3;
/// 후보당 표본 제목 수 (UI 표시용).
const SAMPLE_TITLES_CAP: usize = 4;
/// LLM 증거로 읽는 일지 수/본문 길이 상한 (프롬프트 바운드).
const EVIDENCE_ENTRIES_CAP: usize = 5;
const EVIDENCE_BODY_CHARS: usize = 1600;
/// 승인 저장된 규칙의 출처 마커 — 재등장 억제 키.
const PROMOTED_MARKER_PREFIX: &str = "<!-- oculpm:promoted-from ";
const PROMOTED_MARKER_SUFFIX: &str = " -->";

// ─────────────────────────────────────────────────────────────────────────────
// DTO
// ─────────────────────────────────────────────────────────────────────────────

/// 결정적 규칙 후보 — 한 코드 영역의 반복 실패 클러스터.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RuleCandidate {
    /// 억제/재조회 키 (`area:<영역>`).
    pub key: String,
    /// 공유 디렉터리 영역 (예: `src-tauri/src/oculpm`).
    pub area: String,
    /// 클러스터의 실패(error/bug) 일지 수.
    pub entry_count: u32,
    /// 등장한 종류 (정렬: `bug`, `error`).
    pub kinds: Vec<String>,
    /// 표본 제목 (최신순, 최대 4).
    pub sample_titles: Vec<String>,
    /// 증거 일지의 캐시 상대경로 (최신순 — 초안 생성이 본문을 읽는다).
    pub entry_rels: Vec<String>,
    /// 결정적 paths 제안 (`<area>/**`) — LLM 이 다듬되 폴백으로도 쓴다.
    pub suggested_paths: Vec<String>,
    /// 가장 최근 실패 workday.
    pub last_workday: String,
}

/// LLM 이 만든 규칙 초안. `content` 가 저장용 완성본 — 프런트는 슬러그만
/// 바꿔서 `rules_save(".claude/rules/<slug>.md", content, create=true)` 를
/// 부른다 (승인 없이는 어떤 파일도 쓰이지 않는다).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RuleDraft {
    pub candidate_key: String,
    pub slug: String,
    pub title: String,
    pub paths: Vec<String>,
    pub body_markdown: String,
    /// frontmatter(paths) + promoted-from 마커 + 본문의 저장용 완성본.
    pub content: String,
    /// 제안 저장 위치 (`.claude/rules/<slug>.md`).
    pub rel_path: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// 결정적 후보 추출 (pure)
// ─────────────────────────────────────────────────────────────────────────────

/// 파일 경로 → 영역 키. 디렉터리가 없으면(루트 파일) None.
fn area_of(file: &str) -> Option<String> {
    let dir = file.rsplit_once('/')?.0;
    if dir.is_empty() {
        return None;
    }
    let segs: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return None;
    }
    Some(segs[..segs.len().min(AREA_DEPTH)].join("/"))
}

/// 기존 규칙이 이 영역을 이미 덮는가 — `paths` 의 glob 이 영역(또는 그 하위)을
/// 가리키면 참. 항상-로드 규칙(paths 없음)은 일반 지침이므로 억제하지 않는다.
fn rule_covers_area(rule_paths: &[String], area: &str) -> bool {
    rule_paths.iter().any(|g| {
        let g = g.trim_start_matches("./");
        if g == area {
            return true;
        }
        // 규칙이 영역보다 좁다: `src/api/**` 는 영역 `src/api` 를 덮는다.
        if g.strip_prefix(area).is_some_and(|rest| rest.starts_with('/')) {
            return true;
        }
        // 규칙이 영역보다 **넓다**: `src/**` 나 `src/**/*.ts` 는 영역
        // `src/api` 를 덮는다 (2026-07-20 리뷰 — 이 방향이 빠져 넓은 규칙을
        // 가진 사용자에게 같은 후보가 영구 재제안됐다). 와일드카드가 나오기
        // 전까지의 세그먼트를 base 로 잡아 디렉터리 경계로 비교한다
        // (`src/apiX/**` 가 `src/api` 를 덮지 않도록 경계는 `/` 로 판정).
        let base = g
            .split('/')
            .take_while(|seg| !seg.contains(['*', '?', '[']))
            .collect::<Vec<_>>()
            .join("/");
        !base.is_empty()
            && area
                .strip_prefix(base.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// 후보 추출 본체 (pure). `existing_rules` 는 프로젝트 스코프 규칙 목록,
/// `promoted_keys` 는 규칙 본문에서 수확한 promoted-from 마커 키들.
pub fn extract_candidates(
    entries: &[RangeEntry],
    existing_rules: &[RuleEntry],
    promoted_keys: &BTreeSet<String>,
) -> Vec<RuleCandidate> {
    // 영역 → 실패 일지 인덱스 (한 일지가 한 영역에 두 번 세어지지 않게 set).
    let mut clusters: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, e) in entries.iter().enumerate() {
        if e.entry_type != "error" && e.entry_type != "bug" {
            continue;
        }
        let mut areas: BTreeSet<String> = BTreeSet::new();
        for f in &e.files {
            if let Some(a) = area_of(f) {
                areas.insert(a);
            }
        }
        for a in areas {
            clusters.entry(a).or_default().push(i);
        }
    }

    let mut out: Vec<RuleCandidate> = Vec::new();
    for (area, idxs) in clusters {
        if idxs.len() < MIN_CLUSTER {
            continue;
        }
        let key = format!("area:{area}");
        if promoted_keys.contains(&key) {
            continue;
        }
        if existing_rules.iter().any(|r| rule_covers_area(&r.paths, &area)) {
            continue;
        }
        // 최신 실패가 먼저 오도록 workday 내림차순 (동일 workday 는 경로순).
        let mut ordered: Vec<&RangeEntry> = idxs.iter().map(|&i| &entries[i]).collect();
        ordered.sort_by(|a, b| {
            b.workday
                .cmp(&a.workday)
                .then_with(|| b.relative_path.cmp(&a.relative_path))
        });
        let mut kinds: Vec<String> = ordered
            .iter()
            .map(|e| e.entry_type.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        kinds.sort();
        out.push(RuleCandidate {
            key,
            entry_count: ordered.len() as u32,
            kinds,
            sample_titles: ordered
                .iter()
                .take(SAMPLE_TITLES_CAP)
                .map(|e| e.title.clone())
                .collect(),
            entry_rels: ordered
                .iter()
                .take(EVIDENCE_ENTRIES_CAP)
                .map(|e| e.relative_path.clone())
                .collect(),
            suggested_paths: vec![format!("{area}/**")],
            last_workday: ordered
                .first()
                .map(|e| e.workday.clone())
                .unwrap_or_default(),
            area,
        });
    }

    // 많이 반복된 순 → 최근 순 → 영역명 순. 상한 적용.
    out.sort_by(|a, b| {
        b.entry_count
            .cmp(&a.entry_count)
            .then_with(|| b.last_workday.cmp(&a.last_workday))
            .then_with(|| a.area.cmp(&b.area))
    });
    out.truncate(CANDIDATE_CAP);
    out
}

/// 프로젝트의 기존 규칙 본문에서 promoted-from 마커 키를 수확한다.
pub fn harvest_promoted_keys(project_root: &Path, rules: &[RuleEntry]) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    for r in rules {
        let Ok(text) = std::fs::read_to_string(project_root.join(&r.rel_path)) else {
            continue;
        };
        for line in text.lines().take(20) {
            if let Some(key) = line
                .trim()
                .strip_prefix(PROMOTED_MARKER_PREFIX)
                .and_then(|s| s.strip_suffix(PROMOTED_MARKER_SUFFIX))
            {
                keys.insert(key.trim().to_string());
            }
        }
    }
    keys
}

/// 디스크에서 억제 재료를 모아 후보를 뽑는 상위 헬퍼 (commands 진입점).
pub fn candidates_for(project_root: &Path, entries: &[RangeEntry]) -> Vec<RuleCandidate> {
    let existing = rules::list_project_rules(project_root);
    let promoted = harvest_promoted_keys(project_root, &existing);
    extract_candidates(entries, &existing, &promoted)
}

// ─────────────────────────────────────────────────────────────────────────────
// 증거 수집 + 프롬프트 (초안 생성 준비 — LLM 호출 자체는 commands 소유)
// ─────────────────────────────────────────────────────────────────────────────

/// 한 증거 일지의 프롬프트 조각.
pub struct Evidence {
    pub title: String,
    pub kind: String,
    pub workday: String,
    /// files_touched ∪ entry_diffs 의 실제 변경 파일 (paths 추론 근거).
    pub files: Vec<String>,
    /// redact 통과한 본문 발췌.
    pub excerpt: String,
}

/// 클러스터 일지의 본문·변경 파일을 모은다. 본문은 디스크 SSOT 를 읽되
/// **redact 패턴을 통과시킨 뒤** 잘라낸다 (entry_diffs 사이드카는 캡처 시점에
/// 이미 마스킹 — v3). 읽기 실패는 빈 발췌로 삼키지 않고 발췌 자리에 명시한다
/// (#a0-review-fixes ③) — LLM/사용자가 "증거 없음" 과 "증거 유실" 을 구분해야
/// 규칙 초안의 근거 강도를 바로 읽는다.
pub fn gather_evidence(project_root: &Path, candidate: &RuleCandidate, entries: &[RangeEntry]) -> Vec<Evidence> {
    let patterns = redact::patterns_for_project(project_root);
    let by_rel: BTreeMap<&str, &RangeEntry> = entries
        .iter()
        .map(|e| (e.relative_path.as_str(), e))
        .collect();
    let mut out = Vec::new();
    for rel in candidate.entry_rels.iter().take(EVIDENCE_ENTRIES_CAP) {
        let Some(e) = by_rel.get(rel.as_str()) else { continue };
        let mut files: BTreeSet<String> = e.files.iter().cloned().collect();
        for d in entry_diffs::read_entry_diffs(project_root, rel) {
            files.insert(d.path);
        }
        let disk = project_root.join(".oculpm").join("journal").join(rel);
        let excerpt = match std::fs::read_to_string(&disk) {
            Ok(raw) => {
                let (masked, _) = redact::redact_text(&raw, &patterns);
                truncate_chars(&masked, EVIDENCE_BODY_CHARS)
            }
            Err(_) => format!("(일지 파일을 읽지 못했습니다: {rel} — 디스크에서 이동/삭제된 듯)"),
        };
        out.push(Evidence {
            title: e.title.clone(),
            kind: e.entry_type.clone(),
            workday: e.workday.clone(),
            files: files.into_iter().collect(),
            excerpt,
        });
    }
    out
}

fn truncate_chars(s: &str, cap: usize) -> String {
    if s.chars().count() <= cap {
        return s.to_string();
    }
    let cut: String = s.chars().take(cap).collect();
    format!("{cut}\n…(잘림)")
}

/// LLM system 프롬프트 — JSON 하나만 출력하게 강제한다.
pub const DRAFT_SYSTEM_PROMPT: &str = r##"너는 코딩 에이전트가 따를 "규칙 파일"을 작성하는 시니어 엔지니어다.
입력은 한 코드 영역에서 반복된 에러/버그 작업 일지의 증거다. 같은 실수가
재발하지 않도록 에이전트가 따를 규칙 하나를 만들어라.

출력은 아래 형태의 JSON 오브젝트 **하나만** — 다른 텍스트/코드펜스 금지:
{"title": "짧은 한국어 제목", "slug": "kebab-case-english", "paths": ["glob", ...], "body_markdown": "# 제목\n..."}

규칙:
- 증거에 근거한 구체적 지침만 써라. 일반론("테스트를 잘 하라") 금지.
- body_markdown 은 `# 제목` H1 로 시작하고, 확인 가능한 지침 3~7개의 목록으로.
- paths 는 이 규칙을 적용할 파일 glob 배열 — 증거의 파일 목록이 근거다.
  프로젝트 전체에 적용해야 맞으면 빈 배열 [].
- slug 는 영문 소문자·숫자·하이픈만.
- 증거가 서로 무관해 하나의 규칙이 안 되면, 가장 반복된 문제 하나로 좁혀라."##;

/// user 프롬프트 — 후보 요약 + 증거 발췌.
pub fn build_draft_prompt(candidate: &RuleCandidate, evidence: &[Evidence]) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "영역: {}\n실패 일지: {}건 (종류: {})\n결정적 paths 제안: {}\n",
        candidate.area,
        candidate.entry_count,
        candidate.kinds.join(", "),
        candidate.suggested_paths.join(", "),
    ));
    for (i, ev) in evidence.iter().enumerate() {
        out.push_str(&format!(
            "\n[증거 {} — ({}, {}) {}]\n변경 파일: {}\n",
            i + 1,
            ev.kind,
            ev.workday,
            ev.title,
            if ev.files.is_empty() { "(없음)".to_string() } else { ev.files.join(", ") },
        ));
        if !ev.excerpt.is_empty() {
            out.push_str(&ev.excerpt);
            if !ev.excerpt.ends_with('\n') {
                out.push('\n');
            }
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM 응답 파싱 → 초안 조립
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RawDraft {
    #[serde(default)]
    title: String,
    #[serde(default)]
    slug: String,
    #[serde(default)]
    paths: Vec<String>,
    #[serde(default)]
    body_markdown: String,
}

/// slug 를 kebab-case 로 정규화한다 (LLM 출력 방어). 전부 무효면 폴백.
fn sanitize_slug(raw: &str) -> String {
    let mut s: String = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    let s = s.trim_matches('-').to_string();
    let s = if s.len() > 48 { s[..48].trim_matches('-').to_string() } else { s };
    if rules::validate_new_rule_name(&s).is_ok() {
        s
    } else {
        "promoted-rule".to_string()
    }
}

/// LLM 텍스트에서 JSON 오브젝트를 관대하게 추출·검증해 초안을 조립한다.
pub fn parse_draft_response(
    candidate: &RuleCandidate,
    response: &str,
) -> Result<RuleDraft, String> {
    let text = response.trim();
    let start = text.find('{');
    let end = text.rfind('}');
    let json = match (start, end) {
        (Some(s), Some(e)) if e > s => &text[s..=e],
        _ => return Err("규칙 초안 응답에서 JSON 을 찾지 못했습니다".into()),
    };
    let raw: RawDraft = serde_json::from_str(json)
        .map_err(|e| format!("규칙 초안 JSON 파싱 실패: {e}"))?;

    let title = raw.title.trim().to_string();
    let body = raw.body_markdown.trim().to_string();
    if title.is_empty() || body.is_empty() {
        return Err("규칙 초안에 title/body 가 비어 있습니다".into());
    }
    // paths 검증: 공백 제거, 절대경로·과대입력 거부, 상한 8. 전부 무효/빈
    // 배열이면 빈 배열(항상 로드) 그대로 — 결정적 제안으로 강제 폴백하지
    // 않는다 (LLM 이 "전체 적용" 을 고른 것일 수 있음).
    let paths: Vec<String> = raw
        .paths
        .iter()
        .map(|p| p.trim().trim_start_matches("./").to_string())
        .filter(|p| !p.is_empty() && !p.starts_with('/') && p.len() <= 120 && !p.contains(".."))
        .take(8)
        .collect();

    let slug = sanitize_slug(if raw.slug.trim().is_empty() { &candidate.area } else { &raw.slug });
    let body = if body.starts_with('#') {
        body
    } else {
        format!("# {title}\n\n{body}")
    };

    let content = render_rule_content(&candidate.key, &paths, &body);
    Ok(RuleDraft {
        candidate_key: candidate.key.clone(),
        rel_path: format!("{}/{slug}.md", rules::RULES_SUBDIR),
        slug,
        title,
        paths,
        body_markdown: body,
        content,
    })
}

/// 저장용 완성본 — CI3 규칙 파일 규격(frontmatter `paths`) + 출처 마커.
/// 마커 덕에 같은 후보가 다시 제안되지 않는다 (harvest_promoted_keys).
pub fn render_rule_content(candidate_key: &str, paths: &[String], body: &str) -> String {
    let mut out = String::new();
    if !paths.is_empty() {
        out.push_str("---\npaths:\n");
        for p in paths {
            out.push_str(&format!("  - {}\n", serde_json::to_string(p).unwrap_or_default()));
        }
        out.push_str("---\n");
    }
    out.push_str(&format!("{PROMOTED_MARKER_PREFIX}{candidate_key}{PROMOTED_MARKER_SUFFIX}\n\n"));
    out.push_str(body.trim_start_matches('\n'));
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn entry(ty: &str, workday: &str, title: &str, files: &[&str]) -> RangeEntry {
        RangeEntry {
            relative_path: format!("{workday}/X/{title}.md"),
            workday: workday.to_string(),
            entry_type: ty.to_string(),
            status: "done".to_string(),
            difficulty: None,
            agent_id: "claude-code".to_string(),
            title: title.to_string(),
            files: files.iter().map(|s| s.to_string()).collect(),
            tags: Vec::new(),
        }
    }

    fn rule(rel: &str, paths: &[&str]) -> RuleEntry {
        RuleEntry {
            scope: rules::RuleScope::Project,
            kind: rules::RuleKind::Rule,
            rel_path: rel.to_string(),
            name: rel.to_string(),
            title: String::new(),
            exists: true,
            paths: paths.iter().map(|s| s.to_string()).collect(),
            bytes: 0,
            mirror: rules::MirrorState::None,
        }
    }

    // ─── 후보 추출 ──────────────────────────────────────────────────────────

    #[test]
    fn clusters_failures_by_area_with_threshold() {
        let entries = vec![
            entry("bug", "20260718", "B1", &["src/api/users.ts", "src/api/auth.ts"]),
            entry("error", "20260719", "E1", &["src/api/users.ts"]),
            // 같은 일지가 같은 영역에 두 번 세어지지 않는다 (파일 2개여도 1).
            entry("bug", "20260720", "B2", &["src/ui/App.tsx"]), // 단독 — 임계 미달
            entry("feature", "20260720", "F1", &["src/api/other.ts"]), // 실패 아님 — 제외
        ];
        let got = extract_candidates(&entries, &[], &BTreeSet::new());
        assert_eq!(got.len(), 1, "{got:?}");
        let c = &got[0];
        assert_eq!(c.key, "area:src/api");
        assert_eq!(c.entry_count, 2);
        assert_eq!(c.kinds, vec!["bug", "error"]);
        assert_eq!(c.suggested_paths, vec!["src/api/**"]);
        // 최신 실패가 먼저 (E1 이 20260719 로 B1 보다 최신).
        assert_eq!(c.sample_titles[0], "E1");
        assert_eq!(c.last_workday, "20260719");
    }

    #[test]
    fn area_depth_caps_at_three_segments_and_skips_root_files() {
        assert_eq!(area_of("src-tauri/src/oculpm/agents/mod.rs").as_deref(), Some("src-tauri/src/oculpm"));
        assert_eq!(area_of("src/a.rs").as_deref(), Some("src"));
        assert_eq!(area_of("CLAUDE.md"), None);
        let entries = vec![
            entry("bug", "20260718", "B1", &["src-tauri/src/oculpm/rules.rs"]),
            entry("error", "20260719", "E1", &["src-tauri/src/oculpm/watcher.rs"]),
        ];
        let got = extract_candidates(&entries, &[], &BTreeSet::new());
        assert_eq!(got[0].area, "src-tauri/src/oculpm");
    }

    #[test]
    fn suppressed_by_existing_rule_paths_or_promoted_marker() {
        let entries = vec![
            entry("bug", "20260718", "B1", &["src/api/a.ts"]),
            entry("error", "20260719", "E1", &["src/api/b.ts"]),
        ];
        // paths 가 영역을 덮는 기존 규칙 → 억제.
        let covering = [rule(".claude/rules/api.md", &["src/api/**/*.ts"])];
        assert!(extract_candidates(&entries, &covering, &BTreeSet::new()).is_empty());
        // 정확히 영역 자체를 가리키는 glob 도 억제.
        let exact = [rule(".claude/rules/api.md", &["src/api"])];
        assert!(extract_candidates(&entries, &exact, &BTreeSet::new()).is_empty());
        // 무관한 paths / 항상-로드 규칙(빈 paths)은 억제하지 않는다.
        let other = [rule(".claude/rules/x.md", &["docs/**"]), rule(".claude/rules/g.md", &[])];
        assert_eq!(extract_candidates(&entries, &other, &BTreeSet::new()).len(), 1);
        // "src/apiX" 처럼 접두 문자열만 겹치는 glob 은 영역을 덮지 않는다.
        assert!(!rule_covers_area(&["src/apiX/**".to_string()], "src/api"));
        // 2026-07-20 리뷰 — 영역보다 **넓은** 규칙도 덮는다. 이 방향이 빠져
        // `src/**` 를 가진 사용자에게 같은 후보가 영구 재제안됐다.
        let broad = [rule(".claude/rules/src.md", &["src/**"])];
        assert!(
            extract_candidates(&entries, &broad, &BTreeSet::new()).is_empty(),
            "넓은 규칙(src/**)이 하위 영역(src/api) 후보를 억제해야 한다"
        );
        assert!(rule_covers_area(&["src/**/*.ts".to_string()], "src/api"));
        assert!(rule_covers_area(&["src/*".to_string()], "src/api"));
        // 넓어도 다른 가지면 억제하지 않는다.
        assert!(!rule_covers_area(&["docs/**".to_string()], "src/api"));
        // 루트 전체 glob 은 areas 를 무차별 억제하지 않도록 base 가 비면 제외.
        assert!(!rule_covers_area(&["**".to_string()], "src/api"));
        // promoted-from 마커 키 → 억제.
        let mut promoted = BTreeSet::new();
        promoted.insert("area:src/api".to_string());
        assert!(extract_candidates(&entries, &[], &promoted).is_empty());
    }

    #[test]
    fn candidates_sorted_by_count_then_recency_and_capped() {
        let mut entries = Vec::new();
        // hot: 3건 / warm: 2건 (더 최근).
        for (i, wd) in ["20260710", "20260711", "20260712"].iter().enumerate() {
            entries.push(entry("bug", wd, &format!("H{i}"), &["src/hot/a.ts"]));
        }
        for (i, wd) in ["20260718", "20260719"].iter().enumerate() {
            entries.push(entry("error", wd, &format!("W{i}"), &["src/warm/b.ts"]));
        }
        let got = extract_candidates(&entries, &[], &BTreeSet::new());
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].area, "src/hot", "건수 많은 쪽이 먼저");
        assert_eq!(got[1].area, "src/warm");
    }

    #[test]
    fn harvest_promoted_keys_reads_marker_from_rule_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let rel = ".claude/rules/api-guard.md";
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(
            &p,
            "---\npaths:\n  - \"src/api/**\"\n---\n<!-- oculpm:promoted-from area:src/api -->\n\n# x\n",
        )
        .unwrap();
        let keys = harvest_promoted_keys(root, &[rule(rel, &["src/api/**"])]);
        assert!(keys.contains("area:src/api"));
    }

    // ─── 초안 파싱/조립 ─────────────────────────────────────────────────────

    fn candidate() -> RuleCandidate {
        RuleCandidate {
            key: "area:src/api".into(),
            area: "src/api".into(),
            entry_count: 2,
            kinds: vec!["bug".into()],
            sample_titles: vec!["B1".into()],
            entry_rels: vec!["20260718/Bugs/B1.md".into()],
            suggested_paths: vec!["src/api/**".into()],
            last_workday: "20260719".into(),
        }
    }

    /// A0c ③ — 일지 파일이 디스크에서 사라졌으면 발췌를 빈 문자열로 삼키지
    /// 않고 유실을 명시한다 ("증거 없음" 과 "증거 유실" 의 구분).
    #[test]
    fn gather_evidence_marks_unreadable_journal_instead_of_empty() {
        let dir = TempDir::new().unwrap();
        let e = {
            let mut e = entry("bug", "20260718", "B1", &["src/api/a.ts"]);
            e.relative_path = "20260718/Bugs/B1.md".into();
            e
        };
        let out = gather_evidence(dir.path(), &candidate(), &[e]);
        assert_eq!(out.len(), 1);
        assert!(
            out[0].excerpt.contains("읽지 못했습니다"),
            "유실 명시가 없다: {:?}",
            out[0].excerpt
        );
    }

    #[test]
    fn parse_draft_accepts_fenced_json_and_builds_content() {
        let resp = "설명입니다\n```json\n{\"title\": \"API 검증 규칙\", \"slug\": \"api-validation\", \"paths\": [\"src/api/**/*.ts\"], \"body_markdown\": \"# API 검증 규칙\\n\\n- 입력을 검증하라\"}\n```";
        let d = parse_draft_response(&candidate(), resp).unwrap();
        assert_eq!(d.slug, "api-validation");
        assert_eq!(d.paths, vec!["src/api/**/*.ts"]);
        assert_eq!(d.rel_path, ".claude/rules/api-validation.md");
        assert!(d.content.starts_with("---\npaths:\n  - \"src/api/**/*.ts\"\n---\n"));
        assert!(d.content.contains("<!-- oculpm:promoted-from area:src/api -->"));
        assert!(d.content.trim_end().ends_with("- 입력을 검증하라"));
        // 마커가 억제 수확과 왕복된다.
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join(&d.rel_path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, &d.content).unwrap();
        let keys = harvest_promoted_keys(tmp.path(), &[rule(&d.rel_path, &[])]);
        assert!(keys.contains("area:src/api"));
    }

    #[test]
    fn parse_draft_sanitizes_slug_and_filters_bad_paths() {
        let resp = r#"{"title": "제목", "slug": "Bad Slug!!", "paths": ["/abs/no", "  ", "ok/**", "../escape"], "body_markdown": "지침만 있음"}"#;
        let d = parse_draft_response(&candidate(), resp).unwrap();
        assert_eq!(d.slug, "bad-slug");
        assert_eq!(d.paths, vec!["ok/**"]);
        // H1 없으면 제목으로 시작하게 보정.
        assert!(d.body_markdown.starts_with("# 제목"));
        // paths 빈 배열이면 frontmatter 없이 마커부터.
        let d2 = parse_draft_response(
            &candidate(),
            r##"{"title": "t", "slug": "s1", "paths": [], "body_markdown": "# t\n- a"}"##,
        )
        .unwrap();
        assert!(d2.content.starts_with("<!-- oculpm:promoted-from"));
    }

    #[test]
    fn parse_draft_rejects_missing_json_or_empty_fields() {
        assert!(parse_draft_response(&candidate(), "JSON 없음").is_err());
        assert!(parse_draft_response(&candidate(), r#"{"title": "", "body_markdown": ""}"#).is_err());
    }

    #[test]
    fn build_prompt_contains_evidence_and_suggestion() {
        let ev = vec![Evidence {
            title: "B1".into(),
            kind: "bug".into(),
            workday: "20260718".into(),
            files: vec!["src/api/users.ts".into()],
            excerpt: "## 발생 원인\n검증 누락".into(),
        }];
        let p = build_draft_prompt(&candidate(), &ev);
        assert!(p.contains("영역: src/api"));
        assert!(p.contains("src/api/**"));
        assert!(p.contains("검증 누락"));
        assert!(p.contains("변경 파일: src/api/users.ts"));
    }
}
