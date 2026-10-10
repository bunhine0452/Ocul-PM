//! 「하위 프로세스 기동 원장」 — 유출 경계 원장의 판정 D
//! ({#egress-subprocess}, 보안 피드백 라운드).
//!
//! # 무엇을 지키는가
//!
//! `egress_inventory.rs` 의 A 는 **능력 프리미티브**(`reqwest::`·`TcpListener`·
//! `fetch(` …)로 송출 자리를 찾는다. 그런데 앱이 하위 프로세스를 띄워 나가는
//! 자리 — ACP 어댑터의 `npm ci`, 새 프로젝트 마법사의 `npx create-next-app`,
//! 터미널 셸, 언어 서버 — 는 프리미티브가 `std_cmd(…)` 라 A 에 안 보였다. 새
//! `std_cmd("rsync")` · `CommandBuilder::new("curl")` 한 줄이 아무 게이트도 울리지
//! 않았다 — 막혀 있던 것은 세 모양(`std_cmd(`·`tokio_cmd(`·`Command::new(`)에
//! 글자 그대로 붙은 `"curl"`·`"wget"` 두 이름뿐이었다.
//!
//! 여기서는 **프로세스를 띄우는 자리 전부**를 원장에 분류한다. 송출 여부와
//! 상관없이 전부다 — 그래야 새 기동 자리가 반드시 "이건 나가는가" 를 답하고
//! 들어온다.
//!
//! | | 대조 | 무엇을 잡는가 |
//! |---|---|---|
//! | D1 | 출시 코드의 기동 자리 `(파일, 함수, 띄우는 것)` 집합 == [`APP_LAUNCHES`] | 새 기동 자리(같은 파일의 새 프로그램 포함). 사라진 자리. 분류는 [`Reach`] — 송출 가능 / 로컬 / 창구 |
//! | D2 | 테스트 범위의 기동 자리 == [`TEST_LAUNCHES`] | 테스트 픽스처라는 주장을 **스캐너가 판정**한다 — 출시 코드를 픽스처라고 적으면 실패 |
//! | D3 | 웹뷰가 opener·shell 플러그인에 닿는 쓰임(가져오는 이름까지) == [`WEB_LAUNCHES`] | `opener:allow-open-url` 이 `https://*` 를 열어 두었다 — 웹뷰가 플러그인의 `openUrl` 을 새로 가져오면 여기서 걸린다 |
//! | D4 | clippy 의 `disallowed-methods` 가 닫혀 있고, 그 문을 여는 `allow` 는 창구(`proc.rs`)와 테스트에만 | 별칭(`use Command as C`)으로 D1 의 모양을 피하는 길 — clippy 가 막고, 그 clippy 를 끄는 길은 여기서 막는다 |
//! | D5 | 모든 항목에 사유. 송출 가능이면 그 문(누가 언제 여는가) | 사유 없는 면제는 방치다 |
//!
//! 분류로 받아 줄 수 없는 **금지선** 둘도 여기 산다 (`egress_inventory.rs` 에서
//! 옮겨 왔다): `curl`·`wget` 기동 — 이제 [`LAUNCHERS`] 전부에서, 경로·`.exe` 를
//! 붙여도 — 과 git 의 네트워크 하위 명령 — 이제 git 에 닿는 파일 전부에서.
//!
//! # 자리의 단위
//!
//! `(파일, 감싸는 함수, 띄우는 것)`. "띄우는 것" 은 기동 호출과 첫 인자의 원문
//! 그대로다 (`std_cmd("git")` · `tokio_cmd(npm)` · `spawn_detached(exe, …)`).
//! 같은 함수가 같은 것을 두 번 띄우면 한 자리다 — 분류의 단위가 "이 함수가 이것을
//! 띄운다" 이기 때문이다. 인자가 변수인 자리는 그 값의 출처를 사유에 적는다.
//! 출처는 정적으로 따라가지 못한다 — 그래서 여러 곳이 다른 프로그램을 넘기는
//! 래퍼는 [`LAUNCHERS`] 에 올려 **부르는 쪽을 자리로** 만든다 (`std_cmd` ·
//! `tokio_cmd` · `spawn_detached` · `shell_open`). 그 래퍼 자신은 [`Reach::Relay`].
//!
//! # 스캔의 규율
//!
//! - 기동 호출은 **주석과 리터럴을 걷어낸 코드**에서 찾는다 (`tests/source_scan/`
//!   렉서 — 문자열 속 `//` 를 주석으로 읽어 뒤의 호출을 숨기는 일이 없다). 띄우는
//!   것의 원문은 같은 바이트 위치의 주석만 걷은 판에서 읽는다.
//! - `#[cfg(test)]` 는 **걷어내지 않는다** — 테스트 범위도 전부 센다. 다만 그
//!   범위인지는 사람이 적는 것이 아니라 스캐너가 판정해 D1·D2 로 가른다.
//! - 이 원장이 못 보는 것: 의존 크레이트가 안에서 띄우는 프로세스(업데이터의
//!   설치기, 리눅스 딥링크 등록의 `xdg-mime` 등). 그 크레이트를 부르는 자리는
//!   A 의 프리미티브나 여기 [`LAUNCHERS`] 가 센다 (`AcpAgentConfig::new` ·
//!   `CommandBuilder::new` · `tauri_plugin_opener::*`).

