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
//! 코드는 출시되는 앱에서 아무것도 보내지 못한다.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use regex::Regex;

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
        reason: "면제 — AI 패널의 사용자 작성 대화. 사용자가 직접 만든 호출이 약속의 예외 ① 이고, 자기가 친 글을 자기에게서 가릴 이유가 없다. 같은 파일의 `chat`·`chat_detailed`·`run_chat_stream` 은 관문이라 그것을 부르는 자리는 각자 아래에 있다.",
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
// 스캐너 — 걷어낸 코드
// ─────────────────────────────────────────────────────────────────────────────

/// 한 소스 파일. `prod` 는 주석·리터럴과 `#[cfg(test)]` 항목을 걷어낸 코드다 —
/// 바이트 위치가 `raw` 와 같다.
struct Source {
    rel: String,
    raw: String,
    prod: String,
}

fn crate_src() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// 출시되는 코드 — 테스트 전용 모듈 파일과 `llm/` 을 뺀 전부.
fn production_sources() -> Vec<Source> {
    let root = crate_src();
    let mut paths = Vec::new();
    walk(&root, &mut paths);
    paths.sort();
    let all: Vec<Source> = paths
        .iter()
        .map(|p| {
            let raw = std::fs::read_to_string(p).unwrap();
            let rel = p
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let prod = blank_cfg_test_items(&strip_code(&raw));
            Source { rel, raw, prod }
        })
        .collect();
    let test_only = test_only_modules(&all);
    all.into_iter()
        .filter(|s| !s.rel.starts_with("llm/") && !is_under(&s.rel, &test_only))
        .collect()
}

/// 주석·문자열·문자 리터럴을 공백으로 지운다. 줄바꿈과 바이트 위치는 남긴다.
fn strip_code(src: &str) -> String {
    let b = src.as_bytes();
    let mut out = b.to_vec();
    let blank = |out: &mut Vec<u8>, from: usize, to: usize| {
        for c in &mut out[from..to] {
            if *c != b'\n' {
                *c = b' ';
            }
        }
    };
    let ident = |i: usize| i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_');
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'/' if b.get(i + 1) == Some(&b'/') => {
                let end = b[i..]
                    .iter()
                    .position(|&c| c == b'\n')
                    .map_or(b.len(), |p| i + p);
                blank(&mut out, i, end);
                i = end;
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                let (mut depth, mut j) = (0usize, i);
                while j < b.len() {
                    if b[j] == b'/' && b.get(j + 1) == Some(&b'*') {
                        depth += 1;
                        j += 2;
                    } else if b[j] == b'*' && b.get(j + 1) == Some(&b'/') {
                        depth -= 1;
                        j += 2;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        j += 1;
                    }
                }
                blank(&mut out, i, j.min(b.len()));
                i = j;
            }
            b'r' | b'b' if !ident(i) && raw_string_start(b, i).is_some() => {
                let (open, hashes) = raw_string_start(b, i).unwrap();
                let mut j = open + 1;
                let close = loop {
                    if j >= b.len() {
                        break b.len();
                    }
                    if b[j] == b'"'
                        && b[j + 1..]
                            .iter()
                            .take(hashes)
                            .filter(|&&c| c == b'#')
                            .count()
                            == hashes
                    {
                        break j + 1 + hashes;
                    }
                    j += 1;
                };
                blank(
                    &mut out,
                    open + 1,
                    close.saturating_sub(1 + hashes).max(open + 1),
                );
                i = close;
            }
            b'"' => {
                let mut j = i + 1;
                while j < b.len() && b[j] != b'"' {
                    j += if b[j] == b'\\' { 2 } else { 1 };
                }
                blank(&mut out, i + 1, j.min(b.len()));
                i = j + 1;
            }
            b'\'' => {
                // 문자 리터럴('x', '\n', '{', '가')만 — 수명('a)은 그대로 둔다.
                let len = if b.get(i + 1) == Some(&b'\\') {
                    // 이스케이프된 글자(i+2) 뒤에서 닫는 따옴표를 찾는다 — '\'' 도 맞게.
                    b.get(i + 3..)
                        .and_then(|rest| rest.iter().take(10).position(|&c| c == b'\''))
                        .map(|p| p + 4)
                } else {
                    let ch = src[i + 1..].chars().next().map_or(1, char::len_utf8);
                    (b.get(i + 1 + ch) == Some(&b'\'')).then_some(ch + 2)
                };
                match len {
                    Some(n) => {
                        blank(&mut out, i, i + n);
                        i += n;
                    }
                    None => i += 1,
                }
            }
            _ => i += 1,
        }
    }
    String::from_utf8(out).expect("blanking keeps UTF-8 boundaries")
}

/// `r"`, `r#"`, `br##"` 의 시작이면 `(여는 따옴표 위치, # 개수)`.
fn raw_string_start(b: &[u8], i: usize) -> Option<(usize, usize)> {
    let mut j = i;
    if b[j] == b'b' {
        j += 1;
    }
    if b.get(j) != Some(&b'r') {
        return None;
    }
    j += 1;
    let hashes = b[j..].iter().take_while(|&&c| c == b'#').count();
    (b.get(j + hashes) == Some(&b'"')).then_some((j + hashes, hashes))
}

/// 여는 `{` 에서 짝이 맞는 `}` 의 위치. 걷어낸 코드 위에서만 부른다.
fn matching_brace(code: &[u8], open: usize) -> usize {
    let mut depth = 0i32;
    for (k, &c) in code.iter().enumerate().skip(open) {
        match c {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return k;
                }
            }
            _ => {}
        }
    }
    code.len()
}

