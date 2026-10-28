use super::*;

fn reg_with(windows: &[(&str, Option<u32>)]) -> Registry {
    let mut reg = Registry::default();
    for (label, project) in windows {
        reg.register(label, *project);
    }
    reg
}

#[test]
fn labels_distinguish_app_windows() {
    assert!(is_app_window("main"));
    assert!(is_app_window("win-1"));
    assert!(is_app_window("win-42"));
    assert!(!is_app_window("tray"));
    assert!(!is_app_window("win-"));
    assert!(!is_app_window("win-abc"));
    assert!(!is_app_window("window-1"));
}

#[test]
fn locate_project_finds_the_owning_window() {
    let reg = reg_with(&[("main", None), ("win-1", Some(7))]);
    assert_eq!(reg.locate_project(7).as_deref(), Some("win-1"));
    assert_eq!(reg.locate_project(8), None);
}

#[test]
fn start_windows_are_not_open_projects() {
    let reg = reg_with(&[("main", None), ("win-1", Some(9)), ("win-2", Some(3))]);
    assert_eq!(reg.all_open_projects(), vec![3, 9]);
}

/// 시작 창에서 프로젝트를 고르면 **그 창이** 그 프로젝트가 된다.
#[test]
fn a_start_window_adopts_the_project_in_place() {
    let mut reg = reg_with(&[("main", None)]);
    assert_eq!(reg.adopt("main", 7), Ok(Adopt::Adopted));
    assert_eq!(reg.project_of("main"), Some(Some(7)));
}

/// I1 — 이미 다른 창에 열려 있으면 이 창은 그대로 두고 그 창을 가리킨다.
#[test]
fn adopting_a_project_open_elsewhere_points_at_that_window() {
    let mut reg = reg_with(&[("main", None), ("win-1", Some(7))]);
    assert_eq!(reg.adopt("main", 7), Ok(Adopt::ElsewhereIn("win-1".into())));
    assert_eq!(reg.project_of("main"), Some(None), "시작 창은 그대로다");
}

#[test]
fn adopting_its_own_project_again_is_a_no_op() {
    let mut reg = reg_with(&[("win-1", Some(7))]);
    assert_eq!(reg.adopt("win-1", 7), Ok(Adopt::Already));
}

/// I3 — 프로젝트 창은 다른 프로젝트로 바뀌지 않는다. 모르는 창도 거절한다.
#[test]
fn a_project_window_or_an_unknown_window_cannot_adopt() {
    let mut reg = reg_with(&[("win-1", Some(7))]);
    assert_eq!(reg.adopt("win-1", 8), Err(()));
    assert_eq!(reg.adopt("win-9", 8), Err(()));
    assert_eq!(reg.project_of("win-1"), Some(Some(7)));
}

#[test]
fn removing_a_window_reports_how_many_remain_and_forgets_focus() {
    let mut reg = reg_with(&[("main", None), ("win-1", Some(7))]);
    reg.note_focus("win-1");
    assert_eq!(reg.remove("win-1"), 1);
    assert_eq!(reg.locate_project(7), None);
    assert_eq!(reg.preferred_window().as_deref(), Some("main"));
    assert_eq!(reg.remove("main"), 0);
}

#[test]
fn preferred_window_follows_focus() {
    let mut reg = reg_with(&[("main", None), ("win-1", Some(3))]);
    reg.note_focus("main");
    assert_eq!(reg.preferred_window().as_deref(), Some("main"));
    reg.note_focus("win-1");
    assert_eq!(reg.preferred_window().as_deref(), Some("win-1"));
    // 모르는 창의 포커스는 기억하지 않는다.
    reg.note_focus("win-9");
    assert_eq!(reg.preferred_window().as_deref(), Some("win-1"));
}

#[test]
fn reserve_issues_monotonic_labels() {
    let mut reg = Registry::default();
    assert_eq!(reg.reserve(None), "win-1");
    assert_eq!(reg.reserve(Some(4)), "win-2");
    assert_eq!(reg.project_of("win-2"), Some(Some(4)));
}

#[test]
fn summary_shows_which_window_holds_which_project() {
    let reg = reg_with(&[("win-1", Some(7)), ("main", None)]);
    assert_eq!(reg.summary(), "main:start win-1:p7");
    assert_eq!(Registry::default().summary(), "");
}

#[test]
fn plain_window_url_has_only_label() {
    assert_eq!(window_url("win-3", None), "index.html?win=win-3");
}

#[test]
fn deeplink_url_carries_view_and_entry() {
    let nav = crate::tray::TrayNavigate {
        view: "journal".into(),
        project_id: Some(7),
        entry_path: Some("journal/20260101/Bugs/0900_bug_x.md".into()),
    };
    assert_eq!(
        window_url("win-1", Some(&nav)),
        "index.html?win=win-1&view=journal&entry=journal/20260101/Bugs/0900_bug_x.md"
    );
}

#[test]
fn query_encoding_escapes_separators_and_utf8() {
    assert_eq!(encode_query_value("a&b#c d"), "a%26b%23c%20d");
    assert_eq!(encode_query_value("일"), "%EC%9D%BC");
}

// ─── 세션 복원 (업데이트 재시작) ─────────────────────────────────────

fn known(ids: &[u32]) -> HashSet<u32> {
    ids.iter().copied().collect()
}

fn win(label: &str, project: Option<u32>) -> SessionWindow {
    SessionWindow {
        label: label.into(),
        project,
        ..SessionWindow::default()
    }
}

