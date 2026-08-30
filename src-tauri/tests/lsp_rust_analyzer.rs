//! 실제 `rust-analyzer` 와의 왕복 — 단위 테스트가 못 잡는 것을 잡는다.
//!
//! framing/registry/spec 단위 테스트는 전부 **우리가 만든 입력**을 검사한다.
//! 실제 서버가 우리 initialize 를 받아들이는지, didOpen 뒤 진단이 정말 오는지,
//! 종료가 매달리지 않는지는 진짜 프로세스로만 확인된다.
//!
//! `rust-analyzer` 가 PATH 에 없으면 **건너뛴다** — 이 도구가 없는 기기에서
//! 전체 스위트가 빨개지면 안 된다 (건너뛸 때는 그 사실을 출력한다).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ocul_pm_lib::lsp::client::{LspClient, ServerNotice};
use ocul_pm_lib::lsp::edit::{apply_text_edits, workspace_edit_from_json};
use ocul_pm_lib::lsp::registry::{spec_for_path, SERVERS};
use ocul_pm_lib::lsp::spec::{
    code_actions_from_json, definition_from_json, diagnostics_from_json, hover_from_json,
    LspSeverity,
};

fn rust_analyzer() -> Option<PathBuf> {
    let path = std::env::var("PATH").ok()?;
    path.split(':')
        .map(|d| PathBuf::from(d).join("rust-analyzer"))
        .find(|p| p.is_file())
}

/// 진단이 있는 최소 크레이트. 의존성이 없어 오프라인에서도 뜬다.
fn seed_crate(dir: &std::path::Path, body: &str) -> PathBuf {
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(
        dir.join("Cargo.toml"),
        "[package]\nname = \"lsp-probe\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
    let main = dir.join("src/main.rs");
    std::fs::write(&main, body).unwrap();
    main
}

#[tokio::test(flavor = "multi_thread")]
async fn rust_analyzer_handshakes_and_publishes_diagnostics() {
    let Some(binary) = rust_analyzer() else {
        eprintln!("rust-analyzer 가 PATH 에 없어 건너뜁니다 (rustup component add rust-analyzer)");
        return;
    };

    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    // 구문 오류 — 네이티브 진단이라 `cargo check` 를 기다리지 않는다.
    let main = seed_crate(&root, "fn main() {\n    let x = ;\n}\n");

    let seen: Arc<Mutex<Vec<ServerNotice>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = {
        let seen = seen.clone();
        Arc::new(move |n: ServerNotice| seen.lock().unwrap().push(n))
    };

    let spec = spec_for_path(&main).expect("main.rs → rust 서버");
    let path_env = std::env::var("PATH").unwrap_or_default();
    let client = LspClient::start(spec, &binary, root.clone(), path_env, sink)
        .await
        .expect("initialize 핸드셰이크 실패");

    // 서버가 능력을 광고했는가 — 자동완성을 부르기 전에 확인하는 그 값.
    assert!(
        client.supports("completionProvider"),
        "rust-analyzer 가 completionProvider 를 광고하지 않았다 — 능력 파싱이 깨졌다"
    );
    assert_eq!(client.language_id(), "rust");
    assert_eq!(client.root(), root.as_path());

    let text = std::fs::read_to_string(&main).unwrap();
    client
        .did_open(&main, &text, 1)
        .await
        .expect("didOpen 실패");

    // 진단은 알림으로 온다 — 요청 응답이 아니라서 기다려야 한다.
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    let mut diagnostics = None;
    while std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let found = seen.lock().unwrap().iter().find_map(|n| match n {
            ServerNotice::Diagnostics { uri, diagnostics } if uri.ends_with("main.rs") => {
                let parsed = diagnostics_from_json(diagnostics);
                (!parsed.is_empty()).then(|| parsed.clone())
            }
            _ => None,
        });
        if found.is_some() {
            diagnostics = found;
            break;
        }
    }

    let diagnostics = diagnostics.expect("60초 안에 main.rs 의 진단이 오지 않았다");
    assert!(
        diagnostics.iter().any(|d| d.severity == LspSeverity::Error),
        "구문 오류인데 error 심각도가 없다: {diagnostics:?}"
    );
    // 진단이 실제로 그 줄(0-based 1 = 둘째 줄)을 가리키는가 — 오프셋을 어디선가
    // ±1 하면 여기서 걸린다.
    assert!(
        diagnostics.iter().any(|d| d.start_line == 1),
        "둘째 줄을 가리키지 않는다: {diagnostics:?}"
    );

    // 종료가 매달리지 않아야 한다 (shutdown→exit→wait 경로).
    tokio::time::timeout(Duration::from_secs(15), client.stop())
        .await
        .expect("stop() 이 시간 안에 끝나지 않았다");
}

