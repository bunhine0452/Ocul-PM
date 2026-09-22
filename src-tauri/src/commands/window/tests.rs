use super::*;

fn reg_with(windows: &[(&str, &[Option<u32>])]) -> Registry {
    let mut reg = Registry::default();
    for (label, projects) in windows {
        for (i, p) in projects.iter().enumerate() {
            if i == 0 {
                reg.register(label, *p);
            } else {
                reg.append(label, *p);
            }
        }
        // 첫 탭을 활성으로 되돌려 테스트가 예측 가능하게.
        if let Some(st) = reg.windows.get_mut(*label) {
            st.active = st.order.first().map(|t| t.id);
        }
    }
    reg
}

fn ids(reg: &Registry, label: &str) -> Vec<u32> {
    reg.get(label).unwrap().order.iter().map(|t| t.id).collect()
}

fn projects(reg: &Registry, label: &str) -> Vec<Option<u32>> {
    reg.get(label)
        .unwrap()
        .order
        .iter()
        .map(|t| t.project_id)
        .collect()
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

/// 접두사가 다른 프로젝트를 잡아먹지 않는다 — `p1-` 이 `p12-…` 를 죽이면
/// 탭 하나를 닫을 때 다른 탭의 셸이 함께 죽는다.
#[test]
fn pty_prefix_does_not_swallow_longer_ids() {
    let p1 = pty_prefix_for(1);
    assert!("p1-a1b2c3d4".starts_with(&p1));
    assert!(!"p12-a1b2c3d4".starts_with(&p1));
}

/// 터미널 창은 탭을 물지 않는다 — 탭 레지스트리·⌘W·"마지막 창" 판정이
/// 이 라벨을 앱 창으로 오해하면 남의 탭을 닫거나 앱을 종료시킨다.
#[test]
fn terminal_windows_are_not_app_windows() {
    assert!(!is_app_window("term-3"));
    assert_eq!(terminal_window_label(3), "term-3");
    assert_eq!(terminal_window_project("term-3"), Some(3));
    assert_eq!(terminal_window_project("win-3"), None);
    assert_eq!(terminal_window_project("term-"), None);
    assert_eq!(terminal_window_project("term-abc"), None);
}

/// PTY 정리의 유일한 판정 — 탭이든 터미널 창이든 **하나라도 남아 있으면**
/// 셸을 죽이지 않는다. 탭만 보던 시절에는, 터미널을 창으로 떼어낸 뒤
/// 프로젝트 탭을 닫는 순간 분리 창 안의 셸이 전부 사라졌다.
#[test]
fn a_detached_terminal_window_keeps_the_project_in_use() {
    let mut reg = reg_with(&[("main", &[Some(3)])]);
    let tab = ids(&reg, "main")[0];

    assert!(reg.project_in_use(3), "탭이 있으니 쓰는 중");
    reg.terminal_windows.insert(3);
    reg.remove_tab(tab);
    assert!(reg.project_in_use(3), "탭은 닫혔지만 터미널 창이 남았다");

    reg.terminal_windows.remove(&3);
    assert!(!reg.project_in_use(3), "둘 다 없으면 그때 정리한다");
}

#[test]
fn terminal_window_projects_are_sorted() {
    let mut reg = Registry::default();
    reg.terminal_windows.insert(9);
    reg.terminal_windows.insert(2);
    assert_eq!(reg.terminal_window_projects(), vec![2, 9]);
}

#[test]
fn tab_ids_are_unique_across_windows() {
    let reg = reg_with(&[("main", &[None, Some(3)]), ("win-1", &[Some(7)])]);
    let mut all = ids(&reg, "main");
    all.extend(ids(&reg, "win-1"));
    let mut sorted = all.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(
        sorted.len(),
        all.len(),
        "탭 id 는 창을 가로질러 유일해야 한다"
    );
}

#[test]
fn locate_project_finds_the_owning_window_and_tab() {
    let reg = reg_with(&[("main", &[None, Some(3)]), ("win-1", &[Some(9)])]);
    let (label, tab_id) = reg.locate_project(3).unwrap();
    assert_eq!(label, "main");
    assert_eq!(tab_id, ids(&reg, "main")[1]);
    assert_eq!(reg.locate_project(11), None);
}

/// 시작 탭은 프로젝트가 없으므로 "열림" 목록에 끼지 않는다.
#[test]
fn start_tabs_are_not_open_projects() {
    let reg = reg_with(&[("main", &[None, Some(9), None]), ("win-1", &[Some(3)])]);
    assert_eq!(reg.all_open_projects(), vec![3, 9]);
}

/// 시작 탭에서 프로젝트를 고르면 **자리를 지킨 채** 승격한다.
#[test]
fn assign_project_promotes_in_place() {
    let mut reg = reg_with(&[("main", &[Some(3), None, Some(9)])]);
    let start = ids(&reg, "main")[1];
    assert_eq!(reg.assign_project(start, 5).as_deref(), Some("main"));
    assert_eq!(projects(&reg, "main"), vec![Some(3), Some(5), Some(9)]);
    assert_eq!(reg.get("main").unwrap().active, Some(start));
    assert_eq!(ids(&reg, "main")[1], start, "탭 id 는 유지된다");
}

#[test]
fn assign_project_on_unknown_tab_is_noop() {
    let mut reg = reg_with(&[("main", &[None])]);
    assert_eq!(reg.assign_project(9999, 5), None);
    assert_eq!(projects(&reg, "main"), vec![None]);
}

/// 활성 탭을 닫으면 오른쪽 이웃으로 넘어간다 (Chrome 과 같다).
#[test]
fn closing_active_tab_moves_to_right_neighbour() {
    let mut reg = reg_with(&[("main", &[Some(3), Some(7), Some(9)])]);
    let tabs = ids(&reg, "main");
    reg.activate(tabs[1]);
    let (label, project, empty) = reg.remove_tab(tabs[1]).unwrap();
    assert_eq!((label.as_str(), project, empty), ("main", Some(7), false));
    assert_eq!(reg.get("main").unwrap().active, Some(tabs[2]));
}

/// 오른쪽이 없으면 왼쪽으로.
#[test]
fn closing_last_active_tab_falls_back_left() {
    let mut reg = reg_with(&[("main", &[Some(3), Some(7)])]);
    let tabs = ids(&reg, "main");
    reg.activate(tabs[1]);
    reg.remove_tab(tabs[1]);
    assert_eq!(reg.get("main").unwrap().active, Some(tabs[0]));
}

#[test]
fn removing_the_only_tab_drops_the_window() {
    let mut reg = reg_with(&[("main", &[Some(3)])]);
    let tab = ids(&reg, "main")[0];
    assert_eq!(reg.remove_tab(tab), Some(("main".into(), Some(3), true)));
    assert!(reg.get("main").is_none());
    assert!(reg.all_open_projects().is_empty());
}

/// 시작 탭을 닫아도 정리할 프로젝트가 없다 (PTY·watcher 를 건드리면 안 된다).
#[test]
fn closing_a_start_tab_reports_no_project() {
    let mut reg = reg_with(&[("main", &[None, Some(3)])]);
    let start = ids(&reg, "main")[0];
    let (_, project, empty) = reg.remove_tab(start).unwrap();
    assert_eq!(project, None);
    assert!(!empty);
}

/// 낡은 목록이 와도 탭이 사라지거나 남의 탭이 끼어들지 않는다.
#[test]
fn reorder_filters_unknown_and_keeps_missing() {
    let mut reg = reg_with(&[("main", &[Some(3), Some(7), Some(9)])]);
    let t = ids(&reg, "main");
    assert!(reg.reorder("main", &[t[2], t[0], 9999]));
    assert_eq!(ids(&reg, "main"), vec![t[2], t[0], t[1]]);
}

#[test]
fn reorder_reports_no_change_when_identical() {
    let mut reg = reg_with(&[("main", &[Some(3), Some(7)])]);
    let t = ids(&reg, "main");
    assert!(!reg.reorder("main", &t));
    assert!(!reg.reorder("win-nope", &[1]));
}

/// 새 탭은 마지막으로 포커스된 창에 붙는다.
#[test]
fn move_tab_inserts_at_the_requested_index_of_the_target_window() {
    let mut reg = reg_with(&[("win-1", &[Some(1), Some(2)]), ("win-2", &[Some(3)])]);
    let moving = reg.get("win-1").unwrap().order[1].id;
    let out = reg.move_tab(moving, "win-2", 0);
    assert_eq!(out, Some(("win-1".into(), false)));
    assert_eq!(projects(&reg, "win-2"), vec![Some(2), Some(3)]);
    assert_eq!(projects(&reg, "win-1"), vec![Some(1)]);
    // 옮겨간 탭이 대상 창의 활성 탭이 된다 — 사용자가 방금 손에 들고 있었다.
    assert_eq!(reg.get("win-2").unwrap().active, Some(moving));
}

#[test]
fn moving_the_last_tab_reports_the_source_window_as_emptied() {
    let mut reg = reg_with(&[("win-1", &[Some(1)]), ("win-2", &[Some(2)])]);
    let moving = reg.get("win-1").unwrap().order[0].id;
    assert_eq!(
        reg.move_tab(moving, "win-2", 9),
        Some(("win-1".into(), true))
    );
    assert!(reg.get("win-1").is_none());
    assert_eq!(projects(&reg, "win-2"), vec![Some(2), Some(1)]);
    // 창은 비었어도 프로젝트는 **여전히 열려 있다** — 탭이 옮겨갔을 뿐이다.
    assert_eq!(reg.all_open_projects(), vec![1, 2]);
}

/// 진단 요약은 **양쪽 값**을 담아야 쓸모가 있다 — 시도한 탭 id 와 실제 보유분.
#[test]
fn summary_shows_which_window_holds_which_tab() {
    let reg = reg_with(&[("main", &[None, Some(7)]), ("win-1", &[Some(3)])]);
    // 라벨 정렬 — 로그를 여러 건 나란히 놓고 읽을 때 순서가 흔들리면 안 된다.
    assert_eq!(reg.summary(), "main:[1(start),2(p=7)] win-1:[3(p=3)]");
}

#[test]
fn summary_of_an_empty_registry_is_empty() {
    assert_eq!(Registry::default().summary(), "");
}

#[test]
fn ghost_is_an_app_window_the_registry_forgot() {
    let reg = reg_with(&[("main", &[None])]);
    // 레지스트리가 모르는 앱 창 — 유령이다.
    assert_eq!(ghost_window(&reg, Some("win-1")), Some("win-1".into()));
    // 알고 있는 창은 아니다 (이미 닫힌 탭을 다시 닫는 정상 경로가 여기로 온다).
    assert_eq!(ghost_window(&reg, Some("main")), None);
    // 탭 레지스트리 밖에 사는 창들은 유령 판정 대상이 아니다.
    assert_eq!(ghost_window(&reg, Some("term-3")), None);
    assert_eq!(ghost_window(&reg, Some("tray")), None);
    // 호출한 창을 모르면(내부 경로) 판정하지 않는다.
    assert_eq!(ghost_window(&reg, None), None);
}

/// 떼어낸 창의 탭을 닫으면 그 창이 닫힌다 — 떼어내기와 닫기가 이어지는 지점.
///
/// 두 단계가 각각 맞아도 **이어 붙였을 때** 어긋날 수 있는 자리다: 떼어내기는
/// `remove_tab` + `reserve` 로 창을 새로 세우고, 닫기는 그 창이 비었는지를
/// `remove_tab` 의 셋째 값으로 판정한다. 가운데의 `reserve` 가 탭을 **하나만**
/// 등록한다는 사실에 기대고 있으므로, 거기에 시작 탭이라도 하나 더 붙는 날
/// 조용히 "닫아도 창이 남는" 증상이 된다.
#[test]
fn closing_the_tab_of_a_detached_window_empties_that_window() {
    let mut reg = reg_with(&[("main", &[None, Some(1)])]);
    let moving = reg.get("main").unwrap().order[1].id;
    // detach_tab 이 하는 일: remove_tab → create_window(reserve/register)
    let removed = reg.remove_tab(moving);
    assert_eq!(removed, Some(("main".into(), Some(1), false)));
    let label = reg.reserve(Some(1));
    assert_eq!(label, "win-1");
    let born = reg.get("win-1").unwrap().order[0].id;
    // 떼어낸 창의 X — close_tab 이 보는 값
    let out = reg.remove_tab(born);
    assert_eq!(
        out,
        Some(("win-1".into(), Some(1), true)),
        "emptied 가 true 여야 창이 닫힌다"
    );
    assert!(reg.get("win-1").is_none());
    // handle_window_closed 가 보는 값
    assert_eq!(
        reg.windows.len(),
        1,
        "main 이 남아 있어야 prevent_close 가 안 걸린다"
    );
}

#[test]
fn move_tab_into_its_own_window_is_a_reorder() {
    let mut reg = reg_with(&[("win-1", &[Some(1), Some(2), Some(3)])]);
    let moving = reg.get("win-1").unwrap().order[2].id;
    assert_eq!(
        reg.move_tab(moving, "win-1", 0),
        Some(("win-1".into(), false))
    );
    assert_eq!(projects(&reg, "win-1"), vec![Some(3), Some(1), Some(2)]);
}

#[test]
fn move_tab_to_a_missing_window_leaves_everything_alone() {
    let mut reg = reg_with(&[("win-1", &[Some(1), Some(2)])]);
    let moving = reg.get("win-1").unwrap().order[0].id;
    assert_eq!(reg.move_tab(moving, "win-9", 0), None);
    assert_eq!(projects(&reg, "win-1"), vec![Some(1), Some(2)]);
}

#[test]
fn hovering_a_new_window_reports_the_one_being_left() {
    let mut reg = Registry::default();
    assert_eq!(reg.hover("win-1"), None);
    // 같은 창을 계속 겨누면 떠난 창은 없다 (캐럿을 지우면 안 된다).
    assert_eq!(reg.hover("win-1"), None);
    reg.note_drop_index("win-1", 2);
    assert_eq!(reg.hover("win-2"), Some("win-1".into()));
    // 대상이 바뀌면 인덱스는 버려진다 — 남의 창에서 잰 값이다.
    assert_eq!(reg.take_drop_hint(), Some(("win-2".into(), None)));
}

#[test]
fn a_late_index_report_from_a_stale_window_is_ignored() {
    let mut reg = Registry::default();
    reg.hover("win-2");
    reg.note_drop_index("win-1", 5);
    assert_eq!(reg.take_drop_hint(), Some(("win-2".into(), None)));
}

/// 겉모습(`TabPreview`)은 스트립에 **처음 들어선** 프레임에만 싣는다 —
/// 그 판정이 `hovering()` 이다. `hover()` 의 반환값만 보면 첫 진입과 제자리
/// 유지가 둘 다 `None` 이라 구분되지 않고, 결과는 둘 중 하나다: 매 프레임
/// DB 를 때리거나, 자리표시자가 영영 이름을 못 받거나.
/// 떼어낸 창은 **잡았던 자리가 커서 밑에** 오도록 놓인다. 예전 상수
/// 오프셋(-120, -16)은 줌이 걸리면 그만큼 틀어졌다.
#[test]
fn detached_window_lands_under_the_hand() {
    // 배율 2 인 화면: 물리 (800, 200) = 논리 (400, 100).
    // 새 창 안 (86, 22) 지점이 그 자리에 와야 하므로 원점은 (314, 78).
    assert_eq!(
        detached_origin((800.0, 200.0), 2.0, (86.0, 22.0)),
        (314.0, 78.0)
    );
    // 배율 1 은 그대로 뺀다.
    assert_eq!(
        detached_origin((500.0, 300.0), 1.0, (86.0, 6.0)),
        (414.0, 294.0)
    );
    // 배율이 0 으로 와도 창을 화면 밖으로 던지지 않는다.
    assert_eq!(
        detached_origin((500.0, 300.0), 0.0, (0.0, 0.0)),
        (500.0, 300.0)
    );
}

#[test]
fn hovering_tells_first_entry_from_staying() {
    let mut reg = Registry::default();
    assert_eq!(reg.hovering(), None);
    reg.hover("win-1");
    assert_eq!(reg.hovering(), Some("win-1"));
    reg.hover("win-1");
    assert_eq!(reg.hovering(), Some("win-1"));
    reg.hover("win-2");
    assert_eq!(reg.hovering(), Some("win-2"));
    reg.unhover();
    assert_eq!(reg.hovering(), None);
}

#[test]
fn unhover_clears_the_hint_once() {
    let mut reg = Registry::default();
    reg.hover("win-1");
    assert_eq!(reg.unhover(), Some("win-1".into()));
    assert_eq!(reg.unhover(), None);
}

#[test]
fn strip_band_accepts_above_the_window_but_never_below_the_strip() {
    // 스트립 안.
    assert!(hits_tab_strip(10.0, 4.0, 900.0, 38.0));
    // 창 테두리 위로 살짝 — 받아 준다.
    assert!(hits_tab_strip(10.0, -6.0, 900.0, 38.0));
    // 너무 위 · 스트립 아래(콘텐츠) · 창 가로 밖.
    assert!(!hits_tab_strip(10.0, -40.0, 900.0, 38.0));
    assert!(!hits_tab_strip(10.0, 60.0, 900.0, 38.0));
    assert!(!hits_tab_strip(-2.0, 10.0, 900.0, 38.0));
    assert!(!hits_tab_strip(950.0, 10.0, 900.0, 38.0));
}

#[test]
fn preferred_window_follows_focus() {
    let mut reg = reg_with(&[("main", &[Some(3)]), ("win-1", &[Some(7)])]);
    reg.note_focus("win-1");
    assert_eq!(reg.preferred_window().as_deref(), Some("win-1"));
    // 그 창이 사라지면 남은 창 중 하나로 폴백한다 (유령 라벨 반환 금지).
    reg.windows.remove("win-1");
    assert_eq!(reg.preferred_window().as_deref(), Some("main"));
    reg.windows.remove("main");
    assert_eq!(reg.preferred_window(), None);
}

#[test]
fn reserve_issues_monotonic_labels() {
    let mut reg = Registry::default();
    assert_eq!(reg.reserve(Some(3)), "win-1");
    assert_eq!(reg.reserve(None), "win-2");
    assert_eq!(reg.locate_project(3).unwrap().0, "win-1");
}

#[test]
fn plain_window_url_has_only_label() {
    assert_eq!(window_url("win-2", None, false), "index.html?win=win-2");
}

/// 끌려다니는 창은 URL 로 자기 처지를 안다 — 프런트가 그걸 보고 화면
/// 마운트를 붙잡는다. 이 파라미터가 빠지면 드래그 몇백 ms 마다 프로젝트
/// init·워처·자동색인이 통째로 돌고, 합쳐 버리면 전부 낭비가 된다.
#[test]
fn tearoff_url_tells_the_window_it_is_being_carried() {
    assert_eq!(
        window_url("win-3", None, true),
        "index.html?win=win-3&tearoff=1"
    );
}

/// 떼어낸 창의 탭은 **새 id** 를 받는다 — 이 전제가 `TearOff.tab_id` 의
/// 존재 이유다. 프런트가 들고 있던 옛 id 로 놓기·무르기를 부르면 그 탭은
/// 어디에도 없어 조용히 아무 일도 일어나지 않는다 (가장 고약한 실패 모양:
/// 창은 떴는데 놓아도 합쳐지지 않고, Escape 도 안 먹는다).
#[test]
fn a_torn_off_window_mints_a_new_tab_id() {
    let mut reg = reg_with(&[("win-1", &[Some(1), Some(2)])]);
    let dragged = ids(&reg, "win-1")[1];
    let (_, project_id, _) = reg.remove_tab(dragged).unwrap();
    let label = reg.reserve(project_id);
    let fresh = ids(&reg, &label)[0];
    assert_ne!(fresh, dragged);
    assert_eq!(projects(&reg, &label), vec![Some(2)]);
    // 옛 id 는 이제 어디에도 없다.
    assert_eq!(reg.locate_tab(dragged), None);
}

#[test]
fn a_lone_tab_window_is_carried_whole_instead_of_respawned() {
    let mut reg = reg_with(&[("win-3", &[Some(2)])]);
    let only = ids(&reg, "win-3")[0];

    assert!(reg.carry_whole(only, (86.0, 20.0), (400.0, 120.0)));

    let tear = reg.tearing().unwrap();
    // 새 창을 만들지 않았다 — 들고 있는 것이 그 창 자신이다.
    assert_eq!(tear.label, "win-3");
    assert_eq!(tear.source, "win-3");
    assert_eq!(tear.tab_id, only);
    // 무를 때 되돌릴 **창 자리**를 기억한다 (탭 자리가 아니다).
    assert_eq!(tear.home, Some((400.0, 120.0)));
    // 창도 탭도 그대로다 — 아무것도 다시 마운트되지 않는다.
    assert_eq!(ids(&reg, "win-3"), vec![only]);
}

#[test]
fn carrying_whole_is_declined_when_the_window_has_siblings() {
    let mut reg = reg_with(&[("win-1", &[Some(1), Some(2)])]);
    let dragged = ids(&reg, "win-1")[1];
    // 형제가 있으면 탭만 빠져나가 새 창이 된다 — 창째로 들지 않는다.
    assert!(!reg.carry_whole(dragged, (86.0, 20.0), (0.0, 0.0)));
    assert!(reg.tearing().is_none());
    assert_eq!(ids(&reg, "win-1").len(), 2);
}

#[test]
fn carrying_whole_is_declined_for_an_unknown_tab() {
    let mut reg = reg_with(&[("win-1", &[Some(1)])]);
    assert!(!reg.carry_whole(9999, (0.0, 0.0), (0.0, 0.0)));
    assert!(reg.tearing().is_none());
}

/// 회귀 못 박기 — 떼어낸 창(탭 하나)이 드래그로 **되돌아온다**.
///
/// 2026-08-29 에 `attach_tab` 이 tear-off 로 합쳐지면서 마지막 탭이 거절돼
/// 돌아올 길이 사라졌다. 창째로 들면 그다음은 평범한 `move_tab` 이다.
#[test]
fn a_carried_lone_tab_window_merges_back_and_leaves_no_window_behind() {
    let mut reg = reg_with(&[("win-1", &[Some(1)]), ("win-3", &[Some(2)])]);
    let carried = ids(&reg, "win-3")[0];
    assert!(reg.carry_whole(carried, (86.0, 20.0), (400.0, 120.0)));

    let tear = reg.tearing().unwrap();
    let (source, emptied) = reg.move_tab(tear.tab_id, "win-1", 0).unwrap();

    assert_eq!(source, "win-3");
    // 비었다고 알려야 `commit_move` 가 그 창을 닫는다.
    assert!(emptied);
    assert!(reg.get("win-3").is_none());
    assert_eq!(projects(&reg, "win-1"), vec![Some(2), Some(1)]);
}

/// hide/show 는 **바뀔 때만** 부른다 — 매 틱 부르면 창이 깜빡인다.
#[test]
fn tear_hidden_reports_only_transitions() {
    let mut reg = Registry::default();
    // 들고 있는 창이 없으면 아무 말도 하지 않는다.
    assert_eq!(reg.set_tear_hidden(true), None);
    reg.tearing = Some(TearOff {
        label: "win-9".into(),
        tab_id: 7,
        anchor: (86.0, 20.0),
        source: "win-1".into(),
        index: 1,
        home: None,
        hidden: false,
    });
    assert_eq!(reg.set_tear_hidden(true), Some(true));
    assert_eq!(reg.set_tear_hidden(true), None);
    assert_eq!(reg.set_tear_hidden(false), Some(false));
    // 손을 놓으면 한 번만 꺼내진다.
    assert!(reg.take_tearing().is_some());
    assert!(reg.take_tearing().is_none());
}

#[test]
fn deeplink_url_carries_view_and_entry() {
    let nav = crate::tray::TrayNavigate {
        view: "journal".into(),
        project_id: Some(3),
        entry_path: Some("journal/20260812/Bugs/0603_bug_a b.md".into()),
    };
    assert_eq!(
        window_url("win-1", Some(&nav), false),
        "index.html?win=win-1&view=journal&entry=journal/20260812/Bugs/0603_bug_a%20b.md"
    );
}

/// `&` 가 그대로 새면 뒤 파라미터가 통째로 잘린다.
#[test]
fn query_encoding_escapes_separators_and_utf8() {
    assert_eq!(encode_query_value("a&b=c#d"), "a%26b%3Dc%23d");
    assert_eq!(encode_query_value("일지"), "%EC%9D%BC%EC%A7%80");
}

// ─── 세션 복원 (업데이트 재시작) ─────────────────────────────────────

fn known(ids: &[u32]) -> HashSet<u32> {
    ids.iter().copied().collect()
}

/// 스냅숏은 **인덱스**로 활성 탭을 적는다 — 다음 실행의 탭 id 는 새로
/// 발급되므로 id 를 실으면 아무것도 가리키지 못한다.
#[test]
fn a_snapshot_records_tab_order_and_the_active_index() {
    let mut reg = reg_with(&[("main", &[None, Some(7)]), ("win-1", &[Some(9)])]);
    let second = ids(&reg, "main")[1];
    reg.activate(second);

    let session = reg.session();
    assert_eq!(session.windows.len(), 2);
    // `main` 이 맨 앞 — 복원에서 첫 창을 이어받는 자리다.
    assert_eq!(session.windows[0].label, "main");
    assert_eq!(session.windows[0].tabs, vec![None, Some(7)]);
    assert_eq!(session.windows[0].active, 1);
    assert_eq!(session.windows[1].label, "win-1");
    assert_eq!(session.windows[1].tabs, vec![Some(9)]);
}

#[test]
fn a_snapshot_survives_a_json_round_trip() {
    let reg = reg_with(&[("main", &[None, Some(7)])]);
    let session = reg.session();
    let json = serde_json::to_string(&session).unwrap();
    assert_eq!(serde_json::from_str::<Session>(&json).unwrap(), session);
}

/// 라벨을 그대로 되살려야 `tauri-plugin-window-state` 가 기억한 자리가
/// 따라온다. 그리고 그 라벨이 뒤에 또 발급되면 창 둘이 겹친다.
#[test]
fn restoring_keeps_the_label_and_pushes_the_next_one_past_it() {
    let mut reg = Registry::default();
    reg.restore_window("win-3", &[Some(4), None], 1);

    assert_eq!(projects(&reg, "win-3"), vec![Some(4), None]);
    let st = reg.get("win-3").unwrap();
    assert_eq!(st.active, Some(st.order[1].id));
    assert_eq!(reg.reserve(None), "win-4");
}

/// 그 사이 지워진 프로젝트는 `#12` 짜리 유령 탭으로 되살아나면 안 된다.
#[test]
fn a_deleted_project_is_dropped_from_the_restore() {
    let session = Session {
        windows: vec![SessionWindow {
            label: "main".into(),
            tabs: vec![None, Some(7), Some(99)],
            active: 2,
        }],
        terminals: vec![7, 99],
        focused: Some("main".into()),
    };
    let out = sanitize_session(&session, &known(&[7]));
    assert_eq!(out.windows[0].tabs, vec![None, Some(7)]);
    // 활성이던 탭이 사라졌으면 첫 탭으로 — 빈 화면으로 뜨지 않게.
    assert_eq!(out.windows[0].active, 0);
    assert_eq!(out.terminals, vec![7]);
}

/// I1(프로젝트당 탭 하나, 전역 유일)은 복원에도 그대로 걸린다.
#[test]
fn a_project_is_restored_into_exactly_one_tab() {
    let session = Session {
        windows: vec![
            SessionWindow {
                label: "main".into(),
                tabs: vec![Some(7)],
                active: 0,
            },
            SessionWindow {
                label: "win-1".into(),
                tabs: vec![Some(7)],
                active: 0,
            },
        ],
        terminals: vec![],
        focused: Some("win-1".into()),
    };
    let out = sanitize_session(&session, &known(&[7]));
    // 두 번째 창은 남는 탭이 없어 통째로 사라진다 — 빈 창은 레지스트리가
    // 표현하지 못한다.
    assert_eq!(out.windows.len(), 1);
    assert_eq!(out.windows[0].label, "main");
    // 사라진 창을 포커스하라고 남겨 두면 아무 창도 앞으로 오지 않는다.
    assert_eq!(out.focused, None);
}

/// 프로젝트가 하나도 안 남으면 복원할 것이 없다 — 시작 탭 하나로 뜬다.
#[test]
fn an_all_stale_snapshot_restores_nothing() {
    let session = Session {
        windows: vec![SessionWindow {
            label: "win-1".into(),
            tabs: vec![Some(7)],
            active: 0,
        }],
        terminals: vec![],
        focused: None,
    };
    assert!(sanitize_session(&session, &known(&[])).windows.is_empty());
}

// ─── 지운 프로젝트의 창 흔적 (2026-09-17 06:11 로그) ─────────────────────────
//
// `delete_project` 가 DB 행만 지우던 동안, 그 프로젝트의 탭은 스트립에 `#22`
// 로 남았다. 뒤늦게 그 탭을 누르면 `oculpm_init` 이 "project not found" 로
// 떨어졌고(로그의 `oculpmInit failed`), 사용자는 껍데기를 손으로 닫아야 했다.

/// 지운 프로젝트의 탭은 **어느 창에 있든** 찾아낸다. 이 판정이 창 하나만 보면
/// 다른 창에 껍데기가 남는다 (I1 이라 탭은 많아야 하나지만 그 하나가 어디
/// 있는지는 정해져 있지 않다).
#[test]
fn project_surfaces_finds_the_tab_in_any_window() {
    let mut reg = reg_with(&[("main", &[Some(7)]), ("win-1", &[None, Some(22)])]);
    reg.terminal_windows.insert(22);

    let (tab, had_terminal) = project_surfaces(&reg, 22);
    assert_eq!(tab, Some(ids(&reg, "win-1")[1]));
    // 분리 터미널 창도 함께 걷어야 한다 — 남으면 프런트가 「창으로 떼어냄」
    // 상태에 갇힌다.
    assert!(had_terminal);
}

/// 열려 있지 않은 프로젝트를 지우는 것이 정상 경로다 — 아무것도 안 건드린다.
#[test]
fn project_surfaces_of_an_unopened_project_is_empty() {
    let reg = reg_with(&[("main", &[Some(7)])]);
    assert_eq!(project_surfaces(&reg, 999), (None, false));
}

/// 탭은 없고 분리 터미널 창만 떠 있는 경우도 걷는다.
#[test]
fn project_surfaces_reports_a_lone_terminal_window() {
    let mut reg = reg_with(&[("main", &[Some(7)])]);
    reg.terminal_windows.insert(9);
    assert_eq!(project_surfaces(&reg, 9), (None, true));
}

/// 배선 가드 — 위 판정이 **불리는지**는 소스로만 확인할 수 있다 (두 경로 모두
/// `AppHandle` 을 받아 웹뷰를 만지므로 MockRuntime 으로는 닿지 않는다).
///
/// 순서까지 본다: `close_project_surfaces` 는 `db.delete_project` **앞**이어야
/// 남은 탭의 이름 조회(`snapshot`)가 성립한다.
#[test]
fn delete_project_closes_the_windows_before_dropping_the_row() {
    let src = include_str!("../project.rs");
    let close = src
        .find("close_project_surfaces")
        .expect("delete_project 가 창 흔적을 걷지 않는다");
    let drop_row = src
        .find("db.delete_project(project_id)")
        .expect("delete_project 가 행을 지우지 않는다");
    assert!(close < drop_row, "행을 지우기 전에 창을 걷어야 한다");
}

/// 같은 규율 — 지운 프로젝트를 여는 **두** 경로 모두 레지스트리를 건드리기
/// 전에 거절한다. 탭을 여는 길이 둘이라(스트립·팔레트의 `open_project_tab`,
/// 시작 탭의 `set_tab_project`) 한쪽만 막으면 다른 쪽으로 유령 탭이 들어온다.
#[test]
fn opening_a_project_checks_it_exists_first() {
    let src = include_str!("tabs.rs");
    for entry in [
        "pub async fn open_project_tab_with_nav",
        "pub async fn set_tab_project",
    ] {
        let body = src.split(entry).nth(1).expect(entry);
        let guard = body
            .find("db.get_project(project_id)")
            .unwrap_or_else(|| panic!("{entry} 가 지운 프로젝트를 거르지 않는다"));
        let touches_registry = body
            .find("locate_project")
            .unwrap_or_else(|| panic!("{entry} 본문이 바뀌었다 — 기준점을 다시 잡을 것"));
        assert!(guard < touches_registry, "{entry}: 검사가 먼저다");
    }
}
