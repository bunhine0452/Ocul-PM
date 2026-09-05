//! `{#acp-sid-map}` · `{#mcp-missing-visible}` 의 단위 단언.
//!
//! 여기서 무는 것은 두 가지다 — **신원이 실제로 환경에 실리는가**, 그리고
//! **못 찾았을 때 그 사실이 값으로 남는가**. 둘 다 예전에는 조용했다.

use std::path::{Path, PathBuf};

use agent_client_protocol::schema::v1::McpServer;
use chrono::{Duration, Local, TimeZone, Utc};

use super::*;

fn touch(path: &Path) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, b"#!/bin/sh\n").unwrap();
}

fn env_of(servers: &[McpServer]) -> Vec<(String, String)> {
    servers
        .iter()
        .flat_map(|server| match server {
            McpServer::Stdio(stdio) => stdio
                .env
                .iter()
                .map(|v| (v.name.clone(), v.value.clone()))
                .collect::<Vec<_>>(),
            _ => Vec::new(),
        })
        .collect()
}

// ─── 바이너리 탐색 ───────────────────────────────────────────────────────────

/// 셔틀 스크립트(`plugin/oculpm/bin/oculpm-mcp`)와 **같은 순서·같은 자리**를 본다.
/// 화면의 안내가 셔틀의 안내와 다른 곳을 가리키면 사용자는 두 번 헤맨다.
#[test]
fn candidates_follow_the_shuttle_vocabulary() {
    let paths = candidate_paths(
        Some(Path::new("/opt/manual/oculpm-mcp")),
        Some(Path::new("/apps/ocul-pm.app/Contents/MacOS")),
        Some(Path::new("/home/kim")),
    );
    let shown: Vec<String> = paths.iter().map(|p| p.display().to_string()).collect();

    assert_eq!(shown[0], "/opt/manual/oculpm-mcp", "수동 지정이 1순위다");
    assert!(shown[1].starts_with("/apps/ocul-pm.app/Contents/MacOS/"));
    assert!(
        shown
            .iter()
            .any(|p| p.starts_with("/Applications/ocul-pm.app")),
        "시스템 Applications 를 본다: {shown:?}"
    );
    assert!(
        shown
            .iter()
            .any(|p| p.starts_with("/home/kim/Applications/")),
        "유저 Applications 를 본다: {shown:?}"
    );
    assert!(
        shown.iter().any(|p| p.starts_with("/home/kim/.local/bin/")),
        "수동 설치 자리를 본다: {shown:?}"
    );
}

#[test]
fn probe_stops_at_the_first_hit_and_remembers_what_it_passed() {
    let dir = tempfile::tempdir().unwrap();
    let miss = dir.path().join("nowhere/oculpm-mcp");
    let hit = dir.path().join("here/oculpm-mcp");
    touch(&hit);
    let never = dir.path().join("later/oculpm-mcp");

    let probe = probe_candidates(vec![miss.clone(), hit.clone(), never.clone()]);
    assert_eq!(probe.path, Some(hit.clone()));
    assert_eq!(probe.searched, vec![miss, hit], "지나온 자리를 남긴다");
    assert!(
        !probe.searched.contains(&never),
        "찾은 뒤로는 더 안 본다 — 안 본 자리를 봤다고 말하지 않는다"
    );
}

/// 부재가 **값으로** 남는다. 예전에는 여기서 빈 `Vec` 하나만 돌아가고 끝이었다.
#[test]
fn a_missing_binary_reports_every_place_it_looked() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a/oculpm-mcp");
    let b = dir.path().join("b/oculpm-mcp");

    let probe = probe_candidates(vec![a.clone(), b.clone()]);
    assert!(probe.path.is_none());
    assert_eq!(probe.searched, vec![a, b]);

    let status = AcpRecordingStatus::from_probe(&probe, "acp-20260905-deadbeef");
    assert!(!status.attached);
    assert_eq!(status.searched.len(), 2, "화면이 읽을 목록이 비면 안 된다");
    assert!(status.binary_path.is_none());
}

#[test]
fn an_attached_status_does_not_carry_a_search_list() {
    let dir = tempfile::tempdir().unwrap();
    let hit = dir.path().join("bin/oculpm-mcp");
    touch(&hit);

    let status = AcpRecordingStatus::from_probe(&probe_candidates(vec![hit.clone()]), "acp-x");
    assert!(status.attached);
    assert_eq!(status.binary_path, Some(hit.display().to_string()));
    assert!(
        status.searched.is_empty(),
        "붙었을 때 찾아본 자리는 사용자에게 할 말이 아니다"
    );
}

