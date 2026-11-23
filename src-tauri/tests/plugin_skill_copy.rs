//! 플러그인 스킬 description 은 스킬 목록에서 사람이 제일 먼저 읽는 한 줄이다 — 앱이 걷어 낸
//! 내부 낱말(판정 · 리프 · 미완 · 플랜 · 보이지 않는 이름 ocul-pm)로 쓰이면 앱 말과 갈라진다.
//! 앱 쪽은 `src/__tests__/i18n_glossary.test.ts` 가 `ko.ts` 만 지키므로, 같은 표를 이 줄들에도 건다.
//! (본문은 에이전트가 읽는 규격이라 대상이 아니다 — 파일 문법 `판정 ✓|✗` 는 그대로다.)

use std::path::PathBuf;

const BANNED: &[&str] = &["판정", "리프", "미완", "플랜", "ocul-pm", "Ocul-PM"];

fn skill_files() -> Vec<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .join("plugin");
    let mut out = Vec::new();
    for plugin in ["oculpm", "oculpm-codex"] {
        let dir = root.join(plugin).join("skills");
        for e in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("{dir:?}: {e}")) {
            let p = e.unwrap().path().join("SKILL.md");
            if p.is_file() {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

#[test]
fn skill_descriptions_use_the_users_words() {
    let files = skill_files();
    assert!(files.len() >= 8, "스킬 파일을 못 찾았다: {files:?}");
    for f in files {
        let text = std::fs::read_to_string(&f).unwrap();
        let desc = text
            .lines()
            .find_map(|l| l.strip_prefix("description: "))
            .unwrap_or_else(|| panic!("{f:?}: description 필수"));
        for word in BANNED {
            assert!(
                !desc.contains(word),
                "{f:?}: description 에 내부 낱말 「{word}」 — 앱이 쓰는 말(계획 · 확인 결과 · Ocul)로: {desc}"
            );
        }
    }
}

/// `/oculpm:help` 는 사람이 부를 때만 쓰는 카드다 — 모델 발동이면 설명이 매 턴 컨텍스트에 실린다.
#[test]
fn help_card_is_user_invoked_only() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .join("plugin/oculpm/skills/help/SKILL.md");
    let text = std::fs::read_to_string(root).unwrap();
    assert!(
        text.lines().any(|l| l == "disable-model-invocation: true"),
        "help 는 disable-model-invocation: true 여야 한다"
    );
}