/// `from` 뒤 첫 `{` (본문) 또는 `;` (본문 없음) — 괄호 안은 건너뛴다.
fn body_open(code: &[u8], from: usize) -> Option<usize> {
    let mut depth = 0i32;
    for (k, &c) in code.iter().enumerate().skip(from) {
        match c {
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth -= 1,
            b';' if depth <= 0 => return None,
            b'{' if depth <= 0 => return Some(k),
            _ => {}
        }
    }
    None
}

/// `#[cfg(test)]` 가 붙은 항목(모듈·함수·impl·use)을 지운다.
fn blank_cfg_test_items(code: &str) -> String {
    let attr = Regex::new(r"#\[cfg\(test\)\]\s*(?:#\[[^\]]*\]\s*)*").unwrap();
    let b = code.as_bytes();
    let mut out = b.to_vec();
    for m in attr.find_iter(code) {
        let end = match body_open(b, m.end()) {
            Some(open) => matching_brace(b, open) + 1,
            None => m.end() + b[m.end()..].iter().position(|&c| c == b';').unwrap_or(0) + 1,
        };
        for c in &mut out[m.start()..end.min(b.len())] {
            if *c != b'\n' {
                *c = b' ';
            }
        }
    }
    String::from_utf8(out).unwrap()
}

/// `#[cfg(test)] mod x;` 이 가리키는 파일들 (`#[path]` 포함). 그 아래 폴더도
/// 테스트 전용이다 ([`is_under`]).
fn test_only_modules(all: &[Source]) -> BTreeSet<String> {
    let decl = Regex::new(
        r"#\[cfg\(test\)\]\s*((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;",
    )
    .unwrap();
    let path_attr = Regex::new(r#"#\[path\s*=\s*"([^"]*)"\s*\]"#).unwrap();
    let mut out = BTreeSet::new();
    for s in all {
        let code = strip_code(&s.raw);
        let file = Path::new(&s.rel);
        let dir = file.parent().unwrap_or(Path::new(""));
        let stem = file.file_stem().unwrap().to_string_lossy();
        for m in decl.captures_iter(&code) {
            let attrs = m.get(1).unwrap();
            // 걷어낸 코드는 문자열을 지웠다 — `#[path]` 값은 같은 자리의 원문에서 읽는다.
            let target = match path_attr.captures(&s.raw[attrs.start()..attrs.end()]) {
                Some(p) => dir.join(&p[1]),
                None => {
                    let base = if matches!(stem.as_ref(), "mod" | "lib" | "main") {
                        dir.to_path_buf()
                    } else {
                        dir.join(stem.as_ref())
                    };
                    let flat = base.join(format!("{}.rs", &m[2]));
                    if crate_src().join(&flat).exists() {
                        flat
                    } else {
                        base.join(&m[2]).join("mod.rs")
                    }
                }
            };
            out.insert(normalize(&target));
        }
    }
    out
}

fn normalize(p: &Path) -> String {
    let mut parts: Vec<String> = Vec::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(n) => parts.push(n.to_string_lossy().into_owned()),
            _ => {}
        }
    }
    parts.join("/")
}

/// `rel` 이 테스트 전용 모듈 파일이거나 그 모듈 폴더 아래에 있는가.
fn is_under(rel: &str, test_only: &BTreeSet<String>) -> bool {
    test_only.iter().any(|t| {
        let folder = t
            .strip_suffix("/mod.rs")
            .or_else(|| t.strip_suffix(".rs"))
            .unwrap_or(t);
        rel == t || rel.starts_with(&format!("{folder}/"))
    })
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

/// 본문이 있는 함수: `(이름, 공개 여부, 속성, 본문 범위)`.
fn fn_items(code: &str) -> Vec<(String, bool, String, std::ops::Range<usize>)> {
    let re = Regex::new(
        r#"((?:#\[[^\]]*\]\s*)*)(pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe)\s+|extern\s+(?:"[^"]*"\s+)?)*fn\s+([A-Za-z_]\w*)"#,
    )
    .unwrap();
    let b = code.as_bytes();
    re.captures_iter(code)
        .filter_map(|c| {
            let open = body_open(b, c.get(0).unwrap().end())?;
            Some((
                c[3].to_string(),
                c.get(2).is_some(),
                c[1].to_string(),
                open..matching_brace(b, open),
            ))
        })
        .collect()
}

/// `impl Trait for Type { … }`: `(트레이트 이름, 본문 범위)`.
fn trait_impls(code: &str) -> Vec<(String, std::ops::Range<usize>)> {
    let re = Regex::new(r"\bimpl\b").unwrap();
    let b = code.as_bytes();
    re.find_iter(code)
        .filter_map(|m| {
            let open = body_open(b, m.end())?;
            let header = code[m.end()..open].trim_start();
            // 머리의 제네릭 매개변수(`<T: Into<String>>`)를 짝 맞춰 건너뛴다.
            let header = if header.starts_with('<') {
                let mut depth = 0;
                let end = header.char_indices().find_map(|(k, ch)| {
                    depth += match ch {
                        '<' => 1,
                        '>' => -1,
                        _ => 0,
                    };
                    (depth == 0).then_some(k + 1)
                })?;
                header[end..].trim_start()
            } else {
                header
            };
            let path: String = header
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == ':')
                .collect();
            let rest = &header[path.len()..];
            let for_kw = Regex::new(r"^(?:<[^{]*>)?\s+for\s").unwrap();
            for_kw.is_match(rest).then(|| {
                let name = path.rsplit("::").next().unwrap_or("").to_string();
                (name, open..matching_brace(b, open))
            })
        })
        .collect()
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
