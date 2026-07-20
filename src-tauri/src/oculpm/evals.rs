//! PR-CI6 — EDD-lite 의 eval 신호 (docs/claude-integration/00-master-plan.md).
//!
//! 프로젝트 루트의 `EVALS.md` 를 "완료 정의(definition of done)" 문서로
//! 인식하고, `## 기록` 섹션의 표를 파싱해 점수 추이를 만든다. 표 형식은
//! **CI5 의 run-evals 스킬 템플릿이 정의**한 규약과 한 쌍이다:
//!
//! ```markdown
//! ## 기록
//!
//! | 날짜 | 스위트 | 통과 | 메모 |
//! |---|---|---|---|
//! | 2026-07-20 | frontend | 8/10 | 두 건은 타임아웃 |
//! ```
//!
//! 파싱은 관대하다 — 형식이 어긋난 행은 조용히 건너뛴다 (사람이 손으로
//! 고치는 문서라 한 줄 오염이 전체 신호를 죽이면 안 된다). 쓰기는 없다:
//! 기록 append 는 에이전트(스킬)의 일이고, 여기는 읽기 전용 신호다.

use std::path::Path;

use serde::Serialize;

/// `EVALS.md` 파일명 (프로젝트 루트 고정).
pub const EVALS_FILENAME: &str = "EVALS.md";
/// 기록 상한 — 추이 표시용이므로 최근 것만 유지.
const RECORDS_CAP: usize = 200;

/// `## 기록` 표의 한 행.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct EvalRecord {
    /// `YYYY-MM-DD`.
    pub date: String,
    pub suite: String,
    pub passed: u32,
    pub total: u32,
    pub memo: String,
}

/// `eval_signals` 응답. `EVALS.md` 자체가 없으면 커맨드가 `None` 을 돌려
/// UI 가 섹션을 그리지 않는다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct EvalSignals {
    /// 날짜 오름차순 (동일 날짜는 문서 순서 유지), 최근 200건.
    pub records: Vec<EvalRecord>,
    /// 등장한 스위트명 (등장 순서).
    pub suites: Vec<String>,
}

/// `<root>/EVALS.md` 를 읽어 신호를 만든다. 파일이 없으면 `None`.
pub fn signals_for(project_root: &Path) -> Option<EvalSignals> {
    let text = std::fs::read_to_string(project_root.join(EVALS_FILENAME)).ok()?;
    Some(parse_signals(&text))
}

/// 본문 파싱 (pure). `## 기록` 헤딩부터 다음 `## ` 헤딩 전까지의 표 행만 본다.
pub fn parse_signals(text: &str) -> EvalSignals {
    let mut records: Vec<EvalRecord> = Vec::new();
    let mut in_section = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("## ") {
            in_section = heading.trim() == "기록";
            continue;
        }
        if !in_section || !trimmed.starts_with('|') {
            continue;
        }
        if let Some(rec) = parse_row(trimmed) {
            records.push(rec);
        }
    }
    // 날짜 오름차순 정렬 (stable — 같은 날짜는 문서 순서 유지), 최근만 유지.
    records.sort_by(|a, b| a.date.cmp(&b.date));
    if records.len() > RECORDS_CAP {
        records.drain(..records.len() - RECORDS_CAP);
    }
    let mut suites: Vec<String> = Vec::new();
    for r in &records {
        if !suites.contains(&r.suite) {
            suites.push(r.suite.clone());
        }
    }
    EvalSignals { records, suites }
}

/// `| 날짜 | 스위트 | N/M | 메모 |` 한 행. 헤더/구분선/형식 불일치는 None.
fn parse_row(line: &str) -> Option<EvalRecord> {
    let cells: Vec<&str> = line
        .trim_matches('|')
        .split('|')
        .map(str::trim)
        .collect();
    if cells.len() < 3 {
        return None;
    }
    let date = cells[0];
    if !is_ymd(date) {
        return None; // 헤더("날짜")·구분선("---")·오형식 전부 여기서 걸러진다.
    }
    let suite = cells[1];
    if suite.is_empty() {
        return None;
    }
    let (passed, total) = parse_fraction(cells[2])?;
    Some(EvalRecord {
        date: date.to_string(),
        suite: suite.to_string(),
        passed,
        total,
        memo: cells.get(3).map(|s| s.to_string()).unwrap_or_default(),
    })
}

fn is_ymd(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && [0, 1, 2, 3, 5, 6, 8, 9].iter().all(|&i| b[i].is_ascii_digit())
}

/// `"8/10"` → (8, 10). 통과가 전체를 넘거나 전체가 0 이면 무효 (부풀린 데이터
/// 방어 — 신호로 쓰지 않는다).
fn parse_fraction(s: &str) -> Option<(u32, u32)> {
    let (p, t) = s.split_once('/')?;
    let passed: u32 = p.trim().parse().ok()?;
    let total: u32 = t.trim().parse().ok()?;
    (total > 0 && passed <= total).then_some((passed, total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const DOC: &str = "# EVALS\n\n체크리스트…\n\n## 기록\n\n| 날짜 | 스위트 | 통과 | 메모 |\n|---|---|---|---|\n| 2026-07-18 | frontend | 6/10 | 초기 |\n| 2026-07-20 | frontend | 8/10 | 개선 |\n| 2026-07-19 | backend | 12/12 | |\n| not-a-date | x | 1/2 | 스킵 |\n| 2026-07-20 | bogus | 5/4 | 부풀림 → 스킵 |\n| 2026-07-20 | zero | 0/0 | 스킵 |\n\n## 다른 섹션\n\n| 2026-07-21 | outside | 1/1 | 섹션 밖 → 스킵 |\n";

    #[test]
    fn parses_valid_rows_sorted_by_date_and_collects_suites() {
        let s = parse_signals(DOC);
        assert_eq!(s.records.len(), 3, "{:?}", s.records);
        assert_eq!(
            s.records.iter().map(|r| r.date.as_str()).collect::<Vec<_>>(),
            vec!["2026-07-18", "2026-07-19", "2026-07-20"]
        );
        let last = &s.records[2];
        assert_eq!((last.suite.as_str(), last.passed, last.total), ("frontend", 8, 10));
        assert_eq!(last.memo, "개선");
        assert_eq!(s.suites, vec!["frontend", "backend"]);
    }

    #[test]
    fn tolerates_missing_section_and_missing_memo() {
        let s = parse_signals("# EVALS\n\n기록 섹션 없음\n");
        assert!(s.records.is_empty());
        let s = parse_signals("## 기록\n| 2026-07-20 | api | 3/3 |\n");
        assert_eq!(s.records.len(), 1);
        assert_eq!(s.records[0].memo, "");
    }

    #[test]
    fn signals_for_returns_none_without_file() {
        let tmp = TempDir::new().unwrap();
        assert!(signals_for(tmp.path()).is_none());
        std::fs::write(tmp.path().join(EVALS_FILENAME), DOC).unwrap();
        let s = signals_for(tmp.path()).unwrap();
        assert_eq!(s.records.len(), 3);
    }

    #[test]
    fn fraction_and_date_validation() {
        assert_eq!(parse_fraction("8/10"), Some((8, 10)));
        assert_eq!(parse_fraction(" 8 / 10 "), Some((8, 10)));
        assert_eq!(parse_fraction("11/10"), None);
        assert_eq!(parse_fraction("0/0"), None);
        assert_eq!(parse_fraction("abc"), None);
        assert!(is_ymd("2026-07-20"));
        assert!(!is_ymd("26-07-20"));
        assert!(!is_ymd("2026/07/20"));
    }
}