#[test]
fn a_snapshot_records_each_window_and_its_project() {
    let mut reg = reg_with(&[("win-1", Some(9)), ("main", Some(7))]);
    reg.note_focus("win-1");
    let session = reg.session();
    // `main` 이 맨 앞 — 복원에서 첫 창을 이어받는 자리다.
    assert_eq!(
        session.windows,
        vec![win("main", Some(7)), win("win-1", Some(9))]
    );
    assert_eq!(session.focused.as_deref(), Some("win-1"));
}

#[test]
fn a_snapshot_survives_a_json_round_trip() {
    let session = reg_with(&[("main", None), ("win-2", Some(7))]).session();
    let json = serde_json::to_string(&session).unwrap();
    assert_eq!(serde_json::from_str::<Session>(&json).unwrap(), session);
}

/// 3.x 가 업데이트 직전에 저장한 **탭 모양** 스냅숏도 읽는다 — 그 창의 활성 탭이
/// 프로젝트였으면 그것, 시작 탭이었으면 첫 프로젝트 탭이 그 창의 프로젝트가 된다.
#[test]
fn a_3x_tab_snapshot_restores_the_active_project_per_window() {
    let raw = r#"{"windows":[
        {"label":"main","tabs":[null,7,8],"active":2},
        {"label":"win-1","tabs":[null,9],"active":0},
        {"label":"win-2","tabs":[null],"active":0}
    ],"focused":"win-1"}"#;
    let stored: Session = serde_json::from_str(raw).unwrap();
    let out = sanitize_session(&stored, &known(&[7, 8, 9]));
    assert_eq!(
        out.windows,
        vec![
            win("main", Some(8)),
            win("win-1", Some(9)),
            win("win-2", None)
        ]
    );
    assert_eq!(out.focused.as_deref(), Some("win-1"));
}

/// 라벨을 그대로 되살려야 `tauri-plugin-window-state` 가 기억한 자리가 따라온다.
/// 그리고 그 라벨이 뒤에 또 발급되면 창 둘이 겹친다.
#[test]
fn restoring_keeps_the_label_and_pushes_the_next_one_past_it() {
    let mut reg = Registry::default();
    reg.restore_window("win-3", Some(4));
    assert_eq!(reg.project_of("win-3"), Some(Some(4)));
    assert_eq!(reg.reserve(None), "win-4");
}

/// 그 사이 지워진 프로젝트의 창은 시작 창으로 뜬다 — `#12` 짜리 유령 창이 아니다.
#[test]
fn a_deleted_project_restores_as_a_start_window() {
    let session = Session {
        windows: vec![win("main", Some(99))],
        focused: Some("main".into()),
    };
    let out = sanitize_session(&session, &known(&[7]));
    assert_eq!(out.windows, vec![win("main", None)]);
}

/// I1(프로젝트당 창 하나)은 복원에도 그대로 걸린다.
#[test]
fn a_project_is_restored_into_exactly_one_window() {
    let session = Session {
        windows: vec![win("main", Some(7)), win("win-1", Some(7))],
        focused: Some("win-1".into()),
    };
    let out = sanitize_session(&session, &known(&[7]));
    assert_eq!(out.windows, vec![win("main", Some(7))]);
    // 사라진 창을 포커스하라고 남겨 두면 아무 창도 앞으로 오지 않는다.
    assert_eq!(out.focused, None);
}

// ─── 지운 프로젝트의 창 (2026-09-17 06:11 로그) ─────────────────────────────

/// 지운 프로젝트의 창은 **어느 창이든** 찾아 시작 창으로 되돌린다.
#[test]
fn releasing_a_deleted_project_turns_its_window_back_into_a_start_window() {
    let mut reg = reg_with(&[("main", Some(7)), ("win-1", Some(22))]);
    assert_eq!(reg.release_project(22).as_deref(), Some("win-1"));
    assert_eq!(reg.project_of("win-1"), Some(None));
    assert_eq!(reg.all_open_projects(), vec![7]);
    // 열려 있지 않은 프로젝트를 지우는 것이 정상 경로다 — 아무것도 안 건드린다.
    assert_eq!(reg.release_project(999), None);
}

/// 배선 가드 — 위 판정이 **불리는지**는 소스로만 확인할 수 있다.
/// 순서까지 본다: 창을 되돌리는 것이 `db.delete_project` **앞**이어야 한다.
#[test]
fn delete_project_releases_the_window_before_dropping_the_row() {
    let src = include_str!("../project.rs");
    let close = src
        .find("close_project_surfaces")
        .expect("delete_project 가 창을 되돌리지 않는다");
    let drop_row = src
        .find("db.delete_project(project_id)")
        .expect("delete_project 가 행을 지우지 않는다");
    assert!(close < drop_row, "행을 지우기 전에 창을 되돌려야 한다");
}

/// 같은 규율 — 지운 프로젝트를 여는 **두** 경로 모두 레지스트리를 건드리기 전에
/// 거절한다. 한쪽만 막으면 다른 쪽으로 유령 창이 들어온다.
#[test]
fn opening_a_project_checks_it_exists_first() {
    let src = include_str!("projects.rs");
    for (entry, registry_touch) in [
        (
            "pub async fn open_project_window_with_nav",
            "locate_project",
        ),
        ("pub async fn set_window_project", ".adopt("),
    ] {
        let body = src.split(entry).nth(1).expect(entry);
        let guard = body
            .find("db.get_project(project_id)")
            .unwrap_or_else(|| panic!("{entry} 가 지운 프로젝트를 거르지 않는다"));
        let touches = body
            .find(registry_touch)
            .unwrap_or_else(|| panic!("{entry} 본문이 바뀌었다 — 기준점을 다시 잡을 것"));
        assert!(guard < touches, "{entry}: 검사가 먼저다");
    }
}
