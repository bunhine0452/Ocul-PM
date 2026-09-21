//! 일지 사이의 **관련 후보** 점수 — 순수 함수만 (플랜 `journal-scale-round`
//! {#related-suggest}).
//!
//! 왜 필요한가 (이 저장소 실측, 2026-09-21): 일지 727건 중 frontmatter
//! `related` 가 채워진 것은 243건이고 `links` 는 0건이다. 같은 파일에 bug 일지가
//! 5건 넘게 붙은 파일이 31개인데, **아무도 그 재발을 못 본다** — 700건은
//! 그래프가 아니라 긴 목록이기 때문이다. 이 모듈은 "이 일지 옆에 두어야 할
//! 과거 일지"를 세 가지 근거로 고른다.
//!
//! ## 신호 셋
//!
//! 1. **공유 파일** — 가장 무겁다. 다만 그냥 세면 안 된다. 이 저장소에서
//!    `src/i18n/ko.ts` 는 일지 199건이 만졌다. 그런 허브 파일을 1건으로 세면
//!    "ko.ts 를 만진 모든 일지"가 서로의 후보가 되어 신호가 소음이 된다.
//!    그래서 IDF 로 감쇠한다 ([`file_weight`]).
//! 2. **같은 플래너 항목** — `oculpm_plan_item_updates` 의 `journal_ref` 가
//!    같은 `{#id}` 를 가리키면 둘은 같은 계획의 두 걸음이다.
//! 3. **제목 토큰 자카드** — 파일도 플랜도 안 겹치는데 제목이 닮았다면 그건
//!    대개 같은 증상의 재발이다. 다만 혼자서는 약한 신호라 문턱이 높다.
//!
//! ## 왜 순수한가
//!
//! 점수 함수는 DB·디스크를 모르게 둔다 — 입력(행 묶음)을 만들어 주면
//! 결정적으로 같은 답을 내므로 단위 테스트가 곧 명세가 된다. I/O 는
//! `cache/related.rs`(SQLite)와 `mcp/tools/related.rs`(디스크 walk)가 한다.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use specta::Type;

/// 어느 corpus 에서나 허브인 파일들 — 기능이 아니라 **목록**이라 거의 모든
/// 작업이 한 줄씩 건드린다. IDF 가 corpus 에서 스스로 배우기도 하지만,
/// 표본이 작을 때(새 프로젝트)와 corpus 통계를 못 구하는 자리(MCP 디스크
/// 폴백)에서는 이 표가 유일한 방어다.
///
/// 경로 **끝**으로 본다 — `src/i18n/ko.ts` 와 `packages/app/src/i18n/ko.ts`
/// 는 같은 종류의 파일이다.
pub const HUB_FILE_SUFFIXES: &[&str] = &[
    "/i18n/ko.ts",
    "/i18n/en.ts",
    "/lib.rs",
    "/mod.rs",
    "/bindings.ts",
    "package.json",
    "Cargo.toml",
    "Cargo.lock",
    "pnpm-lock.yaml",
    "CHANGELOG.md",
    "tauri.conf.json",
];

/// 허브 파일의 가중치 상한. 0 이 아닌 이유는 "ko.ts 를 같이 만졌다"가 **아무**
/// 정보도 아닌 것은 아니기 때문이다 — 다른 신호와 합산될 때만 의미가 되게
/// 아주 작게 남긴다.
const HUB_WEIGHT_CAP: f32 = 0.15;

/// 신호별 배점. 파일이 가장 무겁다 (희귀 파일 1개 공유 ≈ 1.0).
const W_FILE: f32 = 1.0;
const W_PLAN: f32 = 0.5;
const W_TITLE: f32 = 0.75;

/// 플랜 항목 가산의 상한 — 항목 여럿이 겹쳐도 파일 신호를 덮지 않는다.
const PLAN_CAP: f32 = 1.0;

/// 이 아래는 후보로 내놓지 않는다. 근거 없는 후보는 목록을 늘릴 뿐이다.
pub const MIN_SCORE: f32 = 0.2;

