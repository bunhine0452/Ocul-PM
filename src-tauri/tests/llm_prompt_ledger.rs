//! 「모델에게 가는 프롬프트」 원장 — 마스킹을 거치지 않고 모델에 닿는 자리를
//! 센다 ({#redact-doc-truth}, 보안 피드백 2차 2026-10-07).
//!
//! # 무엇을 지키는가
//!
//! `oculpm::redact` 의 모듈 문서는 "에이전트가 쓴 글은 마스킹 없이 모델에 닿지
//! 않는다" 고 적는다. 이 파일이 그 주장을 잰다: 모델 호출을 조립하는 자리는
//! 전부 [`LLM_PROMPT_SITES`] 에 있어야 하고, 각 자리는 리댁션을 어떻게 지나는지
//! 적는다. 새 자리가 생기면 실패하고, 있던 자리가 사라져도 실패한다.
//!
//! # 왜 다시 짰나
//!
//! 예전 판(`egress_inventory.rs` 안)은 `llm::create` 와 `commands::llm::chat*` 를
//! **글자 그대로** 부르는 파일만 셌다. 감싸는 함수를 거치는 자리는 보이지
//! 않았다 — 주간 롤업(`summary::call_llm`) · 릴리스 노트 초안
//! (`chunking::map_reduce_blocks`) · 대화 임포트(`ChatBackend`) · 요약 청킹이 원장
//! 밖에 있었다. 롤업의 모듈 문서는 "원장은 `llm::create` 를 부르는 파일을
//! 세므로 래퍼를 지나면 새 줄이 필요 없다" 고 적고 있었다 — 테스트의 빈틈이
//! 설계의 근거로 쓰이고 있었던 것이다.
//!
//! 이제 판정은 두 겹이다:
//!
//! | | 대조 | 무엇을 잡는가 |
//! |---|---|---|
//! | A | [`LLM_GATEWAYS`] 를 하나라도 부르는 파일의 집합 == 원장 | 새 호출 자리 · 사라진 자리 |
//! | B | 관문을 부르는 **공개 함수**와 크레이트 트레이트 구현은 관문으로 등록되거나 [`NOT_GATEWAYS`] 에 사유와 함께 있다 | 새 래퍼 — 등록되지 않은 래퍼를 지나는 호출이 A 를 빠져나가는 길 |
//!
//! B 가 A 의 빈틈을 닫는다. 래퍼를 새로 만들면 그 자리에서 답해야 한다: 부르는
//! 쪽이 프롬프트 글을 싣는가(관문 — 부르는 쪽이 전부 A 에 잡힌다), 아니면 스스로
//! 조립하고 가리는가(관문 아님 — 사유를 적는다).
//!
//! # 스캔의 규율
//!
//! 판정 재료는 **주석과 문자열·문자 리터럴을 걷어낸 코드**다. 문서 주석에 적힌
//! `summary::call_llm` 은 호출이 아니고, 문자열 속 `{` 는 함수 본문의 경계를
//! 흐트러뜨린다 (걷어낼 때 바이트 위치는 그대로 둔다). `#[cfg(test)]` 가 붙은
//! 항목·모듈 파일과 `llm/`(프로바이더 자신 — 목적지다)은 대상이 아니다. 테스트
//! 코드는 출시되는 앱에서 아무것도 보내지 못한다. 렉서는 `tests/source_scan/` 에
//! 있다 — 하위 프로세스 기동 원장(`egress_spawn_ledger.rs`)이 같은 것을 쓴다.

use std::collections::BTreeSet;

use regex::Regex;

mod source_scan;
use source_scan::{
    blank_cfg_test_items, crate_src, fn_items, is_under, strip_code, test_only_modules,
    trait_impls, Source,
};

// ─────────────────────────────────────────────────────────────────────────────
// 원장
// ─────────────────────────────────────────────────────────────────────────────

