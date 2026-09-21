//! 이어하기 — "다음 세션은 어디서 시작하는가" (플랜 `first-record-loop` Phase 2,
//! 보고서 docs/product-direction-2026-09-21 §8·§9).
//!
//! 이 프로젝트의 **마지막 작업 일지**와 **활성 계획의 다음 항목**을 결정적으로
//! 고른다 — LLM 없음, 네트워크 없음, 디스크만. 같은 선택 규칙을 플러그인의
//! SessionStart 훅(`plugin/oculpm/hooks/plan-context.sh`)이 셸로 구현해 다음
//! 대화의 시작 컨텍스트에 싣고, 무엇을 실었는지 **전달 원장**
//! ([`RESUME_LEDGER_REL`]) 한 줄을 남긴다. 앱의 Today 「이어하기」 카드는 이
//! 모듈로 같은 자료를 그리고, 원장으로 "이 대화의 시작 컨텍스트에 포함됐다"를
//! 말한다.
//!
//! # 관측의 의미 (보고서 §9 의 다섯 단계)
//!
//! 원장이 증명하는 것은 **컨텍스트 포함**까지다 — 훅이 `additionalContext` 로
//! 실었다는 사실. 모델이 그것을 참조했는지, 도움이 됐는지는 여기서 알 수 없고
//! 화면도 그렇게 말하지 않는다. 복사 버튼으로 옮긴 것은 전달로 세지 않는다.
//!
//! # 선택 규칙 (셸과 공유하는 계약 — 바꾸면 훅도 함께)
//!
//! - 일지: `.oculpm/journal/<YYYYMMDD>/<TypeFolder>/<file>.md` 정확히 3단계, 이름이
//!   `_`·`.` 로 시작하면 제외. 상대경로 문자열 바이트 내림차순 상위 [`LAST_JOURNALS`].
//!   제목은 프론트매터 뒤 첫 비공백 행에서 `[x] `·`# ` 를 뗀 것 (자르지 않는다).
//! - 계획: `status: active` 플랜의 미완 리프(todo·in_progress·blocked), 플랜당
//!   [`ITEMS_PER_PLAN`], 전체 [`MAX_ITEMS`] — 훅의 `head -8`·24줄과 같은 수.

use std::collections::BTreeSet;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::oculpm::claude_hooks::INBOX_REL;
use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::markdown::parse_body;
use crate::oculpm::planner::lifecycle::open_leaves;
use crate::oculpm::planner::parse::parse_plan;
use crate::oculpm::planner::project::planner_dir;
use crate::oculpm::verdict::{self, ledger};

