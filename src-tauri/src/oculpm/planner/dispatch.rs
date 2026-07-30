//! IN2 (#in2-dispatch) — 플래너 항목을 "실행 단위"로 터미널에 발화할 프롬프트
//! 조립. 플래너를 백미러(기록)에서 핸들(추진)로 바꾸는 첫 링크다: 항목 텍스트 +
//! (부모면) 하위 체크리스트 + 이 항목에 연결된 최근 일지 발췌(redact 통과) +
//! MCP 갱신 지시를 하나의 프롬프트로 만든다. v1 은 조립·프리필까지 — 실행
//! (Enter)은 사용자가 한다 (자동화·큐잉은 v2).

use std::path::Path;

use crate::oculpm::planner::parse::{parse_plan, ItemStatus, ParsedPlan};
use regex::Regex;

use crate::oculpm::redact::{compile_redact_patterns, redact_text};

/// 프롬프트에 넣을 연결 일지 수 상한 — 최근 것 2건이면 맥락은 충분하고,
/// 그 이상은 디스패치된 세션이 직접 읽는 게 낫다.
const MAX_LINKED_JOURNALS: usize = 2;
/// 일지 발췌 문자 상한 (프롬프트 비대 방지).
const EXCERPT_CHARS: usize = 700;

pub struct DispatchBuild {
    pub prompt: String,
    pub item_title: String,
}

/// 항목 하나의 디스패치 프롬프트를 조립한다. 잠긴 plan·미지의 item 은 거부.
pub fn build_dispatch_prompt(
    root: &Path,
    plan_id: &str,
    md: &str,
    item_id: &str,
    redact_patterns: &[Regex],
) -> Result<DispatchBuild, String> {
    let parsed = parse_plan(md, plan_id);
    if parsed.frontmatter.status.as_str() != "active" {
        return Err(format!(
            "plan '{plan_id}' 은 잠겨 있습니다 (status={}) — 실행 대상이 아닙니다",
            parsed.frontmatter.status.as_str()
        ));
    }
    let item = parsed
        .items
        .iter()
        .find(|i| i.item_id == item_id)
        .ok_or_else(|| format!("item '{item_id}' not found in plan '{plan_id}'"))?;
    let children: Vec<_> =
        parsed.items.iter().filter(|i| i.parent_item.as_deref() == Some(item_id)).collect();

    let mut p = String::new();
    p.push_str(&format!(
        "ocul-pm 플래너 디스패치 — plan \"{}\" ({plan_id}) 의 다음 항목을 구현하라.\n\n",
        parsed.frontmatter.title
    ));
    p.push_str("## 대상 항목\n\n");
    p.push_str(&format!(
        "- {{#{}}} [{}] {}{}\n",
        item.item_id,
        item.status.token(),
        item.title,
        item.phase.as_deref().map(|ph| format!("  (phase: {ph})")).unwrap_or_default()
    ));
    if !children.is_empty() {
        p.push_str("\n하위 작업 (미완만 실행 대상 — 부모 글리프는 하위 롤업 자동):\n");
        for c in &children {
            p.push_str(&format!("  - {{#{}}} [{}] {}\n", c.item_id, c.status.token(), c.title));
        }
    }
    if let Some(note) = &item.note {
        p.push_str(&format!("\n메모: {note}\n"));
    }

    let refs = linked_journal_refs(&parsed, item_id, &children);
    if !refs.is_empty() {
        p.push_str("\n## 맥락 — 이 항목에 연결된 최근 일지\n");
        for r in refs.iter().rev().take(MAX_LINKED_JOURNALS) {
            p.push_str(&format!("\n### {r}\n"));
            match read_journal_excerpt(root, r) {
                Some(x) => p.push_str(&format!("{x}\n")),
                None => p.push_str("(파일을 읽지 못했습니다 — 필요하면 직접 여세요)\n"),
            }
        }
    }

    let leaf_targets: Vec<&str> = if children.is_empty() {
        vec![item_id]
    } else {
        children
            .iter()
            .filter(|c| !matches!(c.status, ItemStatus::Done | ItemStatus::Dropped))
            .map(|c| c.item_id.as_str())
            .collect()
    };
    p.push_str(&format!(
        "\n## 완료 시\n\n1. 프로젝트 게이트(빌드/테스트/린트)를 실제로 실행해 exit 0 을 확인한다.\n\
         2. `journal_write` 로 일지를 남긴다.\n\
         3. `plan_update` 로 항목을 갱신한다 — plan_id=\"{plan_id}\", item_id={}.\n",
        leaf_targets
            .iter()
            .map(|t| format!("\"{t}\""))
            .collect::<Vec<_>>()
            .join(" · ")
    ));

    // 프롬프트 전체 redact — 일지 발췌는 이미 redact 를 거쳐 기록됐지만,
    // 프로젝트 패턴이 그 사이 늘었을 수 있다 (심층 방어).
    let (prompt, _) = redact_text(&p, redact_patterns);
    Ok(DispatchBuild { prompt, item_title: item.title.clone() })
}