use std::collections::BTreeSet;
use std::path::PathBuf;

mod source_scan;
use source_scan::{fn_items, is_under, strip_code, strip_comments, test_only_modules};

#[path = "egress_spawn_ledger/sites.rs"]
mod sites;
use sites::{APP_LAUNCHES, TEST_LAUNCHES, WEB_LAUNCHES};

// ─────────────────────────────────────────────────────────────────────────────
// 원장의 모양
// ─────────────────────────────────────────────────────────────────────────────

/// 띄운 프로그램이 어디까지 닿는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reach {
    /// 네트워크에 닿을 수 있다 — 앱이 시키는 일 자체가 송출이거나(설치·제공자 호출),
    /// 무엇을 할지 앱이 정하지 않는 코드를 돌린다(터미널·언어 서버·디버그 대상).
    /// 괄호 안은 **그 문** — 누가 언제 여는가.
    Network(&'static str),
    /// 앱이 시키는 일이 기기 안에서 끝난다. 그 도구가 제 판단으로 하는 일(셸 rc
    /// 등)이 있으면 사유에 적는다.
    Local,
    /// 창구 — 부르는 쪽이 고른 것을 나른다. 이 함수 자신이 [`LAUNCHERS`] 의
    /// 하나라서 부르는 쪽이 각자 이 원장의 자리다 (D1 이 확인한다).
    Relay,
}

/// 출시 코드의 기동 자리 한 곳.
struct Launch {
    /// `src-tauri/src/` 기준.
    path: &'static str,
    /// 감싸는 함수 (가장 안쪽 `fn`).
    func: &'static str,
    /// 기동 호출과 첫 인자, 원문 그대로 (공백은 한 칸으로).
    call: &'static str,
    reach: Reach,
    /// **한 줄 사유.** 비면 D5 가 거부한다.
    reason: &'static str,
}

/// 테스트 범위의 기동 자리 — `(파일, 그 파일 픽스처들의 사유, [(함수, 띄우는 것)])`.
type Fixtures = (
    &'static str,
    &'static str,
    &'static [(&'static str, &'static str)],
);

/// 자식 프로세스를 띄우는 호출 — 여는 괄호까지. 괄호 안 첫 인자가 띄우는 것이다.
const LAUNCHERS: &[&str] = &[
    // `proc.rs` 창구 — 앱의 자식 프로세스는 전부 여기서 만든다 (clippy 가 강제, D4).
    "std_cmd(",
    "tokio_cmd(",
    // 창구 안, 그리고 `#[allow]` 를 단 테스트 픽스처. clippy 가 뚫리는 날에도 센다.
    "Command::new(",
    // 분리 기동 — `proc/detached.rs`(Windows `CreateProcessW`)와 편집기 셸 위임.
    "spawn_detached(",
    "CreateProcessW(",
    // Windows 의 OS 기본 처리기 위임 — open_url·Notion·open_native 가 지난다.
    "shell_open(",
    // 크레이트가 대신 띄우는 것.
    "CommandBuilder::new(",
    "CommandBuilder::new_default_prog(",
    "AcpAgentConfig::new(",
    "tauri_plugin_opener::open_url(",
    "tauri_plugin_opener::open_path(",
    "tauri_plugin_opener::reveal_item_in_dir(",
];

