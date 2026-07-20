fn main() {
    // externalBin(oculpm-mcp 사이드카) 선언은 tauri_build 가 컴파일 시점에 파일
    // 존재를 검증한다 — 사이드카 자신을 빌드할 때도 build.rs 가 돌므로 순환이
    // 생기고, 갓 클론한 레포의 `cargo test` 도 깨진다. 여기서 0바이트
    // 플레이스홀더를 자가 생성해 검증만 통과시킨다. 실제 바이너리는
    // beforeBuildCommand 의 scripts/build-sidecar.mjs 가 덮어쓴다 (스크립트가
    // 크기 검증으로 플레이스홀더 출하를 차단).
    let triple = std::env::var("TARGET").expect("cargo sets TARGET");
    let ext = if triple.contains("windows") { ".exe" } else { "" };
    let dir = std::path::Path::new("binaries");
    let placeholder = dir.join(format!("oculpm-mcp-{triple}{ext}"));
    if !placeholder.exists() {
        std::fs::create_dir_all(dir).expect("mkdir binaries");
        std::fs::write(&placeholder, b"").expect("write sidecar placeholder");
    }

    tauri_build::build()
}
