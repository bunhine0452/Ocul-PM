//! v2 U10 (백로그 C1, docs/20260706_v2/02-features-spec.md §1) — 스탠드업·
//! PR 본문·주간 보고 생성. "기록하는 앱"이 쌓아둔 일지를 매일 쓰는 산출물로
//! 되돌려주는 커맨드.
//!
//! 원칙:
//! - 데이터는 SQLite 캐시(`range_entries` — 회고 F4 와 동일 경로)만 읽는다.
//!   캐시는 투영 시점에 secret-masked(R1) 라 원본 재독 없이 안전하다.
//! - **API 키 없이도 항상 동작한다**: provider/model 미지정·LLM 실패 시
//!   결정적 마크다운으로 폴백하고 `used_llm=false` + `note` 로 정직하게 알린다.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{Db, OpenPlanItem};
use crate::llm;
use crate::oculpm::cache::{JournalCache, RangeEntry};

/// 스탠드업 "오늘 할 일" 로 보여줄 플랜 항목 상한.
const OPEN_ITEMS_CAP: u32 = 12;
/// PR 본문의 "주요 변경 파일" 상한.
const FILES_CAP: usize = 12;
/// LLM 입력에 넣는 일지 줄 수 상한 (프롬프트 폭주 방지).
const LLM_ENTRY_CAP: usize = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SummaryStyle {
    Standup,
    PrDescription,
    WeeklyStatus,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct GeneratedSummary {
    pub style: SummaryStyle,
    pub markdown: String,
    pub entry_count: u32,
    pub used_llm: bool,
    /// LLM 폴백 사유 등 사용자에게 알릴 한 줄 (없으면 None).
    pub note: Option<String>,
}

// ─── deterministic generators (pure, testable) ──────────────────────────────

fn type_label(t: &str) -> &'static str {
    match t {
        "feature" => "기능",
        "bug" => "버그 수정",
        "refactor" => "리팩토링",
        "error" => "에러 대응",
        _ => "기타",
    }
}

fn group_lines(entries: &[RangeEntry]) -> String {
    let mut out = String::new();
    for ty in ["feature", "bug", "refactor", "error", "chore"] {
        let group: Vec<&RangeEntry> = entries.iter().filter(|e| e.entry_type == ty).collect();
        if group.is_empty() {
            continue;
        }
        out.push_str(&format!("**{}**\n", type_label(ty)));
        for e in &group {
            out.push_str(&format!("- {} ({})\n", e.title, e.workday));
        }
        out.push('\n');
    }
    out
}

/// 항목별 등장 파일을 entry 당 1회로 세어 상위 N 파일 추출 (PR "주요 변경").
fn top_files(entries: &[RangeEntry], cap: usize) -> Vec<(String, u32)> {
    use std::collections::{HashMap, HashSet};
    let mut counts: HashMap<String, u32> = HashMap::new();
    for e in entries {
        let mut seen: HashSet<&str> = HashSet::new();
        for f in &e.files {
            if seen.insert(f.as_str()) {
                *counts.entry(f.clone()).or_insert(0) += 1;
            }
        }
    }
    let mut v: Vec<(String, u32)> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    v.truncate(cap);
    v
}

fn fmt_open_items(items: &[OpenPlanItem], statuses: &[&str]) -> String {
    let picked: Vec<&OpenPlanItem> =
        items.iter().filter(|i| statuses.contains(&i.status.as_str())).collect();
    if picked.is_empty() {
        return "- (없음)\n".to_string();
    }
    picked
        .iter()
        .map(|i| format!("- [{}] {}\n", i.plan_title, i.item_title))
        .collect()
}