/// 제목만으로 후보가 되려면 넘어야 하는 자카드. 파일·플랜이 겹친 후보에는
/// 적용하지 않는다 (그쪽은 이미 근거가 있다).
const TITLE_ONLY_MIN: f32 = 0.34;

/// 기본/최대 후보 수.
pub const DEFAULT_LIMIT: usize = 5;
pub const MAX_LIMIT: usize = 20;

/// 경로가 허브 표에 걸리는가.
pub fn is_hub_file(path: &str) -> bool {
    let norm = path.replace('\\', "/");
    HUB_FILE_SUFFIXES
        .iter()
        .any(|s| norm.ends_with(s) || norm == s.trim_start_matches('/'))
}

/// 파일 하나를 공유한다는 사실의 무게 — IDF.
///
/// `ln(total/df) / ln(total)` 이라 0..=1 로 떨어진다. 실측 감각(전체 727건):
/// 한 건만 만진 파일 1.00 · 2건 0.89 · `ko.ts`(199건) 0.20. 허브 표에 걸린
/// 파일은 corpus 가 뭐라 하든 [`HUB_WEIGHT_CAP`] 을 넘지 못한다.
pub fn file_weight(path: &str, doc_freq: u32, total_entries: u32) -> f32 {
    let total = total_entries.max(2) as f32;
    let df = doc_freq.clamp(1, total_entries.max(1)) as f32;
    let w = ((total / df).ln() / total.ln()).clamp(0.0, 1.0);
    if is_hub_file(path) {
        w.min(HUB_WEIGHT_CAP)
    } else {
        w
    }
}

/// 제목을 비교용 토큰으로. 유니코드 alphanumeric 을 살리고(한국어 제목이
/// 통째로 사라지지 않게) ASCII 는 소문자로 접는다. 한 글자 ASCII 토큰은
/// 버린다 — 조사·관사 수준의 소음이다.
pub fn title_tokens(title: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut cur = String::new();
    for c in title.chars() {
        if c.is_alphanumeric() {
            cur.push(c.to_ascii_lowercase());
        } else if !cur.is_empty() {
            push_token(&mut out, std::mem::take(&mut cur));
        }
    }
    push_token(&mut out, cur);
    out
}

fn push_token(out: &mut BTreeSet<String>, tok: String) {
    if tok.is_empty() {
        return;
    }
    if tok.is_ascii() && tok.len() < 2 {
        return;
    }
    out.insert(tok);
}

/// 두 토큰 집합의 자카드. 한쪽이 비면 0.
pub fn jaccard(a: &BTreeSet<String>, b: &BTreeSet<String>) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f32;
    let union = a.union(b).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// plan-log 의 `journal_ref` 표기가 섞여 있다 (`.oculpm/journal/…` ·
/// `journal/…` · 맨 상대경로). 캐시의 `relative_path` 표기로 맞춘다.
pub fn normalize_journal_ref(raw: &str) -> String {
    let mut s = raw.trim().replace('\\', "/");
    for prefix in ["./", ".oculpm/", "journal/"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.to_string();
        }
    }
    s
}

// ─────────────────────────────────────────────────────────────────────────────
// 입출력 타입
// ─────────────────────────────────────────────────────────────────────────────

/// 후보가 될 수 있는 일지 한 건의 메타 (캐시 행 그대로).
#[derive(Debug, Clone)]
pub struct EntryRow {
    pub relative_path: String,
    pub title: String,
    pub workday: String,
    /// `bug` | `feature` | `error` | `refactor` | `chore`
    pub entry_type: String,
}

/// `oculpm_journal_files` 의 한 행 — **대상 일지가 만진 파일**로 좁힌 것.
#[derive(Debug, Clone)]
pub struct FileRow {
    pub relative_path: String,
    pub file_path: String,
}

/// plan-log 한 줄의 일지 귀속.
#[derive(Debug, Clone)]
pub struct PlanRefRow {
    pub plan_id: String,
    pub item_id: String,
    pub journal_ref: String,
}