/// 프롬프트가 리댁션을 어떻게 지나는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Redaction {
    /// 이 파일이 보내기 전에 `redact_text`/`patterns_for_project` 를 직접 부른다.
    Direct,
    /// 마스킹된 캐시 투영이나 리댁션을 지난 모듈에서 재료를 받는다.
    ViaProjection,
    /// 관문 자신 — 고정 지시문 말고는 제 재료를 더하지 않고, 부르는 쪽이 조립한
    /// 것을 나른다. 부르는 쪽은 각자 이 원장에 있고 리댁션은 그쪽이 답한다.
    Relay,
    /// 지나지 않는다 — **면제**. 사유가 근거다.
    None,
}

struct PromptSite {
    /// `src-tauri/src/` 기준.
    path: &'static str,
    redaction: Redaction,
    reason: &'static str,
}

/// 모델 호출을 조립하는 자리 전부. 판정 A 의 스캔 결과와 정확히 같아야 한다.
const LLM_PROMPT_SITES: &[PromptSite] = &[
    PromptSite {
        path: "commands/llm.rs",
        redaction: Redaction::None,
        reason: "면제 — AI 패널의 사용자 작성 대화. 사용자가 직접 만든 호출이 약속의 예외 ① 이고, 자기가 친 글을 자기에게서 가릴 이유가 없다. 같은 파일의 `chat`·`chat_detailed`·`run_chat_stream` 은 관문이라 그것을 부르는 자리는 각자 아래에 있다. 단 패널이 자동으로 싣는 RAG 청크는 사용자 작성이 아니다 — 저장소 파일이라 `search_chunks` 가 꺼낼 때 프로젝트 패턴으로 가린다 (2026-10-08 검토; 그 전엔 이 사유가 청크까지 면제로 덮고 있었다).",
    },
    PromptSite {
        path: "mobile_bridge/server.rs",
        redaction: Redaction::None,
        reason: "면제 — 폰이 보낸 대화를 그대로 중계한다 (commands/llm.rs 와 같은 성격).",
    },
    PromptSite {
        path: "commands/overview.rs",
        redaction: Redaction::None,
        reason: "면제 — README·매니페스트·디렉터리 구조를 디스크에서 **직접** 읽어 보낸다. 에이전트가 쓴 글이 아니라 저장소 파일이라 캐시 투영을 지나지 않는다.",
    },
    PromptSite {
        path: "commands/summary.rs",
        redaction: Redaction::ViaProjection,
        reason: "`range_entries` 만 읽는다 — 캐시는 투영 시점에 마스킹된다 (모듈 문서 §원칙). 같은 파일의 `call_llm` 은 관문이다.",
    },
    PromptSite {
        path: "commands/summary/chunking.rs",
        redaction: Redaction::Relay,
        reason: "관문 — 요약·릴리스 노트가 넘긴 블록을 조각 지시문과 묶어 `call_llm` 으로 나른다. 블록을 만드는 쪽(summary·release_notes)이 각자 원장에 있다.",
    },
    PromptSite {
        path: "commands/rollup.rs",
        redaction: Redaction::ViaProjection,
        reason: "주간 롤업 — `rollup_source_entries` 는 같은 캐시 투영(마스킹된 본문)이고, 결정 문장도 그 본문에서 뽑는다. `summary::call_llm` 을 지난다 — 2026-10-07 전까지 원장이 이 자리를 보지 못했다.",
    },
    PromptSite {
        path: "commands/release_notes.rs",
        redaction: Redaction::Direct,
        reason: "릴리스 노트 초안 — 일지 재료는 캐시 투영이고, 디스크에서 직접 읽는 `CHANGELOG.md` 문체 표본은 보내기 전에 프로젝트 패턴으로 가린다. 2026-10-07 전까지 원장 밖이었고 표본은 가리지 않았다.",
    },
    PromptSite {
        path: "oculpm/reconcile.rs",
        redaction: Redaction::ViaProjection,
        reason: "`JournalCache::with_redaction` 으로 일지를 읽어 화해 프롬프트를 만든다.",
    },
    PromptSite {
        path: "commands/plan.rs",
        redaction: Redaction::ViaProjection,
        reason: "`project_redact_patterns` → `planner::dispatch` 가 프롬프트를 마스킹해 조립한다.",
    },
    PromptSite {
        path: "commands/rule_promotion.rs",
        redaction: Redaction::ViaProjection,
        reason: "규칙 승격의 증거 발췌를 `oculpm::rule_promotion` 이 리댁션을 지나 만들어 넘긴다.",
    },
    PromptSite {
        path: "commands/skill_promotion.rs",
        redaction: Redaction::ViaProjection,
        reason: "스킬 승격의 증거 발췌를 `oculpm::skill_promotion` 이 리댁션을 지나 만들어 넘긴다.",
    },
    PromptSite {
        path: "commands/skills.rs",
        redaction: Redaction::Direct,
        reason: "스킬 초안·카탈로그 재료(일지 발췌)를 보내기 전에 직접 마스킹한다.",
    },
    PromptSite {
        path: "oculpm/journal_draft/mod.rs",
        redaction: Redaction::Direct,
        reason: "일지 초안의 입력(`masked_user_prompt`)과 모델 응답 양쪽을 마스킹한다 (이중 방어). 2026-10-07 전까지 이 줄은 거짓이었다 — 응답만 가렸다.",
    },
    PromptSite {
        path: "oculpm/automation/runner/mod.rs",
        redaction: Redaction::Direct,
        reason: "보내기 전에 지시문을 가리고, 응답에 섞여 돌아온 시크릿도 일지에 닿기 전에 가린다. `ChatBackend` 는 관문이다.",
    },
    PromptSite {
        path: "oculpm/import/journalize.rs",
        redaction: Redaction::Direct,
        reason: "대화 임포트 — 보내기 전에 대화 원문을 `redact_text` 로 가리고 응답도 한 번 더 가린다. `ChatBackend` 를 지난다 — 2026-10-07 전까지 원장이 이 자리를 보지 못했다.",
    },
];

