//! 판정 하네스. 폐기 당시의 사유("판정이 셸에 있으니 시험할 수가 없다")를
//! 무효로 만드는 것이 이 파일의 존재 이유다 — 여기 있는 것은 전부 순수
//! 함수에 대한 단언이고, 디스크를 만지지 않는다.

use super::*;

fn journal(modified_at: i64) -> JournalRecord {
    JournalRecord {
        modified_at,
        ..Default::default()
    }
}

/// 마커 100, 변경 200 — 옆 대화 없음.
fn lone_session_with_changes() -> VerdictInput {
    VerdictInput {
        conversation: "conv-a".into(),
        segment_started_at: Some(100),
        live_peers: Vec::new(),
        changes: vec![ChangedFile {
            path: "src/lib.rs".into(),
            modified_at: 200,
        }],
        journals: Vec::new(),
        workday_sessions: Vec::new(),
        working_tree_readable: true,
    }
}

// ─── 이의 ───────────────────────────────────────────────────────────────────

#[test]
fn a_lone_conversation_that_changed_code_without_recording_is_objected_to() {
    let v = judge(&lone_session_with_changes());
    let Verdict::Objection(o) = v else {
        panic!("이의가 나와야 한다: {v:?}");
    };
    assert_eq!(o.changed, vec!["src/lib.rs".to_string()]);
    assert_eq!(o.basis, ChangeBasis::SoleLiveConversation);
}

/// 문구가 **무엇을 하라**까지 말해야 한다 — 「일지를 쓰세요」로는 에이전트가
/// 무엇을 어디에 적을지 모른다 (폐기 당시 회고가 지목한 자리).
#[test]
fn the_objection_names_the_tool_and_the_files() {
    let Verdict::Objection(o) = judge(&lone_session_with_changes()) else {
        panic!("이의");
    };
    let msg = o.message();
    assert!(msg.contains("journal_write"), "{msg}");
    assert!(msg.contains("src/lib.rs"), "{msg}");
    assert!(msg.contains("plan_update"), "{msg}");
    // 진행 중인 세션이 스스로 풀 수 있는 출구 — 이 문구가 없으면 게이트가
    // 잔소리가 된다 (종전에는 셸 스크립트가 들고 있었다).
    assert!(msg.contains("계속하세요"), "{msg}");
}

#[test]
fn a_long_file_list_is_trimmed_but_still_counts_everything() {
    let mut input = lone_session_with_changes();
    input.changes = (0..9)
        .map(|i| ChangedFile {
            path: format!("src/f{i}.rs"),
            modified_at: 200,
        })
        .collect();
    let Verdict::Objection(o) = judge(&input) else {
        panic!("이의");
    };
    assert_eq!(o.changed.len(), 9);
    assert!(o.message().contains("외 4개"), "{}", o.message());
    assert!(o.reason().contains('9'), "{}", o.reason());
}

// ─── 침묵 (이의 없음) ───────────────────────────────────────────────────────

/// **읽기만 한 세션은 침묵한다.**
#[test]
fn a_read_only_conversation_is_clear() {
    let mut input = lone_session_with_changes();
    input.changes.clear();
    assert_eq!(
        judge(&input),
        Verdict::Clear(Clear::NothingToRecord),
        "읽기만 한 세션에 이의가 붙었다"
    );
}

/// 세그먼트 시작 **전**의 변경은 이 대화의 것이 아니다 (남의 WIP).
#[test]
fn changes_older_than_the_segment_are_not_ours() {
    let mut input = lone_session_with_changes();
    input.changes[0].modified_at = 50;
    assert_eq!(judge(&input), Verdict::Clear(Clear::NothingToRecord));
}

// ─── 사다리 — 없음은 "다음 입력으로" 이지 "미기록" 이 아니다 ────────────────

