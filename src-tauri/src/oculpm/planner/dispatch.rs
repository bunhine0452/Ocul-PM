//! IN2 (#in2-dispatch) — 플래너 항목을 "실행 단위"로 터미널에 발화할 프롬프트
//! 조립. 플래너를 백미러(기록)에서 핸들(추진)로 바꾸는 첫 링크다: 항목 텍스트 +
//! (부모면) 하위 체크리스트 + 이 항목에 연결된 최근 일지 발췌(redact 통과) +
//! MCP 갱신 지시를 하나의 프롬프트로 만든다. v1 은 조립·프리필까지 — 실행
//! (Enter)은 사용자가 한다 (자동화·큐잉은 v2).

use std::path::Path;

use crate::oculpm::planner::parse::{parse_plan, ItemStatus, ParsedPlan};
use regex::Regex;

use crate::oculpm::content_lang::ContentLang;

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
///
/// 이 프롬프트는 터미널에 프리필돼 **사용자가 읽고 실행**한다 — 03-i18n.md
/// §4.5 가 이름을 집어 지목한 예외라 본문도 산출물 언어를 따른다. 에이전트가
/// 이걸 읽고 일지를 쓰므로, 여기 언어가 곧 일지 언어가 된다.
pub fn build_dispatch_prompt(
    root: &Path,
    plan_id: &str,
    md: &str,
    item_id: &str,
    redact_patterns: &[Regex],
    lang: ContentLang,
) -> Result<DispatchBuild, String> {
    let parsed = parse_plan(md, plan_id);
    if parsed.frontmatter.status.as_str() != "active" {
        return Err(format!(
            "plan '{plan_id}' is locked (status={}) - not dispatchable",
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
        "{}\n\n",
        match lang {
            ContentLang::English => format!(
                "ocul-pm planner dispatch — implement the next item of plan \"{}\" ({plan_id}).",
                parsed.frontmatter.title
            ),
            _ => format!(
                "ocul-pm 플래너 디스패치 — plan \"{}\" ({plan_id}) 의 다음 항목을 구현하라.",
                parsed.frontmatter.title
            ),
        }
    ));
    p.push_str(&format!("## {}\n\n", lang.pick("대상 항목", "Target item")));
    p.push_str(&format!(
        "- {{#{}}} [{}] {}{}\n",
        item.item_id,
        item.status.token(),
        item.title,
        item.phase.as_deref().map(|ph| format!("  (phase: {ph})")).unwrap_or_default()
    ));
    if !children.is_empty() {
        p.push_str(lang.pick(
            "\n하위 작업 (미완만 실행 대상 — 부모 글리프는 하위 롤업 자동):\n",
            "\nSubtasks (only unfinished ones are in scope — the parent glyph rolls up automatically):\n",
        ));
        for c in &children {
            p.push_str(&format!("  - {{#{}}} [{}] {}\n", c.item_id, c.status.token(), c.title));
        }
    }
    if let Some(note) = &item.note {
        p.push_str(&format!("\n{}: {note}\n", lang.pick("메모", "Note")));
    }

    let refs = linked_journal_refs(&parsed, item_id, &children);
    if !refs.is_empty() {
        p.push_str(lang.pick(
            "\n## 맥락 — 이 항목에 연결된 최근 일지\n",
            "\n## Context — recent journal entries linked to this item\n",
        ));
        for r in refs.iter().rev().take(MAX_LINKED_JOURNALS) {
            p.push_str(&format!("\n### {r}\n"));
            match read_journal_excerpt(root, r) {
                Some(x) => p.push_str(&format!("{x}\n")),
                None => p.push_str(lang.pick(
                    "(파일을 읽지 못했습니다 — 필요하면 직접 여세요)\n",
                    "(could not read the file — open it yourself if you need it)\n",
                )),
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
    let targets = leaf_targets
        .iter()
        .map(|t| format!("\"{t}\""))
        .collect::<Vec<_>>()
        .join(" · ");
    p.push_str(&match lang {
        ContentLang::English => format!(
            "\n## When done\n\n\
             1. Actually run the project gates (build/test/lint) and confirm exit 0.\n\
             2. Write a journal entry with `journal_write`.\n\
             3. Update the item with `plan_update` — plan_id=\"{plan_id}\", item_id={targets}.\n"
        ),
        _ => format!(
            "\n## 완료 시\n\n1. 프로젝트 게이트(빌드/테스트/린트)를 실제로 실행해 exit 0 을 확인한다.\n\
             2. `journal_write` 로 일지를 남긴다.\n\
             3. `plan_update` 로 항목을 갱신한다 — plan_id=\"{plan_id}\", item_id={targets}.\n"
        ),
    });

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
        let b = build_dispatch_prompt(dir.path(), "p", MD, "papa", &patterns, ContentLang::Unset).unwrap();
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
        let s = build_dispatch_prompt(dir.path(), "p", MD, "solo", &patterns, ContentLang::Unset).unwrap();
        assert!(s.prompt.contains("item_id=\"solo\""));
        // 미지 항목·잠긴 plan 거부.
        assert!(build_dispatch_prompt(dir.path(), "p", MD, "ghost", &patterns, ContentLang::Unset).is_err());
        let locked = MD.replace("status: active", "status: done");
        assert!(build_dispatch_prompt(dir.path(), "p", &locked, "solo", &patterns, ContentLang::Unset).is_err());
    }

    #[test]
    fn shell_command_quotes_single_quotes() {
        let cmd = shell_command_for(Path::new("/a/o'brien/p.md"));
        assert_eq!(cmd, "claude \"$(cat '/a/o'\\''brien/p.md')\"");
    }

    #[test]
    fn english_dispatch_prompt_is_english_but_keeps_ids() {
        let dir = tempfile::tempdir().unwrap();
        let patterns: Vec<Regex> = vec![];
        let b = build_dispatch_prompt(
            dir.path(),
            "p",
            MD,
            "solo",
            &patterns,
            ContentLang::English,
        )
        .unwrap();
        assert!(b.prompt.contains("ocul-pm planner dispatch"), "{}", b.prompt);
        assert!(b.prompt.contains("## Target item"), "{}", b.prompt);
        assert!(b.prompt.contains("## When done"), "{}", b.prompt);
        // 도구 이름과 id 는 계약이라 언어와 무관하게 그대로다.
        assert!(b.prompt.contains("`journal_write`") && b.prompt.contains("`plan_update`"));
        assert!(b.prompt.contains("plan_id=\"p\""), "{}", b.prompt);
        // 남는 한글은 **사용자 데이터**뿐이어야 한다 — 플랜/항목 제목은 그
        // 사람이 쓴 내용이라 번역 대상이 아니다. 그것만 벗겨내고 검사한다.
        let scaffolding = b.prompt.replace("디스패치 플랜", "").replace("단독 항목", "");
        assert!(
            !scaffolding.chars().any(|c| ('\u{AC00}'..='\u{D7A3}').contains(&c)),
            "뼈대에 한글이 남았다:\n{}",
            b.prompt
        );
    }

}
