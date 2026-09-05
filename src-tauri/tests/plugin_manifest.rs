//! A1 (#a1-schema-paths) — 플러그인 매니페스트 불변식.
//!
//! ECC 의 PLUGIN_SCHEMA_NOTES 교훈: plugin.json 의 hooks/agents 선언 가부는
//! CLI 버전에 따라 흔들렸다 (add/revert 4회 flip-flop). 우리는 자동발견에
//! 위임하는 쪽(신·구 CLI 모두 안전)을 계약으로 고정하고, 여기서 회귀를 잡는다.
//! 검증 기준 CLI: claude 2.1.220 (`claude plugin validate` + `--plugin-dir`
//! 실로드·인벤토리(Hooks 3 · MCP 1) 통과 실측 — 2026-07-31).

use std::path::PathBuf;

fn plugin_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../plugin/oculpm")
}

fn read_json(rel: &str) -> serde_json::Value {
    let path = plugin_root().join(rel);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{} 읽기 실패: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{rel} 파싱 실패: {e}"))
}

/// plugin.json 은 문서화된 메타 필드만 갖는다. hooks/mcpServers 는 자동발견
/// (`hooks/hooks.json`·`.mcp.json`)에 위임 — 선언하면 구버전 CLI 에서 중복
/// 로드 에러가 났던 이력이 있다. version 은 앱 버전과 동기 (build-sidecar 가
/// 스탬프).
#[test]
fn plugin_json_is_minimal_and_version_synced() {
    let manifest = read_json(".claude-plugin/plugin.json");
    assert_eq!(
        manifest["name"], "oculpm",
        "이름은 짧게 — MCP 자동 도구명 64자 제한"
    );
    assert!(
        manifest.get("hooks").is_none(),
        "hooks 는 자동발견에 위임 (선언 금지)"
    );
    assert!(
        manifest.get("mcpServers").is_none(),
        "mcpServers 는 자동발견에 위임 (선언 금지)"
    );

    let tauri_conf: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        manifest["version"], tauri_conf["version"],
        "plugin.json 버전은 앱 버전과 동기여야 한다 — scripts/build-sidecar.mjs 실행"
    );
}