#[test]
fn rung_one_is_the_journals_own_conversation_id() {
    let mut input = lone_session_with_changes();
    input.journals = vec![JournalRecord {
        agent_session: Some("conv-a".into()),
        // 마커보다 **오래된** 일지 — resume 로 세그먼트가 새로 열린 경우.
        // 전역 mtime 근사(4순위)라면 놓쳤을 자리다.
        modified_at: 50,
        ..Default::default()
    }];
    assert_eq!(
        judge(&input),
        Verdict::Clear(Clear::Recorded(RecordBasis::AgentSession))
    );
}

#[test]
fn rung_two_joins_through_agent_sessions_membership() {
    let mut input = lone_session_with_changes();
    input.workday_sessions = vec![WorkdaySession {
        id: "20260905-001".into(),
        agent_sessions: vec!["conv-a".into()],
        started_at: 0,
        ended_at: None,
    }];
    input.journals = vec![JournalRecord {
        workday_session_id: Some("20260905-001".into()),
        modified_at: 50,
        ..Default::default()
    }];
    assert_eq!(
        judge(&input),
        Verdict::Clear(Clear::Recorded(RecordBasis::AgentSessions))
    );
}

/// 참여자 등록이 없어도 **세그먼트 시각을 품는** 작업 세션은 알 수 있다.
#[test]
fn rung_three_falls_back_to_the_session_window() {
    let mut input = lone_session_with_changes();
    input.workday_sessions = vec![WorkdaySession {
        id: "20260905-001".into(),
        agent_sessions: Vec::new(), // 워처가 우리 훅을 못 봤다
        started_at: 90,
        ended_at: Some(300),
    }];
    input.journals = vec![JournalRecord {
        workday_session_id: Some("20260905-001".into()),
        modified_at: 50,
        ..Default::default()
    }];
    assert_eq!(
        judge(&input),
        Verdict::Clear(Clear::Recorded(RecordBasis::SessionsJson))
    );
}

/// 세그먼트 시각을 품지 **않는** 세션의 일지는 우리를 면죄하지 않는다.
#[test]
fn a_journal_from_another_session_window_does_not_clear_us() {
    let mut input = lone_session_with_changes();
    input.workday_sessions = vec![WorkdaySession {
        id: "20260905-001".into(),
        agent_sessions: Vec::new(),
        started_at: 0,
        ended_at: Some(50), // 우리 세그먼트(100) 전에 끝났다
    }];
    input.journals = vec![JournalRecord {
        workday_session_id: Some("20260905-001".into()),
        modified_at: 40,
        ..Default::default()
    }];
    assert!(matches!(judge(&input), Verdict::Objection(_)));
}

#[test]
fn rung_four_is_the_old_global_mtime_approximation() {
    let mut input = lone_session_with_changes();
    input.journals = vec![journal(150)];
    assert_eq!(
        judge(&input),
        Verdict::Clear(Clear::Recorded(RecordBasis::MarkerMtime))
    );
}

// ─── 판정 불가 ≠ 미기록 ─────────────────────────────────────────────────────

/// **골든 케이스**. 살아 있는 옆 대화가 있으면 mtime 은 누가 고쳤는지 말하지
/// 못한다 — 아무도 붙잡지 않는다.
#[test]
fn a_live_peer_makes_change_attribution_undecidable() {
    let mut input = lone_session_with_changes();
    input.live_peers = vec!["conv-b".into()];
    assert_eq!(
        judge(&input),
        Verdict::Undecided(Undecided::LivePeers { peers: 1 })
    );
}

/// 그 상황에서도 **1순위 근거가 있으면** 정확히 면죄된다 — 판정 불가가
/// 병렬 세션의 기본값이 되지 않게 하는 것이 사다리의 값어치다.
#[test]
fn a_live_peer_does_not_hide_a_positive_record() {
    let mut input = lone_session_with_changes();
    input.live_peers = vec!["conv-b".into()];
    input.journals = vec![JournalRecord {
        agent_session: Some("conv-a".into()),
        modified_at: 150,
        ..Default::default()
    }];
    assert_eq!(
        judge(&input),
        Verdict::Clear(Clear::Recorded(RecordBasis::AgentSession))
    );
}

