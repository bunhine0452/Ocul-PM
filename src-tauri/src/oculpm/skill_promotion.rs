//! 반복 절차→스킬 승격 루프 — 실패→규칙 승격(PR-CI4, `rule_promotion`)의
//! 미러다. 규칙이 "재발 방지"라면 스킬은 "재사용 절차": 기간 일지에서 같은
//! tag 가 반복되면(=같은 종류의 작업을 손으로 반복하고 있다는 신호) 그 절차를
//! Claude Code 스킬(`.claude/skills/<slug>/SKILL.md`)로 문서화하자고 제안한다.
//!
//! 승인은 이 모듈 밖 — 프런트가 기존 `skills_save` 를 명시적으로 호출할 때만
//! 파일이 생기며, **이 모듈에는 `.claude/skills` 를 쓰는 코드 경로 자체가 없다**
//! (draft=AI, decision=사람 — rule_promotion 과 같은 구조적 보장).
//!
//! 후보 추출 (LLM 없음):
//! - 일지 tag 로 클러스터링, 같은 tag 가 [`MIN_CLUSTER`]건 이상이면 후보.
//!   entry_type 은 무관 — 반복 절차는 chore/feature 에서도 나온다.
//! - 억제: (a) tag 의 슬러그로 된 스킬 폴더가 이미 있으면, (b) 기존 SKILL.md
//!   본문에 `<!-- promoted-from: tag:<tag> -->` 마커가 있으면 (승인된 후보의
//!   재등장 방지), (c) 시스템성 tag([`TAG_STOPLIST`]·버전 태그)는 절차가 아님.
//!
//! 초안 증거: 그 tag 일지들의 본문 발췌 (디스크 SSOT, redact 통과 — 캐시와
//! 달리 디스크는 마스킹되지 않았으므로 rule_promotion 과 동일하게 정제한다).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::Serialize;

use crate::oculpm::cache::RangeEntry;
use crate::oculpm::redact;
use crate::oculpm::spec::SOURCE_MARKER_TAGS;

/// 한 tag 가 후보가 되기 위한 최소 반복 수. 규칙(실패 2회)보다 높다 —
/// "절차" 라 부르려면 우연한 재등장 이상의 반복이 필요하다.
const MIN_CLUSTER: usize = 3;
/// 후보 나열 상한 (많으면 노이즈 — 상위만).
const CANDIDATE_CAP: usize = 6;
/// 후보당 표본 제목 수 (UI 표시용).
const SAMPLE_TITLES_CAP: usize = 3;
/// LLM 증거로 읽는 일지 수/본문 길이 상한 (프롬프트 바운드).
const EVIDENCE_ENTRIES_CAP: usize = 5;
const EVIDENCE_BODY_CHARS: usize = 1600;
/// 스킬 폴더 위치·파일명 — commands/skills.rs 의 규약과 동일해야 한다.
const SKILLS_SUBDIR: &str = ".claude/skills";
const DISABLED_DIRNAME: &str = ".disabled";
const SKILL_FILENAME: &str = "SKILL.md";
/// 승인 저장된 스킬의 출처 마커 — 재등장 억제 키.
const PROMOTED_MARKER_PREFIX: &str = "<!-- promoted-from: tag:";
const PROMOTED_MARKER_SUFFIX: &str = " -->";
/// 시스템성 tag 스톱리스트 — 분류용 tag 는 절차가 아니다. `v1.2.0` 류 버전
/// 태그는 [`is_version_tag`] 가 따로 거른다.
const TAG_STOPLIST: [&str; 9] = [
    "release", "docs", "fix", "bug", "feature", "refactor", "chore", "test", "ci",
];

// ─────────────────────────────────────────────────────────────────────────────
// DTO
// ─────────────────────────────────────────────────────────────────────────────

/// 결정적 스킬 후보 — 한 tag 의 반복 작업 클러스터.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SkillCandidate {
    /// 원본 tag (억제/재조회 키).
    pub tag: String,
    /// tag 의 폴더명 정규화 (`.claude/skills/<slug>/` 제안 위치).
    pub slug: String,
    /// 이 tag 가 붙은 일지 수.
    pub count: u32,
    /// 가장 최근 등장 workday.
    pub last_workday: String,
    /// 표본 제목 (최신순, 최대 3).
    pub sample_titles: Vec<String>,
}

