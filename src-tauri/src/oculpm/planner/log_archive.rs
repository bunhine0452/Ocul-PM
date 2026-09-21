//! plan-log 표의 **이력 분리** — 본문은 현재 상태, 아카이브는 지나간 이력.
//!
//! `plan_update` 는 갱신 한 번마다 plan-log 표에 한 줄을 덧붙인다. 표는 줄지
//! 않으므로 오래 산 플랜일수록 파일의 대부분이 이력이 된다 (이 저장소의
//! `v3-release.md` 는 62KB · 항목 94개에 로그 102행이었다). `plan_status` 는
//! 미완 항목만 주지만, 에이전트가 파일을 **직접 읽는 순간** 그 60KB 가 통째로
//! 컨텍스트에 들어간다.
//!
//! 그래서 [`LOG_KEEP`] 행을 넘으면 넘친 만큼을 **오래된 행부터**
//! `<plan_id>.log.md` 로 옮긴다. 규칙은 셋이다:
//!
//! 1. **아카이브는 append-only.** 옮길 때 뒤에 붙이고, 이미 있는 행은 다시 쓰지
//!    않는다 (중복 판정 = 시각 + 항목 + 변화).
//! 2. **아카이브를 먼저 쓴다.** 본문을 먼저 쓰면 그 다음 실패에서 행이 증발한다.
//!    반대 순서라면 최악이 "양쪽에 잠깐 남는" 것이고, 그건 다음 분리의 중복
//!    판정이 걷는다.
//! 3. **아카이브는 플랜이 아니다.** `*.log.md` 는 플랜 목록을 걷는 모든 자리가
//!    건너뛰고([`is_plan_path`]), 내용으로도 구분된다([`is_archive_markdown`]).
//!
//! 읽기는 갈라지지 않는다 — 투영(`project::load_all_plans`)이
//! [`merge_archived_updates`] 로 아카이브 행까지 `oculpm_plan_item_updates` 에
//! 넣으므로 `plan_item_history` 와 플래너 이력 뷰는 예전과 같은 전체를 본다.

use std::path::{Path, PathBuf};

use regex::Regex;

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::planner::parse::{parse_log_row, ParsedPlan, PlanItemUpdate};
use crate::oculpm::redact::redact_text;

/// 본문 표에 남기는 최신 행 수. 넘친 만큼만 아카이브로 간다.
pub const LOG_KEEP: usize = 40;

const LOG_BEGIN: &str = "<!-- oculpm:plan-log begin v1 -->";
const LOG_END: &str = "<!-- oculpm:plan-log end -->";
const LOG_HEADER: &str = "| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |";
const LOG_SEP: &str = "|---|---|---|---|---|---|";

/// 본문 표 위/아래에 남기는 안내 한 줄의 접두사.
/// `plan_edit::append_log_row` 가 이 줄 **위**로 새 행을 끼워 넣는다.
pub const ARCHIVED_MARKER_PREFIX: &str = "<!-- oculpm:plan-log archived:";

/// 아카이브 파일 frontmatter 의 식별 키.
const ARCHIVE_KIND_KEY: &str = "oculpm_plan_log:";

/// `<plan_id>.log.md` — 본문 파일과 같은 `.oculpm/planner/` 디렉터리.
pub fn archive_path(planner_root: &Path, plan_id: &str) -> PathBuf {
    planner_root.join(format!("{plan_id}.log.md"))
}

/// 이 경로가 **플랜 본문**인가. `*.log.md` 는 이력 보관함이라 플랜이 아니다.
pub fn is_plan_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    name.ends_with(".md") && !name.ends_with(".log.md")
}

/// 파일 이름에서 얻는 플랜 fallback id — frontmatter 에 `id:` 가 없을 때 쓴다.
pub fn plan_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("plan")
        .to_string()
}

/// 읽은 내용이 아카이브 문서인가 — 이름을 우회해 들어와도 걸린다.
/// (프론트매터 펜스 안의 `oculpm_plan_log:` 키만 본다.)
pub fn is_archive_markdown(md: &str) -> bool {
    let mut lines = md.lines();
    if lines.next().map(str::trim) != Some("---") {
        return false;
    }
    for line in lines {
        let t = line.trim();
        if t == "---" {
            return false;
        }
        if t.starts_with(ARCHIVE_KIND_KEY) {
            return true;
        }
    }
    false
}

// ─────────────────────────────────────────────────────────────────────────────
// 순수 분리
// ─────────────────────────────────────────────────────────────────────────────

