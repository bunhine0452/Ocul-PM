//! AD-1 — 발동 원장 (docs/agent-discipline/00-master-plan.md D1).
//!
//! 규칙·스킬이 **실제로 걸렸는지**를 Claude Code transcript 에서 결정론적으로
//! 관측한다 (LLM 0 · 네트워크 0). 2026-08-29 실측으로 확인한 신호는 둘뿐이다:
//!
//! ```jsonc
//! // 규칙 조건부 주입 — paths glob 이 맞아 규칙 본문이 컨텍스트에 들어간 순간
//! {"attachment":{"type":"nested_memory","path":"…/rules/ecc/arkts/coding-style.md",
//!                "content":{"content":"…","globs":["**/*.ts"]}}, "timestamp":"…"}
//! // 스킬 발동
//! {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill",
//!                                           "input":{"skill":"oculpm:oculpm-journal"}}]}}
//! ```
//!
//! transcript JSONL 은 **비공식 포맷**이므로 [`transcript`](super::transcript) 와
//! 같은 방어 규율을 따른다 — 모르는 필드·라인은 통째로 무시하고, 한 줄이 깨져도
//! 나머지를 계속 읽는다. 여기서 아무것도 못 건지면 발동 0 으로 보고될 뿐
//! 호출자가 실패하지는 않는다.
//!
//! 스캔은 증분이다: transcript 는 append-only 라 바이트 오프셋만 있으면 재개할
//! 수 있다 (claude_hooks 인박스와 같은 규약 — 완전한 `\n` 종료 라인만 소비).
//! 이 저장소 기준 transcript 는 293MB 라 전량 재파싱은 매번 할 수 없다.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use serde::Serialize;

/// 규칙 주입.
pub const KIND_RULE: &str = "rule";
/// 스킬 발동.
pub const KIND_SKILL: &str = "skill";

/// transcript 폴더 루트 (홈 기준).
const PROJECTS_SUBDIR: &str = ".claude/projects";
/// 한 번의 스캔이 읽는 바이트 예산. 첫 스캔이 UI 를 무한정 붙잡지 않도록
/// 끊고, 남은 분량은 `complete=false` 로 보고해 호출자가 이어 부른다.
const SCAN_BUDGET_BYTES: u64 = 96 * 1024 * 1024;
/// 후보 디렉터리가 정말 이 프로젝트인지 확인할 때 읽는 선두 바이트.
const CWD_PROBE_BYTES: usize = 64 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// 파싱
// ─────────────────────────────────────────────────────────────────────────────

/// transcript 한 줄에서 건진 발동 1건.
#[derive(Debug, Clone, PartialEq)]
pub struct Firing {
    /// [`KIND_RULE`] | [`KIND_SKILL`].
    pub kind: &'static str,
    /// 규칙 = 파일 절대경로 · 스킬 = 스킬 이름.
    pub key: String,
    /// 규칙 주입 바이트 (컨텍스트 예산). 스킬은 0.
    pub bytes: u64,
    /// 로컬 캘린더 workday `YYYYMMDD`. timestamp 가 없으면 None.
    pub workday: Option<String>,
    /// 규칙을 끌어들인 glob (AD-5 범위 교정 카드의 근거). 스킬은 빈 벡터.
    pub globs: Vec<String>,
}

/// UTC RFC3339 문자열 → 로컬 캘린더 `YYYYMMDD`.
/// 파싱 실패는 None — 날짜 없는 발동은 창(window) 집계에서 빠진다.
fn workday_of(ts: Option<&str>) -> Option<String> {
    let parsed = DateTime::parse_from_rfc3339(ts?).ok()?;
    Some(
        parsed
            .with_timezone(&Local)
            .date_naive()
            .format("%Y%m%d")
            .to_string(),
    )
}

/// 한 줄(JSON)에서 발동을 뽑는다. 한 줄에 스킬 블록이 여럿일 수 있다.
fn firings_in_line(line: &str) -> Vec<Firing> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return Vec::new();
    };
    let workday = workday_of(v.get("timestamp").and_then(|t| t.as_str()));

    // ── 규칙 주입 ──
    let attachment = v.get("attachment");
    if attachment
        .and_then(|a| a.get("type"))
        .and_then(|t| t.as_str())
        == Some("nested_memory")
    {
        let a = attachment.expect("checked above");
        if let Some(path) = a.get("path").and_then(|p| p.as_str()) {
            let inner = a.get("content");
            // `content` 가 실제 주입 본문, `rawContent` 는 디스크 원문 —
            // 예산은 주입된 쪽이 정답이고 없으면 원문으로 폴백한다.
            let bytes = inner
                .and_then(|c| c.get("content"))
                .and_then(|c| c.as_str())
                .or_else(|| {
                    inner
                        .and_then(|c| c.get("rawContent"))
                        .and_then(|c| c.as_str())
                })
                .map(|s| s.len() as u64)
                .unwrap_or(0);
            let globs = inner
                .and_then(|c| c.get("globs"))
                .and_then(|g| g.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|g| g.as_str())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            return vec![Firing {
                kind: KIND_RULE,
                key: path.to_string(),
                bytes,
                workday,
                globs,
            }];
        }
    }

    // ── 스킬 발동 ──
    let Some(blocks) = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter(|b| {
            b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                && b.get("name").and_then(|n| n.as_str()) == Some("Skill")
        })
        .filter_map(|b| {
            b.get("input")
                .and_then(|i| i.get("skill"))
                .and_then(|s| s.as_str())
        })
        .filter(|s| !s.is_empty())
        .map(|skill| Firing {
            kind: KIND_SKILL,
            key: skill.to_string(),
            bytes: 0,
            workday: workday.clone(),
            globs: Vec::new(),
        })
        .collect()
}