/// 모델 호출의 관문 — 프로바이더를 만드는 `llm::create` 와, 그것을 감싸 다른
/// 파일이 프롬프트를 실어 보내는 함수·트레이트.
struct Gateway {
    /// 정의한 파일 (`src-tauri/src/` 기준).
    home: &'static str,
    /// 함수·트레이트 이름 — 판정 B 가 이 이름으로 맞춘다.
    name: &'static str,
    /// 부르는 자리를 알아보는 정규식. 이름이 흔하면(`chat`) 경로로 좁힌다.
    patterns: &'static [&'static str],
}

const LLM_GATEWAYS: &[Gateway] = &[
    Gateway {
        home: "llm/mod.rs",
        name: "create",
        patterns: &[r"\bllm::create\b"],
    },
    Gateway {
        home: "commands/llm.rs",
        name: "chat",
        patterns: &[r"\bllm::chat\b", r"\bllm::\{[^}]*\bchat\b"],
    },
    Gateway {
        home: "commands/llm.rs",
        name: "chat_detailed",
        patterns: &[r"\bchat_detailed\b"],
    },
    Gateway {
        home: "commands/llm.rs",
        name: "run_chat_stream",
        patterns: &[r"\brun_chat_stream\b"],
    },
    Gateway {
        home: "commands/summary.rs",
        name: "call_llm",
        patterns: &[r"\bcall_llm\b"],
    },
    Gateway {
        home: "commands/summary/chunking.rs",
        name: "generate_with_llm",
        patterns: &[r"\bgenerate_with_llm\b"],
    },
    Gateway {
        home: "commands/summary/chunking.rs",
        name: "map_reduce_blocks",
        patterns: &[r"\bmap_reduce_blocks\b"],
    },
    Gateway {
        home: "oculpm/automation/runner/mod.rs",
        name: "ChatBackend",
        patterns: &[r"\bChatBackend\b"],
    },
];

