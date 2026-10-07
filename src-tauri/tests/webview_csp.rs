//! 웹뷰 CSP (플랜 `v3-release` {#webview-csp} → 보안 피드백 라운드 `#csp`, 2026-10-07).
//!
//! # 켰다 — 그리고 왜 이번에는 켤 수 있었나
//!
//! v3-release 는 정책 **초안만** 두고 켜지 않았다: CSP 위반은 콘솔에만 나고 화면은
//! 조용히 빈 채로 남는데, 그 라운드에는 화면을 볼 길이 없었다. 외부 보안 피드백이
//! 이것을 가장 큰 구조적 약점으로 짚었다 — 웹뷰가 부를 수 있는 커맨드에 임의 셸·임의
//! 프로그램 실행이 있고(외부 편집기 템플릿·그린필드 스캐폴드·내장 터미널), 그래서
//! XSS 하나가 곧 원격 코드 실행이다. 방어선이 렌더링 코드 하나뿐이었다.
//!
//! 달라진 것은 볼 길이다. 크로스플랫폼 라운드의 끝단 테스트(`e2e/`)가 **실제 앱**을
//! WebView2(Windows)·WebKitGTK(Linux)에서 띄워 모든 화면을 돈다. 앱은 시작부터 CSP
//! 위반을 `window.__oculpmCsp` 와 `oculpm.log`(`csp` 타깃)에 모으고
//! (`src/lib/oculpmLog.ts` watchCspViolations), e2e 는 화면마다 그것을 떼어 보고 한
//! 건이라도 있으면 그 단계를 떨어뜨린다. macOS(WKWebView)는 e2e 가 닿지 않는 자리라
//! 실기기 확인 항목으로 남는다 — 그때도 위반은 `oculpm.log` 에 이름이 붙어 남는다.
//!
//! # 정책 (`tauri.conf.json` `app.security.csp`)
//!
//! | 지시어 | 왜 그 모양인가 (근거 파일) |
//! |---|---|
//! | `script-src 'self' 'wasm-unsafe-eval'` | 코드 검색 포매터가 `@wasm-fmt`(clang-format·gofmt·ruff·shfmt)를 지연 로드해 `WebAssembly` 를 컴파일한다 (`features/search/formatCode.ts`). `eval(`·`new Function` 은 빌드 산출물에 0곳이다(2026-10-07 dist 전수 확인) — `'unsafe-eval'` 은 없다. |
//! | `style-src 'self' 'unsafe-inline'` | `style={{…}}` 인라인 속성이 수백 곳이고 Monaco·xterm 이 `<style>` 을 만든다. Tauri 는 **빌드된 HTML 안의** `<style>`·인라인 `<script>` 에만 nonce 를 붙이는데(tauri-utils `inject_nonce_token`) 우리 index.html 에는 둘 다 없다 — nonce 가 붙으면 `'unsafe-inline'` 이 무시되니 이 사실이 이 줄의 전제다. |
//! | `img-src 'self' data: blob:` | 코드/SVG 미리보기는 `blob:`(`features/code/CodePreview.tsx`·`SvgPreview.tsx`), 첨부 미리보기는 `data:`. **원격 이미지는 막는다** — 에이전트가 쓴 일지·답의 `![](https://…)` 가 화면을 여는 순간 바깥으로 요청을 내던 길이었다. |
//! | `frame-src blob:` | PDF 미리보기 `<iframe src=blob:…>` (`CodePreview.tsx`). |
//! | `worker-src 'self' blob:` | Monaco 편집기 워커 (`/assets/editor.worker-*.js`, module 워커). |
//! | `connect-src 'self' ipc: http://ipc.localhost https://api.github.com` | Tauri IPC 가 `ipc://localhost`(Windows `http://ipc.localhost`) 로 나간다 — 빠뜨리면 모든 커맨드가 느린 postMessage 길로 떨어진다. 릴리스 노트는 프런트가 직접 부른다(`UpdateTab.tsx`·`WhatsNewCard.tsx`). 나머지 바깥 호출은 전부 Rust 쪽 — 목록은 `tests/egress_inventory.rs`. |
//! | `object-src 'none'` · `base-uri 'self'` · `form-action 'none'` | 쓰지 않는 문은 닫는다. 폼은 전부 JS 로 처리한다 — 네이티브 제출은 SPA 를 새로고침할 뿐이다. |
//!
//! # 확인 목록 (초안의 넷)
//!
//! 1. **개발 서버** — 데스크톱 `tauri dev` 는 웹뷰가 `devUrl` 을 **직접** 연다. Tauri 는
//!    자기 asset 프로토콜 응답에만 CSP 를 싣는다(tauri 2.11 `protocol/tauri.rs`;
//!    `dev` 프록시는 모바일 전용) — Vite 의 응답에는 안 실리므로 HMR 은 그대로다.
//!    e2e 의 `tauri build --debug` 는 내장 asset 을 쓰므로 운영과 같은 정책을 받는다.
//! 2. **터미널 WebGL 렌더러** — 캔버스라 CSP 대상이 아니다. 실패는 조용한 폴백이라
//!    macOS 실기기 확인 항목에 남긴다.
//! 3. **모바일 브리지**는 이 정책 밖이다 (같은 프런트를 HTTP 로 내주는 별도 오리진).
//! 4. **`assetProtocol` 은 꺼져 있다.** 켜면 `img-src`·`connect-src` 에
//!    `asset: http://asset.localhost` 를 함께 넣는다.