/// 완전한 `\n` 종료 라인만 소비해 발동을 모은다.
/// 반환 `consumed` 는 이번에 확실히 처리한 바이트 수 (다음 재개점 델타).
pub fn parse_chunk(chunk: &str) -> (Vec<Firing>, u64) {
    let Some(last_nl) = chunk.rfind('\n') else {
        return (Vec::new(), 0);
    };
    let complete = &chunk[..=last_nl];
    let mut out = Vec::new();
    for line in complete.lines() {
        if line.trim().is_empty() {
            continue;
        }
        out.extend(firings_in_line(line));
    }
    (out, complete.len() as u64)
}

// ─────────────────────────────────────────────────────────────────────────────
// transcript 위치 찾기
// ─────────────────────────────────────────────────────────────────────────────

/// Claude Code 의 프로젝트 폴더 슬러그 — 경로의 비영숫자를 `-` 로 바꾼 형태
/// (실측: `/Users/x/Desktop/git/ai-pm` → `-Users-x-Desktop-git-ai-pm`).
pub fn project_slug(root: &Path) -> String {
    root.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// 파일 선두에서 `cwd` 를 하나 건진다 — 슬러그가 손실 변환이라
/// (`/` 와 `-` 가 같은 글자가 된다) 후보 폴더의 진짜 주인을 확인하는 용도.
fn probe_cwd(file: &Path) -> Option<String> {
    let raw = read_head(file, CWD_PROBE_BYTES)?;
    for line in raw.lines().take(40) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(cwd) = v.get("cwd").and_then(|c| c.as_str()) {
                return Some(cwd.to_string());
            }
        }
    }
    None
}

fn read_head(file: &Path, cap: usize) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(file).ok()?;
    let mut buf = vec![0u8; cap];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// 이 프로젝트의 transcript 폴더들. 하위 디렉터리에서 시작한 세션은 별도
/// 슬러그 폴더(`…-ai-pm-src-tauri`)로 갈리므로 접두 일치까지 후보로 잡고,
/// 실제 `cwd` 가 프로젝트 루트 안인지 확인해 남의 프로젝트를 배제한다.
pub fn transcript_dirs(home: &Path, project_root: &Path) -> Vec<PathBuf> {
    let base = home.join(PROJECTS_SUBDIR);
    let slug = project_slug(project_root);
    let Ok(entries) = std::fs::read_dir(&base) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let candidate = name == slug || name.starts_with(&format!("{slug}-"));
        if !candidate || !entry.path().is_dir() {
            continue;
        }
        if name == slug || dir_belongs_to(&entry.path(), project_root) {
            dirs.push(entry.path());
        }
    }
    dirs.sort();
    dirs
}

/// 접두 일치 폴더의 소유 확인 — 첫 transcript 의 `cwd` 가 프로젝트 루트
/// 아래여야 한다. 판단 근거가 없으면(빈 폴더·cwd 부재) 보수적으로 배제한다.
fn dir_belongs_to(dir: &Path, project_root: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        if entry.path().extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let Some(cwd) = probe_cwd(&entry.path()) {
            return Path::new(&cwd).starts_with(project_root);
        }
    }
    false
}

// ─────────────────────────────────────────────────────────────────────────────
// 증분 스캔
// ─────────────────────────────────────────────────────────────────────────────

/// 스캔 대상 한 파일. `bytes_consumed` 는 DB 에 남은 재개점.
#[derive(Debug, Clone)]
pub struct ScanTarget {
    /// `<슬러그폴더>/<session>.jsonl` — 프로젝트 안에서 유일한 세션 식별자.
    pub session_file: String,
    pub abs_path: PathBuf,
    pub bytes_consumed: u64,
}

/// 한 파일 스캔 결과 — 그대로 UPSERT 되는 집계 행들.
#[derive(Debug, Clone, PartialEq)]
pub struct FiringRow {
    pub kind: &'static str,
    pub key: String,
    pub workday: String,
    pub count: u32,
    pub bytes: u64,
}