/// 후보를 고를 대상 일지.
#[derive(Debug, Clone, Default)]
pub struct TargetEntry {
    pub relative_path: String,
    pub title: String,
    /// frontmatter `files_touched[].path`.
    pub files: Vec<String>,
    /// 이미 frontmatter `related` 에 있는 참조 (제외 대상).
    pub already_related: Vec<String>,
}

/// [`suggest_related`] 의 모든 입력. I/O 층이 채워 준다.
#[derive(Debug, Clone, Default)]
pub struct SuggestInput {
    pub target: TargetEntry,
    /// 프로젝트의 일지 메타 (대상 포함 — 안에서 걸러낸다).
    pub entries: Vec<EntryRow>,
    /// `file_path` 가 `target.files` 중 하나인 행 전부.
    pub file_rows: Vec<FileRow>,
    pub plan_refs: Vec<PlanRefRow>,
    /// 프로젝트의 전체 일지 수 — IDF 의 분자.
    pub total_entries: u32,
}

/// 사람이 읽는 근거 — **코드와 파라미터만** 낸다. 번역은 프런트 몫이다
/// (백엔드가 한국어 문장을 만들면 영어 모드에서 그대로 새어 나온다).
///
/// 코드는 셋: `shared_files`(n, 대표 파일) · `plan_item`(항목 id) ·
/// `title`(일치율 %).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RelatedReason {
    pub code: String,
    pub params: Vec<String>,
}

/// 후보 한 건.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RelatedSuggestion {
    /// `.oculpm/journal/` 기준 상대경로 — frontmatter `related.ref` 에 그대로 쓴다.
    pub relative_path: String,
    pub title: String,
    pub workday: String,
    pub entry_type: String,
    pub score: f32,
    pub reasons: Vec<RelatedReason>,
}

// ─────────────────────────────────────────────────────────────────────────────
// 점수
// ─────────────────────────────────────────────────────────────────────────────

/// 후보 하나의 신호 — [`score_candidate`] 의 입력이자 테스트의 단위.
#[derive(Debug, Clone, Default)]
pub struct CandidateSignals {
    /// 공유 파일 `(경로, corpus 안에서 그 파일을 만진 일지 수)`.
    pub shared_files: Vec<(String, u32)>,
    /// 공유 플랜 항목 id (`#` 없는 형태).
    pub shared_plan_items: Vec<String>,
    pub title_jaccard: f32,
}

/// 신호 → (점수, 근거). 문턱 아래거나 근거가 없으면 `None`.
pub fn score_candidate(
    signals: &CandidateSignals,
    total_entries: u32,
) -> Option<(f32, Vec<RelatedReason>)> {
    let mut score = 0.0f32;
    let mut reasons: Vec<RelatedReason> = Vec::new();

    if !signals.shared_files.is_empty() {
        // 무게 순으로 — 대표 파일은 가장 희귀한(=말이 되는) 것이어야 한다.
        let mut weighted: Vec<(&str, f32)> = signals
            .shared_files
            .iter()
            .map(|(p, df)| (p.as_str(), file_weight(p, *df, total_entries)))
            .collect();
        weighted.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        // 허브 파일은 **합쳐서도** 상한을 못 넘는다. 개별 상한만 두면
        // `ko.ts`+`en.ts` 처럼 늘 같이 움직이는 짝이 둘이 되어 문턱을 넘고,
        // 그러면 i18n 을 건드린 모든 일지가 서로의 후보가 된다.
        let (hub, real): (Vec<&(&str, f32)>, Vec<&(&str, f32)>) =
            weighted.iter().partition(|(p, _)| is_hub_file(p));
        let real_sum: f32 = real.iter().map(|(_, w)| *w).sum();
        let hub_sum: f32 = hub.iter().map(|(_, w)| *w).sum::<f32>().min(HUB_WEIGHT_CAP);
        score += W_FILE * (real_sum + hub_sum);
        let (top, _) = weighted[0];
        reasons.push(RelatedReason {
            code: "shared_files".to_string(),
            params: vec![weighted.len().to_string(), top.to_string()],
        });
    }

    if !signals.shared_plan_items.is_empty() {
        score += (W_PLAN * signals.shared_plan_items.len() as f32).min(PLAN_CAP);
        reasons.push(RelatedReason {
            code: "plan_item".to_string(),
            params: vec![signals.shared_plan_items.join(", ")],
        });
    }

    let title_only = signals.shared_files.is_empty() && signals.shared_plan_items.is_empty();
    if signals.title_jaccard > 0.0 && (!title_only || signals.title_jaccard >= TITLE_ONLY_MIN) {
        score += W_TITLE * signals.title_jaccard;
        reasons.push(RelatedReason {
            code: "title".to_string(),
            params: vec![((signals.title_jaccard * 100.0).round() as i32).to_string()],
        });
    }

    if reasons.is_empty() || score < MIN_SCORE {
        return None;
    }
    Some((score, reasons))
}