/// 관문을 부르지만 관문이 **아닌** 공개 함수 — 스스로 프롬프트를 조립하고
/// 가리며, 부르는 쪽은 프롬프트 글을 넘기지 않는다. `(파일, 함수, 사유)`.
const NOT_GATEWAYS: &[(&str, &str, &str)] = &[
    (
        "commands/overview.rs",
        "run_generation",
        "프로젝트 id 만 받는다 — README·매니페스트를 스스로 읽어 프롬프트를 만든다 (원장의 면제 사유 그대로).",
    ),
    (
        "oculpm/journal_draft/mod.rs",
        "draft_for_session",
        "세션과 대화 파일 경로만 받는다 — 대화를 스스로 읽고 `masked_user_prompt` 로 가린 뒤 보낸다.",
    ),
    (
        "oculpm/reconcile.rs",
        "reconcile_entry",
        "일지 경로만 받는다 — 일지를 마스킹된 캐시 판으로 읽어 화해 프롬프트를 스스로 만든다.",
    ),
];

// ─────────────────────────────────────────────────────────────────────────────
// 스캐너 — 걷어낸 코드 (렉서는 `source_scan` 공용 모듈)
// ─────────────────────────────────────────────────────────────────────────────

/// 출시되는 코드 — 테스트 전용 모듈 파일과 `llm/` 을 뺀 전부. 남은 파일의
/// `prod` 는 주석·리터럴과 `#[cfg(test)]` 항목을 걷어낸 코드다.
fn production_sources() -> Vec<Source> {
    let all = source_scan::sources();
    let test_only = test_only_modules(&all);
    all.into_iter()
        .filter(|s| !s.rel.starts_with("llm/") && !is_under(&s.rel, &test_only))
        .collect()
}

struct Compiled<'a> {
    gateway: &'a Gateway,
    patterns: Vec<Regex>,
}

fn compiled_gateways() -> Vec<Compiled<'static>> {
    LLM_GATEWAYS
        .iter()
        .map(|g| Compiled {
            gateway: g,
            patterns: g.patterns.iter().map(|p| Regex::new(p).unwrap()).collect(),
        })
        .collect()
}