/// 웹뷰가 기동 플러그인에 닿는 길 — JS 패키지 가져오기와 날 `invoke` 이름.
/// 함수 이름(`openUrl(`)으로 찾지 않는 이유: 앱의 `commands.openUrl`(Rust 의
/// open_url — 스킴 가드를 지난다)과 편집기의 `openPath` 가 같은 이름이라, 이름으로
/// 세면 소음이 원장을 죽인다. 플러그인은 이 넷 말고는 부를 길이 없다.
const WEB_LAUNCHERS: &[&str] = &[
    "@tauri-apps/plugin-opener",
    "@tauri-apps/plugin-shell",
    "plugin:opener|",
    "plugin:shell|",
];

// ─────────────────────────────────────────────────────────────────────────────
// 스캐너
// ─────────────────────────────────────────────────────────────────────────────

/// 찾은 기동 자리 하나.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Found {
    path: String,
    func: String,
    call: String,
    /// 첫 인자 — 띄우는 것 (`"git"` · `npm` · `exe, …`).
    arg: String,
    /// `#[cfg(test)]` 항목 안이거나 테스트 전용 모듈 파일.
    test: bool,
}

fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

/// 여는 괄호 `open` 뒤 첫 인자 — 구조는 걷어낸 `code` 로 재고, 글자는 같은 위치의
/// `text`(주석만 걷은 원문)에서 읽는다. 인자가 더 있으면 `, …` 를 붙인다.
fn first_arg(code: &str, text: &str, open: usize) -> String {
    let b = code.as_bytes();
    let mut depth = 0i32;
    let (mut end, mut more) = (b.len(), false);
    for (k, &c) in b.iter().enumerate().skip(open + 1) {
        match c {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth == 0 => {
                end = k;
                break;
            }
            b')' | b']' | b'}' => depth -= 1,
            b',' if depth == 0 => {
                (end, more) = (k, !code[k + 1..].trim_start().starts_with(')'));
                break;
            }
            _ => {}
        }
    }
    let arg = text[open + 1..end].split_whitespace().collect::<Vec<_>>();
    format!("{}{}", arg.join(" "), if more { ", …" } else { "" })
}

/// 한 파일의 기동 자리. `file_is_test` 는 테스트 전용 모듈 파일인가.
fn launches_in(rel: &str, raw: &str, file_is_test: bool) -> Vec<Found> {
    let code = strip_code(raw);
    let prod = source_scan::blank_cfg_test_items(&code);
    let text = strip_comments(raw);
    let fns = fn_items(&code);
    let b = code.as_bytes();
    let mut out = Vec::new();
    for shape in LAUNCHERS {
        for (pos, _) in code.match_indices(shape) {
            // 다른 식별자의 꼬리(`my_std_cmd(`)와 정의(`fn std_cmd(`)는 호출이 아니다.
            let before = code[..pos].trim_end();
            let is_def = before
                .strip_suffix("fn")
                .is_some_and(|rest| !rest.ends_with(|c: char| c.is_alphanumeric() || c == '_'));
            if (pos > 0 && is_ident(b[pos - 1])) || is_def {
                continue;
            }
            let open = pos + shape.len() - 1;
            let func = fns
                .iter()
                .filter(|(_, _, _, body)| body.contains(&pos))
                .max_by_key(|(_, _, _, body)| body.start)
                .map_or_else(|| "<모듈>".to_string(), |f| f.0.clone());
            let arg = first_arg(&code, &text, open);
            out.push(Found {
                path: rel.to_string(),
                func,
                call: format!("{shape}{arg})"),
                arg,
                test: file_is_test || prod.as_bytes()[pos] != b[pos],
            });
        }
    }
    out
}