/// 후보 목록 — 점수 내림차순, 동점이면 최신 일지가 먼저 (경로가 곧 시각).
pub fn suggest_related(input: &SuggestInput, limit: usize) -> Vec<RelatedSuggestion> {
    let limit = limit.clamp(1, MAX_LIMIT);
    let self_path = input.target.relative_path.as_str();

    // 제외 집합 — 자기 자신 + 이미 이어 둔 것.
    let mut excluded: HashSet<String> = input
        .target
        .already_related
        .iter()
        .map(|r| normalize_journal_ref(r))
        .collect();
    excluded.insert(self_path.to_string());

    // 파일 축: 파일별 문서 빈도와, 후보별 공유 파일 목록.
    let mut doc_freq: HashMap<&str, u32> = HashMap::new();
    let mut by_entry: HashMap<&str, Vec<&str>> = HashMap::new();
    for row in &input.file_rows {
        *doc_freq.entry(row.file_path.as_str()).or_insert(0) += 1;
        if row.relative_path == self_path {
            continue;
        }
        by_entry
            .entry(row.relative_path.as_str())
            .or_default()
            .push(row.file_path.as_str());
    }

    // 플랜 축: 대상이 걸린 (plan_id, item_id) → 같은 항목에 걸린 다른 일지.
    let mut target_items: HashSet<(&str, &str)> = HashSet::new();
    let normalized: Vec<(String, &PlanRefRow)> = input
        .plan_refs
        .iter()
        .map(|r| (normalize_journal_ref(&r.journal_ref), r))
        .collect();
    for (rel, row) in &normalized {
        if rel == self_path {
            target_items.insert((row.plan_id.as_str(), row.item_id.as_str()));
        }
    }
    let mut plan_by_entry: HashMap<&str, BTreeSet<&str>> = HashMap::new();
    if !target_items.is_empty() {
        for (rel, row) in &normalized {
            if rel == self_path {
                continue;
            }
            if target_items.contains(&(row.plan_id.as_str(), row.item_id.as_str())) {
                plan_by_entry
                    .entry(rel.as_str())
                    .or_default()
                    .insert(row.item_id.as_str());
            }
        }
    }

    let target_tokens = title_tokens(&input.target.title);

    let mut out: Vec<RelatedSuggestion> = Vec::new();
    for entry in &input.entries {
        let rel = entry.relative_path.as_str();
        if excluded.contains(rel) {
            continue;
        }
        let signals = CandidateSignals {
            shared_files: by_entry
                .get(rel)
                .map(|files| {
                    files
                        .iter()
                        .map(|f| (f.to_string(), doc_freq.get(f).copied().unwrap_or(1)))
                        .collect()
                })
                .unwrap_or_default(),
            shared_plan_items: plan_by_entry
                .get(rel)
                .map(|s| s.iter().map(|i| i.to_string()).collect())
                .unwrap_or_default(),
            title_jaccard: jaccard(&target_tokens, &title_tokens(&entry.title)),
        };
        if let Some((score, reasons)) = score_candidate(&signals, input.total_entries) {
            out.push(RelatedSuggestion {
                relative_path: entry.relative_path.clone(),
                title: entry.title.clone(),
                workday: entry.workday.clone(),
                entry_type: entry.entry_type.clone(),
                score,
                reasons,
            });
        }
    }

    out.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| b.relative_path.cmp(&a.relative_path))
    });
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(rel: &str, title: &str) -> EntryRow {
        EntryRow {
            relative_path: rel.to_string(),
            title: title.to_string(),
            workday: rel.split('/').next().unwrap_or("").to_string(),
            entry_type: "bug".to_string(),
        }
    }

    fn file_row(rel: &str, file: &str) -> FileRow {
        FileRow {
            relative_path: rel.to_string(),
            file_path: file.to_string(),
        }
    }

    #[test]
    fn hub_files_are_damped_and_rare_files_are_not() {
        // 실측 감각: 727건 중 ko.ts 를 만진 일지가 199건.
        let hub = file_weight("src/i18n/ko.ts", 199, 727);
        let rare = file_weight("src-tauri/src/oculpm/watcher.rs", 1, 727);
        assert!(hub <= HUB_WEIGHT_CAP, "hub weight = {hub}");
        assert!(rare > 0.9, "rare weight = {rare}");
        // 중첩 경로도 같은 허브다.
        assert!(is_hub_file("packages/app/src/i18n/en.ts"));
        assert!(!is_hub_file("src/features/oculpm/EntryDetailView.tsx"));
    }

    #[test]
    fn hub_only_overlap_never_clears_the_floor() {
        // ko.ts + en.ts 는 늘 같이 움직인다 — 둘이어도 근거가 아니다.
        let signals = CandidateSignals {
            shared_files: vec![
                ("src/i18n/ko.ts".to_string(), 199),
                ("src/i18n/en.ts".to_string(), 198),
            ],
            ..Default::default()
        };
        assert!(score_candidate(&signals, 727).is_none());
    }

    #[test]
    fn one_rare_shared_file_is_enough() {
        let signals = CandidateSignals {
            shared_files: vec![("src-tauri/src/oculpm/watcher.rs".to_string(), 3)],
            ..Default::default()
        };
        let (score, reasons) = score_candidate(&signals, 727).expect("후보여야 한다");
        assert!(score > MIN_SCORE);
        assert_eq!(reasons[0].code, "shared_files");
        assert_eq!(reasons[0].params[1], "src-tauri/src/oculpm/watcher.rs");
    }

    #[test]
    fn the_representative_file_is_the_rarest_one() {
        let signals = CandidateSignals {
            shared_files: vec![
                ("src/i18n/ko.ts".to_string(), 199),
                ("src-tauri/src/oculpm/lock.rs".to_string(), 2),
            ],
            ..Default::default()
        };
        let (_, reasons) = score_candidate(&signals, 727).unwrap();
        assert_eq!(reasons[0].params[1], "src-tauri/src/oculpm/lock.rs");
    }

    #[test]
    fn a_similar_title_alone_needs_a_high_bar() {
        let weak = CandidateSignals {
            title_jaccard: 0.2,
            ..Default::default()
        };
        assert!(score_candidate(&weak, 100).is_none());
        let strong = CandidateSignals {
            title_jaccard: 0.5,
            ..Default::default()
        };
        let (score, reasons) = score_candidate(&strong, 100).unwrap();
        assert!(score > MIN_SCORE);
        assert_eq!(reasons[0].code, "title");
        assert_eq!(reasons[0].params[0], "50");
    }

    #[test]
    fn a_weak_title_still_counts_when_a_file_is_shared() {
        // 문턱은 "제목만" 일 때의 것이다 — 다른 근거가 있으면 가산된다.
        let base = CandidateSignals {
            shared_files: vec![("src/lib/toast.ts".to_string(), 5)],
            ..Default::default()
        };
        let with_title = CandidateSignals {
            title_jaccard: 0.2,
            ..base.clone()
        };
        let a = score_candidate(&base, 727).unwrap().0;
        let b = score_candidate(&with_title, 727).unwrap().0;
        assert!(b > a);
        assert_eq!(score_candidate(&with_title, 727).unwrap().1.len(), 2);
    }

    #[test]
    fn plan_items_are_capped() {
        let one = CandidateSignals {
            shared_plan_items: vec!["a".into()],
            ..Default::default()
        };
        let many = CandidateSignals {
            shared_plan_items: vec!["a".into(), "b".into(), "c".into(), "d".into()],
            ..Default::default()
        };
        assert_eq!(score_candidate(&many, 100).unwrap().0, PLAN_CAP);
        assert!(score_candidate(&one, 100).unwrap().0 < PLAN_CAP);
    }

    #[test]
    fn title_tokens_keep_hangul_and_drop_single_ascii() {
        let toks = title_tokens("IME 조합이 a 깨진다 (WKWebView)");
        assert!(toks.contains("ime"));
        assert!(toks.contains("조합이"));
        assert!(toks.contains("wkwebview"));
        assert!(!toks.contains("a"));
    }

    #[test]
    fn jaccard_is_symmetric_and_bounded() {
        let a = title_tokens("워처가 멈춘다");
        let b = title_tokens("워처가 멈춘다");
        assert_eq!(jaccard(&a, &b), 1.0);
        assert_eq!(jaccard(&a, &title_tokens("")), 0.0);
        assert_eq!(
            jaccard(&a, &title_tokens("워처가 살아 있다")),
            jaccard(&title_tokens("워처가 살아 있다"), &a)
        );
    }

    #[test]
    fn journal_refs_normalize_to_cache_paths() {
        for raw in [
            "20260921/Bugs/1000_bug_x.md",
            "./20260921/Bugs/1000_bug_x.md",
            ".oculpm/journal/20260921/Bugs/1000_bug_x.md",
            "journal/20260921/Bugs/1000_bug_x.md",
        ] {
            assert_eq!(normalize_journal_ref(raw), "20260921/Bugs/1000_bug_x.md");
        }
    }

    #[test]
    fn suggestions_exclude_self_and_already_linked() {
        let target = "20260921/Bugs/1200_bug_watcher.md";
        let linked = "20260901/Bugs/0900_bug_watcher.md";
        let fresh = "20260910/Bugs/0900_bug_watcher.md";
        let input = SuggestInput {
            target: TargetEntry {
                relative_path: target.to_string(),
                title: "워처가 멈춘다".to_string(),
                files: vec!["src-tauri/src/oculpm/watcher.rs".to_string()],
                // plan-log 표기로 들어와도 같은 것으로 본다.
                already_related: vec![format!(".oculpm/journal/{linked}")],
            },
            entries: vec![
                entry(target, "워처가 멈춘다"),
                entry(linked, "워처가 멈춘다"),
                entry(fresh, "워처가 또 멈춘다"),
            ],
            file_rows: vec![
                file_row(target, "src-tauri/src/oculpm/watcher.rs"),
                file_row(linked, "src-tauri/src/oculpm/watcher.rs"),
                file_row(fresh, "src-tauri/src/oculpm/watcher.rs"),
            ],
            plan_refs: vec![],
            total_entries: 727,
        };
        let out = suggest_related(&input, DEFAULT_LIMIT);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].relative_path, fresh);
    }

    #[test]
    fn the_same_plan_item_is_its_own_reason() {
        let target = "20260921/Chores/1200_chore_a.md";
        let sibling = "20260920/Features_to_add/1000_feature_b.md";
        let input = SuggestInput {
            target: TargetEntry {
                relative_path: target.to_string(),
                title: "전혀 다른 제목".to_string(),
                ..Default::default()
            },
            entries: vec![
                entry(target, "전혀 다른 제목"),
                entry(sibling, "또 다른 것"),
            ],
            file_rows: vec![],
            plan_refs: vec![
                PlanRefRow {
                    plan_id: "p".into(),
                    item_id: "related-ui".into(),
                    journal_ref: target.to_string(),
                },
                PlanRefRow {
                    plan_id: "p".into(),
                    item_id: "related-ui".into(),
                    journal_ref: format!(".oculpm/journal/{sibling}"),
                },
                // 다른 항목에만 걸린 일지는 후보가 아니다.
                PlanRefRow {
                    plan_id: "p".into(),
                    item_id: "다른항목".into(),
                    journal_ref: "20260919/Bugs/0100_bug_c.md".to_string(),
                },
            ],
            total_entries: 100,
        };
        let out = suggest_related(&input, DEFAULT_LIMIT);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].relative_path, sibling);
        assert_eq!(out[0].reasons[0].code, "plan_item");
        assert_eq!(out[0].reasons[0].params[0], "related-ui");
    }

    #[test]
    fn ranking_prefers_the_stronger_signal_then_the_newer_entry() {
        let target = "20260921/Bugs/1200_bug_x.md";
        let strong = "20260801/Bugs/0900_bug_y.md";
        let weak_old = "20260701/Bugs/0900_bug_z.md";
        let weak_new = "20260901/Bugs/0900_bug_w.md";
        let input = SuggestInput {
            target: TargetEntry {
                relative_path: target.to_string(),
                title: "무관한 제목".to_string(),
                files: vec![
                    "src-tauri/src/oculpm/lock.rs".to_string(),
                    "src/i18n/ko.ts".to_string(),
                ],
                ..Default::default()
            },
            entries: vec![
                entry(target, "무관한 제목"),
                entry(strong, "자물쇠"),
                entry(weak_old, "사전"),
                entry(weak_new, "사전"),
            ],
            file_rows: vec![
                file_row(target, "src-tauri/src/oculpm/lock.rs"),
                file_row(target, "src/i18n/ko.ts"),
                file_row(strong, "src-tauri/src/oculpm/lock.rs"),
                file_row(strong, "src/i18n/ko.ts"),
                file_row(weak_old, "src/i18n/ko.ts"),
                file_row(weak_new, "src/i18n/ko.ts"),
            ],
            plan_refs: vec![],
            total_entries: 727,
        };
        let out = suggest_related(&input, MAX_LIMIT);
        // 허브만 겹친 둘은 문턱을 못 넘는다.
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].relative_path, strong);

        // 동점이면 최신이 먼저다.
        let mut input2 = input.clone();
        input2
            .file_rows
            .push(file_row(weak_old, "src-tauri/src/oculpm/lock.rs"));
        input2
            .file_rows
            .push(file_row(weak_new, "src-tauri/src/oculpm/lock.rs"));
        let out2 = suggest_related(&input2, MAX_LIMIT);
        assert_eq!(out2.len(), 3);
        assert_eq!(out2[0].relative_path, weak_new);
    }

    #[test]
    fn the_limit_is_clamped() {
        let target = "20260921/Bugs/1200_bug_x.md";
        let mut entries = vec![entry(target, "제목")];
        let mut file_rows = vec![file_row(target, "src/a.ts")];
        for i in 0..30 {
            let rel = format!("2026090{}/Bugs/0900_bug_{i}.md", i % 9);
            entries.push(entry(&rel, "제목"));
            file_rows.push(file_row(&rel, "src/a.ts"));
        }
        let input = SuggestInput {
            target: TargetEntry {
                relative_path: target.to_string(),
                title: "제목".to_string(),
                files: vec!["src/a.ts".to_string()],
                ..Default::default()
            },
            entries,
            file_rows,
            plan_refs: vec![],
            total_entries: 727,
        };
        assert_eq!(suggest_related(&input, 0).len(), 1);
        assert_eq!(suggest_related(&input, 1000).len(), MAX_LIMIT);
    }
}