// ─── 신원이 환경에 실린다 ───────────────────────────────────────────────────

/// `{#acp-sid-map}` 의 핵심 단언 — 세션 신원이 실제로 MCP 서버 환경에 실린다.
#[test]
fn a_started_session_hands_its_identity_to_the_mcp_server() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("oculpm-mcp");
    touch(&bin);
    let probe = probe_candidates(vec![bin.clone()]);

    let servers = client_mcp_servers(AcpProvider::Codex, "acp-20260905-abcd1234", &probe);
    assert_eq!(servers.len(), 1);
    let env = env_of(&servers);

    assert!(
        env.contains(&(
            crate::oculpm::mcp::tools::AGENT_ID_ENV.to_string(),
            "codex".to_string()
        )),
        "누가 부르는지: {env:?}"
    );
    assert!(
        env.contains(&(
            crate::oculpm::mcp::tools::OCULPM_SESSION_ENV.to_string(),
            "acp-20260905-abcd1234".to_string()
        )),
        "어느 대화인지 — 이 줄이 없으면 agent.session 이 영원히 빈다: {env:?}"
    );
    // 옛 이름도 같은 값으로 한 번 더 — 중립 이름을 모르는 낡은 설치본 폴백.
    // 서버는 중립 이름을 **먼저** 보므로 어댑터가 이 칸을 덮어써도 우리가 이긴다.
    assert!(
        env.contains(&(
            crate::oculpm::mcp::tools::CLAUDE_SESSION_ENV.to_string(),
            "acp-20260905-abcd1234".to_string()
        )),
        "옛 이름 폴백이 사라졌다: {env:?}"
    );
}

#[test]
fn claude_sessions_are_attributed_to_claude_code() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("oculpm-mcp");
    touch(&bin);
    let servers = client_mcp_servers(
        AcpProvider::Claude,
        "acp-20260905-0000ffff",
        &probe_candidates(vec![bin]),
    );
    assert!(env_of(&servers).contains(&(
        crate::oculpm::mcp::tools::AGENT_ID_ENV.to_string(),
        "claude-code".to_string()
    )));
}

#[test]
fn no_binary_means_no_servers_but_the_reason_survives() {
    let dir = tempfile::tempdir().unwrap();
    let probe = probe_candidates(vec![dir.path().join("absent/oculpm-mcp")]);
    assert!(client_mcp_servers(AcpProvider::Claude, "acp-x", &probe).is_empty());
    assert!(
        !AcpRecordingStatus::from_probe(&probe, "acp-x")
            .searched
            .is_empty(),
        "빈 목록만 남고 사유가 사라지면 예전과 같다"
    );
}

// ─── 매핑의 수명 ────────────────────────────────────────────────────────────

#[test]
fn minted_tokens_carry_the_workday_and_are_unique() {
    let now = Local.with_ymd_and_hms(2026, 9, 5, 13, 0, 0).unwrap();
    let a = mint_token(now);
    let b = mint_token(now);
    assert!(a.starts_with("acp-20260905-"), "{a}");
    assert_eq!(a.len(), "acp-20260905-".len() + 8);
    assert_ne!(a, b, "대화 둘이 같은 신원을 쓰면 가르는 의미가 없다");
}

#[test]
fn a_new_session_binds_its_uuid_to_the_token_it_was_given() {
    let app_data = tempfile::tempdir().unwrap();
    let root = PathBuf::from("/tmp/project");
    bind(
        app_data.path(),
        "uuid-1111",
        "acp-20260905-aaaaaaaa",
        AcpProvider::Claude,
        &root,
    );
    assert_eq!(
        lookup(app_data.path(), "uuid-1111").as_deref(),
        Some("acp-20260905-aaaaaaaa")
    );
}

/// 재개(`session/load`)와 앱 재시작이 신원을 바꾸지 않는다 — 원장이 파일이라
/// 같은 대화의 일지가 계속 같은 `agent.session` 을 받는다.
#[test]
fn resuming_a_conversation_reuses_its_identity_across_restarts() {
    let app_data = tempfile::tempdir().unwrap();
    let root = PathBuf::from("/tmp/project");

    let first = token_for_existing(app_data.path(), "uuid-2222", AcpProvider::Claude, &root);
    // "앱 재시작" = 인메모리 상태 없이 같은 디스크를 다시 읽는 것.
    let again = token_for_existing(app_data.path(), "uuid-2222", AcpProvider::Claude, &root);

    assert_eq!(first, again);
    assert_eq!(
        lookup(app_data.path(), "uuid-2222").as_deref(),
        Some(first.as_str())
    );
}