pub(crate) fn deterministic_markdown(
    style: SummaryStyle,
    since: &str,
    until: &str,
    entries: &[RangeEntry],
    open_items: &[OpenPlanItem],
) -> String {
    match style {
        SummaryStyle::Standup => {
            let mut out = format!("# 스탠드업 — {since} ~ {until}\n\n## 한 일\n");
            if entries.is_empty() {
                out.push_str("- (기록 없음)\n");
            } else {
                out.push('\n');
                out.push_str(&group_lines(entries));
            }
            out.push_str("## 오늘 할 일\n");
            out.push_str(&fmt_open_items(open_items, &["todo", "in_progress"]));
            out.push_str("\n## 막힘\n");
            out.push_str(&fmt_open_items(open_items, &["blocked"]));
            out
        }
        SummaryStyle::PrDescription => {
            let shipped: Vec<&RangeEntry> = entries
                .iter()
                .filter(|e| e.entry_type != "chore" || e.status == "done")
                .collect();
            let mut out = String::from("## 변경 요약\n");
            if shipped.is_empty() {
                out.push_str("- (기록 없음)\n");
            } else {
                for e in &shipped {
                    out.push_str(&format!("- {} — {}\n", type_label(&e.entry_type), e.title));
                }
            }
            let files = top_files(entries, FILES_CAP);
            if !files.is_empty() {
                out.push_str("\n## 주요 변경 파일\n");
                for (path, count) in files {
                    out.push_str(&format!("- `{path}` ({count}개 작업)\n"));
                }
            }
            let error_cycles = entries.iter().filter(|e| e.entry_type == "error").count();
            out.push_str("\n## 검증\n");
            out.push_str(&format!(
                "- 작업 단위별 검증은 각 일지의 `## 검증` 참조 (총 {}건{}).\n",
                entries.len(),
                if error_cycles > 0 {
                    format!(", 에러 사이클 {error_cycles}건 포함")
                } else {
                    String::new()
                },
            ));
            out
        }
        SummaryStyle::WeeklyStatus => {
            let done = entries
                .iter()
                .filter(|e| {
                    (e.entry_type == "feature" || e.entry_type == "refactor")
                        && e.status == "done"
                })
                .count();
            let friction = entries
                .iter()
                .filter(|e| e.entry_type == "error" || e.entry_type == "bug")
                .count();
            let mut out = format!(
                "# 주간 보고 — {since} ~ {until}\n\n총 {}개 작업 기록 · 출시 {}건 · 마찰 {}건\n\n## 하이라이트\n",
                entries.len(),
                done,
                friction,
            );
            if entries.is_empty() {
                out.push_str("- (기록 없음)\n");
            } else {
                out.push('\n');
                out.push_str(&group_lines(entries));
            }
            out.push_str("## 다음 주\n");
            out.push_str(&fmt_open_items(open_items, &["todo", "in_progress", "blocked"]));
            out
        }
    }
}

// ─── LLM ─────────────────────────────────────────────────────────────────────

fn system_prompt(style: SummaryStyle) -> &'static str {
    match style {
        SummaryStyle::Standup => {
            r#"너는 개발자의 데일리 스탠드업 공유문을 한국어로 쓰는 조수다.
입력: 기간 내 작업 일지 목록(타입/제목/상태/워크데이) + 활성 플랜의 미완 항목.
출력: 마크다운 본문만 (코드펜스 금지). 섹션: ## 한 일 / ## 오늘 할 일 / ## 막힘.
규칙: 입력에 있는 사실만. 비슷한 일지는 한 불릿으로 묶어 간결하게. 각 섹션 3~7불릿."#
        }
        SummaryStyle::PrDescription => {
            r#"너는 Pull Request 본문을 한국어로 쓰는 시니어 개발자다.
입력: 이 브랜치 기간의 작업 일지 목록(타입/제목/상태) + 자주 변경된 파일.
출력: 마크다운 본문만 (코드펜스 금지). 섹션: ## 변경 요약(2~3문장) /
## 주요 변경점(불릿, 파일·기능 단위로 묶기) / ## 검증(일지의 타입 구성에 근거).
규칙: 입력에 있는 사실만. 커밋 메시지 톤 — 담백하고 구체적으로."#
        }
        SummaryStyle::WeeklyStatus => {
            r#"너는 주간 업무 보고를 한국어로 쓰는 테크 리드다.
입력: 한 주의 작업 일지 목록 + 활성 플랜의 미완 항목.
출력: 마크다운 본문만 (코드펜스 금지). 섹션: ## 주간 하이라이트 /
## 진행·이슈 / ## 다음 주.
규칙: 입력에 있는 사실만. 경영진이 30초에 읽게 간결히."#
        }
    }
}

