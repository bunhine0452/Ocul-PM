//! PR-CI3 — 규칙 허브 백엔드 (docs/claude-integration/03-rules-hub-ui-spec.md).
//!
//! Claude Code 의 메모리/규칙 파일 계층을 관리한다:
//!
//! - **CLAUDE.md 계열 고정 슬롯** — 프로젝트 `CLAUDE.md` · `.claude/CLAUDE.md` ·
//!   `CLAUDE.local.md`, 전역 `~/.claude/CLAUDE.md`. 없어도 `exists=false` 로
//!   나열해 UI 가 "만들기" 를 제공한다 (삭제는 비제공 — 파괴적 조작 위임).
//! - **규칙 파일** — `.claude/rules/**/*.md` (프로젝트+전역, 재귀·깊이 4).
//!   frontmatter 는 공식 스키마인 `paths: [glob…]` 만 해석한다 (없으면 항상
//!   로드 — 실측 2026-07-20, 스펙 문서 §1).
//! - **Cursor `.mdc` 미러 번역** — 옵인(`config.agents.rules_translate`) 시
//!   프로젝트 규칙을 `.cursor/rules/<평탄화>.mdc` 로 병행 배포. `paths` →
//!   `globs`+`alwaysApply:false`, 무-`paths` → `alwaysApply:true`. 소유는
//!   본문 첫 줄의 [`MIRROR_MARKER_PREFIX`] 마커로 식별하고, 마커 없는 기존
//!   파일은 절대 덮어쓰지 않는다 (`conflict` 보고).
//!
//! SSOT 는 디스크 파일이다 — 스킬(commands/skills.rs)과 동일하게 캐시 없음.
//! 모든 쓰기는 멱등(동일 바이트면 무기록)으로 watcher 증폭을 막는다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::error::{OculpmError, OculpmResult};

/// 규칙 폴더 (스코프 루트 기준). Claude Code 규약 고정.
pub const RULES_SUBDIR: &str = ".claude/rules";
/// Cursor 규칙 폴더 (프로젝트 루트 기준).
const CURSOR_RULES_SUBDIR: &str = ".cursor/rules";
/// 미러 소유 마커 — 이 줄이 있는 `.mdc` 만 우리가 갱신/삭제한다.
const MIRROR_MARKER_PREFIX: &str = "<!-- oculpm:rule-mirror ";
const MIRROR_MARKER_SUFFIX: &str = " -->";
/// `config.agents.rules_translate` 에 허용되는 번역 타깃 (v1: Cursor 만).
pub const TRANSLATE_TARGETS: &[&str] = &["cursor"];
/// 파일 저장 상한 — 스킬과 동일 근거 (에이전트 컨텍스트에 통째로 들어간다).
const MAX_RULE_BYTES: usize = 512 * 1024;
/// rules/ 재귀 나열 상한 (비정상 트리 가드).
const MAX_LISTED_RULES: usize = 200;
const MAX_RULES_DEPTH: u8 = 4;

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RuleScope {
    /// 프로젝트 루트 기준 (`<project>/CLAUDE.md`, `<project>/.claude/rules/…`).
    Project,
    /// 홈 디렉터리 기준 (`~/.claude/CLAUDE.md`, `~/.claude/rules/…`).
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RuleKind {
    /// CLAUDE.md 계열 고정 슬롯 (항상 로드되는 메모리 파일).
    ClaudeMd,
    /// `.claude/rules/**/*.md` 규칙 파일.
    Rule,
}

/// Cursor 미러 상태 — 프로젝트 스코프 `Rule` 에만 의미가 있다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum MirrorState {
    /// 미러 없음 (번역 꺼짐 포함).
    None,
    /// 우리 마커가 있는 미러가 존재.
    Mirrored,
    /// 같은 경로에 마커 없는 파일이 존재 — 건드리지 않는다.
    Conflict,
}

