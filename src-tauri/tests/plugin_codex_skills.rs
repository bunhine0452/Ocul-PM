//! Codex 판 플러그인의 구현 루프 스킬 셋(`next` · `redteam` · `inception`)은 Claude 판의
//! **같은 원문에서 렌더된다** (love-round-20261123 L7 #codex-plugin-parity).
//!
//! 손으로 옮겨 적으면 한쪽만 고쳐져 Codex 사용자만 조용히 옛 규칙을 쓴다 — 훅 묶음
//! (`plugin_xplat.rs` `the_codex_plugin_ships_the_same_hook_bundle_as_the_claude_one`)과 같은
//! 이유다. 그래서 여기 [`render`] 하나가 Claude 문법을 Codex 말로 바꾸고, 시험은 디스크의 Codex
//! 판이 그 결과와 글자 그대로 같은지 본다.
//!
//! Claude 판을 고쳤으면:
//!
//! ```text
//! OCULPM_BLESS_CODEX_SKILLS=1 cargo test --test plugin_codex_skills
//! ```
//!
//! 로 Codex 판을 다시 쓴다(다른 때는 읽기만 한다).
//!
//! 바꾸는 것 — Codex 에 없는 것만:
//! - `/oculpm:<스킬>` 슬래시 커맨드 → 「<스킬> 스킬」 (Codex 는 스킬을 이름으로 부른다).
//! - `$ARGUMENTS` (Claude 가 커맨드 인자를 끼워 넣는 자리) → 「사용자가 준 인자」.
//! - `.claude/rules/` (Claude 전용 규칙 폴더) → 루트 `AGENTS.md` 의 관리 블록 밖.
//! - frontmatter 에 `name:` 이 없으면 폴더 이름으로 넣는다 — Codex 스킬은 `name` 이 필수다.

use std::path::PathBuf;

/// Codex 판에 같이 싣는 Claude 스킬. `help` 는 Claude 표면(슬래시 커맨드 · statusline) 카드라
/// 싣지 않고, `oculpm-journal` 의 자리는 Codex 판의 `oculpm-codex` 안내가 맡는다.
const SHARED: &[&str] = &["next", "redteam", "inception"];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .to_path_buf()
}

fn claude_skill(name: &str) -> PathBuf {
    repo_root().join("plugin/oculpm/skills").join(name).join("SKILL.md")
}

fn codex_skill(name: &str) -> PathBuf {
    repo_root()
        .join("plugin/oculpm-codex/skills")
        .join(name)
        .join("SKILL.md")
}

/// 「X 스킬」 · 「사용자가 준 인자」 뒤에 띄어 붙던 조사를 한국어 낱말에 붙이고 받침에 맞춘다
/// (스킬 = ㄹ 받침, 인자 = 받침 없음).
const PARTICLES: &[(&str, &str)] = &[
    ("스킬 가 ", "스킬이 "),
    ("스킬 는 ", "스킬은 "),
    ("스킬 를 ", "스킬을 "),
    ("스킬 로", "스킬로"),
    ("인자 가 ", "인자가 "),
    ("인자 로 ", "인자로 "),
    ("인자 에 ", "인자에 "),
];

