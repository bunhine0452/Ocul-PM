//! ponytail-round C1 — 규칙 사본 "불변 문구 카나리".
//!
//! 정본(마스터 템플릿)과 그 파생 표면(MCP instructions·플러그인 스킬·claude
//! 어댑터)은 바이트 비교가 불가능하다 — 길이도 언어도 다르다. 대신 **하중을
//! 받는 규칙 문구**가 각 표면에 살아있는지를 핀으로 고정한다 (ponytail 의
//! check-rule-copies INVARIANTS 방식). 규칙을 리워딩하면 여기가 깨지고,
//! 그 깨짐이 "모든 사본에 전파하라"는 리마인더다.
//!
//! 카나리는 완전성 검사가 아니다 — 실드리프트를 놓치는 사례가 나오면
//! 그 문구를 여기 추가하는 것이 업그레이드 경로다.

use std::path::PathBuf;

fn repo(rel: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} 읽기 실패: {e}", p.display()))
}

fn assert_all(surface: &str, text: &str, canaries: &[&str]) {
    for c in canaries {
        assert!(
            text.contains(c),
            "[{surface}] 카나리 문구 소실: {c:?} — 규칙을 리워딩했다면 모든 사본(정본·어댑터·스킬·instructions)에 전파하고 이 테스트를 갱신하라"
        );
    }
}

/// 정본 ko — 준수를 담보하는 핵심 규칙 전부.
#[test]
fn master_ko_carries_load_bearing_rules() {
    let t = repo("src/oculpm/agents/templates/master_ko.md.tpl");
    assert_all(
        "master_ko",
        &t,
        &[
            "`.oculpm/index/**` 에 쓰기 금지",
            "secrets / API key / `.env` 내용 포함 금지",
            "기존 일지 수정 금지",
            "한 파일에 작업 두 개 금지",
            "schema_version: 1",
            "verified_by_user: false",
            "부모를 직접 갱신하지 말 것",
            "oculpm:plan-log begin v1",
            "oculpm-defer:",
            "journal_write",
            "plan_create",
        ],
    );
}

/// 정본 en — ko 와 같은 하중 규칙의 영어 대응.
#[test]
fn master_en_carries_load_bearing_rules() {
    let t = repo("src/oculpm/agents/templates/master_en.md.tpl");
    assert_all(
        "master_en",
        &t,
        &[
            "Never write into `.oculpm/index/**`",
            "Never include secrets / API keys",
            "Never edit an existing journal entry",
            "schema_version: 1",
            "verified_by_user: false",
            "oculpm:plan-log begin v1",
            "oculpm-defer:",
            "journal_write",
            "plan_create",
        ],
    );
}

/// MCP 서버 instructions — 도구 우선·직접 생성 금지·시크릿 금지가 살아있어야
/// 플러그인-온리 사용자도 같은 계약 아래 움직인다. 소스 전문이 아니라
/// **서빙되는 상수 값**을 검증한다 — 주석/죽은 문자열로는 통과 못 한다.
#[test]
fn mcp_instructions_carry_load_bearing_rules() {
    assert_all(
        "mcp instructions",
        ocul_pm_lib::oculpm::mcp::protocol::MCP_INSTRUCTIONS,
        &[
            "journal_write",
            "plan_update",
            "plan_create",
            "project_init",
            "시크릿/.env 내용은 어떤 인자에도 넣지 말 것",
            ".oculpm/ 파일을 직접 만들지 말 것",
            "선제 호출 금지",
        ],
    );
}

/// 플러그인 풀 스펙 캐리어 스킬 — 앱 없이 스킬만 보는 에이전트의 마지막 방어선.
#[test]
fn plugin_journal_skill_carries_load_bearing_rules() {
    let t = repo("../plugin/oculpm/skills/oculpm-journal/SKILL.md");
    assert_all(
        "oculpm-journal skill",
        &t,
        &[".oculpm/index/**", "secrets", "journal_write", "plan_update"],
    );
}

/// claude 어댑터(.claude/CLAUDE.md 블록) — MCP-first 포인터가 도구 이름을 잃으면
/// 에이전트가 파일 직접 작성으로 후퇴한다.
#[test]
fn claude_adapter_points_at_tools() {
    let t = repo("src/oculpm/agents/templates/claude_code.md.tpl");
    assert_all(
        "claude adapter",
        &t,
        &["journal_write", "plan_update", "plan_create", "AGENTS.md"],
    );
}