/// 옆 대화가 살아 있을 때 **전역 mtime(4순위)은 쓰지 않는다.** 옆 대화의
/// 일지로 우리가 "기록했다"가 되면 원장이 거짓을 남긴다.
#[test]
fn a_peers_journal_does_not_launder_us_into_recorded() {
    let mut input = lone_session_with_changes();
    input.live_peers = vec!["conv-b".into()];
    input.journals = vec![journal(150)];
    assert_eq!(
        judge(&input),
        Verdict::Undecided(Undecided::LivePeers { peers: 1 })
    );
}

#[test]
fn without_a_segment_marker_nothing_can_be_said() {
    let mut input = lone_session_with_changes();
    input.segment_started_at = None;
    assert_eq!(
        judge(&input),
        Verdict::Undecided(Undecided::NoSegmentMarker)
    );
}

#[test]
fn an_unreadable_working_tree_is_undecidable_not_a_violation() {
    let mut input = lone_session_with_changes();
    input.working_tree_readable = false;
    input.changes.clear();
    assert_eq!(judge(&input), Verdict::Undecided(Undecided::NoWorkingTree));
}

/// 원장에 적히는 낱말이 셋을 **구별**한다 — 이 구별이 없어서 옛 원장의 55%가
/// 사후 재판정 불가가 됐다.
#[test]
fn the_ledger_word_separates_missing_from_undecided() {
    assert_eq!(judge(&lone_session_with_changes()).ledger_word(), "missing");
    let mut peers = lone_session_with_changes();
    peers.live_peers = vec!["conv-b".into()];
    assert_eq!(judge(&peers).ledger_word(), "undecided");
    let mut clean = lone_session_with_changes();
    clean.changes.clear();
    assert_eq!(judge(&clean).ledger_word(), "recorded");
}

#[test]
fn exit_codes_are_the_shell_contract() {
    assert_eq!(
        judge(&lone_session_with_changes()).exit_code(),
        EXIT_OBJECTION
    );
    let mut peers = lone_session_with_changes();
    peers.live_peers = vec!["conv-b".into()];
    assert_eq!(judge(&peers).exit_code(), EXIT_UNDECIDED);
    let mut clean = lone_session_with_changes();
    clean.changes.clear();
    assert_eq!(judge(&clean).exit_code(), 0);
}

// ─── 수집 (IO) — 살아 있음의 판정만 여기서 시험한다 ─────────────────────────

#[test]
fn a_peer_is_live_only_with_a_fresh_heartbeat() {
    let dir = tempfile::tempdir().unwrap();
    let hooks = dir.path();

    // 마커만 있는 대화 = 크래시 잔여. 용의자가 아니다.
    std::fs::write(hooks.join(".session-start-dead"), "").unwrap();
    // 마커 + 최근 생존 = 용의자.
    std::fs::write(hooks.join(".session-start-alive"), "").unwrap();
    std::fs::write(hooks.join(".session-live-alive"), "").unwrap();
    // 자기 자신은 세지 않는다.
    std::fs::write(hooks.join(".session-start-me"), "").unwrap();
    std::fs::write(hooks.join(".session-live-me"), "").unwrap();

    // 방금 만든 파일이라 mtime 은 실제 현재 시각 — `now` 를 그 근처로 잡는다.
    let real_now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    assert_eq!(
        super::collect::live_peers(hooks, "me", real_now),
        vec!["alive".to_string()]
    );
    // 창 밖으로 밀어내면 아무도 살아 있지 않다 (크래시 잔여와 같은 취급).
    assert!(
        super::collect::live_peers(hooks, "me", real_now + PEER_LIVE_WINDOW_SECS + 60).is_empty()
    );
}