/// 훅은 3이벤트, 전부 `.oculpm` 추적 가드 + 비추적에서도 stdin 소비
/// (가드 실패 시 cat 미실행으로 세션당 3회 EPIPE 가 나던 문제의 재발 방지).
#[test]
fn hooks_json_guards_and_consumes_stdin() {
    let hooks = read_json("hooks/hooks.json");
    let map = hooks["hooks"].as_object().expect("hooks 맵");
    assert_eq!(
        map.len(),
        4,
        "구독 이벤트는 SessionStart/Stop/SessionEnd(싱크) + SubagentStart(주입) 4종"
    );
    // 인라인 이벤트 싱크 2종 — 가드·stdin 소비·네트워크 금지 계약 (D1).
    for ev in ["SessionStart", "Stop"] {
        let cmd = map[ev][0]["hooks"][0]["command"]
            .as_str()
            .unwrap_or_else(|| panic!("{ev} command"));
        assert!(cmd.contains(".oculpm"), "{ev}: 추적 프로젝트 가드 누락");
        assert!(
            cmd.contains("cat > /dev/null"),
            "{ev}: 비추적에서도 stdin 을 소비해야 한다 (EPIPE)"
        );
        for banned in ["curl", "wget", "http://", "https://"] {
            assert!(
                !cmd.contains(banned),
                "{ev}: 훅은 로컬 append 만 — 네트워크 금지 계약"
            );
        }
    }
    let stop = map["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
    assert!(
        !stop.contains("echo"),
        "Stop 에는 안내를 붙이지 않는다 (매 턴 소음)"
    );

    // 배달 게이트 — Stop 2번째 훅 (ponytail delivery-gate 이식). "코드 변경이
    // 있는데 일지 없음"을 세션당 1회만 차단하는 계약을 잠근다.
    let gate_cmd = map["Stop"][0]["hooks"][1]["command"]
        .as_str()
        .expect("Stop[1] 배달 게이트 훅 누락");
    assert!(
        gate_cmd.contains("delivery-gate.sh"),
        "Stop: delivery-gate.sh 참조"
    );
    let gate = std::fs::read_to_string(plugin_root().join("hooks/delivery-gate.sh"))
        .expect("delivery-gate.sh 존재");
    assert!(
        gate.contains("payload=$(cat"),
        "배달 게이트: stdin 즉시 소비"
    );
    assert!(
        gate.contains("stop_hook_active"),
        "배달 게이트: 무한 차단 방지 가드 (공식 플래그)"
    );
    assert!(
        gate.contains(".delivery-gate-"),
        "배달 게이트: 세션당 1회 플래그 파일"
    );
    assert!(
        gate.contains(".session-live-"),
        "배달 게이트: 생존 흔적을 판정 **전에** 찍는다 (옆 대화가 우리를 볼 수 있게)"
    );
    assert!(
        gate.contains("exit 2"),
        "배달 게이트: 차단은 exit 2 (stderr 가 에이전트에 전달)"
    );
    // 판정은 더 이상 셸에 없다 — `oculpm-mcp verdict` (oculpm::verdict) 한
    // 자리다. 그래서 여기서 잠그는 것은 **판정 로직**이 아니라 **진입점의
    // 계약**이다. 판정 자체의 행위는 tests/delivery_gate.rs 가 훅을 실제로
    // 실행해 잰다 (문자열 존재 단언은 지워도 통과하므로 아무것도 지키지
    // 못한다 — 그게 이 가드를 옮긴 이유다).
    assert!(
        gate.contains("verdict --root"),
        "배달 게이트: 판정 진입점 호출"
    );
    assert!(
        gate.contains("bin/oculpm-mcp"),
        "배달 게이트: 설치 위치 탐색은 셔틀 한 벌 (새 바이너리 금지)"
    );
    assert!(
        gate.contains(r#"[ "$rc" -eq 10 ]"#),
        "배달 게이트: 이의(10)에만 발화 — 판정 불가(11)는 침묵"
    );
    assert!(
        gate.contains(r#"[ -x "$bin" ] || exit 0"#),
        "배달 게이트: 진입점이 없으면 침묵 (옛 셸 판정으로 폴백 금지)"
    );
    assert!(
        gate.contains(r#"printf '%s\n' "$msg" >&2"#),
        "배달 게이트: 지시 문구는 판정이 만든 것을 그대로 전달"
    );
    for banned in ["curl", "wget", "http://", "https://"] {
        assert!(!gate.contains(banned), "배달 게이트: 네트워크 금지");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(plugin_root().join("hooks/delivery-gate.sh"))
            .unwrap()
            .permissions()
            .mode();
        assert!(mode & 0o111 != 0, "delivery-gate.sh 실행 비트 누락");
    }

    // H3 — SessionStart 3번째 훅: 세션 마커 (journal-missing 판정 기준점).
    let marker_cmd = map["SessionStart"][0]["hooks"][2]["command"]
        .as_str()
        .expect("SessionStart[2] 세션 마커 훅 누락");
    assert!(
        marker_cmd.contains("session-marker.sh"),
        "SessionStart: session-marker.sh 참조"
    );
    let marker = std::fs::read_to_string(plugin_root().join("hooks/session-marker.sh"))
        .expect("session-marker.sh 존재");
    assert!(
        marker.contains("payload=$(cat"),
        "마커 스크립트: stdin 즉시 소비"
    );
    assert!(
        marker.contains(".session-start-"),
        "마커 스크립트: 세션별 마커 파일"
    );
    // create-only — auto-compact 재발화가 마커를 재터치하면 기록한 세션에
    // 미작성 오탐이 난다 (리뷰 HIGH 회귀 방지).
    assert!(
        marker.contains("[ ! -f \"$marker\" ]"),
        "마커 스크립트: create-only (재터치 금지)"
    );
    // 마커 백데이팅은 BSD/GNU date 양쪽 폴백 (Linux 에서 조용한 무효 방지 — 리뷰 LOW).
    assert!(
        marker.contains("date -d '-2 seconds'"),
        "마커 스크립트: GNU date 폴백"
    );

    // H3 — SessionEnd 는 스크립트로: append + 일지 미작성 판정 + 조건부 안내.
    // (벤치 실측 — 헤드리스 단발 준수 0/12 — 이 신호의 존재 근거다.)
    let end_cmd = map["SessionEnd"][0]["hooks"][0]["command"]
        .as_str()
        .unwrap();
    assert!(
        end_cmd.contains("session-end.sh"),
        "SessionEnd: session-end.sh 참조"
    );
    let end = std::fs::read_to_string(plugin_root().join("hooks/session-end.sh"))
        .expect("session-end.sh 존재");
    assert!(
        end.contains("payload=$(cat"),
        "SessionEnd 스크립트: stdin 즉시 소비"
    );
    assert!(
        end.contains("claude-events.jsonl"),
        "SessionEnd 스크립트: 이벤트 인박스 append 유지"
    );
    assert!(
        end.contains("journal-missing.jsonl"),
        "SessionEnd 스크립트: 미작성 신호 파일"
    );
    assert!(
        end.contains("verdict --root"),
        "SessionEnd 스크립트: 판정 진입점 호출 (배달 게이트와 같은 함수)"
    );
    assert!(
        end.contains("--ledger"),
        "SessionEnd 스크립트: 원장 append 는 바이너리 안에서 (회전 경합·개행 누락 방지)"
    );
    assert!(
        end.contains(r#"[ -x "$bin" ]"#),
        "SessionEnd 스크립트: 진입점이 없으면 침묵"
    );
    assert!(
        end.contains(">&2"),
        "SessionEnd 스크립트: stderr 안내 (조건부)"
    );
    assert!(
        end.contains("일지 없이 끝났습니다"),
        "SessionEnd 스크립트: 미작성 경고 문구"
    );
    assert!(
        end.contains("-mtime +7 -delete"),
        "SessionEnd 스크립트: 크래시 잔여 마커 청소 (판정 뒤)"
    );
    assert!(
        end.contains(".session-live-"),
        "SessionEnd 스크립트: 생존 흔적도 세그먼트와 함께 걷는다"
    );
    // 원장 라인의 포맷 계약은 이제 Rust↔Rust 다 (`verdict::cli` 가 쓰고
    // `claude_hooks` 가 읽는다). 왕복은 tests/session_verdict.rs 가 실제로
    // 쓰고 읽어 확인한다.
    // B1 — statusline 넛지는 딱 1회 (ponytail 패턴: 반복하면 잔소리).
    assert!(
        end.contains(".statusline-nudged"),
        "SessionEnd 스크립트: 넛지 1회성 플래그"
    );
    assert!(
        end.contains("\"statusLine\""),
        "SessionEnd 스크립트: 미설정일 때만 넛지"
    );

    // B1 — statusline 배지 스크립트: 디스패치 플래그 → 상태줄. 매 렌더
    // 호출되므로 저비용·무네트워크·실패는 기본 출력 낙하 계약.
    let sl = std::fs::read_to_string(plugin_root().join("hooks/oculpm-statusline.sh"))
        .expect("oculpm-statusline.sh 존재");
    assert!(
        sl.contains("current.json"),
        "statusline: 디스패치 플래그 읽기"
    );
    assert!(sl.contains("86400"), "statusline: 24h 신선도 컷");
    assert!(
        sl.contains("perl -CS"),
        "statusline: 문자 단위 절단 (바이트 절단은 한글 파괴)"
    );
    for banned in ["curl", "wget", "http://", "https://"] {
        assert!(!sl.contains(banned), "statusline: 네트워크 금지");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(plugin_root().join("hooks/oculpm-statusline.sh"))
            .unwrap()
            .permissions()
            .mode();
        assert!(mode & 0o111 != 0, "oculpm-statusline.sh 실행 비트 누락");
    }
    for script in [&marker, &end] {
        for banned in ["curl", "wget", "http://"] {
            assert!(!script.contains(banned), "훅 스크립트: 네트워크 금지");
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for name in ["hooks/session-marker.sh", "hooks/session-end.sh"] {
            let mode = std::fs::metadata(plugin_root().join(name))
                .unwrap()
                .permissions()
                .mode();
            assert!(mode & 0o111 != 0, "{name} 실행 비트 누락");
        }
    }

    // ponytail-round H1/H2 — 플랜 컨텍스트 주입: SessionStart 2번째 훅과
    // SubagentStart(서브에이전트엔 SessionStart stdout 이 안 닿는다)가 같은
    // 스크립트를 공유한다.
    for (ev, idx) in [("SessionStart", 1usize), ("SubagentStart", 0)] {
        let cmd = map[ev][0]["hooks"][idx]["command"]
            .as_str()
            .unwrap_or_else(|| panic!("{ev}[{idx}] 주입 훅 누락"));
        assert!(
            cmd.contains("${CLAUDE_PLUGIN_ROOT}"),
            "{ev}: 주입은 플러그인 동봉 스크립트로"
        );
        assert!(
            cmd.contains("plan-context.sh"),
            "{ev}: plan-context.sh 참조"
        );
    }
    // 주입 스크립트 계약 — 절대 블록 금지·상한·네트워크 금지·JSON 출력.
    let script_path = plugin_root().join("hooks/plan-context.sh");
    let script = std::fs::read_to_string(&script_path).expect("plan-context.sh 존재");
    assert!(
        script.contains("payload=$(cat"),
        "주입 스크립트: stdin 즉시 소비 (블록 금지)"
    );
    // plain stdout 은 SubagentStart 에서 버려진다 — JSON additionalContext 만
    // 두 이벤트 모두에 닿는다 (적대 리뷰 HIGH 회귀 방지).
    assert!(
        script.contains("hookSpecificOutput"),
        "주입 스크립트: JSON 출력 계약"
    );
    assert!(
        script.contains("additionalContext"),
        "주입 스크립트: additionalContext 필드"
    );
    assert!(
        script.contains("지시가 아님"),
        "주입 스크립트: 비신뢰 데이터 프레이밍"
    );
    // 바이트 컷(head -c)은 한글 멀티바이트를 중간에서 깨뜨린다 — 줄 경계 컷 + 절단 표식.
    assert!(
        script.contains("if (n > 1600)"),
        "주입 스크립트: 컨텍스트 상한 (토큰 예산, 줄 경계)"
    );
    assert!(
        script.contains("생략"),
        "주입 스크립트: 절단 표식 (침묵 절단 금지)"
    );
    assert!(
        script.contains("status: active"),
        "주입 스크립트: 활성 플랜만 (frontmatter 스코프)"
    );
    for banned in ["curl", "wget", "http://", "https://"] {
        assert!(!script.contains(banned), "주입 스크립트: 네트워크 금지");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&script_path)
            .unwrap()
            .permissions()
            .mode();
        assert!(mode & 0o111 != 0, "plan-context.sh 실행 비트 누락");
    }
}

/// A2 — 동봉 스킬·커맨드 표면과 상시(always-on) 토큰 예산.
/// 스킬 description 은 전 프로젝트 전 세션의 스킬 목록에 상주한다 — ECC 의
/// "상시 로드 토큰 폭탄" 을 피하기 위해 표면을 상수로 잠근다.
#[test]
fn bundled_skills_and_commands_stay_within_budget() {
    let skills_dir = plugin_root().join("skills");
    let mut names: Vec<String> = std::fs::read_dir(&skills_dir)
        .expect("skills/ 존재")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    assert_eq!(
        names,
        [
            "oculpm-journal",
            "project-inception",
            "run-evals",
            "self-audit",
            "tdd-workflow"
        ],
        "동봉 스킬은 5종 고정 — 추가하려면 토큰 예산부터 재계산"
    );

    let mut desc_chars = 0usize;
    for name in &names {
        let text = std::fs::read_to_string(skills_dir.join(name).join("SKILL.md")).unwrap();
        assert!(text.starts_with("---\n"), "{name}: frontmatter 필수");
        let desc = text
            .lines()
            .find_map(|l| l.strip_prefix("description: "))
            .unwrap_or_else(|| panic!("{name}: description 필수 (트리거 문장)"));
        desc_chars += desc.chars().count();
    }
    // 커맨드는 전수 스캔 — 새 커맨드가 예산 계산에서 빠지지 않게.
    let mut cmd_names: Vec<String> = std::fs::read_dir(plugin_root().join("commands"))
        .expect("commands/ 존재")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".md"))
        .collect();
    cmd_names.sort();
    assert_eq!(
        cmd_names,
        [
            "help.md",
            "inception.md",
            "next.md",
            "project_init.md",
            "standup.md"
        ],
        "동봉 커맨드 5종 고정 — 추가하려면 토큰 예산부터 재계산 (+ landing/plugin.html 문서화)"
    );
    for name in &cmd_names {
        let cmd = std::fs::read_to_string(plugin_root().join("commands").join(name)).unwrap();
        let cmd_desc = cmd
            .lines()
            .find_map(|l| l.strip_prefix("description: "))
            .unwrap_or_else(|| panic!("{name}: description 필수"));
        desc_chars += cmd_desc.chars().count();
    }
    // 한글 혼합 기준 보수적으로 1 tok ≈ 2 chars — 1,400 chars ≈ ~700 tok 상한.
    assert!(
        desc_chars <= 1_400,
        "상시 노출 description 합계 {desc_chars} chars — 예산(1,400) 초과. 트리거를 압축하라"
    );
}

/// oculpm.com/plugin 문서 페이지가 플러그인의 실제 표면과 동기 —
/// 새 커맨드/도구를 추가하고 문서를 빼먹으면 여기서 게이트가 실패한다
/// ("새 커맨드는 항상 문서에 업데이트" 를 리마인더가 아니라 테스트로 강제).
#[test]
fn landing_plugin_docs_page_lists_every_command_and_tool() {
    let page_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../landing/plugin.html");
    let page = std::fs::read_to_string(&page_path).unwrap_or_else(|e| {
        panic!(
            "{} 읽기 실패: {e} — 플러그인 문서 페이지가 필요하다",
            page_path.display()
        )
    });

    for entry in std::fs::read_dir(plugin_root().join("commands")).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().to_string();
        let Some(base) = name.strip_suffix(".md") else {
            continue;
        };
        let cmd = format!("/oculpm:{base}");
        assert!(
            page.contains(&cmd),
            "landing/plugin.html 에 {cmd} 문서 누락 — 커맨드를 추가했으면 문서도 갱신하라"
        );
    }
    // MCP 도구 14종 — tools/list 계약(protocol 테스트)과 같은 목록.
    for tool in [
        "journal_write",
        "journal_search",
        "journal_read",
        "plan_status",
        "plan_update",
        "plan_create",
        "project_init",
        "agent_register",
        "agent_list",
        "agent_inbox",
        "agent_send",
        "task_create",
        "task_update",
        "claim_paths",
    ] {
        assert!(
            page.contains(tool),
            "landing/plugin.html 에 MCP 도구 {tool} 문서 누락"
        );
    }
    // 스킬 5종 — 갤러리/매니페스트와 같은 목록.
    for skill in [
        "oculpm-journal",
        "project-inception",
        "run-evals",
        "self-audit",
        "tdd-workflow",
    ] {
        assert!(
            page.contains(skill),
            "landing/plugin.html 에 스킬 {skill} 문서 누락"
        );
    }

    // 버전 pill (Phase 8 `#landing-skills`) — 동봉 스킬은 플러그인 버전을
    // 그대로 단다. 릴리스에서 랜딩을 빼먹으면 옛 버전이 웹에 남으므로 게이트로
    // 잡는다 (docs/RELEASE.md §4 의 "plugin.html 버전" 항목이 이것이다).
    let version = read_json(".claude-plugin/plugin.json")["version"]
        .as_str()
        .expect("plugin.json version")
        .to_string();
    assert!(
        page.contains(&format!("v{version}")),
        "landing/plugin.html 의 버전 배지가 v{version} 가 아니다 — 릴리스에서 랜딩이 빠졌다"
    );
}

/// MCP 는 머신 종속 절대경로 대신 플러그인 동봉 셔틀을 가리킨다.
#[test]
fn mcp_json_uses_plugin_root_shuttle() {
    let mcp = read_json(".mcp.json");
    assert_eq!(
        mcp["oculpm"]["command"], "${CLAUDE_PLUGIN_ROOT}/bin/oculpm-mcp",
        "절대경로 하드코딩 금지 — bin/ 셔틀 경유"
    );
    let args: Vec<&str> = mcp["oculpm"]["args"]
        .as_array()
        .expect("args")
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert_eq!(args, vec!["--root", "${CLAUDE_PROJECT_DIR}"]);
}

/// 셔틀 실행 비트 — 플러그인 설치는 디렉터리 복사라 실행 비트 유실이
/// 공식 문서 Troubleshooting 1순위 고장 원인이다.
#[cfg(unix)]
#[test]
fn shuttle_script_is_executable_and_stderr_only() {
    use std::os::unix::fs::PermissionsExt;
    let path = plugin_root().join("bin/oculpm-mcp");
    let meta = std::fs::metadata(&path).expect("bin/oculpm-mcp 존재");
    assert!(meta.permissions().mode() & 0o111 != 0, "실행 비트 유실");
    let script = std::fs::read_to_string(&path).unwrap();
    assert!(script.starts_with("#!/bin/sh"), "POSIX sh — bash 의존 금지");
    assert!(
        script.contains(">&2"),
        "안내는 stderr 로 (stdout 은 MCP 프로토콜 전용)"
    );
}

/// A3 — 레포 루트 마켓플레이스: `/plugin marketplace add bunhine0452/Ocul-PM`
/// 의 진입점. source 는 서브디렉터리 상대경로(git-source add 에서만 동작 —
/// 직접 URL add 는 상대경로를 못 푼다), 버전은 plugin.json 과 동기.
#[test]
fn marketplace_points_at_plugin_and_stays_version_synced() {
    let mkt_path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.claude-plugin/marketplace.json");
    let mkt: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&mkt_path).expect("marketplace.json"))
            .expect("marketplace.json 파싱");
    assert_eq!(mkt["name"], "oculpm");
    let plugins = mkt["plugins"].as_array().expect("plugins 배열");
    assert_eq!(plugins.len(), 1, "플러그인은 1개 — 표면 극소화 원칙");
    assert_eq!(plugins[0]["source"], "./plugin/oculpm");
    let manifest = read_json(".claude-plugin/plugin.json");
    assert_eq!(
        plugins[0]["version"], manifest["version"],
        "marketplace 버전은 plugin.json 과 동기 (build-sidecar 가 스탬프)"
    );
}