/// LLM 이 만든 스킬 초안. `content` 가 저장용 SKILL.md 전문 — 프런트는
/// 슬러그만 바꿔서 `skills_save(scope=project, <slug>, content, create=true)`
/// 를 부른다 (승인 없이는 어떤 파일도 쓰이지 않는다).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SkillDraft {
    pub tag: String,
    pub slug: String,
    /// frontmatter description (영어 "Use when …" — 자동 발동 트리거).
    pub description: String,
    /// 본문만 (frontmatter·마커 제외) — 모달 미리보기용.
    pub body_markdown: String,
    /// frontmatter + 본문 + promoted-from 마커의 저장용 완성본.
    pub content: String,
    /// 제안 저장 위치 (`.claude/skills/<slug>/SKILL.md`).
    pub rel_path: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// 결정적 후보 추출 (pure)
// ─────────────────────────────────────────────────────────────────────────────

/// tag → 스킬 폴더명. 소문자화 후 비ASCII/공백/기호는 전부 `-` 로 —
/// commands/skills.rs 의 strict 검증(kebab-case)을 통과해야 한다.
pub fn slug_of_tag(tag: &str) -> String {
    let mut s: String = tag
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
    let s = s.trim_matches(|c| c == '-' || c == '_').to_string();
    let s = if s.len() > 48 {
        s[..48].trim_matches(|c| c == '-' || c == '_').to_string()
    } else {
        s
    };
    // 전부 비ASCII(예: 한글 tag)면 빈 문자열 — tag 해시 접미사로 결정적이되
    // 서로 다른 태그끼리 충돌하지 않는 폴백을 만든다 (단일 "promoted-skill"
    // 폴백은 폴더가 하나 생기는 순간 이후 모든 비ASCII 후보를 억제해 버린다).
    // 사용자가 모달에서 슬러그를 고칠 수 있으니 저장이 막히지는 않는다.
    if s.is_empty() {
        let h = blake3::hash(tag.trim().as_bytes()).to_hex();
        format!("promoted-skill-{}", &h.as_str()[..8])
    } else {
        s
    }
}

/// `v1`, `v1.2.0` 같은 버전 태그 — 릴리스 표식이지 절차가 아니다.
fn is_version_tag(tag: &str) -> bool {
    let t = tag.trim();
    t.len() >= 2
        && (t.starts_with('v') || t.starts_with('V'))
        && t.chars().nth(1).is_some_and(|c| c.is_ascii_digit())
}

fn is_stoplisted(tag: &str) -> bool {
    let lower = tag.trim().to_lowercase();
    TAG_STOPLIST.contains(&lower.as_str())
        || is_version_tag(&lower)
        // 출처 표식(`mcp-tool`) — 누가 기록했는가의 신호일 뿐 반복 절차가
        // 아니다. 이 저장소 표본은 727건 중 431건에 붙어 있어, 빼지 않으면
        // 언제나 1위 클러스터가 돼 실제 절차 후보를 밀어낸다.
        || SOURCE_MARKER_TAGS.contains(&lower.as_str())
}