/// [`split_overflow`] 의 결과 — 양쪽 문서 전문과 옮긴 행 수.
#[derive(Debug, Clone)]
pub struct ArchiveSplit {
    /// 최신 [`LOG_KEEP`] 행 + 마커만 남은 본문.
    pub body: String,
    /// 옮긴 행이 뒤에 붙은 아카이브 문서 전문.
    pub archive: String,
    /// 이번에 옮긴 행 수.
    pub moved: usize,
    /// 아카이브에 쌓인 누적 행 수 (마커의 `N`).
    pub archived_total: usize,
}

/// 넘친 행을 갈라낸다. 넘치지 않았으면 `None` — 그 경우 파일은 손대지 않는다.
///
/// `existing_archive` 는 현재 아카이브 문서 전문(없으면 빈 문자열). 행 순서는
/// 문서 순서 그대로다 — plan-log 는 append-only 라 문서 순서가 곧 시간순이고,
/// 시각 문자열로 다시 정렬하면 손으로 끼워 넣은 행의 자리가 바뀐다.
pub fn split_overflow(
    body_md: &str,
    plan_id: &str,
    existing_archive: &str,
    keep: usize,
) -> Option<ArchiveSplit> {
    let mut lines: Vec<String> = body_md.split('\n').map(String::from).collect();
    let begin = lines
        .iter()
        .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log begin"))?;
    let end = lines
        .iter()
        .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log end"))?;
    if end <= begin {
        return None;
    }
    let data_rows: Vec<usize> = (begin + 1..end)
        .filter(|&i| parse_log_row(lines[i].trim_start()).is_some())
        .collect();
    if data_rows.len() <= keep {
        return None;
    }
    let overflow = data_rows.len() - keep;
    let moving: Vec<usize> = data_rows.into_iter().take(overflow).collect();
    let moved_text: Vec<String> = moving
        .iter()
        .map(|&i| lines[i].trim().to_string())
        .collect();

    // 아카이브 쪽 — 이미 있는 행은 다시 쓰지 않는다.
    let mut archive_lines: Vec<String> = if existing_archive.trim().is_empty() {
        archive_skeleton(plan_id)
    } else {
        existing_archive.split('\n').map(String::from).collect()
    };
    let mut seen: Vec<String> = archive_lines
        .iter()
        .filter_map(|l| row_key(l))
        .collect::<Vec<_>>();
    let insert_at = archive_lines
        .iter()
        .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log end"))
        .unwrap_or(archive_lines.len());
    let mut appended = 0usize;
    for row in &moved_text {
        let Some(key) = row_key(row) else { continue };
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        archive_lines.insert(insert_at + appended, row.clone());
        appended += 1;
    }
    let archived_total = seen.len();

    // 본문 쪽 — 옮긴 줄과 낡은 마커를 걷고 표 위/아래에 마커를 다시 놓는다.
    let marker = format!("{ARCHIVED_MARKER_PREFIX} {archived_total} rows → {plan_id}.log.md -->");
    let mut drop: Vec<bool> = vec![false; lines.len()];
    for i in moving {
        drop[i] = true;
    }
    for i in begin + 1..end {
        if lines[i].trim_start().starts_with(ARCHIVED_MARKER_PREFIX) {
            drop[i] = true;
        }
    }
    let mut kept = 0usize;
    lines.retain(|_| {
        let d = drop[kept];
        kept += 1;
        !d
    });
    let begin = lines
        .iter()
        .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log begin"))?;
    let end = lines
        .iter()
        .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log end"))?;
    lines.insert(end, marker.clone());
    lines.insert(begin + 1, marker);

    Some(ArchiveSplit {
        body: lines.join("\n"),
        archive: archive_lines.join("\n"),
        moved: appended,
        archived_total,
    })
}

fn archive_skeleton(plan_id: &str) -> Vec<String> {
    vec![
        "---".to_string(),
        "oculpm_plan_log: v1".to_string(),
        format!("plan: {plan_id}"),
        "---".to_string(),
        String::new(),
        LOG_BEGIN.to_string(),
        LOG_HEADER.to_string(),
        LOG_SEP.to_string(),
        LOG_END.to_string(),
        String::new(),
    ]
}