// ─── Codex 판 플러그인 (`plugin/oculpm-codex`) ──────────────────────────────
//
// 규격 출처는 codex-cli 0.153.0 이 내장한 저작 가이드
// (`plugin-creator/references/plugin-json-spec.md` · marketplace 절)와
// 번들 마켓플레이스의 실제 매니페스트다. 실측 기준 CLI: codex-cli 0.153.0
// (`codex plugin list -c 'marketplaces.x={source_type="local", source="<repo>"}'`
// 가 `oculpm-codex@oculpm` 을 이 경로로 해석 — 2026-09-04).

fn repo_json(rel: &str) -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(rel);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{} 읽기 실패: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{rel} 파싱 실패: {e}"))
}

/// `defaultPrompt` 는 **배열**이다 (≤3개, 각 ≤128자). 문자열로 적으면 Codex
/// 스키마 위반 — 첫 판이 정확히 그랬다. 버전은 앱 버전과 동기(build-sidecar).
#[test]
fn codex_plugin_manifest_follows_the_codex_schema() {
    let manifest = repo_json("plugin/oculpm-codex/.codex-plugin/plugin.json");
    assert_eq!(
        manifest["name"], "oculpm-codex",
        "마켓플레이스 항목명과 같아야 한다"
    );
    for key in ["version", "description", "skills"] {
        assert!(manifest[key].is_string(), "{key} 는 필수 문자열");
    }
    assert!(
        manifest["author"]["name"].is_string(),
        "author.name 은 필수 (검증기가 거른다)"
    );

    let tauri_conf = repo_json("src-tauri/tauri.conf.json");
    assert_eq!(
        manifest["version"], tauri_conf["version"],
        "codex plugin.json 버전은 앱 버전과 동기 — scripts/build-sidecar.mjs 실행"
    );

    let prompts = manifest["interface"]["defaultPrompt"]
        .as_array()
        .expect("interface.defaultPrompt 는 문자열이 아니라 배열이다");
    assert!(
        (1..=3).contains(&prompts.len()),
        "starter prompt 는 1~3개 — 4번째부터는 Codex 가 버린다"
    );
    for p in prompts {
        let s = p.as_str().expect("starter prompt 는 문자열");
        assert!(s.chars().count() <= 128, "128자를 넘으면 잘린다: {s}");
    }
}