/// 후보 추출 본체 (pure). `existing_slugs` 는 스킬 폴더명(비활성 포함),
/// `promoted_tags` 는 기존 SKILL.md 에서 수확한 promoted-from tag 들.
pub fn extract_candidates(
    entries: &[RangeEntry],
    existing_slugs: &BTreeSet<String>,
    promoted_tags: &BTreeSet<String>,
) -> Vec<SkillCandidate> {
    // 소문자 정규화 키 → (첫 등장 표기, 일지 인덱스). 'Migration'/'migration'
    // 이 갈려 임계에 못 미치는 비일관을 막는다 (스톱리스트·슬러그와 동일 규율).
    let mut clusters: BTreeMap<String, (String, Vec<usize>)> = BTreeMap::new();
    for (i, e) in entries.iter().enumerate() {
        let tags: BTreeSet<&str> = e
            .tags
            .iter()
            .map(|t| t.trim())
            .filter(|t| !t.is_empty())
            .collect();
        for t in tags {
            let entry = clusters
                .entry(t.to_lowercase())
                .or_insert_with(|| (t.to_string(), Vec::new()));
            entry.1.push(i);
        }
    }

    let mut out: Vec<SkillCandidate> = Vec::new();
    for (tag_lower, (tag, idxs)) in clusters {
        if idxs.len() < MIN_CLUSTER {
            continue;
        }
        if is_stoplisted(&tag) {
            continue;
        }
        if promoted_tags.contains(&tag_lower) {
            continue;
        }
        let slug = slug_of_tag(&tag);
        if existing_slugs.contains(&slug) {
            continue;
        }
        // 최신 등장이 먼저 오도록 workday 내림차순 (동일 workday 는 경로순).
        let mut ordered: Vec<&RangeEntry> = idxs.iter().map(|&i| &entries[i]).collect();
        ordered.sort_by(|a, b| {
            b.workday
                .cmp(&a.workday)
                .then_with(|| b.relative_path.cmp(&a.relative_path))
        });
        out.push(SkillCandidate {
            count: ordered.len() as u32,
            last_workday: ordered
                .first()
                .map(|e| e.workday.clone())
                .unwrap_or_default(),
            sample_titles: ordered
                .iter()
                .take(SAMPLE_TITLES_CAP)
                .map(|e| e.title.clone())
                .collect(),
            slug,
            tag,
        });
    }

    // 많이 반복된 순 → 최근 순 → tag 순. 상한 적용.
    out.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| b.last_workday.cmp(&a.last_workday))
            .then_with(|| a.tag.cmp(&b.tag))
    });
    out.truncate(CANDIDATE_CAP);
    out
}

/// 프로젝트 스킬 폴더의 기존 폴더명을 모은다 (비활성 `.disabled/` 포함 —
/// 끈 스킬과 같은 이름을 다시 제안하면 skills_save 가 어차피 거부한다).
pub fn existing_skill_slugs(project_root: &Path) -> BTreeSet<String> {
    let root = project_root.join(SKILLS_SUBDIR);
    let mut out = BTreeSet::new();
    for dir in [root.clone(), root.join(DISABLED_DIRNAME)] {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            if !ft.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') {
                out.insert(name);
            }
        }
    }
    out
}

/// 기존 SKILL.md 본문에서 promoted-from tag 마커를 수확한다.
pub fn harvest_promoted_tags(project_root: &Path) -> BTreeSet<String> {
    let root = project_root.join(SKILLS_SUBDIR);
    let mut tags = BTreeSet::new();
    let dirs: Vec<_> = [root.clone(), root.join(DISABLED_DIRNAME)]
        .into_iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flatten()
        .flatten()
        .map(|e| e.path())
        .collect();
    for dir in dirs {
        let Ok(text) = std::fs::read_to_string(dir.join(SKILL_FILENAME)) else {
            continue;
        };
        // 마커는 마지막 줄 규약이지만 위치를 강제하지 않는다 — 어디 있든 억제.
        for line in text.lines() {
            if let Some(tag) = line
                .trim()
                .strip_prefix(PROMOTED_MARKER_PREFIX)
                .and_then(|s| s.strip_suffix(PROMOTED_MARKER_SUFFIX))
            {
                // 클러스터 키와 같은 축(소문자)으로 대조 — 케이스 변형 재등장 억제.
                tags.insert(tag.trim().to_lowercase());
            }
        }
    }
    tags
}

/// 디스크에서 억제 재료를 모아 후보를 뽑는 상위 헬퍼 (commands 진입점).
pub fn candidates_for(project_root: &Path, entries: &[RangeEntry]) -> Vec<SkillCandidate> {
    let existing = existing_skill_slugs(project_root);
    let promoted = harvest_promoted_tags(project_root);
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
    /// redact 통과한 본문 발췌.
    pub excerpt: String,
}

