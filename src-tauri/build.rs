fn main() {
    // externalBin(oculpm-mcp 사이드카) 선언은 tauri_build 가 컴파일 시점에 파일
    // 존재를 검증한다 — 사이드카 자신을 빌드할 때도 build.rs 가 돌므로 순환이
    // 생기고, 갓 클론한 레포의 `cargo test` 도 깨진다. 여기서 0바이트
    // 플레이스홀더를 자가 생성해 검증만 통과시킨다. 실제 바이너리는
    // beforeBuildCommand 의 scripts/build-sidecar.mjs 가 덮어쓴다 (스크립트가
    // 크기 검증으로 플레이스홀더 출하를 차단).
    let triple = std::env::var("TARGET").expect("cargo sets TARGET");
    let ext = if triple.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let dir = std::path::Path::new("binaries");
    let placeholder = dir.join(format!("oculpm-mcp-{triple}{ext}"));
    if !placeholder.exists() {
        std::fs::create_dir_all(dir).expect("mkdir binaries");
        std::fs::write(&placeholder, b"").expect("write sidecar placeholder");
    }

    // Windows(MSVC): 앱 매니페스트(Common Controls v6 의존)를 리소스(.res) 대신
    // **링커로** 모든 실행 파일에 싣는다 (크로스플랫폼 W1).
    //
    // tauri-build 는 매니페스트를 .res 로 **bin 에만** 링크한다(embed-resource 의
    // `rustc-link-arg-bins`). 그래서 테스트 실행 파일(lib 단위 테스트·통합 테스트)은
    // 매니페스트 없이 comctl32 v5 에 묶여, v6 에만 있는 진입점(TaskDialogIndirect)을
    // 못 찾고 기동 즉시 STATUS_ENTRYPOINT_NOT_FOUND(0xc0000139)로 죽었다
    // (portability run 35879935049 — lib 단위 테스트 전체가 한 건도 못 돌았다).
    // tauri 자신의 build.rs 가 테스트에 쓰는 우회(`embed_manifest_for_tests`)와 같다.
    // .res 쪽 매니페스트는 끈다 — 둘 다 실으면 bin 에서 MANIFEST 리소스가 겹친다.
    // macOS·Linux 는 아래 `tauri_build::build()` 그대로다.
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if windows_msvc {
        let out_dir =
            std::path::PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets OUT_DIR"));
        let manifest = out_dir.join("windows-app-manifest.xml");
        std::fs::write(&manifest, WINDOWS_APP_MANIFEST).expect("write windows app manifest");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        if let Err(error) = tauri_build::try_build(attributes) {
            println!("{error:#}");
            std::process::exit(1);
        }
        return;
    }

    tauri_build::build()
}

/// tauri-build 의 기본 Windows 앱 매니페스트(`tauri-build/src/windows-app-manifest.xml`)
/// 와 같은 내용 — 대화상자 API 가 Common Controls v6 를 요구한다.
const WINDOWS_APP_MANIFEST: &str = r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#;