/// 목록의 한 줄. `(scope, rel_path)` 가 조작 키다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RuleEntry {
    pub scope: RuleScope,
    pub kind: RuleKind,
    /// 스코프 루트 상대 경로 (`CLAUDE.md`, `.claude/rules/api/validation.md` …).
    pub rel_path: String,
    /// 표시명 — ClaudeMd 는 파일명, Rule 은 rules/ 이하 스템 (`api/validation`).
    pub name: String,
    /// 본문 첫 H1 텍스트 (없으면 빈 문자열) — 목록 부제용.
    pub title: String,
    /// ClaudeMd 슬롯 전용 — 파일이 아직 없으면 false ("만들기" 어포던스).
    pub exists: bool,
    /// frontmatter `paths` (없으면 빈 배열 = 항상 로드).
    pub paths: Vec<String>,
    pub bytes: u32,
    pub mirror: MirrorState,
}

/// `rules_list` 응답 — 전 스코프를 한 번에 (스킬 overview 패턴).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RulesOverview {
    /// 고정 슬롯 (프로젝트 3 + 전역 1, exists=false 포함).
    pub claude_md: Vec<RuleEntry>,
    pub project_rules: Vec<RuleEntry>,
    pub global_rules: Vec<RuleEntry>,
    /// 절대 경로 — 빈 상태 안내용.
    pub project_rules_dir: String,
    pub global_rules_dir: String,
    /// `config.agents.rules_translate` 에 "cursor" 가 있는가.
    pub cursor_translate: bool,
}

/// `rules_read` 응답.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RuleDetail {
    pub entry: RuleEntry,
    pub content: String,
    /// 절대 경로 — 외부 에디터로 열 때 사용.
    pub abs_path: String,
}

/// 미러 쓰기/제거 한 건의 결과.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct MirrorWriteResult {
    /// 번역 타깃 id (v1: "cursor").
    pub target: String,
    /// 원본 rel_path.
    pub source_rel: String,
    /// "written" | "unchanged" | "removed" | "conflict".
    pub action: String,
    /// 미러 파일의 프로젝트 상대 경로.
    pub mirror_rel: String,
}

/// `rules_save` 응답 — 저장된 엔트리 + (옵인 시) 미러 결과.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RuleSaveOutcome {
    pub entry: RuleEntry,
    pub mirror: Option<MirrorWriteResult>,
}

// ─────────────────────────────────────────────────────────────────────────────
// 경로 검증
// ─────────────────────────────────────────────────────────────────────────────

/// 프로젝트 스코프의 ClaudeMd 고정 슬롯 (표시 순서 = 로드 순서 근사).
const PROJECT_CLAUDE_MD_SLOTS: &[&str] = &["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
/// 전역 스코프의 ClaudeMd 슬롯 (`~/.claude/CLAUDE.md`).
const GLOBAL_CLAUDE_MD_SLOTS: &[&str] = &[".claude/CLAUDE.md"];

fn claude_md_slots(scope: RuleScope) -> &'static [&'static str] {
    match scope {
        RuleScope::Project => PROJECT_CLAUDE_MD_SLOTS,
        RuleScope::Global => GLOBAL_CLAUDE_MD_SLOTS,
    }
}

/// `rel_path` 를 (kind 판별 + 탈출 차단) 검증한다. 허용 목록 밖은 전부 거부 —
/// 이 함수가 이 모듈의 유일한 경로 입구다.
pub fn validate_rel(scope: RuleScope, rel_path: &str) -> Result<RuleKind, String> {
    if claude_md_slots(scope).contains(&rel_path) {
        return Ok(RuleKind::ClaudeMd);
    }
    let prefix = format!("{RULES_SUBDIR}/");
    let Some(inner) = rel_path.strip_prefix(&prefix) else {
        return Err(format!("Rule path is not allowed: {rel_path}"));
    };
    if !inner.ends_with(".md") {
        return Err("Rule files must be .md".into());
    }
    if inner.len() > 200 {
        return Err("Rule path is too long (over 200 characters)".into());
    }
    let segments: Vec<&str> = inner.split('/').collect();
    if segments.len() > MAX_RULES_DEPTH as usize {
        return Err(format!(
            "Rule folders may nest at most {MAX_RULES_DEPTH} levels"
        ));
    }
    for (i, seg) in segments.iter().enumerate() {
        let is_last = i == segments.len() - 1;
        let stem = if is_last {
            seg.strip_suffix(".md").unwrap_or(seg)
        } else {
            seg
        };
        if stem.is_empty()
            || stem == "."
            || stem == ".."
            || stem.starts_with('.')
            || stem.contains('\\')
        {
            return Err(format!("Rule path contains an unusable name: {seg:?}"));
        }
    }
    Ok(RuleKind::Rule)
}

