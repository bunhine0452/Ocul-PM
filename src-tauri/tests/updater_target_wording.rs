//! 업데이터 「대상 없음」 문장 — 플러그인과 프런트의 대조 (크로스플랫폼 L-UPD
//! `#upd-target-missing`).
//!
//! 프런트는 「대상 없음」(latest.json 에 이 OS·설치 형식의 키가 없다)을 플러그인 오류의
//! **문장**으로 알아본다 — 오류가 IPC 를 문자열로 건너오기 때문이다. 그 문장을 쥔 곳은
//! `src/lib/updaterRoute.ts` 의 `TARGET_MISSING_MARKERS` 다. tauri-plugin-updater 를 올려
//! 문장이 바뀌면 여기서 먼저 붉어진다 — 안 그러면 deb·빠진 OS 의 중립 상태가 조용히 오류
//! 문장으로 돌아간다.
//!
//! `src/` 밖(통합 테스트)에 두는 이유: `egress_inventory.rs` 는 `src/` 에서 업데이터 크레이트
//! 이름을 **아웃바운드 능력**으로 센다. 이 파일은 오류 타입의 문장만 읽는다.

use std::path::Path;

#[test]
fn plugin_target_missing_wording_matches_the_frontend_markers() {
    let ts = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/updaterRoute.ts"),
    )
    .expect("src/lib/updaterRoute.ts");
    // 플러그인이 찾는 순서 그대로 — deb 설치본이 받는 실제 오류.
    let many = tauri_plugin_updater::Error::TargetsNotFound(vec![
        "linux-x86_64-deb".into(),
        "linux-x86_64".into(),
    ])
    .to_string();
    // 사용자가 대상을 정했을 때의 단수형 (지금은 안 쓰지만 같은 뜻이다).
    let one = tauri_plugin_updater::Error::TargetNotFound("linux-x86_64".into()).to_string();
    for (marker, message) in [
        ("were found in the response `platforms` object", &many),
        ("was not found in the response `platforms` object", &one),
    ] {
        assert!(
            message.contains(marker),
            "플러그인 문장이 바뀌었다: {message:?} — updaterRoute.ts 의 표식을 고칠 것"
        );
        assert!(
            ts.contains(&format!("\"{marker}\"")),
            "updaterRoute.ts 의 TARGET_MISSING_MARKERS 에 {marker:?} 가 없다"
        );
    }
}