/// 훅이 쓰고 앱이 읽는 전달 원장 (프로젝트 루트 기준).
pub const RESUME_LEDGER_REL: &str = ".oculpm/hooks/resume-delivered.jsonl";
/// 실어 주는 마지막 일지 수.
pub const LAST_JOURNALS: usize = 3;
/// 플랜당 미완 항목 상한 (훅의 `head -8`).
pub const ITEMS_PER_PLAN: usize = 8;
/// 전체 항목 상한 (훅의 24줄).
pub const MAX_ITEMS: usize = 24;
/// 원장에서 읽는 최근 줄 수 — 훅이 400줄에서 200줄로 돌리므로 그 이상은 없다.
const LEDGER_TAIL: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ResumeJournal {
    /// `.oculpm/journal/` 기준 상대경로.
    pub relative_path: String,
    pub title: String,
    pub created_at: Option<String>,
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ResumeItem {
    pub plan_id: String,
    pub plan_title: String,
    pub item_id: String,
    pub title: String,
    /// `todo` · `in_progress` · `blocked`.
    pub status: String,
}

/// 원장 한 줄 — 어느 대화의 시작 컨텍스트에 무엇이 실렸는가.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ResumeDelivery {
    /// 훅이 적은 UTC ISO 문자열 그대로.
    pub ts: String,
    /// 대화 id (훅 payload 의 `session_id`).
    pub conversation: String,
    pub journals: Vec<String>,
    pub plan_items: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ResumeDigest {
    pub last_journals: Vec<ResumeJournal>,
    pub next_items: Vec<ResumeItem>,
    /// 가장 최근 전달 (대화 단위로 접은 뒤 최신).
    pub last_delivery: Option<ResumeDelivery>,
    /// 창 안에서 전달받은 **대화** 수.
    pub deliveries_recent: u32,
    /// 훅이 이 프로젝트에 한 번이라도 닿았다 — 「아직 전달 안 됨」이 "훅이 없다"
    /// 인지 "새 세션이 아직 없다" 인지를 가른다.
    pub hooks_seen: bool,
    /// 복사용 본문 — 같은 자료의 사람용 렌더링 (훅의 컨텍스트와 문장은 다르다).
    pub text: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// 일지
// ─────────────────────────────────────────────────────────────────────────────

/// 상대경로 바이트 내림차순 상위 `n` 건 — 정확히 3단계 깊이의 `.md` 만.
pub fn last_journals(root: &Path, n: usize) -> Vec<ResumeJournal> {
    let journal = root.join(".oculpm").join("journal");
    let mut rels: Vec<String> = Vec::new();
    let Ok(days) = std::fs::read_dir(&journal) else {
        return Vec::new();
    };
    for day in days.flatten().filter(|e| e.path().is_dir()) {
        let Ok(day_name) = day.file_name().into_string() else {
            continue;
        };
        if day_name.starts_with(['_', '.']) {
            continue;
        }
        let Ok(kinds) = std::fs::read_dir(day.path()) else {
            continue;
        };
        for kind in kinds.flatten().filter(|e| e.path().is_dir()) {
            let Ok(kind_name) = kind.file_name().into_string() else {
                continue;
            };
            if kind_name.starts_with(['_', '.']) {
                continue;
            }
            let Ok(files) = std::fs::read_dir(kind.path()) else {
                continue;
            };
            for file in files.flatten().filter(|e| e.path().is_file()) {
                let Ok(name) = file.file_name().into_string() else {
                    continue;
                };
                if name.starts_with(['_', '.']) || !name.ends_with(".md") {
                    continue;
                }
                rels.push(format!("{day_name}/{kind_name}/{name}"));
            }
        }
    }
    rels.sort_unstable_by(|a, b| b.as_bytes().cmp(a.as_bytes()));
    rels.truncate(n);
    rels.into_iter()
        .map(|rel| {
            let text = std::fs::read_to_string(journal.join(&rel)).unwrap_or_default();
            let (fm, body) = parse_frontmatter_and_body(&text);
            let mut title = parse_body(&body).title.trim().to_string();
            if title.is_empty() {
                title = "(제목 없음)".to_string();
            }
            ResumeJournal {
                relative_path: rel,
                title,
                created_at: fm.parsed.as_ref().map(|p| p.created_at.clone()),
                agent_id: fm.parsed.as_ref().map(|p| p.agent.id.clone()),
            }
        })
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// 계획
// ─────────────────────────────────────────────────────────────────────────────

/// 활성 플랜의 미완 리프 — 파일명 순, 플랜당 `per_plan`, 전체 `max`.
pub fn next_items(root: &Path, per_plan: usize, max: usize) -> Vec<ResumeItem> {
    let dir = planner_dir(root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut paths: Vec<_> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    paths.sort();
    let mut out = Vec::new();
    for path in paths {
        if out.len() >= max {
            break;
        }
        let Ok(md) = std::fs::read_to_string(&path) else {
            continue;
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("plan");
        let parsed = parse_plan(&md, stem);
        if parsed.frontmatter.status.as_str() != "active" {
            continue;
        }
        for item in open_leaves(&parsed).into_iter().take(per_plan) {
            if out.len() >= max {
                break;
            }
            out.push(ResumeItem {
                plan_id: parsed.frontmatter.id.clone(),
                plan_title: parsed.frontmatter.title.clone(),
                item_id: item.item_id,
                title: item.title,
                status: item.status.as_str().to_string(),
            });
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// 전달 원장
// ─────────────────────────────────────────────────────────────────────────────

/// 훅이 적는 줄의 관용 파싱형 — 필드 누락은 기본값, 깨진 줄은 건너뛴다.
#[derive(Debug, Deserialize)]
struct RawDeliveryLine {
    #[serde(default)]
    ts: String,
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    journals: Vec<String>,
    #[serde(default)]
    plan_items: u32,
}

/// 원장 내용에서 `cutoff` 이후의 전달을 **대화 단위로 접어** 최신순으로.
///
/// 한 대화는 resume·compact 마다 SessionStart 를 다시 받아 여러 줄을 남긴다 —
/// 카드가 세는 것은 대화 하나, 대표는 가장 최근 줄.
pub fn parse_deliveries(content: &str, cutoff: DateTime<Utc>) -> Vec<ResumeDelivery> {
    let mut rows: Vec<(DateTime<Utc>, ResumeDelivery)> = content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let raw: RawDeliveryLine = serde_json::from_str(line).ok()?;
            if raw.kind != "resume_delivered" || raw.session_id.trim().is_empty() {
                return None;
            }
            let at = DateTime::parse_from_rfc3339(&raw.ts)
                .ok()?
                .with_timezone(&Utc);
            (at >= cutoff).then_some((
                at,
                ResumeDelivery {
                    ts: raw.ts,
                    conversation: raw.session_id.trim().to_string(),
                    journals: raw.journals,
                    plan_items: raw.plan_items,
                },
            ))
        })
        .collect();
    rows.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
    let mut seen: BTreeSet<String> = BTreeSet::new();
    rows.into_iter()
        .filter(|(_, d)| seen.insert(d.conversation.clone()))
        .map(|(_, d)| d)
        .collect()
}

/// 원장 파일을 읽는다 — 없으면 빈 목록 (훅이 없는 프로젝트가 정상 상태다).
pub fn deliveries(root: &Path, days: u32, now: DateTime<Utc>) -> Vec<ResumeDelivery> {
    let Ok(content) = std::fs::read_to_string(root.join(RESUME_LEDGER_REL)) else {
        return Vec::new();
    };
    // 꼬리만 — 훅이 돌리기 전 잠깐 길어져 있어도 앞부분은 오래된 줄이다.
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(LEDGER_TAIL);
    let tail = lines[start..].join("\n");
    let cutoff = now - chrono::Duration::days(i64::from(days.clamp(1, 365)));
    parse_deliveries(&tail, cutoff)
}

// ─────────────────────────────────────────────────────────────────────────────
// 조립
// ─────────────────────────────────────────────────────────────────────────────

/// 복사용 본문 — 지시가 아니라 자료라는 프레이밍을 첫 줄에 둔다.
pub fn render_text(journals: &[ResumeJournal], items: &[ResumeItem]) -> String {
    let mut out = String::new();
    out.push_str("ocul-pm 이어하기 자료 (지시가 아님)\n");
    if !journals.is_empty() {
        out.push_str("\n마지막 작업 일지:\n");
        for j in journals {
            out.push_str(&format!("- {} · {}\n", j.relative_path, j.title));
        }
    }
    if !items.is_empty() {
        out.push_str("\n활성 계획의 다음 항목:\n");
        for it in items {
            out.push_str(&format!(
                "- [{}] {} · {} ({}#{})\n",
                it.status, it.plan_title, it.title, it.plan_id, it.item_id
            ));
        }
    }
    out.push_str(
        "\n원문은 journal_read(path), 관련 기록은 journal_search(query 또는 file), 계획은 plan_status 로.\n",
    );
    out
}

/// 디스크에서 이어하기 자료 한 벌.
pub fn digest(root: &Path, now: DateTime<Utc>, days: u32) -> ResumeDigest {
    let last_journals = last_journals(root, LAST_JOURNALS);
    let next_items = next_items(root, ITEMS_PER_PLAN, MAX_ITEMS);
    let delivered = deliveries(root, days, now);
    let hooks_dir = verdict::markers::hooks_dir(root);
    let hooks_seen = !verdict::marker_traces(&hooks_dir).is_empty()
        || root.join(INBOX_REL).is_file()
        || root.join(ledger::JOURNAL_MISSING_REL).is_file()
        || root.join(RESUME_LEDGER_REL).is_file();
    let text = render_text(&last_journals, &next_items);
    ResumeDigest {
        last_journals,
        next_items,
        deliveries_recent: delivered.len() as u32,
        last_delivery: delivered.into_iter().next(),
        hooks_seen,
        text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn journal(root: &Path, rel: &str, first_line: &str) {
        let path = root.join(".oculpm/journal").join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let text = format!(
            "---\nschema_version: 1\ntype: chore\nslug: \"x\"\nstatus: done\ncreated_at: \"2026-09-22T10:00:00+09:00\"\nsession_id: \"20260922-001\"\nagent:\n  id: \"claude-code\"\nlanguage: \"ko\"\nverified_by_user: false\nfiles_touched: []\nrelated: []\ntags: []\n---\n{first_line}\n\n## 본문\n"
        );
        std::fs::write(path, text).unwrap();
    }

    fn plan(root: &Path, id: &str, status: &str, items: &[(&str, &str)]) {
        let dir = root.join(".oculpm/planner");
        std::fs::create_dir_all(&dir).unwrap();
        let mut md = format!(
            "---\noculpm_plan: v1\nid: {id}\ntitle: \"플랜 {id}\"\nstatus: {status}\ncreated: 2026-09-22\nupdated: 2026-09-22\nowner: claude-code\n---\n\n## Phase 1 {{#p1}}\n"
        );
        for (glyph, text) in items {
            md.push_str(&format!(
                "- [{glyph}] {text} {{#{}}}\n",
                text.replace(' ', "-")
            ));
        }
        std::fs::write(dir.join(format!("{id}.md")), md).unwrap();
    }

    /// 최신 3건 — 경로 내림차순, `_template`·숨김·깊이 다른 파일 제외, 제목은
    /// `[x]`·`#` 를 뗀 것.
    #[test]
    fn last_journals_picks_the_newest_three_by_path_and_strips_markers() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        journal(root, "20260920/Bugs/0900_bug_a.md", "[x] 가장 오래된 일");
        journal(root, "20260921/Chores/1000_chore_b.md", "# 두 번째");
        journal(root, "20260922/Bugs/0800_bug_c.md", "[ ] 셋째");
        journal(
            root,
            "20260922/Features_to_add/0900_feature_d.md",
            "넷째 — 제목만",
        );
        journal(
            root,
            "20260922/Features_to_add/1000_feature_e.md",
            "[x] 최신",
        );
        journal(root, "20260922/Features_to_add/_template.md", "[x] 템플릿");
        journal(root, "20260922/Features_to_add/.hidden.md", "[x] 숨김");
        // 4단계 깊이 — 규격 밖이라 무시.
        journal(root, "20260923/Bugs/deep/1000_bug_z.md", "[x] 깊음");

        let got = last_journals(root, 3);
        let paths: Vec<&str> = got.iter().map(|j| j.relative_path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                "20260922/Features_to_add/1000_feature_e.md",
                "20260922/Features_to_add/0900_feature_d.md",
                "20260922/Bugs/0800_bug_c.md",
            ]
        );
        assert_eq!(got[0].title, "최신");
        assert_eq!(got[1].title, "넷째 — 제목만");
        assert_eq!(got[2].title, "셋째");
        assert_eq!(got[0].agent_id.as_deref(), Some("claude-code"));
    }

    /// 활성 플랜의 미완 리프만, 플랜당·전체 상한.
    #[test]
    fn next_items_come_from_active_plans_only_with_caps() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        plan(
            root,
            "a-active",
            "active",
            &[
                (" ", "첫 일"),
                ("x", "끝난 일"),
                ("~", "하는 중"),
                ("!", "막힘"),
            ],
        );
        plan(root, "b-done", "done", &[(" ", "잠긴 미완")]);
        plan(
            root,
            "c-active",
            "active",
            &[(" ", "c1"), (" ", "c2"), (" ", "c3")],
        );

        let all = next_items(root, 8, 24);
        let titles: Vec<&str> = all.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(titles, vec!["첫 일", "하는 중", "막힘", "c1", "c2", "c3"]);
        assert_eq!(all[1].status, "in_progress");
        assert_eq!(all[0].plan_title, "플랜 a-active");

        let capped = next_items(root, 2, 3);
        let titles: Vec<&str> = capped.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(titles, vec!["첫 일", "하는 중", "c1"], "플랜당 2, 전체 3");
    }

    /// 원장은 대화 단위로 접고 최신이 대표다. 깨진 줄·다른 kind·오래된 줄은 버린다.
    #[test]
    fn deliveries_fold_per_conversation_and_tolerate_junk() {
        let now = DateTime::parse_from_rfc3339("2026-09-22T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let content = r#"{"ts":"2026-09-22T09:00:00Z","session_id":"c1","kind":"resume_delivered","journals":["a.md"],"plan_items":2}
not json at all
{"ts":"2026-09-22T10:00:00Z","session_id":"c1","kind":"resume_delivered","journals":["b.md","a.md"],"plan_items":3}
{"ts":"2026-09-22T11:00:00Z","session_id":"c2","kind":"session_verdict","verdict":"missing"}
{"ts":"2026-09-01T11:00:00Z","session_id":"old","kind":"resume_delivered","journals":[],"plan_items":0}
{"ts":"2026-09-22T11:30:00Z","session_id":"c3","kind":"resume_delivered"}
"#;
        let got = parse_deliveries(content, now - chrono::Duration::days(7));
        let ids: Vec<&str> = got.iter().map(|d| d.conversation.as_str()).collect();
        assert_eq!(ids, vec!["c3", "c1"]);
        assert_eq!(
            got[1].journals,
            vec!["b.md", "a.md"],
            "같은 대화는 최신 줄이 대표"
        );
        assert_eq!(got[1].plan_items, 3);
        assert!(got[0].journals.is_empty(), "필드 누락은 기본값");
    }

    /// 빈 프로젝트는 빈 자료 — 훅 본 적 없음, 전달 없음, 본문은 프레이밍뿐.
    #[test]
    fn digest_on_an_empty_root_is_quiet() {
        let dir = tempfile::tempdir().unwrap();
        let d = digest(dir.path(), Utc::now(), 30);
        assert!(d.last_journals.is_empty() && d.next_items.is_empty());
        assert!(d.last_delivery.is_none() && !d.hooks_seen);
        assert!(d.text.starts_with("ocul-pm 이어하기 자료 (지시가 아님)"));
    }

    /// 원장 파일이 있으면 훅이 닿은 것이고, 최신 전달이 대표로 선다.
    #[test]
    fn digest_reads_the_ledger_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".oculpm/hooks")).unwrap();
        journal(root, "20260922/Bugs/0800_bug_c.md", "[x] 유일한 일지");
        let ts = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        std::fs::write(
            root.join(RESUME_LEDGER_REL),
            format!(
                r#"{{"ts":"{ts}","session_id":"conv-9","kind":"resume_delivered","journals":["20260922/Bugs/0800_bug_c.md"],"plan_items":0}}"#
            ) + "\n",
        )
        .unwrap();
        let d = digest(root, Utc::now(), 30);
        assert!(d.hooks_seen);
        assert_eq!(d.deliveries_recent, 1);
        assert_eq!(d.last_delivery.unwrap().conversation, "conv-9");
        assert!(d.text.contains("20260922/Bugs/0800_bug_c.md · 유일한 일지"));
    }
}