#[test]
fn an_unknown_conversation_gets_a_fresh_identity_and_it_persists() {
    let app_data = tempfile::tempdir().unwrap();
    let root = PathBuf::from("/tmp/project");

    let a = token_for_existing(app_data.path(), "uuid-3333", AcpProvider::Codex, &root);
    let b = token_for_existing(app_data.path(), "uuid-4444", AcpProvider::Codex, &root);
    assert_ne!(a, b);
    assert!(
        ledger_path(app_data.path()).is_file(),
        "원장이 디스크에 남는다"
    );
}

#[test]
fn deleting_a_conversation_forgets_its_mapping() {
    let app_data = tempfile::tempdir().unwrap();
    let root = PathBuf::from("/tmp/project");
    bind(
        app_data.path(),
        "uuid-5555",
        "acp-20260905-bbbbbbbb",
        AcpProvider::Claude,
        &root,
    );
    forget(app_data.path(), "uuid-5555");
    assert!(lookup(app_data.path(), "uuid-5555").is_none());
}

#[test]
fn rebinding_the_same_uuid_keeps_one_row() {
    let now = Utc::now().to_rfc3339();
    let row = |token: &str| SessionLink {
        acp_session_id: "uuid-same".into(),
        oculpm_session: token.into(),
        provider: "codex".into(),
        project_root: "/tmp/p".into(),
        bound_at: now.clone(),
        last_seen_at: now.clone(),
    };
    let links = upsert(vec![row("old")], row("new"));
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].oculpm_session, "new");
}

/// 원장이 무한히 자라지 않는다. 어댑터 종료는 대화를 지우지 않으므로 나이·개수
/// 상한이 유일한 장치다.
#[test]
fn the_ledger_is_pruned_by_age_and_by_count() {
    let now = Utc::now();
    let row = |id: &str, seen: chrono::DateTime<Utc>| SessionLink {
        acp_session_id: id.into(),
        oculpm_session: format!("acp-{id}"),
        provider: "claude-code".into(),
        project_root: "/tmp/p".into(),
        bound_at: seen.to_rfc3339(),
        last_seen_at: seen.to_rfc3339(),
    };

    let aged = prune(
        vec![row("fresh", now), row("stale", now - Duration::days(31))],
        now,
        100,
        30,
    );
    assert_eq!(aged.len(), 1);
    assert_eq!(aged[0].acp_session_id, "fresh");

    let many: Vec<SessionLink> = (0..10)
        .map(|i| row(&format!("s{i}"), now - Duration::minutes(i)))
        .collect();
    let capped = prune(many, now, 4, 30);
    assert_eq!(capped.len(), 4);
    assert!(
        capped.iter().any(|l| l.acp_session_id == "s0"),
        "가장 최근 것이 남아야 한다: {:?}",
        capped.iter().map(|l| &l.acp_session_id).collect::<Vec<_>>()
    );
}

/// 시각을 못 읽는 항목은 나이로 버리지 않는다 — 판정할 수 없는 자리는 뺏지 않는다.
#[test]
fn rows_with_unreadable_timestamps_are_kept() {
    let mut broken = SessionLink {
        acp_session_id: "weird".into(),
        oculpm_session: "acp-weird".into(),
        provider: "codex".into(),
        project_root: "/tmp/p".into(),
        bound_at: "not a time".into(),
        last_seen_at: "not a time".into(),
    };
    broken.provider = "codex".into();
    let kept = prune(vec![broken], Utc::now(), 100, 30);
    assert_eq!(kept.len(), 1);
}

/// 깨진 원장 파일이 세션 시작을 막지 않는다 — 못 읽으면 새로 발급한다.
#[test]
fn a_corrupt_ledger_does_not_block_a_session() {
    let app_data = tempfile::tempdir().unwrap();
    let path = ledger_path(app_data.path());
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"{ this is not json").unwrap();

    let token = token_for_existing(
        app_data.path(),
        "uuid-6666",
        AcpProvider::Claude,
        Path::new("/tmp/p"),
    );
    assert!(token.starts_with("acp-"));
    assert_eq!(
        lookup(app_data.path(), "uuid-6666").as_deref(),
        Some(token.as_str())
    );
}