/// **Codex 매니페스트에 훅을 실을 수 없다** (플랜 `v3-record-integrity`
/// {#gate-beyond-cc}).
///
/// Codex 0.153.4 는 훅 자체는 완전히 지원한다 — 이벤트 12종(`SessionStart` ·
/// `Stop` · `SessionEnd` · `PreToolUse` …), 핸들러 `command`/`async`/MCP, 그리고
/// `CLAUDE_PLUGIN_ROOT` 까지. 실제로 우리 Claude 플러그인의 `hooks/hooks.json`
/// 을 Codex 세션이 그대로 실행한 기록이 남아 있다(2026-09-03, 이 저장소의
/// `.oculpm/hooks/claude-events.jsonl` 에 `transcript_path` 가
/// `~/.codex/sessions/…` 인 SessionStart·Stop·SessionEnd).
///
/// 그런데 **매니페스트 필드로는 못 싣는다**: 번들 1st-party 플러그인(`browser`)은
/// `hooks` 를 쓰지만, 마켓플레이스 검증은 그 필드를 거부한다 — 실측
/// `plugin.json field 'hooks' is not accepted by plugin validation`
/// (`plugin-creator/scripts/validate_plugin.py`). 그래서 이 항목이 들어오는 순간
/// **플러그인이 설치 불가**가 된다. Claude 판이 `hooks` 를 선언하지 않는 것과
/// 겉모습은 같지만 이유가 다르므로 따로 못박는다.
#[test]
fn the_codex_manifest_declares_no_hooks_because_validation_rejects_them() {
    let manifest = repo_json("plugin/oculpm-codex/.codex-plugin/plugin.json");
    assert!(
        manifest.get("hooks").is_none(),
        "codex plugin.json 에 hooks 를 실으면 검증이 거부해 설치가 통째로 막힌다"
    );
}