/// 깨끗한 파일에는 빈 진단이 온다 — "진단 없음" 과 "서버 안 붙음" 을 구별하는 근거.
#[tokio::test(flavor = "multi_thread")]
async fn clean_file_yields_no_error_diagnostics() {
    let Some(binary) = rust_analyzer() else {
        eprintln!("rust-analyzer 가 PATH 에 없어 건너뜁니다");
        return;
    };

    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    let main = seed_crate(&root, "fn main() {\n    println!(\"안녕\");\n}\n");

    let seen: Arc<Mutex<Vec<ServerNotice>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = {
        let seen = seen.clone();
        Arc::new(move |n: ServerNotice| seen.lock().unwrap().push(n))
    };
    let spec = spec_for_path(&main).unwrap();
    let client = LspClient::start(
        spec,
        &binary,
        root.clone(),
        std::env::var("PATH").unwrap_or_default(),
        sink,
    )
    .await
    .expect("initialize 실패");

    let text = std::fs::read_to_string(&main).unwrap();
    client.did_open(&main, &text, 1).await.unwrap();
    // 진단이 올 시간을 주되, 안 와도 정상이다 (빈 배열이거나 아예 안 보낸다).
    tokio::time::sleep(Duration::from_secs(5)).await;

    let errors: Vec<_> = seen
        .lock()
        .unwrap()
        .iter()
        .filter_map(|n| match n {
            ServerNotice::Diagnostics { diagnostics, .. } => {
                Some(diagnostics_from_json(diagnostics))
            }
            _ => None,
        })
        .flatten()
        .filter(|d| d.severity == LspSeverity::Error)
        .collect();
    assert!(
        errors.is_empty(),
        "깨끗한 파일에 오류 진단이 붙었다: {errors:?}"
    );

    let _ = tokio::time::timeout(Duration::from_secs(15), client.stop()).await;
}