fn fmt_llm_input(
    since: &str,
    until: &str,
    entries: &[RangeEntry],
    open_items: &[OpenPlanItem],
) -> String {
    let mut out = format!("기간: {since} ~ {until} (일지 {}개)\n\n[작업 일지]\n", entries.len());
    for e in entries.iter().take(LLM_ENTRY_CAP) {
        out.push_str(&format!(
            "- ({}, {}) {} / {} / 파일 {}개\n",
            e.entry_type,
            e.status,
            e.title,
            e.workday,
            e.files.len()
        ));
    }
    if entries.len() > LLM_ENTRY_CAP {
        out.push_str(&format!("… 외 {}개\n", entries.len() - LLM_ENTRY_CAP));
    }
    out.push_str("\n[활성 플랜 미완 항목]\n");
    if open_items.is_empty() {
        out.push_str("(없음)\n");
    } else {
        for i in open_items {
            out.push_str(&format!("- [{}] {} ({})\n", i.plan_title, i.item_title, i.status));
        }
    }
    out
}

async fn call_llm(
    provider: &str,
    model: &str,
    style: SummaryStyle,
    input: String,
    content_lang: crate::oculpm::content_lang::ContentLang,
) -> Result<String, String> {
    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("No API key configured for {provider}"))?
    };
    let client = llm::create(provider, api_key).map_err(|e| e.to_string())?;
    let response = client
        .chat(
            vec![
                llm::Message {
                    role: llm::Role::System,
                    content: content_lang.apply(system_prompt(style)),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: input,
                },
            ],
            llm::ChatOptions {
                model: model.to_string(),
                temperature: Some(0.3),
                max_tokens: Some(1200),
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    let content = response.content.trim();
    let body = if content.starts_with("```") {
        content
            .trim_start_matches("```markdown")
            .trim_start_matches("```md")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        content
    };
    if body.is_empty() {
        return Err("The result came back empty.".to_string());
    }
    Ok(body.to_string())
}

// ─── command ─────────────────────────────────────────────────────────────────

/// 기간의 일지 + 활성 플랜을 스탠드업/PR 본문/주간 보고 마크다운으로 만든다.
/// provider/model 이 없거나 LLM 이 실패하면 결정적 마크다운으로 폴백한다
/// (`used_llm`/`note` 로 구분) — API 키 없이도 항상 동작.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_generate_summary(
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
    style: SummaryStyle,
    provider: Option<String>,
    model: Option<String>,
) -> Result<GeneratedSummary, String> {
    let entries = JournalCache::new(&db)
        .range_entries(project_id, &since, &until)
        .await
        .map_err(|e| e.to_string())?;
    let open_items = db
        .list_open_plan_items(project_id, OPEN_ITEMS_CAP)
        .await
        .map_err(|e| e.to_string())?;

    let entry_count = entries.len() as u32;
    let fallback = deterministic_markdown(style, &since, &until, &entries, &open_items);

    if let (Some(provider), Some(model)) = (provider, model) {
        let input = fmt_llm_input(&since, &until, &entries, &open_items);
        let content_lang = crate::oculpm::content_lang::current(&db).await;
        match call_llm(&provider, &model, style, input, content_lang).await {
            Ok(markdown) => {
                return Ok(GeneratedSummary {
                    style,
                    markdown,
                    entry_count,
                    used_llm: true,
                    note: None,
                })
            }
            Err(e) => {
                return Ok(GeneratedSummary {
                    style,
                    markdown: fallback,
                    entry_count,
                    used_llm: false,
                    note: Some(format!("LLM 사용 불가로 기본 형식으로 생성했어요 ({e})")),
                })
            }
        }
    }

    Ok(GeneratedSummary {
        style,
        markdown: fallback,
        entry_count,
        used_llm: false,
        note: None,
    })
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(ty: &str, status: &str, workday: &str, title: &str, files: &[&str]) -> RangeEntry {
        RangeEntry {
            relative_path: format!("{workday}/X/{title}.md"),
            workday: workday.to_string(),
            entry_type: ty.to_string(),
            status: status.to_string(),
            difficulty: None,
            agent_id: "claude-code".to_string(),
            title: title.to_string(),
            files: files.iter().map(|s| s.to_string()).collect(),
            tags: Vec::new(),
        }
    }

    fn item(plan: &str, title: &str, status: &str) -> OpenPlanItem {
        OpenPlanItem {
            plan_id: "p".to_string(),
            plan_title: plan.to_string(),
            item_id: title.to_string(),
            item_title: title.to_string(),
            phase: None,
            status: status.to_string(),
        }
    }

    #[test]
    fn standup_sections_and_plan_split() {
        let entries = vec![
            entry("feature", "done", "20260705", "팔레트 점프", &["src/a.ts"]),
            entry("bug", "done", "20260705", "토스트 테마", &["src/b.ts"]),
        ];
        let items = vec![
            item("v2", "FTS 검색", "todo"),
            item("v2", "workday brief", "in_progress"),
            item("v2", "서명키 발급", "blocked"),
        ];
        let md = deterministic_markdown(SummaryStyle::Standup, "20260705", "20260706", &entries, &items);
        assert!(md.contains("## 한 일"));
        assert!(md.contains("**기능**"));
        assert!(md.contains("팔레트 점프"));
        // 오늘 할 일에는 todo/in_progress 만, 막힘에는 blocked 만.
        let todo_at = md.find("## 오늘 할 일").unwrap();
        let blocked_at = md.find("## 막힘").unwrap();
        assert!(md[todo_at..blocked_at].contains("FTS 검색"));
        assert!(md[todo_at..blocked_at].contains("workday brief"));
        assert!(!md[todo_at..blocked_at].contains("서명키"));
        assert!(md[blocked_at..].contains("서명키 발급"));
    }

    #[test]
    fn pr_description_lists_top_files_once_per_entry() {
        let entries = vec![
            entry("feature", "done", "20260706", "F1", &["src/x.ts", "src/x.ts", "src/y.ts"]),
            entry("refactor", "done", "20260706", "R1", &["src/x.ts"]),
        ];
        let md = deterministic_markdown(SummaryStyle::PrDescription, "20260706", "20260706", &entries, &[]);
        // entry 내 중복은 1회 — x.ts 는 2개 작업.
        assert!(md.contains("`src/x.ts` (2개 작업)"));
        assert!(md.contains("`src/y.ts` (1개 작업)"));
        assert!(md.contains("## 검증"));
    }

    #[test]
    fn weekly_counts_and_next_week() {
        let entries = vec![
            entry("feature", "done", "20260701", "F1", &[]),
            entry("error", "done", "20260702", "E1", &[]),
        ];
        let items = vec![item("v2", "남은 일", "todo")];
        let md = deterministic_markdown(SummaryStyle::WeeklyStatus, "20260630", "20260706", &entries, &items);
        assert!(md.contains("총 2개 작업 기록 · 출시 1건 · 마찰 1건"));
        assert!(md.contains("## 다음 주"));
        assert!(md.contains("남은 일"));
    }

    #[test]
    fn empty_range_is_still_valid_markdown() {
        let md = deterministic_markdown(SummaryStyle::Standup, "20260706", "20260706", &[], &[]);
        assert!(md.contains("(기록 없음)"));
        assert!(md.contains("(없음)"));
    }
}
