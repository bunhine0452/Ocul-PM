//! 원장 테스트들이 함께 쓰는 소스 스캐너 — 주석·리터럴을 걷어낸 코드, 함수 본문,
//! `#[cfg(test)]` 범위.
//!
//! `llm_prompt_ledger.rs`(모델 호출 자리)와 `egress_spawn_ledger.rs`(하위 프로세스
//! 기동 자리)가 같은 렉서를 쓴다. 두 벌이면 한쪽만 고쳐지는 날이 온다 — 그날
//! 한 원장은 조용히 다른 코드를 읽게 된다.
//!
//! **걷어낼 때 바이트 위치는 그대로 둔다.** 걷어낸 코드에서 찾은 자리를 원문의
//! 같은 위치에서 다시 읽을 수 있어야 한다 (함수 본문 범위·호출 인자).
//!
//! 쓰는 쪽마다 쓰는 함수가 달라 `dead_code` 를 끈다 (통합 테스트 공용 모듈의 관용구).
#![allow(dead_code)]

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use regex::Regex;

/// 한 소스 파일. 세 판의 바이트 위치가 전부 같다.
pub struct Source {
    /// `src-tauri/src/` 기준, `/` 구분.
    pub rel: String,
    pub raw: String,
    /// 주석·문자열·문자 리터럴을 공백으로 지운 코드.
    pub code: String,
    /// `code` 에서 `#[cfg(test)]` 항목까지 지운 코드.
    pub prod: String,
}

pub fn crate_src() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")
}

pub fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
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

/// 크레이트의 `.rs` 전부 — 테스트 전용 모듈 파일까지. 거르는 것은 쓰는 쪽의 몫이다.
pub fn sources() -> Vec<Source> {
    let root = crate_src();
    let mut paths = Vec::new();
    walk(&root, &mut paths);
    paths.sort();
    paths
        .iter()
        .map(|p| {
            let raw = std::fs::read_to_string(p).unwrap();
            let rel = p
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let code = strip_code(&raw);
            let prod = blank_cfg_test_items(&code);
            Source {
                rel,
                raw,
                code,
                prod,
            }
        })
        .collect()
}

/// 주석·문자열·문자 리터럴을 공백으로 지운다. 줄바꿈과 바이트 위치는 남긴다.
pub fn strip_code(src: &str) -> String {
    strip(src, true)
}

/// 주석만 지운다 — 리터럴은 남긴다. 호출 인자(`std_cmd("git")` 의 `"git"`)를
/// 원문 그대로 읽되 그 안의 주석은 버릴 때 쓴다.
pub fn strip_comments(src: &str) -> String {
    strip(src, false)
}

fn strip(src: &str, literals: bool) -> String {
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
                if literals {
                    blank(
                        &mut out,
                        open + 1,
                        close.saturating_sub(1 + hashes).max(open + 1),
                    );
                }
                i = close;
            }
            b'"' => {
                let mut j = i + 1;
                while j < b.len() && b[j] != b'"' {
                    j += if b[j] == b'\\' { 2 } else { 1 };
                }
                if literals {
                    blank(&mut out, i + 1, j.min(b.len()));
                }
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
                        if literals {
                            blank(&mut out, i, i + n);
                        }
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
pub fn matching_brace(code: &[u8], open: usize) -> usize {
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
pub fn body_open(code: &[u8], from: usize) -> Option<usize> {
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
pub fn blank_cfg_test_items(code: &str) -> String {
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
pub fn test_only_modules(all: &[Source]) -> BTreeSet<String> {
    let decl = Regex::new(
        r"#\[cfg\(test\)\]\s*((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;",
    )
    .unwrap();
    let path_attr = Regex::new(r#"#\[path\s*=\s*"([^"]*)"\s*\]"#).unwrap();
    let mut out = BTreeSet::new();
    for s in all {
        let file = Path::new(&s.rel);
        let dir = file.parent().unwrap_or(Path::new(""));
        let stem = file.file_stem().unwrap().to_string_lossy();
        for m in decl.captures_iter(&s.code) {
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
pub fn is_under(rel: &str, test_only: &BTreeSet<String>) -> bool {
    test_only.iter().any(|t| {
        let folder = t
            .strip_suffix("/mod.rs")
            .or_else(|| t.strip_suffix(".rs"))
            .unwrap_or(t);
        rel == t || rel.starts_with(&format!("{folder}/"))
    })
}

/// 본문이 있는 함수: `(이름, 공개 여부, 속성, 본문 범위)`.
pub fn fn_items(code: &str) -> Vec<(String, bool, String, std::ops::Range<usize>)> {
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
pub fn trait_impls(code: &str) -> Vec<(String, std::ops::Range<usize>)> {
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