/// 신규 생성 이름 규칙 — 스킬과 동일한 kebab-case (평탄 생성만 허용).
pub fn validate_new_rule_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err("Rule name may only use lowercase letters, digits, and hyphens (kebab-case)".into())
    }
}

/// 검증 통과한 rel 을 스코프 루트 아래 절대 경로로 정규화 + 감금한다.
///
/// 프로젝트 쪽은 저장소에 실려 온다 — 링크까지 풀어 루트 안인지 본다
/// (`path_guard`, 보안 피드백 2차: `.claude -> ~/.claude` 이면 프로젝트 규칙
/// 화면이 전역 규칙을 고치고 지웠다). 홈 쪽은 사용자 자신의 설정이라
/// `~/.claude -> dotfiles` 같은 링크가 정상이다 — 어휘 검사만 한다.
fn secure_path(scope: RuleScope, scope_root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    if scope == RuleScope::Project {
        return crate::path_guard::secure_join(scope_root, rel_path);
    }
    let clean = crate::indexer::clean_path(&scope_root.join(rel_path));
    let root_clean = crate::indexer::clean_path(scope_root);
    if clean.starts_with(&root_clean) {
        Ok(clean)
    } else {
        Err("Access denied: path is outside the scope".into())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// frontmatter 파싱 (관대 — 실패해도 에러로 만들지 않는다)
// ─────────────────────────────────────────────────────────────────────────────

/// `paths` 배열(단일 문자열도 수용)과 본문 첫 H1 을 추출한다.
pub fn parse_rule_meta(content: &str) -> (Vec<String>, String) {
    let (fm, body) = split_frontmatter(content);
    let mut paths = Vec::new();
    if let Some(fm) = fm {
        if let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(fm) {
            match yaml.get("paths") {
                Some(serde_yaml::Value::Sequence(seq)) => {
                    for v in seq {
                        if let Some(s) = v.as_str() {
                            let s = s.trim();
                            if !s.is_empty() {
                                paths.push(s.to_string());
                            }
                        }
                    }
                }
                Some(serde_yaml::Value::String(s)) => {
                    let s = s.trim();
                    if !s.is_empty() {
                        paths.push(s.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    let title = body
        .lines()
        .find_map(|l| l.strip_prefix("# ").map(|t| t.trim().to_string()))
        .unwrap_or_default();
    (paths, title)
}

/// `(frontmatter 내부, 본문)` — frontmatter 가 없으면 `(None, 전체)`.
/// 여닫는 구분자는 **정확히 `---` 한 줄**이어야 한다 — 종전의 접두/부분 문자열
/// 매칭은 `----` 수평선이나 `--- 제목` 을 frontmatter 로 오인해 미러 본문을
/// 유실시켰다 (#a0-review-fixes ④). 닫는 줄을 못 찾으면 전체를 본문으로 취급.
pub(crate) fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let first_line_end = content.find('\n').map(|i| i + 1).unwrap_or(content.len());
    let first_line = content[..first_line_end].trim_end_matches(['\n', '\r']);
    if first_line != "---" {
        return (None, content);
    }
    let rest = &content[first_line_end..];
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\n', '\r']) == "---" {
            return (Some(&rest[..offset]), &rest[offset + line.len()..]);
        }
        offset += line.len();
    }
    (None, content)
}

// ─────────────────────────────────────────────────────────────────────────────
// 목록/읽기/저장/삭제
// ─────────────────────────────────────────────────────────────────────────────

fn build_entry(
    scope: RuleScope,
    kind: RuleKind,
    rel_path: &str,
    content: Option<&str>,
    project_root: Option<&Path>,
) -> RuleEntry {
    let (paths, title) = content.map(parse_rule_meta).unwrap_or_default();
    let name = match kind {
        RuleKind::ClaudeMd => rel_path.rsplit('/').next().unwrap_or(rel_path).to_string(),
        RuleKind::Rule => rel_path
            .strip_prefix(&format!("{RULES_SUBDIR}/"))
            .unwrap_or(rel_path)
            .trim_end_matches(".md")
            .to_string(),
    };
    let mirror = match (scope, kind, project_root) {
        (RuleScope::Project, RuleKind::Rule, Some(root)) => mirror_state(root, rel_path),
        _ => MirrorState::None,
    };
    RuleEntry {
        scope,
        kind,
        rel_path: rel_path.to_string(),
        name,
        title,
        exists: content.is_some(),
        paths,
        bytes: content
            .map(|c| u32::try_from(c.len()).unwrap_or(u32::MAX))
            .unwrap_or(0),
        mirror,
    }
}

/// 읽기 경로 공통 가드 (#a0-review-fixes ⑤) — 저장(`MAX_RULE_BYTES`)과 달리
/// 읽기에는 상한이 없어 거대 파일이 목록/미러 경로에서 통째로 메모리에 올라
/// 왔다. `Ok(Some)` 정상 / `Ok(None)` 파일 없음 / `Err(())` 상한 초과·IO 오류
/// (호출측이 "검증 불능" 으로 취급해야 하는 상태).
fn read_capped(path: &Path) -> Result<Option<String>, ()> {
    match std::fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
        Ok(m) if m.len() > MAX_RULE_BYTES as u64 => return Err(()),
        Ok(_) => {}
    }
    match std::fs::read_to_string(path) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(()),
    }
}

/// 스코프 루트에서 overview 한 쪽을 만든다. `project_root` 는 미러 상태 계산용
/// (프로젝트 스코프일 때만 Some).
fn list_scope(scope: RuleScope, scope_root: &Path, project_root: Option<&Path>) -> Vec<RuleEntry> {
    let mut out = Vec::new();
    let rules_dir = scope_root.join(RULES_SUBDIR);
    let mut rels = Vec::new();
    collect_rule_files(&rules_dir, &rules_dir, 0, &mut rels);
    rels.sort();
    for inner in rels.into_iter().take(MAX_LISTED_RULES) {
        let rel = format!("{RULES_SUBDIR}/{inner}");
        let Ok(Some(content)) = read_capped(&scope_root.join(&rel)) else {
            continue;
        };
        out.push(build_entry(
            scope,
            RuleKind::Rule,
            &rel,
            Some(&content),
            project_root,
        ));
    }
    out
}

fn collect_rule_files(base: &Path, dir: &Path, depth: u8, out: &mut Vec<String>) {
    if depth >= MAX_RULES_DEPTH || out.len() >= MAX_LISTED_RULES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_LISTED_RULES {
            return;
        }
        let Ok(ft) = entry.file_type() else { continue };
        // 심볼릭 링크는 루프/탈출 위험 — 따라가지 않는다 (skills/docs 와 동일).
        if ft.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if ft.is_dir() {
            collect_rule_files(base, &entry.path(), depth + 1, out);
        } else if name.ends_with(".md") {
            if let Ok(rel) = entry.path().strip_prefix(base) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

/// `rules_list` 본체. `cursor_translate` 는 호출측(commands)이 config 에서 읽어
/// 넘긴다 — 이 모듈은 config 로딩을 소유하지 않는다.
pub fn overview(project_root: &Path, home: &Path, cursor_translate: bool) -> RulesOverview {
    let mut claude_md = Vec::new();
    for (scope, scope_root) in [
        (RuleScope::Project, project_root),
        (RuleScope::Global, home),
    ] {
        for rel in claude_md_slots(scope) {
            let content = read_capped(&scope_root.join(rel)).ok().flatten();
            claude_md.push(build_entry(
                scope,
                RuleKind::ClaudeMd,
                rel,
                content.as_deref(),
                None,
            ));
        }
    }
    RulesOverview {
        claude_md,
        project_rules: list_scope(RuleScope::Project, project_root, Some(project_root)),
        global_rules: list_scope(RuleScope::Global, home, None),
        project_rules_dir: project_root.join(RULES_SUBDIR).display().to_string(),
        global_rules_dir: home.join(RULES_SUBDIR).display().to_string(),
        cursor_translate,
    }
}

pub fn read(
    scope: RuleScope,
    scope_root: &Path,
    project_root: &Path,
    rel_path: &str,
) -> Result<RuleDetail, String> {
    let kind = validate_rel(scope, rel_path)?;
    let abs = secure_path(scope, scope_root, rel_path)?;
    if std::fs::metadata(&abs).map(|m| m.len()).unwrap_or(0) > MAX_RULE_BYTES as u64 {
        return Err(format!(
            "Rule file exceeds the read limit ({}KB) - clean up files that grew outside the app",
            MAX_RULE_BYTES / 1024
        ));
    }
    let content =
        std::fs::read_to_string(&abs).map_err(|e| format!("Could not read the rule file: {e}"))?;
    let project_root = (scope == RuleScope::Project).then_some(project_root);
    Ok(RuleDetail {
        entry: build_entry(scope, kind, rel_path, Some(&content), project_root),
        content,
        abs_path: abs.display().to_string(),
    })
}

/// 저장. `create=true` 는 기존 파일이 있으면 거부 (덮어쓰기 사고 방지).
/// 미러 갱신은 하지 않는다 — 호출측이 [`write_mirror`] 를 조합한다 (config
/// 소유권 분리).
pub fn save(
    scope: RuleScope,
    scope_root: &Path,
    project_root: &Path,
    rel_path: &str,
    content: &str,
    create: bool,
) -> Result<RuleEntry, String> {
    if content.len() > MAX_RULE_BYTES {
        return Err("Rule file is too large (over 512KB)".into());
    }
    let kind = validate_rel(scope, rel_path)?;
    // 신규 규칙은 rules/ 바로 아래 kebab-case 만 (중첩·기존 파일 편집은 자유).
    if create && kind == RuleKind::Rule {
        let inner = rel_path
            .strip_prefix(&format!("{RULES_SUBDIR}/"))
            .unwrap_or(rel_path);
        if inner.contains('/') {
            return Err("New rules can only be created directly under rules/".into());
        }
        validate_new_rule_name(inner.trim_end_matches(".md"))?;
    }
    let abs = secure_path(scope, scope_root, rel_path)?;
    if create && abs.exists() {
        return Err(format!("File already exists: {rel_path}"));
    }
    // 앱 소유 관리 블록 보호 (2026-07-20 적대 리뷰 HIGH). 일부 슬롯(특히
    // `.claude/CLAUDE.md`)은 어댑터가 `<!-- oculpm:begin v1 -->` 구간을
    // **매 sync 마다 재작성**한다. 규칙 허브가 전체 파일을 덮어쓰면 (a) 사용자가
    // 블록 *안에* 쓴 내용이 다음 sync 에 조용히 사라지고, (b) 편집 중 sync 가
    // 끼면 낡은 스냅샷이 어댑터 갱신을 되돌린다. 블록 밖은 자유롭게 편집하되,
    // 블록 안이 디스크와 다르면 저장을 거부한다 (claude_hooks/mcp::register 의
    // "해석 불가 대상은 쓰지 않는다" 계약과 같은 정신).
    guard_managed_block(&abs, content)?;
    // 멱등: 동일 바이트면 디스크를 건드리지 않는다 (watcher 증폭 방지).
    let unchanged = std::fs::read(&abs).is_ok_and(|cur| cur == content.as_bytes());
    if !unchanged {
        write_atomic(&abs, content.as_bytes()).map_err(|e| e.to_string())?;
    }
    let project_root = (scope == RuleScope::Project).then_some(project_root);
    Ok(build_entry(
        scope,
        kind,
        rel_path,
        Some(content),
        project_root,
    ))
}

/// 문자열에서 oculpm 관리 블록 **본문**을 뽑는다.
/// `Ok(None)` = 블록 없음, `Err` = 마커 짝이 안 맞음(어댑터가 영구 에러로
/// 취급하는 상태 — 저장 자체를 막아야 한다).
fn extract_managed_block(text: &str) -> Result<Option<String>, String> {
    let mut inner: Vec<&str> = Vec::new();
    let mut in_block = false;
    let mut closed = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("<!--") && t.contains("oculpm:begin") {
            if in_block || closed {
                return Err("Duplicate oculpm managed-block markers".into());
            }
            in_block = true;
            continue;
        }
        if t.starts_with("<!--") && t.contains("oculpm:end") {
            if !in_block {
                return Err("An oculpm:end marker appears without a begin".into());
            }
            in_block = false;
            closed = true;
            continue;
        }
        if in_block {
            inner.push(line);
        }
    }
    if in_block {
        return Err("An oculpm:begin marker was never closed".into());
    }
    Ok(closed.then(|| inner.join("\n")))
}

/// 저장 전 관리 블록 무결성 검사. 디스크에 블록이 있으면 저장 내용의 같은
/// 구간이 바이트 동일해야 한다.
fn guard_managed_block(abs: &Path, content: &str) -> Result<(), String> {
    // 저장 내용 자체가 깨진 마커면 무조건 거부 — 어댑터를 영구 에러 상태로
    // 만들 수 있다.
    let incoming = extract_managed_block(content)?;
    let on_disk = match read_capped(abs) {
        Ok(Some(cur)) => extract_managed_block(&cur).unwrap_or(None),
        Ok(None) => None, // 신규 파일 → 보호할 블록 없음
        Err(()) => {
            return Err(
                "The existing file exceeds the read limit or could not be read, so the \
                 managed block could not be verified - aborting the save"
                    .into(),
            )
        }
    };
    let Some(disk_block) = on_disk else {
        return Ok(());
    };
    match incoming {
        Some(ref new_block) if new_block == &disk_block => Ok(()),
        _ => Err(
            "The `oculpm:begin/end` region of this file is managed by ocul-pm (rewritten on \
             every agent sync). You can edit freely outside the block, but not inside it - \
             to change the rule text, edit `.oculpm/agents/_template.md`."
                .into(),
        ),
    }
}

/// AD-6 — **승인형 저장 + 원본 백업** (마스터플랜 D4 의 소유권 규율).
///
/// 규칙 다이어트가 고치는 파일은 대개 `~/.claude/rules/**` — 우리 마커가 없는
/// **사용자 소유** 파일이다. 그래서 쓰기 전에 현재 바이트를 `<파일>.bak` 으로
/// 남긴다: 제안이 틀렸을 때 되돌릴 길이 앱 밖에 있어야 한다.
///
/// 백업은 **직전 원본 한 벌**이다 (같은 파일을 두 번 좁히면 갱신된다) — 여러
/// 세대를 남기면 사용자의 규칙 폴더가 우리 쓰레기로 찬다.
///
/// 새 파일은 만들지 않는다(`create=false` 고정): 백업할 원본이 없다는 건
/// 이 경로를 잘못 쓰고 있다는 뜻이다.
pub fn save_with_backup(
    scope: RuleScope,
    scope_root: &Path,
    project_root: &Path,
    rel_path: &str,
    content: &str,
) -> Result<(RuleEntry, String), String> {
    validate_rel(scope, rel_path)?;
    let abs = secure_path(scope, scope_root, rel_path)?;
    let original = std::fs::read(&abs)
        .map_err(|e| format!("Could not read the rule before backing it up: {e}"))?;
    let backup = abs.with_extension(match abs.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("{ext}.bak"),
        None => "bak".to_string(),
    });
    write_atomic(&backup, &original).map_err(|e| format!("Could not write the backup: {e}"))?;
    let entry = save(scope, scope_root, project_root, rel_path, content, false)?;
    Ok((entry, backup.display().to_string()))
}

/// 삭제 — Rule 만. ClaudeMd 슬롯은 구조적으로 거부한다.
pub fn delete(scope: RuleScope, scope_root: &Path, rel_path: &str) -> Result<(), String> {
    let kind = validate_rel(scope, rel_path)?;
    if kind != RuleKind::Rule {
        return Err("CLAUDE.md-family files cannot be deleted here".into());
    }
    let abs = secure_path(scope, scope_root, rel_path)?;
    std::fs::remove_file(&abs).map_err(|e| format!("Could not delete the rule: {e}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor `.mdc` 미러 번역
// ─────────────────────────────────────────────────────────────────────────────

/// 원본 rel → 미러의 프로젝트 상대 경로. 중첩은 `-` 로 평탄화한다
/// (구버전 Cursor 가 하위 폴더 규칙을 못 읽는 문제 회피).
pub fn mirror_rel_for(rule_rel: &str) -> String {
    let stem = rule_rel
        .strip_prefix(&format!("{RULES_SUBDIR}/"))
        .unwrap_or(rule_rel)
        .trim_end_matches(".md")
        .replace('/', "-");
    format!("{CURSOR_RULES_SUBDIR}/{stem}.mdc")
}

fn marker_line(rule_rel: &str) -> String {
    format!("{MIRROR_MARKER_PREFIX}{rule_rel}{MIRROR_MARKER_SUFFIX}")
}

/// `.mdc` 본문에서 미러 마커의 원본 rel 을 추출한다 (첫 20줄만 검사).
fn mirror_source_of(content: &str) -> Option<String> {
    content.lines().take(20).find_map(|l| {
        l.trim()
            .strip_prefix(MIRROR_MARKER_PREFIX)?
            .strip_suffix(MIRROR_MARKER_SUFFIX)
            .map(|s| s.to_string())
    })
}

fn mirror_state(project_root: &Path, rule_rel: &str) -> MirrorState {
    let abs = project_root.join(mirror_rel_for(rule_rel));
    match read_capped(&abs) {
        Ok(Some(text)) => match mirror_source_of(&text) {
            Some(src) if src == rule_rel => MirrorState::Mirrored,
            Some(_) | None => MirrorState::Conflict,
        },
        Ok(None) => MirrorState::None,
        // 상한 초과/IO 오류 — 마커를 검증할 수 없으니 건드리면 안 되는 상태.
        Err(()) => MirrorState::Conflict,
    }
}

/// Claude 규칙 → Cursor `.mdc` 렌더.
/// `paths` 있음 → `globs` + `alwaysApply: false` (매칭 파일 작업 시 자동 첨부),
/// 없음 → `alwaysApply: true` (Claude 의 "항상 로드" 의미 보존).
pub fn render_mirror(rule_rel: &str, content: &str) -> String {
    let (paths, _) = parse_rule_meta(content);
    let (_, body) = split_frontmatter(content);
    let mut out = String::from("---\n");
    if paths.is_empty() {
        out.push_str("alwaysApply: true\n");
    } else {
        let quoted: Vec<String> = paths
            .iter()
            .map(|p| format!("\"{}\"", p.replace('"', "\\\"")))
            .collect();
        out.push_str(&format!("globs: [{}]\n", quoted.join(", ")));
        out.push_str("alwaysApply: false\n");
    }
    out.push_str("---\n");
    out.push_str(&marker_line(rule_rel));
    out.push_str("\n\n");
    out.push_str(body.trim_start_matches('\n'));
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// 미러 한 건 쓰기. 마커 없는 기존 파일은 건드리지 않는다 (`conflict`).
pub fn write_mirror(project_root: &Path, rule_rel: &str, content: &str) -> MirrorWriteResult {
    let mirror_rel = mirror_rel_for(rule_rel);
    let abs = crate::path_guard::secure_join_managed(project_root, &mirror_rel);
    let result = |action: &str| MirrorWriteResult {
        target: "cursor".into(),
        source_rel: rule_rel.to_string(),
        action: action.into(),
        mirror_rel: mirror_rel.clone(),
    };
    // 미러 자리(`.cursor` 폴더 포함)가 링크면 쓰지 않는다 — 밖에 떨어진다.
    let Ok(abs) = abs else {
        return result("conflict");
    };
    let rendered = render_mirror(rule_rel, content);
    match read_capped(&abs) {
        Ok(Some(existing)) => {
            if mirror_source_of(&existing).as_deref() != Some(rule_rel) {
                return result("conflict");
            }
            if existing == rendered {
                return result("unchanged");
            }
        }
        Ok(None) => {}
        Err(()) => return result("conflict"),
    }
    match write_atomic(&abs, rendered.as_bytes()) {
        Ok(()) => result("written"),
        Err(_) => result("conflict"),
    }
}

/// 미러 한 건 제거 — 우리 마커가 있고 원본 rel 이 일치할 때만 지운다.
pub fn remove_mirror(project_root: &Path, rule_rel: &str) -> MirrorWriteResult {
    let mirror_rel = mirror_rel_for(rule_rel);
    let abs = crate::path_guard::secure_join_managed(project_root, &mirror_rel);
    let result = |action: &str| MirrorWriteResult {
        target: "cursor".into(),
        source_rel: rule_rel.to_string(),
        action: action.into(),
        mirror_rel: mirror_rel.clone(),
    };
    let Ok(abs) = abs else {
        return result("conflict");
    };
    match read_capped(&abs) {
        Ok(Some(existing)) if mirror_source_of(&existing).as_deref() == Some(rule_rel) => {
            match std::fs::remove_file(&abs) {
                Ok(()) => result("removed"),
                Err(_) => result("conflict"),
            }
        }
        Ok(Some(_)) | Err(()) => result("conflict"),
        Ok(None) => result("unchanged"),
    }
}

/// 미러 전체 화해 — `enabled` 기준으로 수렴시킨다 (멱등).
///
/// - `enabled=true`: 모든 프로젝트 규칙을 미러하고, 원본이 사라진 **고아
///   마커 미러**를 제거한다.
/// - `enabled=false`: 마커 미러를 전량 제거한다.
///
/// 마커 없는 `.mdc` (사용자/어댑터 파일)는 어느 쪽에서도 건드리지 않는다.
pub fn sync_mirrors(project_root: &Path, enabled: bool) -> Vec<MirrorWriteResult> {
    let mut results = Vec::new();
    // 현재 마커 미러 목록 (평탄 — 우리가 만드는 미러는 항상 flat).
    let mut marked: Vec<(PathBuf, String)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(project_root.join(CURSOR_RULES_SUBDIR)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("mdc") {
                continue;
            }
            let Ok(Some(text)) = read_capped(&path) else {
                continue;
            };
            if let Some(src) = mirror_source_of(&text) {
                marked.push((path, src));
            }
        }
    }
    if enabled {
        // 고아 정리를 쓰기보다 **먼저** — 평탄화가 겹치는 rename(예:
        // `api/validation.md` → `api-validation.md`, 둘 다 `api-validation.mdc`)
        // 에서 낡은 마커 미러가 새 미러 쓰기를 conflict 로 막은 채 쓰기 뒤의
        // 고아 정리에 지워져, 1패스 후 미러가 사라지던 비수렴(#a0-review-fixes ②)
        // 을 제거한다. 원본이 살아 있는 미러는 이 단계가 건드리지 않는다.
        for (_, src) in &marked {
            let orphan =
                validate_rel(RuleScope::Project, src).is_err() || !project_root.join(src).is_file();
            if orphan {
                results.push(remove_mirror(project_root, src));
            }
        }
        let live = list_scope(RuleScope::Project, project_root, Some(project_root));
        for entry in &live {
            let Ok(Some(content)) = read_capped(&project_root.join(&entry.rel_path)) else {
                continue;
            };
            results.push(write_mirror(project_root, &entry.rel_path, &content));
        }
    } else {
        for (_, src) in &marked {
            results.push(remove_mirror(project_root, src));
        }
    }
    results
}

/// 프로젝트 스코프 규칙만 나열한다 — rule_promotion(CI4)의 억제 재료.
pub(crate) fn list_project_rules(project_root: &Path) -> Vec<RuleEntry> {
    list_scope(RuleScope::Project, project_root, Some(project_root))
}

/// 홈 디렉터리 (전역 스코프 루트).
pub fn home_dir() -> OculpmResult<PathBuf> {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .ok_or_else(|| OculpmError::InvalidConfig("Could not find the home directory".into()))
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "rules_tests.rs"]
mod tests;