/// 그 tag 일지들의 제목+본문 발췌를 모은다. 본문은 디스크 SSOT 를 읽되
/// **redact 패턴을 통과시킨 뒤** 잘라낸다 (rule_promotion 과 동일 — 캐시는
/// 마스킹돼 있지만 디스크 원문은 아니다). 읽기 실패는 빈 발췌로 삼키지 않고
/// 발췌 자리에 명시한다 — "증거 없음" 과 "증거 유실" 의 구분.
pub fn gather_evidence(
    project_root: &Path,
    candidate: &SkillCandidate,
    entries: &[RangeEntry],
) -> Vec<Evidence> {
    let patterns = redact::patterns_for_project(project_root);
    let mut tagged: Vec<&RangeEntry> = entries
        .iter()
        .filter(|e| {
            e.tags
                .iter()
                .any(|t| t.trim().eq_ignore_ascii_case(&candidate.tag))
        })
        .collect();
    tagged.sort_by(|a, b| {
        b.workday
            .cmp(&a.workday)
            .then_with(|| b.relative_path.cmp(&a.relative_path))
    });
    let mut out = Vec::new();
    for e in tagged.into_iter().take(EVIDENCE_ENTRIES_CAP) {
        let disk = project_root
            .join(".oculpm")
            .join("journal")
            .join(&e.relative_path);
        let excerpt = match std::fs::read_to_string(&disk) {
            Ok(raw) => {
                // frontmatter 는 메타데이터(제목·태그는 이미 별도 필드) — 이
                // 저장소 실측으로 frontmatter 만 500~1,700자라, 벗기지 않으면
                // 발췌 상한이 절차 본문을 한 글자도 못 담는다.
                let body = strip_frontmatter(&raw);
                let (masked, _) = redact::redact_text(body, &patterns);
                truncate_chars(&masked, EVIDENCE_BODY_CHARS)
            }
            // 에러 반환이 아니라 **프롬프트 증거 본문**에 끼우는 자리표시자다
            // — 모델에게 가는 문구라 §4.5 대로 한국어로 둔다.
            Err(_) => format!(
                "(일지 파일을 읽지 못했습니다: {} — 디스크에서 이동/삭제된 듯)",
                e.relative_path
            ),
        };
        out.push(Evidence {
            title: e.title.clone(),
            kind: e.entry_type.clone(),
            workday: e.workday.clone(),
            excerpt,
        });
    }
    out
}

/// 일지 frontmatter(`---` 블록)를 벗기고 본문만 남긴다. 규격이 아니면 원문.
fn strip_frontmatter(md: &str) -> &str {
    md.strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n").map(|(_, b)| b))
        .map(str::trim_start)
        .unwrap_or(md)
}

fn truncate_chars(s: &str, cap: usize) -> String {
    if s.chars().count() <= cap {
        return s.to_string();
    }
    let cut: String = s.chars().take(cap).collect();
    format!("{cut}\n…(잘림)")
}

/// LLM system 프롬프트 — SKILL.md 전문 하나만 출력하게 강제한다.
pub const DRAFT_SYSTEM_PROMPT: &str = r##"너는 코딩 에이전트가 재사용할 Claude Code "스킬 파일"(SKILL.md)을 작성하는 시니어 엔지니어다.
입력은 같은 태그로 반복된 작업 일지의 증거다. 이 반복 절차를 다음에 같은 작업이
왔을 때 에이전트가 그대로 따를 수 있는 스킬 하나로 문서화하라.

출력은 SKILL.md 전문 **하나만** — 다른 설명/코드펜스 금지. 형식:
---
name: kebab-case-english
description: "English, 1-2 sentences in the form 'Use when ...' — 자동 발동 트리거"
---

# 한국어 제목

(본문: 한국어로 절차를 적는다 — 단계, 각 단계의 검증 방법, 빠지기 쉬운 함정)

<!-- promoted-from: tag:<tag> -->

규칙:
- 일지에 없는 절차를 지어내지 말 것 — 증거에 나온 단계·명령·파일만 근거로 써라.
- name 은 영문 소문자·숫자·하이픈만.
- description 은 영어 1~2문장, 반드시 'Use when …' 형식 — 이 문장으로 스킬이 자동 발동된다.
- 본문은 번호 매긴 단계 목록 중심으로, 단계마다 확인(검증) 방법을 붙여라.
- 마지막 줄의 promoted-from 주석은 그대로 유지하라."##;