/// plan-log 에서 이 항목(부모면 하위 포함)에 연결된 일지 경로를 시간순으로.
fn linked_journal_refs(
    parsed: &ParsedPlan,
    item_id: &str,
    children: &[&crate::oculpm::planner::parse::PlanItem],
) -> Vec<String> {
    let mut ids: Vec<&str> = vec![item_id];
    ids.extend(children.iter().map(|c| c.item_id.as_str()));
    let mut out: Vec<String> = Vec::new();
    for u in &parsed.updates {
        if ids.contains(&u.item_id.as_str()) {
            if let Some(jr) = &u.journal_ref {
                if !out.contains(jr) {
                    out.push(jr.clone());
                }
            }
        }
    }
    out
}

/// 일지 파일 발췌 — 제목 줄 + 본문 앞부분. ref 는 `.oculpm/…` 와 `journal/…`
/// 두 표기가 모두 쓰인다 (plan-log 관례가 혼재).
fn read_journal_excerpt(root: &Path, journal_ref: &str) -> Option<String> {
    let rel = journal_ref.trim().trim_start_matches("./");
    let path = if rel.starts_with(".oculpm/") {
        root.join(rel)
    } else {
        root.join(".oculpm").join(rel)
    };
    let raw = std::fs::read_to_string(path).ok()?;
    // frontmatter 는 건너뛰고 본문만.
    let body = match raw.strip_prefix("---") {
        Some(rest) => rest.split_once("\n---").map(|(_, b)| b).unwrap_or(&raw),
        None => raw.as_str(),
    };
    let trimmed: String = body.trim_start_matches('\n').chars().take(EXCERPT_CHARS).collect();
    Some(if body.chars().count() > EXCERPT_CHARS {
        format!("{trimmed}\n…(잘림)")
    } else {
        trimmed
    })
}

/// 프리필용 셸 한 줄 — 프롬프트 파일을 claude 위치 인자로 넘긴다. 경로는
/// 단일인용부호로 감싸고 내부 `'` 는 `'\''` 로 이스케이프 (셸 주입 방지).
pub fn shell_command_for(prompt_abs_path: &Path) -> String {
    let quoted = prompt_abs_path.display().to_string().replace('\'', "'\\''");
    format!("claude \"$(cat '{quoted}')\"")
}

/// 프로젝트 config 의 redact 패턴 로드 (없으면 기본).
pub fn project_redact_patterns(root: &Path) -> Vec<Regex> {
    let cfg = crate::oculpm::spec::OculpmConfig::load(&root.join(".oculpm").join("config.toml"))
        .unwrap_or_else(|_| crate::oculpm::spec::OculpmConfig::default_for_new_project());
    compile_redact_patterns(&cfg.git.auto_redact_patterns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const MD: &str = "---\noculpm_plan: v1\nid: p\ntitle: \"디스패치 플랜\"\nstatus: active\n---\n\n## Phase 1 {#p1}\n- [ ] 부모 작업 {#papa}\n  - [x] 끝난 하위 {#kid-done}\n  - [ ] 남은 하위 {#kid-todo}\n- [ ] 단독 항목 {#solo}\n\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n| 2026-07-31T01:00:00+09:00 | #kid-done | claude-code | →x | journal/20260731/Bugs/0100_bug_x.md | |\n<!-- oculpm:plan-log end -->\n";

    #[test]
    fn builds_prompt_with_children_journal_and_mcp_targets() {
        let dir = TempDir::new().unwrap();
        let jdir = dir.path().join(".oculpm/journal/20260731/Bugs");
        std::fs::create_dir_all(&jdir).unwrap();
        std::fs::write(
            jdir.join("0100_bug_x.md"),
            "---\nschema_version: 1\n---\n[x] 지난 수정\n\n## 발생 원인\n키 sk-abcdef123456 노출\n",
        )
        .unwrap();

        let patterns = compile_redact_patterns(&["sk-[A-Za-z0-9]+".to_string()]);
        let b = build_dispatch_prompt(dir.path(), "p", MD, "papa", &patterns).unwrap();
        assert!(b.prompt.contains("{#papa}"), "{}", b.prompt);
        assert!(b.prompt.contains("{#kid-todo}"), "하위 체크리스트: {}", b.prompt);
        assert!(b.prompt.contains("지난 수정"), "일지 발췌: {}", b.prompt);
        assert!(!b.prompt.contains("sk-abcdef123456"), "redact: {}", b.prompt);
        assert!(
            b.prompt.contains("item_id=\"kid-todo\"") && !b.prompt.contains("\"kid-done\""),
            "미완 리프만 갱신 대상: {}",
            b.prompt
        );

        // 단독(리프) 항목은 자기 자신이 갱신 대상.
        let s = build_dispatch_prompt(dir.path(), "p", MD, "solo", &patterns).unwrap();
        assert!(s.prompt.contains("item_id=\"solo\""));
        // 미지 항목·잠긴 plan 거부.
        assert!(build_dispatch_prompt(dir.path(), "p", MD, "ghost", &patterns).is_err());
        let locked = MD.replace("status: active", "status: done");
        assert!(build_dispatch_prompt(dir.path(), "p", &locked, "solo", &patterns).is_err());
    }

    #[test]
    fn shell_command_quotes_single_quotes() {
        let cmd = shell_command_for(Path::new("/a/o'brien/p.md"));
        assert_eq!(cmd, "claude \"$(cat '/a/o'\\''brien/p.md')\"");
    }
}