/// Codex 는 레포 마켓플레이스를 `<repo-root>/.agents/plugins/marketplace.json`
/// **에서만** 찾는다. 이 파일이 없으면 플러그인은 디스크에 있어도 아무도
/// 설치할 수 없다 (첫 판이 그 상태였다).
#[test]
fn codex_marketplace_makes_the_plugin_installable() {
    let mkt = repo_json(".agents/plugins/marketplace.json");
    assert_eq!(mkt["name"], "oculpm");
    let plugins = mkt["plugins"].as_array().expect("plugins 배열");
    assert_eq!(plugins.len(), 1, "플러그인은 1개 — 표면 극소화 원칙");
    let entry = &plugins[0];
    assert_eq!(entry["name"], "oculpm-codex");
    assert_eq!(entry["source"]["source"], "local");
    // path 는 마켓플레이스 루트(레포 루트) 기준 상대경로이고, 진짜 있어야 한다.
    let rel = entry["source"]["path"].as_str().expect("source.path");
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(rel.trim_start_matches("./"));
    assert!(
        dir.join(".codex-plugin/plugin.json").is_file(),
        "{} 에 매니페스트가 없다",
        dir.display()
    );
    // policy·category 는 "항상 넣는다" — 가이드가 명시한 필수 항목.
    assert_eq!(entry["policy"]["installation"], "AVAILABLE");
    assert!(entry["policy"]["authentication"].is_string());
    assert!(entry["category"].is_string());
}
