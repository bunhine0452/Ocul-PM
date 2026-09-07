//! 웹뷰 CSP **초안** (플랜 `v3-release` {#webview-csp}).
//!
//! # 이 파일이 테스트인 이유
//!
//! 플랜이 "정책 **초안만** 두고 실행은 앱 실행 라운드" 라고 못박았다. 그래서
//! 초안을 적어 둘 자리가 필요했는데, 원래 자리인 `tauri.conf.json` 은 못 쓴다 —
//! JSON 에 주석이 없고, 별도 키도 안 된다(실측 2026-09-07):
//!
//! ```text
//! unknown field `_cspDraft`, expected one of `csp`, `dev-csp`, `devCsp`,
//! `freeze-prototype`, …
//! ```
//!
//! `app.security` 는 미지의 키를 **빌드 실패**로 거른다. 남은 자리는 원장이다 —
//! 이 저장소는 `tests/egress_inventory.rs` 로 같은 일을 이미 한다: 사실을 테스트가
//! 들고 있으면 조용히 낡지 않는다.
//!
//! # 지금 상태와 왜 안 켜는가
//!
//! `csp: null` — 웹뷰에 정책이 없다. 켜는 것이 옳지만 **이번 라운드에서는 범위
//! 밖**이다: CSP 위반은 콘솔에만 나고 화면은 조용히 빈 채로 남는다. 육안 확인을
//! 할 수 없는 라운드에서 켜면 "깨진 줄 모르는 앱"을 릴리스하게 된다.
//!
//! # 초안 (`app.security.csp` 에 넣을 값)
//!
//! ```text
//! default-src 'self';
//! script-src  'self' 'wasm-unsafe-eval';
//! style-src   'self' 'unsafe-inline';
//! font-src    'self';
//! img-src     'self' data: blob:;
//! media-src   'self' blob:;
//! frame-src   'self' blob:;
//! connect-src 'self' ipc: http://ipc.localhost https://api.github.com;
//! object-src  'none';
//! base-uri    'self';
//! form-action 'none';
//! ```
//!
//! # 각 줄이 왜 그 모양인가 — 실제 코드에서 확인한 것
//!
//! | 지시어 | 이렇게 두는 이유 (근거 파일) |
//! |---|---|
//! | `'wasm-unsafe-eval'` | 코드 검색 포매터가 `@wasm-fmt`(clang-format·gofmt·ruff·shfmt) 를 **동적 import 로 지연 로드**해 `WebAssembly` 를 컴파일한다 (`src/features/search/formatCode.ts`). 이게 빠지면 포매팅만 조용히 죽는다 — 화면은 원문을 그대로 보여줘서 **깨진 티가 안 난다**(그래서 더 위험하다). |
//! | `style-src 'unsafe-inline'` | `style={{…}}` 인라인 속성이 `src/features/**` 에만 332곳이다. CSP 는 인라인 **속성**도 막으므로 이걸 빼면 레이아웃이 통째로 무너진다. 줄이려면 그 332곳을 먼저 클래스로 옮겨야 한다 — 다른 라운드의 일. |
//! | `img-src data: blob:` | 문서 뷰어가 이미지를 base64 `data:` 로 받고(`commands/docs`), 코드/SVG 미리보기는 `URL.createObjectURL` 로 `blob:` 을 만든다 (`features/code/CodePreview.tsx`·`SvgPreview.tsx`). |
//! | `frame-src blob:` | PDF 미리보기가 `<iframe src=blob:…>` 로 웹뷰 내장 뷰어에 맡긴다 (`features/code/CodePreview.tsx`). |
//! | `connect-src … api.github.com` | 릴리스 노트를 프런트가 **직접** 부른다 (`features/settings/tabs/UpdateTab.tsx`·`features/today/WhatsNewCard.tsx`). 나머지 바깥 호출(LLM·Notion·플러그인 zip·테마·임베딩 모델)은 전부 Rust 쪽이라 웹뷰 CSP 와 무관하다 — 목록은 `tests/egress_inventory.rs`. |
//! | `connect-src ipc:` | Tauri IPC 자체가 이 스킴을 탄다. 빠뜨리면 **모든 커맨드가 죽는다** — 가장 크게 깨지는 한 줄이다. |
//! | `font-src 'self'` | 웹폰트는 전부 번들 woff2 다 (`src/App.css` 의 `@font-face` 가 `./assets/fonts/*.woff2`). Google Fonts 는 **안 쓴다** — 확인함. |
//! | `script-src` 에 `'unsafe-eval'` 없음 | `eval(`·`new Function` 이 프런트에 0곳이다. Prettier standalone 도 안 쓴다. |
//!
//! # 켜기 전에 반드시 확인할 것 (육안)
//!
//! 1. **개발 서버.** `devUrl` 이 `http://localhost:1420` 이라 dev 에서는
//!    `connect-src`·`script-src` 에 그 오리진과 HMR 웹소켓(`ws://localhost:1420`)이
//!    더 필요하다. Tauri 는 그 자리를 위해 `devCsp` 를 따로 둔다 — **prod 값을
//!    그대로 쓰면 `pnpm tauri dev` 가 먼저 깨진다.**
//! 2. **터미널 WebGL 렌더러** (`features/terminal/TerminalInstanceImpl.tsx`).
//!    캔버스라 CSP 대상은 아니지만, 실패가 조용한 폴백이라 눈으로 확인해야 한다.
//! 3. **모바일 브리지**는 이 정책 밖이다. 같은 프런트를 HTTP 로 내주는 별도
//!    오리진이라 `tauri.conf.json` 의 `csp` 가 안 실린다 (`mobile_bridge/`).
//! 4. **`assetProtocol` 이 꺼져 있다.** 지금 `convertFileSrc` 의 실사용처가 0인
//!    이유이기도 하다. 나중에 켜면 `img-src`·`connect-src` 에
//!    `asset: http://asset.localhost` 를 함께 넣어야 한다.

use std::path::PathBuf;

fn tauri_conf() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = std::fs::read_to_string(path).expect("tauri.conf.json");
    serde_json::from_str(&raw).expect("tauri.conf.json 은 유효한 JSON")
}

/// **아직 안 켰다** — 이 라운드의 결정을 못박는다.
///
/// 이 단언이 붉어졌다면 누군가 CSP 를 켠 것이다. 그 자체는 좋은 일이지만, 위
/// "켜기 전에 확인할 것" 넷을 실제로 눈으로 봤는지부터 물어야 한다. 봤으면 이
/// 테스트를 "정책이 이 초안을 덮는가" 로 바꿔 쓰면 된다.
#[test]
fn the_webview_csp_is_still_off_and_that_is_this_rounds_decision() {
    let conf = tauri_conf();
    assert!(
        conf["app"]["security"]["csp"].is_null(),
        "CSP 가 켜졌다 — 이 파일 머리말의 확인 목록 4개를 실기기에서 봤는가? \
         봤다면 이 테스트를 초안 대조로 바꿔라"
    );
}

/// 초안이 근거로 삼은 **코드 쪽 사실**이 아직 사실인가.
///
/// 초안만 적어 두면 다음 라운드가 켤 때쯤 근거가 낡아 있다. 여기서 무는 것은
/// "그 파일에 그 호출이 아직 있는가" 하나다 — 사라졌으면 그 지시어를 뺄 수 있다는
/// 신호이고, 그건 초안이 좁아진다는 뜻이라 반가운 실패다.
#[test]
fn the_draft_still_matches_what_the_frontend_actually_does() {
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
}