#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub session_file: String,
    /// 이번 스캔이 읽기 시작한 재개점 — DB 적재 때 CAS 기대값. 다른 스캔이
    /// 그사이 앞서갔으면 이 청크는 이미 반영된 것이라 버려야 한다.
    pub started_at: u64,
    pub bytes_consumed: u64,
    /// 파일이 재개점보다 작아져 0 부터 다시 읽었다 — 회전/재생성. 적재 전에
    /// 이 세션 파일의 기존 집계 행을 지워야 옛 행 위에 가산되지 않는다.
    pub reset: bool,
    pub rows: Vec<FiringRow>,
}

/// 발동 목록을 (kind, key, workday) 로 접는다. workday 를 못 읽은 발동은
/// 버린다 — 창 집계에 넣을 자리가 없고, 총계만 부풀리면 거짓말이 된다.
pub fn fold_rows(firings: Vec<Firing>) -> Vec<FiringRow> {
    use std::collections::BTreeMap;
    let mut acc: BTreeMap<(&'static str, String, String), (u32, u64)> = BTreeMap::new();
    for f in firings {
        let Some(workday) = f.workday else { continue };
        let slot = acc.entry((f.kind, f.key, workday)).or_insert((0, 0));
        slot.0 += 1;
        slot.1 += f.bytes;
    }
    acc.into_iter()
        .map(|((kind, key, workday), (count, bytes))| FiringRow {
            kind,
            key,
            workday,
            count,
            bytes,
        })
        .collect()
}

/// 열거된 대상을 예산 안에서 스캔한다. 반환 `complete=false` 면 예산이 동나
/// 남은 파일이 있다는 뜻 — 호출자가 다시 부르면 재개점부터 이어 간다.
pub fn scan_targets(targets: Vec<ScanTarget>) -> (Vec<ScannedFile>, bool) {
    let mut out = Vec::new();
    let mut spent: u64 = 0;
    for target in targets {
        let Ok(meta) = std::fs::metadata(&target.abs_path) else {
            continue;
        };
        let size = meta.len();
        // 파일이 줄었으면 회전·재생성으로 보고 처음부터 다시 읽는다.
        let reset = size < target.bytes_consumed;
        let start = if reset { 0 } else { target.bytes_consumed };
        if size == start {
            continue;
        }
        if spent >= SCAN_BUDGET_BYTES {
            return (out, false);
        }
        let Some(chunk) = read_from(&target.abs_path, start) else {
            continue;
        };
        spent += chunk.len() as u64;
        let (firings, consumed) = parse_chunk(&chunk);
        out.push(ScannedFile {
            session_file: target.session_file,
            started_at: target.bytes_consumed,
            bytes_consumed: start + consumed,
            reset,
            rows: fold_rows(firings),
        });
    }
    (out, true)
}

fn read_from(file: &Path, offset: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(file).ok()?;
    f.seek(SeekFrom::Start(offset)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// 스캔 대상 열거 — `resume(session_file)` 이 DB 의 재개점을 준다.
pub fn enumerate_targets(dirs: &[PathBuf], resume: impl Fn(&str) -> u64) -> Vec<ScanTarget> {
    let mut targets = Vec::new();
    for dir in dirs {
        let Some(dir_name) = dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let session_file = format!("{dir_name}/{file_name}");
            let bytes_consumed = resume(&session_file);
            targets.push(ScanTarget {
                session_file,
                abs_path: path,
                bytes_consumed,
            });
        }
    }
    // 최근 세션부터 — 첫 스캔이 예산으로 끊겨도 30일 창이 먼저 채워진다.
    // (파일명은 UUID 라 이름순은 날짜와 무관했다.) 같은 mtime 이면 이름순.
    targets.sort_by(|a, b| {
        let mt = |t: &ScanTarget| {
            std::fs::metadata(&t.abs_path)
                .and_then(|m| m.modified())
                .ok()
        };
        mt(b)
            .cmp(&mt(a))
            .then_with(|| a.session_file.cmp(&b.session_file))
    });
    targets
}

// ─────────────────────────────────────────────────────────────────────────────
// 표시용 라벨
// ─────────────────────────────────────────────────────────────────────────────

/// 규칙 절대경로를 읽기 쉬운 라벨로 — 홈 아래는 `~/`, 프로젝트 아래는 상대.
pub fn rule_label(key: &str, home: &Path, project_root: &Path) -> String {
    let path = Path::new(key);
    if let Ok(rel) = path.strip_prefix(project_root) {
        return rel.to_string_lossy().into_owned();
    }
    if let Ok(rel) = path.strip_prefix(home) {
        return format!("~/{}", rel.to_string_lossy());
    }
    key.to_string()
}

/// 프런트가 그대로 그리는 발동 통계 1행.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct FiringStat {
    /// `rule` | `skill`.
    pub kind: String,
    /// 규칙 절대경로 · 스킬 이름 (조회 키).
    pub key: String,
    /// 표시용 축약 라벨.
    pub label: String,
    /// 창 안의 발동 총 횟수.
    pub count: u32,
    /// 창 안의 주입 바이트 합 (스킬은 0). specta 가 u64 노출을 막으므로
    /// 포화 변환한 u32 — 실측 규모(세션당 ~90KB)에서 도달할 수 없는 상한이다.
    pub bytes: u32,
    /// 발동한 서로 다른 세션 수.
    pub sessions: u32,
    /// 가장 최근 발동 workday.
    pub last_workday: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const NESTED: &str = r#"{"attachment":{"type":"nested_memory","path":"/home/u/.claude/rules/ecc/arkts/coding-style.md","content":{"content":"1234567890","globs":["**/*.ts","**/*.ets"],"rawContent":"12345678901234"}},"type":"attachment","timestamp":"2026-08-29T04:00:00.000Z","cwd":"/w/proj"}"#;
    const SKILL: &str = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"oculpm:oculpm-journal"}}]},"timestamp":"2026-08-29T04:00:00.000Z"}"#;

    #[test]
    fn parses_rule_injection_with_bytes_and_globs() {
        let f = firings_in_line(NESTED);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, KIND_RULE);
        assert!(f[0].key.ends_with("arkts/coding-style.md"));
        // rawContent(14) 가 아니라 실제 주입된 content(10) 가 예산이다.
        assert_eq!(f[0].bytes, 10);
        assert_eq!(f[0].globs, vec!["**/*.ts", "**/*.ets"]);
    }

    #[test]
    fn parses_skill_invocation() {
        let f = firings_in_line(SKILL);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, KIND_SKILL);
        assert_eq!(f[0].key, "oculpm:oculpm-journal");
        assert_eq!(f[0].bytes, 0);
    }

    #[test]
    fn ignores_unrelated_and_broken_lines() {
        assert!(firings_in_line("not json at all").is_empty());
        assert!(firings_in_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_empty());
        assert!(firings_in_line(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}"#
        )
        .is_empty());
        // 모르는 attachment 종류는 규칙이 아니다.
        assert!(firings_in_line(r#"{"attachment":{"type":"image","path":"/a.png"}}"#).is_empty());
    }

    #[test]
    fn consumes_only_complete_lines() {
        let chunk = format!("{SKILL}\n{{\"type\":\"assist");
        let (firings, consumed) = parse_chunk(&chunk);
        assert_eq!(firings.len(), 1);
        // 잘린 뒷줄은 남겨 둔다 — 다음 스캔이 그 지점부터 다시 읽는다.
        assert_eq!(consumed, SKILL.len() as u64 + 1);
    }

    #[test]
    fn no_newline_means_nothing_consumed() {
        let (firings, consumed) = parse_chunk(SKILL);
        assert!(firings.is_empty());
        assert_eq!(consumed, 0);
    }

    #[test]
    fn folds_by_kind_key_workday() {
        let (firings, _) = parse_chunk(&format!("{NESTED}\n{NESTED}\n{SKILL}\n"));
        let mut rows = fold_rows(firings);
        rows.sort_by(|a, b| a.key.cmp(&b.key));
        assert_eq!(rows.len(), 2);
        let rule = rows.iter().find(|r| r.kind == KIND_RULE).unwrap();
        assert_eq!(rule.count, 2);
        assert_eq!(rule.bytes, 20);
        assert_eq!(rule.workday.len(), 8);
        assert_eq!(rows.iter().find(|r| r.kind == KIND_SKILL).unwrap().count, 1);
    }

    #[test]
    fn drops_firings_without_a_readable_timestamp() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"x"}}]}}"#;
        let (firings, _) = parse_chunk(&format!("{line}\n"));
        assert_eq!(firings.len(), 1);
        assert!(fold_rows(firings).is_empty());
    }

    #[test]
    fn slug_maps_non_alphanumerics_to_dash() {
        assert_eq!(
            project_slug(Path::new("/Users/x/Desktop/git/ai-pm")),
            "-Users-x-Desktop-git-ai-pm"
        );
    }

    #[test]
    fn rule_label_shortens_home_and_project() {
        let home = Path::new("/Users/x");
        let root = Path::new("/Users/x/proj");
        assert_eq!(
            rule_label("/Users/x/.claude/rules/a.md", home, root),
            "~/.claude/rules/a.md"
        );
        assert_eq!(
            rule_label("/Users/x/proj/.claude/rules/b.md", home, root),
            ".claude/rules/b.md"
        );
        assert_eq!(rule_label("/elsewhere/c.md", home, root), "/elsewhere/c.md");
    }
}