/// user 프롬프트 — 후보 요약 + 증거 발췌.
pub fn build_draft_prompt(candidate: &SkillCandidate, evidence: &[Evidence]) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "태그: {}\n반복: {}회 (최근 {})\n제안 슬러그: {}\n",
        candidate.tag, candidate.count, candidate.last_workday, candidate.slug,
    ));
    for (i, ev) in evidence.iter().enumerate() {
        out.push_str(&format!(
            "\n[증거 {} — ({}, {}) {}]\n",
            i + 1,
            ev.kind,
            ev.workday,
            ev.title,
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

/// name 을 kebab-case 로 정규화한다 (LLM 출력 방어) — slug_of_tag 와 같은
/// 규칙이므로 그대로 재사용한다.
fn sanitize_slug(raw: &str) -> String {
    slug_of_tag(raw)
}

/// LLM 텍스트에서 SKILL.md 를 관대하게 추출·검증해 초안을 조립한다.
/// frontmatter(name/description) 누락은 에러, promoted-from 마커 누락은
/// 자동 부착 (마커는 재등장 억제 장치라 빠지면 안 된다).
pub fn parse_draft_response(
    candidate: &SkillCandidate,
    response: &str,
) -> Result<SkillDraft, String> {
    // 코드펜스·서두 잡담 방어 — 첫 frontmatter 구분선부터 취한다.
    let text = response.trim();
    let start = text
        .find("---")
        .ok_or_else(|| "No frontmatter in the skill draft response".to_string())?;
    let text = &text[start..];
    let rest = text
        .strip_prefix("---")
        .ok_or_else(|| "No frontmatter in the skill draft response".to_string())?;
    let end = rest
        .find("\n---")
        .ok_or_else(|| "The skill draft frontmatter was never closed".to_string())?;
    let yaml: serde_yaml::Value = serde_yaml::from_str(&rest[..end])
        .map_err(|e| format!("Could not parse the skill draft frontmatter: {e}"))?;
    let get = |key: &str| {
        yaml.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let name = get("name").ok_or_else(|| "The skill draft has an empty name".to_string())?;
    let description =
        get("description").ok_or_else(|| "The skill draft has an empty description".to_string())?;

    // 본문 = 닫는 --- 줄 다음부터. 코드펜스 잔여(```)와 마커는 떼어 낸다 —
    // content 는 결정적으로 재조립하므로 본문은 순수 마크다운만 남긴다.
    let after = &rest[end + 4..];
    let after = after.strip_prefix('\n').unwrap_or(after);
    // 마커는 우리가 결정적으로 재부착하므로, LLM 이 에코한(혹은 증거에서
    // 주입된) promoted-from 줄은 **어느 태그든 전부** 제거한다 — 남으면
    // 무관한 태그의 후보 제안을 영구 억제한다.
    let cleaned: String = after
        .lines()
        .filter(|l| !l.trim_start().starts_with(PROMOTED_MARKER_PREFIX))
        .collect::<Vec<_>>()
        .join("\n");
    // 트레일링 ``` 제거는 응답 전체가 펜스로 감싸였을 때만 — 무조건 떼면
    // 본문이 정상 코드블록으로 끝나는 초안의 닫는 펜스를 잘라먹는다.
    let had_wrapping_fence = response.trim()[..start].contains("```");
    let mut body = cleaned.trim().to_string();
    if had_wrapping_fence {
        body = body.trim_end_matches("```").trim_end().to_string();
    }
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("The skill draft has an empty body".into());
    }

    let slug = sanitize_slug(&name);
    let content = render_skill_content(&slug, &description, &body, &candidate.tag);
    Ok(SkillDraft {
        tag: candidate.tag.clone(),
        rel_path: format!("{SKILLS_SUBDIR}/{slug}/{SKILL_FILENAME}"),
        slug,
        description,
        body_markdown: body,
        content,
    })
}

/// 저장용 완성본 — 스킬 frontmatter 규격 + 출처 마커. 마커 덕에 같은 tag 가
/// 다시 제안되지 않는다 (harvest_promoted_tags).
pub fn render_skill_content(slug: &str, description: &str, body: &str, tag: &str) -> String {
    let desc = description.replace(char::is_control, " ");
    let mut out = format!(
        "---\nname: {slug}\ndescription: {}\n---\n\n",
        serde_json::to_string(desc.trim()).unwrap_or_default(),
    );
    out.push_str(body.trim());
    out.push_str(&format!(
        "\n\n{PROMOTED_MARKER_PREFIX}{tag}{PROMOTED_MARKER_SUFFIX}\n"
    ));
    out
}

#[cfg(test)]
#[path = "skill_promotion_tests.rs"]
mod tests;
