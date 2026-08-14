//! PR-ACP1 — 패키징된 `.app` 의 빈약한 PATH 시나리오 (docs/acp-panel/00-master-plan.md D2).
//!
//! **별도 테스트 바이너리인 이유**: 이 테스트는 프로세스 전역인 `PATH` 를 건드린다.
//! 같은 바이너리 안의 다른 테스트와 병렬로 돌면 서로를 오염시키므로, cargo 가
//! 파일 단위로 프로세스를 분리해 준다는 성질에 기대어 격리한다.
//!
//! 재현하는 상황: Finder 에서 띄운 `.app` 은 PATH 가 `/usr/bin:/bin:/usr/sbin:/sbin`
//! 뿐이라 fnm·nvm·homebrew 의 node 가 안 보인다. 그때 로그인 셸 폴백이 실제로
//! 구조하는지 — 이게 깨지면 개발 중엔 멀쩡하다가 릴리스에서만 터진다.
//!
//! ```bash
//! cargo test --test acp_login_shell -- --ignored --nocapture
//! ```

use ocul_pm_lib::acp::env::{self, PathSource};

/// Finder 가 물려주는 것과 같은 최소 PATH.
const BARE_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "외부 의존(로그인 셸·Node 설치) — 수동 실행 전용"]
async fn login_shell_rescues_node_when_process_path_is_bare() {
    // 전제 확인: 이 머신엔 node 가 있고, 그게 시스템 경로 밖에 있다.
    // (시스템 node 를 쓰는 머신이라면 폴백을 검증할 수 없으므로 건너뛴다.)
    let Some((real, _)) = env::resolve_binary("node").await else {
        eprintln!("skip: 이 머신에 node 가 없다");
        return;
    };
    if env::search_path(BARE_PATH, "node").is_some() {
        eprintln!("skip: node 가 시스템 경로({BARE_PATH})에 있어 폴백을 검증할 수 없다");
        return;
    }
    eprintln!("실제 node = {}", real.display());

    std::env::set_var("PATH", BARE_PATH);

    let resolved = env::resolve_binary("node").await;

    let (path, source) = resolved.expect(
        "빈약한 PATH 에서 node 를 못 찾았다 — 로그인 셸 폴백이 동작하지 않으면 \
         패키징된 .app 에서 에이전트가 뜨지 않는다",
    );
    assert_eq!(
        source,
        PathSource::LoginShell,
        "프로세스 PATH 엔 없으니 로그인 셸에서 찾았다고 보고해야 한다"
    );
    assert_eq!(path, real, "폴백이 찾은 node 는 평소 쓰던 것과 같아야 한다");

    // 자식에게 물려줄 PATH 에도 로그인 셸 몫이 들어가야 어댑터가 claude 를 찾는다.
    let effective = env::effective_path().await;
    assert!(
        env::search_path(&effective, "node").is_some(),
        "effective_path 가 node 를 잃어버렸다"
    );
}