impl Compiled<'_> {
    fn hit(&self, code: &str) -> bool {
        self.patterns.iter().any(|p| p.is_match(code))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────────────────────────

/// A — 관문을 부르는 파일 전부가 원장에 있고, 원장의 자리는 전부 실재한다.
/// 면제의 수는 `redact` 모듈 문서의 주장과 같다.
///
/// 새 LLM 호출을 붙이면 여기서 걸린다 — 그때 답해야 하는 질문은 하나다:
/// "이 프롬프트에 에이전트가 쓴 글이나 저장소의 글이 섞이는가?"
#[test]
fn every_llm_prompt_site_declares_how_it_meets_redaction() {
    let gateways = compiled_gateways();
    let found: BTreeSet<String> = production_sources()
        .into_iter()
        .filter(|s| gateways.iter().any(|g| g.hit(&s.prod)))
        .map(|s| s.rel)
        .collect();
    let declared: BTreeSet<String> = LLM_PROMPT_SITES
        .iter()
        .map(|s| s.path.to_string())
        .collect();

    let added: Vec<_> = found.difference(&declared).collect();
    assert!(
        added.is_empty(),
        "원장에 없는 모델 호출 자리가 생겼다: {added:?}\n\
         → LLM_PROMPT_SITES 에 등록하고 리댁션을 어떻게 지나는지 적어라."
    );
    let gone: Vec<_> = declared.difference(&found).collect();
    assert!(
        gone.is_empty(),
        "원장에 있는데 소스에 없는 모델 호출: {gone:?}"
    );

    for site in LLM_PROMPT_SITES
        .iter()
        .filter(|s| s.redaction == Redaction::Relay)
    {
        assert!(
            LLM_GATEWAYS.iter().any(|g| g.home == site.path),
            "{}: 중계(Relay)라고 적었지만 관문을 정의하지 않는다",
            site.path
        );
    }
    let exempt = LLM_PROMPT_SITES
        .iter()
        .filter(|s| s.redaction == Redaction::None)
        .count();
    assert_eq!(
        exempt,
        ocul_pm_lib::oculpm::redact::EXEMPT_LLM_PROMPT_SITES,
        "리댁션 면제 자리의 수가 모듈 문서의 주장과 다르다"
    );
}

/// B — 관문을 부르는 공개 함수와 크레이트 트레이트 구현은 전부 분류돼 있다.
///
/// 래퍼를 새로 만들고 등록하지 않으면, 그 래퍼를 부르는 새 자리는 A 의 스캔에
/// 보이지 않는다 (2026-10-07 전의 `summary::call_llm` · `ChatBackend` 가 그랬다).
#[test]
fn every_model_call_wrapper_is_classified() {
    let gateways = compiled_gateways();
    let sources = production_sources();
    let crate_traits: BTreeSet<String> = {
        let re = Regex::new(r"\btrait\s+([A-Za-z_]\w*)").unwrap();
        sources
            .iter()
            .flat_map(|s| {
                re.captures_iter(&s.prod)
                    .map(|c| c[1].to_string())
                    .collect::<Vec<_>>()
            })
            .collect()
    };

    let mut unclassified = Vec::new();
    let mut excused_seen = BTreeSet::new();
    for s in &sources {
        for (name, public, attrs, body) in fn_items(&s.prod) {
            if !public || attrs.contains("tauri::command") || attrs.contains("test") {
                continue;
            }
            let hits: Vec<&str> = gateways
                .iter()
                .filter(|g| !(g.gateway.home == s.rel && g.gateway.name == name))
                .filter(|g| g.hit(&s.prod[body.clone()]))
                .map(|g| g.gateway.name)
                .collect();
            if hits.is_empty() {
                continue;
            }
            let registered = LLM_GATEWAYS
                .iter()
                .any(|g| g.home == s.rel && g.name == name);
            let excused = NOT_GATEWAYS
                .iter()
                .any(|(p, n, _)| *p == s.rel && *n == name);
            if excused {
                excused_seen.insert((s.rel.clone(), name.clone()));
            }
            if !registered && !excused {
                unclassified.push(format!("{}::{name} → {hits:?}", s.rel));
            }
        }
        for (tr, body) in trait_impls(&s.prod) {
            if !crate_traits.contains(&tr) {
                continue;
            }
            let hits: Vec<&str> = gateways
                .iter()
                .filter(|g| g.gateway.name != tr && g.hit(&s.prod[body.clone()]))
                .map(|g| g.gateway.name)
                .collect();
            if !hits.is_empty() && !LLM_GATEWAYS.iter().any(|g| g.name == tr) {
                unclassified.push(format!("{}: impl {tr} → {hits:?}", s.rel));
            }
        }
    }
    assert!(
        unclassified.is_empty(),
        "모델 호출을 감싸는데 분류되지 않은 함수·트레이트: {unclassified:#?}\n\
         → 부르는 쪽이 프롬프트 글을 싣는다면 LLM_GATEWAYS 에(그 호출자들이 판정 A 에 잡힌다),\n\
           스스로 조립하고 가린다면 NOT_GATEWAYS 에 사유와 함께 적어라."
    );
    for (p, n, _) in NOT_GATEWAYS {
        assert!(
            excused_seen.contains(&(p.to_string(), n.to_string())),
            "{p}::{n}: NOT_GATEWAYS 에 있는데 더는 관문을 부르지 않는다 — 지워라"
        );
    }
}

/// 관문이 실재한다 — 이름이 바뀌었는데 표가 옛 이름을 들고 있으면 그 관문을
/// 지나는 호출은 아무도 세지 않는다.
#[test]
fn every_gateway_is_defined_where_the_ledger_says() {
    let sources = production_sources();
    for g in LLM_GATEWAYS.iter().filter(|g| !g.home.starts_with("llm/")) {
        let home = sources
            .iter()
            .find(|s| s.rel == g.home)
            .unwrap_or_else(|| panic!("{}: 관문의 집이 없다", g.home));
        let def = Regex::new(&format!(r"\b(?:fn|trait)\s+{}\b", g.name)).unwrap();
        assert!(
            def.is_match(&home.prod),
            "{}::{} 가 정의돼 있지 않다",
            g.home,
            g.name
        );
    }
    let create = std::fs::read_to_string(crate_src().join("llm/mod.rs")).unwrap();
    assert!(create.contains("pub fn create("), "llm::create 가 사라졌다");
}

/// 사유 없는 면제는 면제가 아니라 방치다.
#[test]
fn every_prompt_ledger_entry_carries_a_reason() {
    let mut seen = BTreeSet::new();
    for site in LLM_PROMPT_SITES {
        assert!(seen.insert(site.path), "{} 가 원장에 두 번 있다", site.path);
        assert!(
            site.reason.trim().chars().count() >= 20,
            "{}: 프롬프트 자리의 사유가 없다",
            site.path
        );
    }
    for (p, n, reason) in NOT_GATEWAYS {
        assert!(reason.trim().chars().count() >= 20, "{p}::{n}: 사유가 없다");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 스캐너 자신의 테스트 — 숨기는 쪽으로 틀리면 원장이 거짓이 된다
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn the_stripper_hides_comments_and_literals_but_not_calls() {
    let src = r##"
// summary::call_llm(x) 는 주석이다
/* llm::create 도 /* 중첩 */ 주석이다 */
let s = "call_llm( 안의 { 는 글자다";
let r = r#"ChatBackend "따옴표" {"#;
let c = '{';
fn f<'a>(x: &'a str) { crate::commands::summary::call_llm(x) }
"##;
    let code = strip_code(src);
    assert_eq!(code.len(), src.len(), "바이트 위치를 보존한다");
    assert_eq!(code.matches("call_llm").count(), 1, "{code}");
    assert!(!code.contains("llm::create"));
    assert!(!code.contains("ChatBackend"));
    let items = fn_items(&code);
    assert_eq!(items.len(), 1);
    assert!(code[items[0].3.clone()].contains("call_llm"));
}

#[test]
fn wrappers_and_trait_impls_are_found_with_their_bodies() {
    let src = r#"
#[tauri::command]
pub async fn cmd() { call_llm() }
pub(crate) async fn wrap(x: &str) -> Result<(), String> { call_llm(x) }
fn private() { call_llm() }
pub trait Backend { fn chat(&self) -> u8; }
impl<T: Into<String>> Backend for Real<T> { fn chat(&self) -> u8 { call_llm() } }
#[cfg(test)]
mod tests { pub fn fake() { call_llm() } }
"#;
    let code = blank_cfg_test_items(&strip_code(src));
    let names: Vec<(String, bool, bool)> = fn_items(&code)
        .into_iter()
        .map(|(n, public, attrs, _)| (n, public, attrs.contains("tauri::command")))
        .collect();
    assert!(names.contains(&("cmd".into(), true, true)));
    assert!(names.contains(&("wrap".into(), true, false)));
    assert!(names.contains(&("private".into(), false, false)));
    assert!(
        !names.iter().any(|(n, ..)| n == "fake"),
        "테스트 모듈은 지운다"
    );
    let impls = trait_impls(&code);
    assert_eq!(impls.len(), 1, "{impls:?}");
    assert_eq!(impls[0].0, "Backend");
}