/// 크레이트 전체의 기동 자리 (중복 자리는 하나로).
fn launch_sites() -> BTreeSet<Found> {
    let all = source_scan::sources();
    let test_only = test_only_modules(&all);
    all.iter()
        .flat_map(|s| launches_in(&s.rel, &s.raw, is_under(&s.rel, &test_only)))
        .collect()
}

fn diff_report(label: &str, found: &BTreeSet<String>, declared: &BTreeSet<String>) {
    let added: Vec<_> = found.difference(declared).collect();
    assert!(
        added.is_empty(),
        "{label}: 원장에 없는 기동 자리가 생겼다: {added:#?}\n\
         → tests/egress_spawn_ledger/sites.rs 에 **송출 가능한가**와 사유 한 줄을 적어 등록하라. \
         CLAUDE.md 「What this is」 의 송출 목록에 없는 송출이면 그 목록도 같은 커밋에서 고쳐라."
    );
    let gone: Vec<_> = declared.difference(found).collect();
    assert!(
        gone.is_empty(),
        "{label}: 원장에 있는데 소스에 없는 자리: {gone:#?}\n\
         → 지웠거나 옮겼다면 표에서도 고쳐라. 죽은 항목은 '분류돼 있다'는 착시를 만든다."
    );
}

fn key(path: &str, func: &str, call: &str) -> String {
    format!("{path} :: {func} :: {call}")
}

// ─────────────────────────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────────────────────────

/// D1·D2 — 기동 자리 전부가 출시/테스트 범위대로 원장에 있고, 원장의 자리는 실재한다.
#[test]
fn every_process_launch_site_is_classified() {
    let sites = launch_sites();
    let app: BTreeSet<String> = sites
        .iter()
        .filter(|f| !f.test)
        .map(|f| key(&f.path, &f.func, &f.call))
        .collect();
    let test: BTreeSet<String> = sites
        .iter()
        .filter(|f| f.test)
        .map(|f| key(&f.path, &f.func, &f.call))
        .collect();
    let declared_app: BTreeSet<String> = APP_LAUNCHES
        .iter()
        .map(|l| key(l.path, l.func, l.call))
        .collect();
    let declared_test: BTreeSet<String> = TEST_LAUNCHES
        .iter()
        .flat_map(|(p, _, calls)| calls.iter().map(move |(f, c)| key(p, f, c)))
        .collect();

    // 범위를 잘못 적은 것은 따로 말한다 — "없다/남는다" 두 줄보다 읽기 쉽다.
    let misfiled: Vec<_> = app.intersection(&declared_test).collect();
    assert!(
        misfiled.is_empty(),
        "테스트 픽스처라고 적었지만 출시 코드다: {misfiled:#?}"
    );
    diff_report("D1 출시 코드", &app, &declared_app);
    diff_report("D2 테스트 범위", &test, &declared_test);
    assert!(
        app.len() >= 30 && test.len() >= 10,
        "기동 자리를 {}·{}개밖에 못 찾았다 — 스캐너가 낡아 검사가 헛돌고 있다",
        app.len(),
        test.len()
    );

    // 창구라고 적었으면 그 함수가 정말 기동 호출의 하나여야 한다 — 그래야 부르는
    // 쪽이 각자 자리로 잡힌다.
    for l in APP_LAUNCHES.iter().filter(|l| l.reach == Reach::Relay) {
        assert!(
            LAUNCHERS.iter().any(|s| s.trim_end_matches('(').rsplit("::").next() == Some(l.func)),
            "{} :: {}: 창구(Relay)라고 적었지만 이 함수는 LAUNCHERS 에 없다 — 부르는 쪽이 원장에 안 잡힌다",
            l.path,
            l.func
        );
    }
}