/// 데이터 행의 동일성 열쇠 — 시각 + 항목 + 변화. 같은 항목을 같은 초에 같은
/// 방향으로 두 번 옮길 일은 없으므로 이걸로 append-only 를 멱등하게 만든다.
fn row_key(line: &str) -> Option<String> {
    let u = parse_log_row(line.trim())?;
    Some(format!(
        "{}\u{1}{}\u{1}{}\u{1}{}",
        u.ts,
        u.item_id,
        u.from_status.unwrap_or_default(),
        u.to_status.unwrap_or_default()
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기 · 읽기
// ─────────────────────────────────────────────────────────────────────────────

/// 본문을 디스크에 쓰기 **직전**에 부른다 — 넘친 행을 아카이브로 옮기고
/// 호출자가 써야 할 본문 마크다운을 돌려준다. 넘치지 않았으면 입력 그대로.
///
/// 아카이브 파일만 여기서 쓴다(그것도 본문보다 먼저). 본문 쓰기는 호출자가
/// 이미 쥐고 있는 CAS·문지기 경로에 그대로 남는다 — 분리 때문에 본문 해시가
/// 바뀌는 것은 정상이고, 응답의 `hash` 는 **분리된 뒤** 내용으로 계산된다.
///
/// 잠긴(done/archived) 플랜은 호출 경로가 이미 앞에서 거절하므로 여기까지
/// 오지 않는다.
pub fn archive_overflow(
    planner_root: &Path,
    plan_id: &str,
    body_md: &str,
) -> Result<String, String> {
    let path = archive_path(planner_root, plan_id);
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let Some(split) = split_overflow(body_md, plan_id, &existing, LOG_KEEP) else {
        return Ok(body_md.to_string());
    };
    write_atomic(&path, split.archive.as_bytes()).map_err(|e| e.to_string())?;
    Ok(split.body)
}

/// 이 플랜의 아카이브 행을 `parsed.updates` **앞**에 덧댄다 (아카이브가 더
/// 오래됐다). 파일이 없으면 무해한 no-op, 깨졌으면 조용히 건너뛴다 — 이력
/// 보관함 하나 때문에 플랜 투영이 실패하면 안 된다.
pub fn merge_archived_updates(planner_root: &Path, parsed: &mut ParsedPlan, redact: &[Regex]) {
    let path = archive_path(planner_root, &parsed.frontmatter.id);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    if !is_archive_markdown(&text) {
        return;
    }
    let (text, _hits) = redact_text(&text, redact);
    let mut rows: Vec<PlanItemUpdate> = text
        .lines()
        .filter_map(|l| parse_log_row(l.trim()))
        .collect();
    if rows.is_empty() {
        return;
    }
    // 아카이브를 쓴 뒤 본문 쓰기가 실패하면 같은 행이 잠시 양쪽에 남는다.
    // 이력에 두 번 뜨지 않게 여기서도 한 번 더 걷는다.
    let body_keys: Vec<String> = parsed.updates.iter().map(update_key).collect();
    rows.retain(|u| !body_keys.contains(&update_key(u)));
    rows.append(&mut parsed.updates);
    parsed.updates = rows;
}

fn update_key(u: &PlanItemUpdate) -> String {
    format!(
        "{}\u{1}{}\u{1}{}\u{1}{}",
        u.ts,
        u.item_id,
        u.from_status.clone().unwrap_or_default(),
        u.to_status.clone().unwrap_or_default()
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::planner::parse::parse_plan;
    use crate::oculpm::planner::plan_edit::{append_log_row, LogRow};

    fn plan_with_rows(n: usize) -> String {
        let mut md = String::from(
            "---\noculpm_plan: v1\nid: p\ntitle: \"t\"\nstatus: active\n---\n\n\
             ## Phase {#ph}\n- [ ] 항목 {#it}\n\n\
             <!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n\
             |---|---|---|---|---|---|\n",
        );
        for i in 0..n {
            md.push_str(&format!(
                "| 2026-01-{:02}T0{}:00:00+09:00 | #it | claude-code | →x | | r{i} |\n",
                (i % 28) + 1,
                i % 10
            ));
        }
        md.push_str("<!-- oculpm:plan-log end -->\n");
        md
    }

    fn body_row_count(md: &str) -> usize {
        md.lines()
            .filter(|l| parse_log_row(l.trim()).is_some())
            .count()
    }

    #[test]
    fn under_threshold_is_untouched() {
        let md = plan_with_rows(LOG_KEEP);
        assert!(split_overflow(&md, "p", "", LOG_KEEP).is_none());
    }

    #[test]
    fn splits_oldest_rows_and_keeps_latest_forty() {
        let md = plan_with_rows(102);
        let s = split_overflow(&md, "p", "", LOG_KEEP).expect("overflow splits");
        assert_eq!(s.moved, 62);
        assert_eq!(s.archived_total, 62);
        assert_eq!(body_row_count(&s.body), LOG_KEEP);
        assert_eq!(body_row_count(&s.archive), 62);
        // 남은 것은 **최신** 40행 — 옮긴 것은 가장 오래된 62행.
        assert!(s.body.contains("| r101 |"));
        assert!(!s.body.contains("| r0 |"));
        assert!(s.archive.contains("| r0 |"));
        assert!(!s.archive.contains("| r101 |"));
        // 마커는 표 위/아래 한 줄씩.
        assert_eq!(
            s.body
                .lines()
                .filter(|l| l.trim_start().starts_with(ARCHIVED_MARKER_PREFIX))
                .count(),
            2
        );
        assert!(s.body.contains("62 rows → p.log.md"));
        // 아카이브는 스스로를 아카이브라고 말한다.
        assert!(is_archive_markdown(&s.archive));
        assert!(s.archive.contains("plan: p"));
    }

    #[test]
    fn archive_append_is_idempotent() {
        let md = plan_with_rows(102);
        let first = split_overflow(&md, "p", "", LOG_KEEP).unwrap();
        // 같은 본문을 다시 갈라도 (본문 쓰기가 실패했다면) 아카이브는 안 는다.
        let again = split_overflow(&md, "p", &first.archive, LOG_KEEP).unwrap();
        assert_eq!(again.moved, 0);
        assert_eq!(again.archived_total, 62);
        assert_eq!(body_row_count(&again.archive), 62);
    }

    #[test]
    fn second_overflow_appends_after_existing_rows() {
        let first = split_overflow(&plan_with_rows(102), "p", "", LOG_KEEP).unwrap();
        // 분리된 본문에 새 행 30개를 더 쌓아 다시 넘긴다.
        let mut body = first.body.clone();
        for i in 0..30 {
            body = append_log_row(
                &body,
                &LogRow {
                    ts: format!("2026-03-01T0{}:00:00+09:00", i % 10),
                    item_id: "it".into(),
                    agent_id: "claude-code".into(),
                    from: None,
                    to: None,
                    journal_ref: None,
                    note: Some(format!("n{i}")),
                },
            );
        }
        assert_eq!(body_row_count(&body), 70);
        let second = split_overflow(&body, "p", &first.archive, LOG_KEEP).unwrap();
        assert_eq!(second.moved, 30);
        assert_eq!(body_row_count(&second.body), LOG_KEEP);
        assert_eq!(body_row_count(&second.archive), 92);
        assert!(second.body.contains("92 rows → p.log.md"));
        // 마커가 겹쳐 쌓이지 않는다.
        assert_eq!(
            second
                .body
                .lines()
                .filter(|l| l.trim_start().starts_with(ARCHIVED_MARKER_PREFIX))
                .count(),
            2
        );
    }

    #[test]
    fn split_preserves_body_items_and_frontmatter() {
        let md = plan_with_rows(60);
        let s = split_overflow(&md, "p", "", LOG_KEEP).unwrap();
        let parsed = parse_plan(&s.body, "p");
        assert_eq!(parsed.frontmatter.id, "p");
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.phases.len(), 1);
        assert_eq!(parsed.updates.len(), LOG_KEEP);
    }

    #[test]
    fn path_and_content_both_identify_an_archive() {
        assert!(!is_plan_path(Path::new("/x/p.log.md")));
        assert!(is_plan_path(Path::new("/x/p.md")));
        assert!(is_plan_path(Path::new("/x/my-log.md")));
        assert!(!is_plan_path(Path::new("/x/p.txt")));
        assert!(is_archive_markdown(
            "---\noculpm_plan_log: v1\nplan: p\n---\n"
        ));
        assert!(!is_archive_markdown(
            "---\noculpm_plan: v1\nid: p\n---\n\noculpm_plan_log: v1\n"
        ));
        assert!(!is_archive_markdown("# no frontmatter"));
    }

    #[test]
    fn archive_overflow_writes_sidecar_and_merges_back() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let md = plan_with_rows(102);
        let body = archive_overflow(root, "p", &md).unwrap();
        let side = root.join("p.log.md");
        assert!(side.exists());
        assert_eq!(body_row_count(&body), LOG_KEEP);

        let mut parsed = parse_plan(&body, "p");
        assert_eq!(parsed.updates.len(), LOG_KEEP);
        merge_archived_updates(root, &mut parsed, &[]);
        assert_eq!(parsed.updates.len(), 102);
        // 아카이브가 앞(오래된 것이 먼저).
        assert!(parsed.updates[0].note.as_deref() == Some("r0"));

        // 두 번째 호출은 넘치지 않으므로 아무것도 안 쓴다.
        let again = archive_overflow(root, "p", &body).unwrap();
        assert_eq!(again, body);
    }

    #[test]
    fn merge_skips_missing_and_foreign_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut parsed = parse_plan(&plan_with_rows(3), "p");
        merge_archived_updates(root, &mut parsed, &[]);
        assert_eq!(parsed.updates.len(), 3);
        // 아카이브 키가 없는 파일은 무시한다.
        std::fs::write(
            root.join("p.log.md"),
            "---\noculpm_plan: v1\nid: p\n---\n| 2026-01-01T00:00:00+09:00 | #it | a | →x | | z |\n",
        )
        .unwrap();
        merge_archived_updates(root, &mut parsed, &[]);
        assert_eq!(parsed.updates.len(), 3);
    }
}