/// `` `/oculpm:<이름>[ <인자>]` `` → `<이름> 스킬` 또는 `<이름> 스킬(`<인자>`)`.
fn replace_slash_commands(text: &str) -> String {
    const OPEN: &str = "`/oculpm:";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(OPEN) {
        out.push_str(&rest[..at]);
        let after = &rest[at + OPEN.len()..];
        let Some(close) = after.find('`') else {
            out.push_str(&rest[at..]);
            rest = "";
            break;
        };
        let inner = &after[..close];
        match inner.split_once(' ') {
            Some((name, arg)) => out.push_str(&format!("{name} 스킬(`{arg}`)")),
            None => out.push_str(&format!("{inner} 스킬")),
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out
}

fn render(name: &str, claude: &str) -> String {
    // 제목 줄의 맨 커맨드 (`# /oculpm:next` · `# /oculpm:redteam — 부제`).
    let titled: Vec<String> = claude
        .split_inclusive('\n')
        .map(|line| match line.strip_prefix("# /oculpm:") {
            Some(rest) => match rest.split_once(" — ") {
                Some((name, tail)) => format!("# {name} 스킬 — {tail}"),
                None => format!("# {} 스킬{}", rest.trim_end(), &rest[rest.trim_end().len()..]),
            },
            None => line.to_string(),
        })
        .collect();
    let mut text = replace_slash_commands(&titled.concat());
    text = text.replace("`$ARGUMENTS`", "$ARGUMENTS");
    text = text.replace("$ARGUMENTS", "사용자가 준 인자");
    text = text.replace(
        "`.claude/rules/<name>.md` 1~2개(`paths` 로 범위)",
        "루트 `AGENTS.md` 의 관리 블록 밖에 한두 줄",
    );
    for (from, to) in PARTICLES {
        text = text.replace(from, to);
    }
    let has_name = text
        .lines()
        .skip(1)
        .take_while(|l| *l != "---")
        .any(|l| l.starts_with("name: "));
    if !has_name {
        text = text.replacen("---\n", &format!("---\nname: {name}\n"), 1);
    }
    text
}

#[test]
fn codex_skills_are_rendered_from_the_claude_originals() {
    let bless = std::env::var_os("OCULPM_BLESS_CODEX_SKILLS").is_some();
    for name in SHARED {
        let claude = std::fs::read_to_string(claude_skill(name)).expect("Claude 판 스킬");
        let want = render(name, &claude);
        let path = codex_skill(name);
        if bless {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &want).unwrap();
            continue;
        }
        let have = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            panic!("oculpm-codex 에 {name} 스킬이 없다 ({e}) — OCULPM_BLESS_CODEX_SKILLS=1 cargo test --test plugin_codex_skills")
        });
        assert_eq!(
            have, want,
            "{name}: Codex 판이 Claude 원문과 갈라졌다 — Claude 판을 고쳤으면 OCULPM_BLESS_CODEX_SKILLS=1 cargo test --test plugin_codex_skills"
        );
    }
}

/// 렌더한 판에 Claude 전용 문법이 남지 않는다 — 남으면 Codex 가 그 줄을 따라 할 수 없다.
#[test]
fn rendered_skills_carry_no_claude_only_syntax() {
    for name in SHARED {
        let text = render(name, &std::fs::read_to_string(claude_skill(name)).unwrap());
        for claude_only in ["/oculpm:", "$ARGUMENTS", ".claude/", "CLAUDE_PLUGIN_ROOT", "스킬 가 ", "스킬 를 "] {
            assert!(!text.contains(claude_only), "{name}: {claude_only:?} 가 남았다");
        }
        let front: Vec<&str> = text.lines().skip(1).take_while(|l| *l != "---").collect();
        assert!(front.contains(&format!("name: {name}").as_str()), "{name}: name 필수");
        assert!(front.iter().any(|l| l.starts_with("description: ")), "{name}: description 필수");
    }
}

#[test]
fn the_renderer_maps_commands_arguments_and_particles() {
    let src = "---\ndescription: d\n---\n\n# /oculpm:next\n\n`$ARGUMENTS` 가 있다. **`/oculpm:next` 가 그대로 도는 플랜** · `/oculpm:next until-done` 이면 · `/oculpm:redteam <plan_id>` · `/oculpm:next` 로.\n";
    assert_eq!(
        render("next", src),
        "---\nname: next\ndescription: d\n---\n\n# next 스킬\n\n사용자가 준 인자가 있다. **next 스킬이 그대로 도는 플랜** · next 스킬(`until-done`) 이면 · redteam 스킬(`<plan_id>`) · next 스킬로.\n"
    );
    // 이미 name 이 있으면 두 번 넣지 않는다. 제목의 줄표 뒤는 그대로.
    let red = "---\nname: redteam\ndescription: d\n---\n\n# /oculpm:redteam — 반대편\n";
    assert_eq!(render("redteam", red), "---\nname: redteam\ndescription: d\n---\n\n# redteam 스킬 — 반대편\n");
}

/// Codex 도 스킬 description 을 늘 컨텍스트에 싣는다 — 넷(안내 + 셋)의 합을 Claude 판과 같은
/// 잣대(1 tok ≈ 2 chars, 1,400 chars)로 묶는다.
#[test]
fn codex_skill_descriptions_stay_within_budget() {
    let dir = repo_root().join("plugin/oculpm-codex/skills");
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    assert_eq!(names, ["inception", "next", "oculpm-codex", "redteam"]);
    let total: usize = names
        .iter()
        .map(|n| {
            let text = std::fs::read_to_string(dir.join(n).join("SKILL.md")).unwrap();
            text.lines()
                .find_map(|l| l.strip_prefix("description: "))
                .unwrap_or_else(|| panic!("{n}: description 필수"))
                .chars()
                .count()
        })
        .sum();
    assert!(total <= 1_400, "Codex 스킬 description 합계 {total} chars");
}