/// D3 — 웹뷰가 기동 플러그인에 직접 닿는 자리. `opener:allow-open-url` 이
/// `https://*` 를 허용하므로, 웹뷰가 플러그인의 `openUrl` 을 직접 부르면 Rust 쪽
/// open_url 의 스킴 가드를 지나지 않는다.
#[test]
fn every_webview_launch_is_classified() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src");
    let skip = ["lib/bindings.ts", "__tests__", "features/skills/catalog"];
    let mut files = Vec::new();
    walk_ts(&root, &mut files);
    let mut found = BTreeSet::new();
    for path in files {
        let rel = path
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if skip.iter().any(|s| rel.starts_with(s)) {
            continue;
        }
        let raw = std::fs::read_to_string(&path).unwrap();
        // 줄 전체 주석만 걷는다 — egress_inventory A 와 같은 규칙(숨기는 쪽으로 틀리지 않게).
        let text: String = raw
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        for shape in WEB_LAUNCHERS {
            for (i, _) in text.match_indices(shape) {
                found.insert(format!("{rel} :: {}", web_use(&text, i)));
            }
        }
    }
    let declared: BTreeSet<String> = WEB_LAUNCHES
        .iter()
        .map(|(p, c, ..)| format!("{p} :: {c}"))
        .collect();
    diff_report("D3 웹뷰", &found, &declared);
}

/// `i` 의 플러그인 이름을 감싸는 쓰임 — 정적 `import` 면 가져오는 이름까지 그
/// 문장을, 아니면 그 줄의 시작부터. 끝은 이름을 닫는 따옴표다. 같은 파일이 같은
/// 플러그인에서 이름을 하나 더 가져오면 다른 쓰임이 된다.
fn web_use(text: &str, i: usize) -> String {
    let line_start = text[..i].rfind('\n').map_or(0, |p| p + 1);
    let from = text[..i]
        .rfind("import")
        .filter(|&s| !text[s..i].contains(';'))
        .unwrap_or(line_start);
    let end = text[i..]
        .find(['"', '\'', '`'])
        .map_or(text.len(), |p| i + p + 1);
    text[from..end]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn walk_ts(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_ts(&path, out);
        } else if path.extension().is_some_and(|e| e == "ts" || e == "tsx") {
            out.push(path);
        }
    }
}

/// D4 — D1 의 모양(`std_cmd(` · `Command::new(` …)을 피하는 길은 별칭이다
/// (`use std::process::Command as C; C::new("curl")`). 그 길은 clippy 의
/// `disallowed-methods` 가 막는다 — 그러니 그 clippy 가 닫혀 있는지를 여기서 잰다.
#[test]
fn the_clippy_spawn_gate_stays_closed_outside_the_gateway_and_tests() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let clippy: toml::Value =
        toml::from_str(&std::fs::read_to_string(manifest.join("clippy.toml")).unwrap()).unwrap();
    let banned: BTreeSet<&str> = clippy["disallowed-methods"]
        .as_array()
        .expect("clippy.toml 의 disallowed-methods")
        .iter()
        .filter_map(|m| m["path"].as_str())
        .collect();
    assert_eq!(
        banned,
        BTreeSet::from(["std::process::Command::new", "tokio::process::Command::new"]),
        "프로세스 생성 금지 목록이 바뀌었다 — 창구(proc.rs) 밖의 기동이 D1 의 모양을 피할 수 있다"
    );

    let cargo: toml::Value =
        toml::from_str(&std::fs::read_to_string(manifest.join("Cargo.toml")).unwrap()).unwrap();
    let level = cargo
        .get("lints")
        .and_then(|l| l.get("clippy"))
        .and_then(|c| c.get("disallowed_methods"));
    assert!(
        level.is_none_or(|v| !v.to_string().contains("allow")),
        "Cargo.toml [lints.clippy] 가 disallowed_methods 를 껐다: {level:?}"
    );

    let all = source_scan::sources();
    let test_only = test_only_modules(&all);
    let mut opened = Vec::new();
    for s in &all {
        for (pos, _) in s.code.match_indices("clippy::disallowed_methods") {
            let test =
                is_under(&s.rel, &test_only) || s.prod.as_bytes()[pos] != s.code.as_bytes()[pos];
            if s.rel != "proc.rs" && !test {
                opened.push(s.rel.clone());
            }
        }
    }
    assert!(
        opened.is_empty(),
        "출시 코드가 clippy 의 프로세스 생성 금지를 끈다: {opened:?}\n\
         → crate::proc::std_cmd / tokio_cmd 를 써라. 그래야 그 자리가 이 원장에 잡힌다."
    );
}