use std::path::PathBuf;

fn tauri_conf() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = std::fs::read_to_string(path).expect("tauri.conf.json");
    serde_json::from_str(&raw).expect("tauri.conf.json 은 유효한 JSON")
}

fn directive(conf: &serde_json::Value, name: &str) -> Vec<String> {
    conf["app"]["security"]["csp"][name]
        .as_str()
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

/// 정책이 켜져 있고, 앱이 실제로 쓰는 문은 열려 있으며, 열면 안 되는 문은 닫혀 있다.
#[test]
fn the_webview_csp_is_on_and_shaped_like_the_app() {
    let conf = tauri_conf();
    assert!(
        conf["app"]["security"]["csp"].is_object(),
        "CSP 가 꺼졌다 — 이 파일 머리말의 이유를 읽고 되돌려라"
    );

    let script = directive(&conf, "script-src");
    assert!(script.contains(&"'self'".into()) && script.contains(&"'wasm-unsafe-eval'".into()));
    for banned in [
        "'unsafe-eval'",
        "'unsafe-inline'",
        "*",
        "https:",
        "http:",
        "data:",
        "blob:",
    ] {
        assert!(
            !script.contains(&banned.to_string()),
            "script-src 에 {banned} 가 있다"
        );
    }
    let connect = directive(&conf, "connect-src");
    for need in [
        "'self'",
        "ipc:",
        "http://ipc.localhost",
        "https://api.github.com",
    ] {
        assert!(
            connect.contains(&need.to_string()),
            "connect-src 에 {need} 가 없다"
        );
    }
    for banned in ["*", "https:", "http:"] {
        assert!(
            !connect.contains(&banned.to_string()),
            "connect-src 에 {banned} 가 있다"
        );
    }
    let img = directive(&conf, "img-src");
    assert!(
        !img.iter().any(|s| s == "*" || s.starts_with("http")),
        "원격 이미지가 열렸다 — 에이전트가 쓴 마크다운이 바깥으로 요청을 낸다: {img:?}"
    );
    assert!(directive(&conf, "frame-src").contains(&"blob:".into()));
    assert!(directive(&conf, "worker-src").contains(&"'self'".into()));
    assert_eq!(directive(&conf, "object-src"), vec!["'none'".to_string()]);
    assert_eq!(directive(&conf, "default-src"), vec!["'self'".to_string()]);
}

/// 정책이 근거로 삼은 **코드 쪽 사실**이 아직 사실인가.
///
/// 사라졌으면 그 지시어를 뺄 수 있다는 신호다 — 정책이 좁아진다는 뜻이라 반가운
/// 실패다. 늘어난 쪽(새 원격 호출·새 wasm)은 e2e 의 CSP 위반 단계가 잡는다.
#[test]
fn the_policy_still_matches_what_the_frontend_actually_does() {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src");
    let read = |rel: &str| std::fs::read_to_string(src.join(rel)).unwrap_or_default();

    assert!(
        read("features/search/formatCode.ts").contains("wasm"),
        "wasm 포매터가 사라졌으면 'wasm-unsafe-eval' 을 뺄 수 있다"
    );
    assert!(
        read("features/code/CodePreview.tsx").contains("createObjectURL"),
        "blob: 미리보기가 사라졌으면 img-src/frame-src 의 blob: 을 뺄 수 있다"
    );
    for rel in [
        "features/settings/tabs/UpdateTab.tsx",
        "features/today/WhatsNewCard.tsx",
    ] {
        assert!(
            read(rel).contains("fetch("),
            "{rel} 이 더는 직접 fetch 하지 않으면 connect-src 에서 api.github.com 을 뺄 수 있다"
        );
    }
    assert!(
        read("main.tsx").contains("watchCspViolations"),
        "CSP 위반 감시가 빠지면 막힌 것이 조용히 사라진다 — e2e 도 그것을 읽는다"
    );
}