/// 호버와 정의로 이동 — 요청/응답 경로. 진단(알림)과 달리 이쪽은 id 상관을 탄다.
#[tokio::test(flavor = "multi_thread")]
async fn hover_and_definition_round_trip() {
    let Some(binary) = rust_analyzer() else {
        eprintln!("rust-analyzer 가 PATH 에 없어 건너뜁니다");
        return;
    };

    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    // `greet` 를 정의하고 아래에서 부른다 — 정의로 이동의 출발점과 도착점이
    // 같은 파일에 있어 워크스페이스 인덱싱을 덜 기다린다.
    let main = seed_crate(
        &root,
        "fn greet(name: &str) -> String {\n    format!(\"안녕, {name}\")\n}\n\nfn main() {\n    let s = greet(\"세상\");\n    println!(\"{s}\");\n}\n",
    );

    let sink = Arc::new(|_: ServerNotice| {});
    let spec = spec_for_path(&main).unwrap();
    let client = LspClient::start(
        spec,
        &binary,
        root.clone(),
        std::env::var("PATH").unwrap_or_default(),
        sink,
    )
    .await
    .expect("initialize 실패");

    assert!(client.supports("hoverProvider"));
    assert!(client.supports("definitionProvider"));

    let text = std::fs::read_to_string(&main).unwrap();
    client.did_open(&main, &text, 1).await.unwrap();

    let uri = ocul_pm_lib::lsp::registry::path_to_uri(&main);
    // 6번째 줄(0-based 5) 의 `greet` 호출 — "    let s = greet(" 에서 g 는 12열.
    let params = ocul_pm_lib::lsp::state::position_params(uri.clone(), 5, 13);

    // rust-analyzer 는 인덱싱이 끝나야 답한다 — 빈 응답이면 잠시 뒤 다시 묻는다.
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    let mut hover = None;
    let mut definition = None;
    while std::time::Instant::now() < deadline && (hover.is_none() || definition.is_none()) {
        if hover.is_none() {
            if let Ok(v) = client.request("textDocument/hover", params.clone()).await {
                hover = hover_from_json(&v);
            }
        }
        if definition.is_none() {
            if let Ok(v) = client
                .request("textDocument/definition", params.clone())
                .await
            {
                definition = definition_from_json(&v, &root);
            }
        }
        if hover.is_none() || definition.is_none() {
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    let hover = hover.expect("60초 안에 호버가 오지 않았다");
    assert!(
        hover.contents.contains("greet"),
        "호버에 심볼 이름이 없다: {}",
        hover.contents
    );

    let def = definition.expect("60초 안에 정의가 오지 않았다");
    assert_eq!(
        def.path.as_deref(),
        Some("src/main.rs"),
        "같은 파일 안의 정의인데 프로젝트 상대 경로가 아니다: {def:?}"
    );
    // `fn greet` 는 첫 줄(0-based 0)이고, 커서는 정의 블록 맨 위가 아니라
    // **심볼 이름**에 떨어져야 한다 (targetSelectionRange 를 골랐는지 확인).
    assert_eq!(def.line, 0, "{def:?}");
    assert_eq!(
        def.character, 3,
        "`greet` 의 g 가 아니라 줄 머리를 가리킨다: {def:?}"
    );

    let _ = tokio::time::timeout(Duration::from_secs(15), client.stop()).await;
}

/// 이름 바꾸기 — 실제 서버가 준 WorkspaceEdit 을 실제 파일에 적용한다.
///
/// 이 라운드에서 유일하게 **파일을 고치는** 기능이라 단위 테스트만으로는 부족하다.
/// 서버가 실제로 몇 곳을 잡는지, 우리 오프셋 변환이 그 편집과 맞는지는 진짜
/// 왕복으로만 확인된다. 한글 문자열을 일부러 넣어 UTF-16↔UTF-8 변환도 함께 건다.
#[tokio::test(flavor = "multi_thread")]
async fn rename_applies_a_real_workspace_edit() {
    let Some(binary) = rust_analyzer() else {
        eprintln!("rust-analyzer 가 PATH 에 없어 건너뜁니다");
        return;
    };

    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    // `greet` 를 3곳에서 쓴다. 한글 리터럴이 앞에 있는 줄도 섞는다 — 오프셋을
    // 바이트로 세면 여기서 어긋난다.
    let main = seed_crate(
        &root,
        "fn greet(name: &str) -> String {\n    format!(\"안녕하세요, {name}\")\n}\n\nfn main() {\n    let a = greet(\"세상\");\n    let b = greet(\"친구\");\n    println!(\"{a} {b}\");\n}\n",
    );

    let sink = Arc::new(|_: ServerNotice| {});
    let spec = spec_for_path(&main).unwrap();
    let client = LspClient::start(
        spec,
        &binary,
        root.clone(),
        std::env::var("PATH").unwrap_or_default(),
        sink,
    )
    .await
    .expect("initialize 실패");
    assert!(client.supports("renameProvider"), "rename 능력 광고 없음");

    let before = std::fs::read_to_string(&main).unwrap();
    client.did_open(&main, &before, 1).await.unwrap();

    let uri = ocul_pm_lib::lsp::registry::path_to_uri(&main);
    // 정의 자리의 `greet` (0번째 줄, 3번째 문자).
    let mut params = ocul_pm_lib::lsp::state::position_params(uri, 0, 3);
    params["newName"] = serde_json::Value::String("hello".into());

    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    let mut by_file = None;
    while std::time::Instant::now() < deadline {
        if let Ok(v) = client.request("textDocument/rename", params.clone()).await {
            if let Ok(map) = workspace_edit_from_json(&v, &root) {
                if !map.is_empty() {
                    by_file = Some(map);
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    let by_file = by_file.expect("60초 안에 rename 편집이 오지 않았다");
    let edits = by_file.get(&main).expect("main.rs 에 대한 편집이 없다");
    assert_eq!(
        edits.len(),
        3,
        "정의 1 + 호출 2 = 3곳이어야 한다: {edits:?}"
    );

    let after = apply_text_edits(&before, edits).expect("편집 적용 실패");
    assert!(after.contains("fn hello(name: &str)"), "{after}");
    assert_eq!(
        after.matches("hello(").count(),
        3,
        "3곳이 다 안 바뀌었다:\n{after}"
    );
    assert!(!after.contains("greet"), "옛 이름이 남았다:\n{after}");
    // 한글 리터럴이 온전한가 — 오프셋이 어긋났다면 여기가 깨진다.
    assert!(
        after.contains("\"안녕하세요, {name}\""),
        "한글이 깨졌다:\n{after}"
    );
    assert!(
        after.contains("hello(\"세상\")") && after.contains("hello(\"친구\")"),
        "{after}"
    );

    let _ = tokio::time::timeout(Duration::from_secs(15), client.stop()).await;
}

/// 코드 액션 — **요청 경로**를 검증한다.
///
/// 어떤 액션이 나오는지는 rust-analyzer 버전마다 달라서(assist 목록이 계속
/// 바뀐다) 특정 제목을 단언하면 그 순간 깨지는 테스트가 된다. 그래서 여기서는
/// 프로토콜 왕복과 우리 파서의 계약만 본다: 요청이 오류 없이 돌아오는가,
/// 걸러낸 뒤의 인덱스가 원본 배열과 어긋나지 않는가.
#[tokio::test(flavor = "multi_thread")]
async fn code_action_request_round_trips_and_indices_stay_consistent() {
    let Some(binary) = rust_analyzer() else {
        eprintln!("rust-analyzer 가 PATH 에 없어 건너뜁니다");
        return;
    };

    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    let main = seed_crate(
        &root,
        "fn main() {\n    let x = 5;\n    println!(\"{x}\");\n}\n",
    );

    let sink = Arc::new(|_: ServerNotice| {});
    let spec = spec_for_path(&main).unwrap();
    let client = LspClient::start(
        spec,
        &binary,
        root.clone(),
        std::env::var("PATH").unwrap_or_default(),
        sink,
    )
    .await
    .expect("initialize 실패");
    assert!(
        client.supports("codeActionProvider"),
        "codeAction 능력 광고 없음"
    );

    let text = std::fs::read_to_string(&main).unwrap();
    client.did_open(&main, &text, 1).await.unwrap();
    // 인덱싱이 끝나야 assist 가 나온다.
    tokio::time::sleep(Duration::from_secs(3)).await;

    let params = serde_json::json!({
        "textDocument": { "uri": ocul_pm_lib::lsp::registry::path_to_uri(&main) },
        "range": {
            "start": { "line": 1, "character": 8 },
            "end": { "line": 1, "character": 9 },
        },
        "context": { "diagnostics": [] },
    });
    let result = client
        .request("textDocument/codeAction", params)
        .await
        .expect("codeAction 요청이 오류로 돌아왔다");

    let (actions, raw) = code_actions_from_json(&result);
    assert_eq!(
        actions.len(),
        raw.len(),
        "걸러낸 목록과 원본 개수가 어긋난다"
    );
    for (i, a) in actions.iter().enumerate() {
        // 적용은 이 인덱스로 raw 를 되짚는다 — 어긋나면 엉뚱한 액션이 적용된다.
        assert_eq!(a.index as usize, i, "인덱스가 자리와 다르다: {a:?}");
        assert!(!a.title.is_empty());
        assert!(
            raw[i].get("edit").is_some() || raw[i].get("data").is_some(),
            "적용할 수 없는 항목이 목록에 남았다: {}",
            raw[i]
        );
    }

    let _ = tokio::time::timeout(Duration::from_secs(15), client.stop()).await;
}

/// 레지스트리가 광고하는 서버 목록이 실제 실행 파일 이름과 맞는지 — 오타 방지.
#[test]
fn registry_commands_are_plausible_binary_names() {
    for spec in SERVERS {
        assert!(
            !spec.command.contains('/') && !spec.command.contains(' '),
            "{} 는 PATH 에서 찾을 이름이어야 한다 (경로·인자 금지)",
            spec.command
        );
        assert!(
            !spec.root_markers.is_empty(),
            "{} 에 루트 마커가 없다",
            spec.language_id
        );
    }
}