/// D5 — 사유 없는 분류는 분류가 아니다.
#[test]
fn every_launch_entry_carries_a_reason() {
    let mut seen = BTreeSet::new();
    for l in APP_LAUNCHES {
        let k = key(l.path, l.func, l.call);
        assert!(seen.insert(k.clone()), "{k} 가 원장에 두 번 있다");
        assert!(l.reason.trim().chars().count() >= 12, "{k}: 사유가 없다");
        if let Reach::Network(door) = l.reach {
            assert!(
                door.trim().chars().count() >= 8,
                "{k}: 송출 가능이라고 적었으면 그 문(누가 언제 여는가)을 적어라"
            );
        }
    }
    for (path, reason, calls) in TEST_LAUNCHES {
        assert!(
            reason.trim().chars().count() >= 12,
            "{path}: 테스트 픽스처의 사유가 없다"
        );
        assert!(!calls.is_empty(), "{path}: 자리 없는 항목");
    }
    for (path, call, _, reason) in WEB_LAUNCHES {
        assert!(
            reason.trim().chars().count() >= 12,
            "{path} :: {call}: 사유가 없다"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 금지선 — 분류로 받아 줄 수 없는 기동 (egress_inventory.rs 에서 옮겨 왔다)
// ─────────────────────────────────────────────────────────────────────────────

/// 원장을 우회하는 고전적인 두 길 — 하위 프로세스로 `curl`/`wget` 을 띄우기.
/// 예전엔 `std_cmd("curl")` 꼴 셋만 봤다. 이제 [`LAUNCHERS`] 전부에서, 경로
/// (`/usr/bin/curl`)·확장자(`curl.exe`)를 붙여도 본다.
#[test]
fn nothing_launches_curl_or_wget() {
    let banned: Vec<Found> = launch_sites()
        .into_iter()
        .filter(|f| is_downloader(&f.arg))
        .collect();
    assert!(
        banned.is_empty(),
        "하위 프로세스로 내려받기 도구를 띄운다 — 유출 원장을 우회한다: {banned:#?}"
    );
}

fn is_downloader(arg: &str) -> bool {
    let Some(lit) = arg.strip_prefix('"').and_then(|a| a.split('"').next()) else {
        return false;
    };
    let name = lit
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(lit)
        .to_ascii_lowercase();
    matches!(name.trim_end_matches(".exe"), "curl" | "wget")
}

/// git 은 로컬 전용이라는 주장(`git.rs` — "no token, no network")을 실제로 잡는다.
///
/// 소스 전체에서 `"push"` 를 찾지 않는다 — LSP 자동완성 픽스처의
/// `{"label": "push"}` 가 걸린다. 오탐이 한 번 나면 다음 사람이 게이트를 느슨하게
/// 만들고, 그때 진짜가 새어 나간다. 그래서 **git 에 닿는 파일**만 본다: git 을
/// 직접 띄우는 파일 · 창구(`git::safe::cmd`)를 부르는 파일 · `git/` 모듈 전부.
///
/// 2026-10-10 전까지는 첫째만 봤다. git 을 띄우는 출시 파일은 `git/safe.rs` 하나고
/// 거기서 하위 명령은 변수다 — 하위 명령 글자는 창구를 부르는 파일과 그것을 감싼
/// `run_git` 의 호출자(`git/` 모듈)에 적힌다. 검사는 그 파일들을 하나도 읽지
/// 않았고, "띄우는 파일 셋 이상" 이라는 낡음 검사는 테스트 픽스처 둘이 채우고 있었다.
#[test]
fn git_stays_local_only() {
    let all = source_scan::sources();
    let test_only = test_only_modules(&all);
    let spawners: BTreeSet<String> = launch_sites()
        .into_iter()
        .filter(|f| f.arg == "\"git\"")
        .map(|f| f.path)
        .collect();
    let mut gateway_callers = 0;
    for s in all.iter().filter(|s| !is_under(&s.rel, &test_only)) {
        let calls_gateway = s.code.contains("safe::cmd(");
        gateway_callers += usize::from(calls_gateway);
        if !(spawners.contains(&s.rel) || calls_gateway || s.rel.starts_with("git/")) {
            continue;
        }
        let banned = git_network_args_in(&strip_comments(&s.raw));
        assert!(
            banned.is_empty(),
            "{}: git 네트워크 서브커맨드 {banned:?} — git 은 로컬 전용 계약이다 \
             (토큰도 없고 원격도 안 건드린다는 것이 README 의 주장이다)",
            s.rel
        );
    }
    assert!(
        gateway_callers >= 3,
        "git 창구(git::safe::cmd)를 부르는 파일을 {gateway_callers}개밖에 못 찾았다 — 스캐너가 낡았다"
    );
}

/// git 의 네트워크 하위 명령이 **인자로 넘어가는** 모양 (`&["fetch", …]` ·
/// `.arg("fetch")`). `ls-remote`·`submodule`(update 가 받는다)도 원격에 닿는다.
fn git_network_args_in(text: &str) -> Vec<String> {
    ["push", "clone", "fetch", "pull", "ls-remote", "submodule"]
        .iter()
        .flat_map(|b| {
            [
                format!("\"{b}\","),
                format!("\"{b}\"]"),
                format!("arg(\"{b}\")"),
            ]
        })
        .filter(|shape| text.contains(shape))
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// 스캐너 자신의 테스트 — 숨기는 쪽으로 틀리면 원장이 거짓이 된다
// ─────────────────────────────────────────────────────────────────────────────

/// 창구를 감싼 래퍼의 호출 모양(2026-10-10 전의 git 검사가 놓치던 그 모양)과
/// 경로를 붙인 내려받기 도구를 잡는다.
#[test]
fn the_ban_lines_see_wrappers_and_paths() {
    let caller = r#"let t = run_git(&repo, &["fetch", "origin"])?;"#;
    assert_eq!(git_network_args_in(caller), vec!["\"fetch\",".to_string()]);
    assert!(git_network_args_in(r#"run_git(&repo, &["remote", "-v"])"#).is_empty());
    assert!(!git_network_args_in(r#"cmd.arg("submodule")"#).is_empty());
    assert!(is_downloader("\"/usr/bin/curl\""));
    assert!(is_downloader("\"wget.exe\", …"));
    assert!(!is_downloader("\"git\"") && !is_downloader("curl_path"));
}

#[test]
fn the_launch_scanner_sees_calls_after_urls_and_ignores_comments_and_definitions() {
    let src = r##"
pub fn std_cmd(program: &str) -> Command { Command::new(program) }
fn fetch_it() {
    // std_cmd("in-a-comment") 는 호출이 아니다
    let msg = "std_cmd(\"in-a-string\")";
    let u = "https://x.test/a"; let c = crate::proc::std_cmd("curl"); // 끝 주석
    my_std_cmd("not-ours");
    tokio_cmd(npm).args(["ci"]);
}
#[cfg(test)]
mod tests {
    fn fixture() { crate::proc::std_cmd("git"); }
}
"##;
    let found = launches_in("x.rs", src, false);
    let got: BTreeSet<(String, String, bool)> = found
        .into_iter()
        .map(|f| (f.func, f.call, f.test))
        .collect();
    let want: BTreeSet<(String, String, bool)> = [
        ("std_cmd", "Command::new(program)", false),
        ("fetch_it", "std_cmd(\"curl\")", false),
        ("fetch_it", "tokio_cmd(npm)", false),
        ("fixture", "std_cmd(\"git\")", true),
    ]
    .into_iter()
    .map(|(f, c, t)| (f.to_string(), c.to_string(), t))
    .collect();
    assert_eq!(got, want);
}
