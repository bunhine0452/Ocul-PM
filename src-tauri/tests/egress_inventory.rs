//! 「유출 경계 원장」 — 기기 밖으로 나가는 자리의 전수 대조
//! ({#egress-inventory-test}).
//!
//! # 무엇을 지키는가
//!
//! 이 제품의 1번 약속은 이것이다 — **"로컬 우선. 사용자가 만든 LLM API 호출과
//! 업데이트 확인 말고는 기기 밖으로 아무것도 안 나간다."** README·랜딩·
//! CLAUDE.md 가 전부 그렇게 적고 있는데, 그 약속을 **지키는 장치는 코드에
//! 없었다.** 누구든 `reqwest::Client::new()` 한 줄로 새 목적지를 늘릴 수
//! 있었고 아무 게이트도 울리지 않았다. 이 파일이 그 게이트다.
//!
//! # 왜 문자열 존재 단언이 아닌가
//!
//! 이 저장소는 "판정 로직을 지우고 `exit 2` 라는 글자만 남겨도 통과하던"
//! 테스트로 데인 적이 있다. `contains("reqwest")` 류는 **새 자리가 생겨도
//! 통과한다** — 무엇이 있는지만 보고 무엇이 늘었는지는 안 보기 때문이다.
//!
//! 그래서 판정은 **집합의 상등**이다. 셋 다 통과해야 한다:
//!
//! | | 대조 | 무엇을 잡는가 |
//! |---|---|---|
//! | A | 소스 스캔으로 찾은 **자리**의 집합 == 원장의 자리 집합 | 새 파일이 네트워크 프리미티브를 들면 실패. 원장의 자리가 사라져도 실패(죽은 항목이 남아 "가드가 있다"는 착시를 만든다) |
//! | B | 소스 전체의 절대 URL **호스트** 인구조사 == 원장의 선언 | 어디에 적히든 새 목적지가 생기면 실패. 파일 단위로 묶지 않는 이유는 실제 코드가 그렇지 않기 때문이다 — `RELEASES_API` 는 `lib/updater.ts` 에 있고 그걸 `fetch` 하는 자리는 다른 파일 둘이다 |
//! | C | 모든 원장 항목에 **사유 한 줄** | 사유 없는 면제는 면제가 아니라 방치다 |
//!
//! 즉 `Site` 표에 손을 대지 않고는 아웃바운드를 **늘릴 수도 줄일 수도** 없다.
//!
//! # 스캔의 규율
//!
//! - 자리(A)의 판정 재료는 **능력 프리미티브**다 (`reqwest::` · `TcpListener` · `fetch(`
//!   …). URL 문자열이 아니다 — 문자열은 주석과 테스트 픽스처에 흔하고,
//!   프리미티브 없이는 아무것도 나가지 못한다.
//! - **줄 전체 주석은 걷어낸다.** 문서 주석에 적힌 `https://build.nvidia.com`
//!   이 목적지로 오해되면 원장이 소음으로 죽는다. 줄 끝 주석은 걷지 않는다 —
//!   `"https://…"` 안의 `//` 를 주석으로 잘못 읽어 진짜 자리를 **숨길** 수
//!   있기 때문이다 (숨기는 쪽으로 틀리는 규칙은 쓰지 않는다).
//! - `#[cfg(test)]` 는 **걷어내지 않는다.** 잘라 내는 규칙은 언제나 진짜
//!   자리를 함께 자를 위험이 있다. 테스트 픽스처 호스트는 사유를 달아 원장에
//!   싣는다.
//!
//! # 곁들여 세는 것 ({#redact-doc-truth})
//!
//! 같은 관용구로 두 가지를 더 센다: 리댁션을 지나는 파일 수와, 모델에게 가는
//! 프롬프트 중 **리댁션을 안 지나는** 자리. `oculpm::redact` 의 모듈 문서가
//! 그 숫자를 주장하고, 여기가 실측과 대조한다.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

// ─────────────────────────────────────────────────────────────────────────────
// 원장의 모양
// ─────────────────────────────────────────────────────────────────────────────

/// 이 자리가 무엇으로 통제되는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Control {
    /// 코드가 목적지·스킴을 **실제로 검사한다**. 괄호 안은 그 검사기.
    Guarded(&'static str),
    /// 검사는 없고, 제품 약속이 명시적으로 허용하는 자리다 — 사유가 근거다.
    Exempt,
    /// 기기를 벗어나지 않는다 (루프백 바인드·OS 위임 등).
    LocalOnly,
}

/// 아웃바운드 자리 한 곳.
struct Site {
    /// `src-tauri/src/` 또는 `src/` 기준 상대 경로.
    path: &'static str,
    /// 이 파일이 든 네트워크 프리미티브. 스캔 결과와 정확히 같아야 한다.
    primitives: &'static [&'static str],
    control: Control,
    /// **한 줄 사유.** 비면 테스트가 거부한다.
    reason: &'static str,
}

/// Rust 쪽에서 "무언가 기기 밖과 말을 섞을 수 있다" 를 뜻하는 토큰.
const RUST_PRIMITIVES: &[&str] = &[
    "reqwest::",
    "ureq::",
    "tauri_plugin_http",
    "TcpStream",
    "TcpListener",
    "tauri_plugin_updater",
    "UpdaterExt",
    "tauri_plugin_opener",
    "TextEmbedding::try_new",
    "xdg-open",
];

/// 웹뷰 쪽. `fetch(` 는 인자가 있는 호출만 센다 (`void fetch()` 같은 지역
/// 함수 호출을 자리로 오해하지 않게).
const WEB_PRIMITIVES: &[&str] = &[
    "XMLHttpRequest",
    "new WebSocket",
    "sendBeacon",
    "EventSource",
    "fetch(",
];

// ─────────────────────────────────────────────────────────────────────────────
// 원장 — Rust
// ─────────────────────────────────────────────────────────────────────────────

const RUST_SITES: &[Site] = &[
    // ── 약속의 예외 ①: 사용자가 만든 LLM API 호출 ──
    Site {
        path: "llm/anthropic.rs",
        primitives: &["reqwest::"],
        control: Control::Exempt,
        reason: "약속의 예외 ① — 사용자가 자기 키로 만든 LLM 호출. 키는 키체인, 목적지는 상수 하나뿐이다.",
    },
    Site {
        path: "llm/openai.rs",
        primitives: &["reqwest::"],
        control: Control::Exempt,
        reason: "약속의 예외 ① — OpenAI 및 OpenAI 호환(OpenRouter). oculpm.com 은 목적지가 아니라 OpenRouter 어트리뷰션 헤더(HTTP-Referer) 값이다.",
    },
    Site {
        path: "llm/gemini.rs",
        primitives: &["reqwest::"],
        control: Control::Exempt,
        reason: "약속의 예외 ① — Google Gemini. 목적지는 상수 하나, 키는 키체인에서 온다.",
    },
    Site {
        path: "llm/nim.rs",
        primitives: &["reqwest::"],
        control: Control::Exempt,
        reason: "약속의 예외 ① — NVIDIA NIM (OpenAI 호환 와이어). 목적지는 상수 하나뿐이다.",
    },
    Site {
        path: "llm/mod.rs",
        primitives: &["reqwest::"],
        control: Control::Exempt,
        reason: "어댑터 공통 타입·SSE 포워더. 자기 목적지가 없다 — 위 넷의 응답만 다룬다.",
    },
    // ── 약속의 예외 ②: 업데이트 확인 ──
    Site {
        path: "lib.rs",
        primitives: &["tauri_plugin_updater", "tauri_plugin_opener"],
        control: Control::Guarded("tauri.conf.json 의 endpoints + minisign pubkey"),
        reason: "약속의 예외 ② — 업데이터 플러그인 등록. 목적지는 설정에 고정돼 있고 서명 검증을 거친다 (updater_endpoints_are_exactly_the_declared_one 이 잠근다).",
    },
    // ── 약속에 적혀 있지 않은 자리 (이 라운드의 발견) ──
    Site {
        path: "notion.rs",
        primitives: &["reqwest::"],
        control: Control::Exempt,
        reason: "사용자가 Notion 연결을 켠 뒤의 아웃바운드. oculpm.com 은 OAuth 교환 브로커(벤더 서버)이고 www.notion.so 는 테스트 픽스처 URL이다 — **약속 문구가 이 예외를 아직 안 적고 있다** (후속으로 남긴다).",
    },
    Site {
        path: "commands/notion.rs",
        primitives: &["TcpListener", "xdg-open"],
        control: Control::LocalOnly,
        reason: "OAuth 콜백용 127.0.0.1 루프백 리스너 + 브라우저 위임. 자기 목적지가 없다 (URL 은 notion.rs 상수).",
    },
    Site {
        path: "plugins/source.rs",
        primitives: &["reqwest::"],
        control: Control::Guarded("GithubSource::zip_url — owner/repo 만 조립, 호스트 상수"),
        reason: "사용자가 명시적으로 요청한 플러그인 번들 내려받기. 호스트는 코드 상수라 임의 서버로 못 간다 (github.com 은 테스트 픽스처).",
    },
    Site {
        path: "commands/themes.rs",
        primitives: &["reqwest::"],
        control: Control::Guarded("deeplink::validate_theme_url — https + 호스트 화이트리스트"),
        reason: "테마 설치 내려받기. URL 은 사용자/딥링크가 주지만 THEME_HOSTS 화이트리스트를 지나야 한다 (theme_host_allowlist_stays_closed 이 잠근다).",
    },
    Site {
        path: "embedding.rs",
        primitives: &["TextEmbedding::try_new"],
        control: Control::Exempt,
        reason: "fastembed 가 첫 실행에 ONNX 모델(~135MB)을 HuggingFace 에서 내려받는다 — **내려받기만** 하고 프로젝트 내용은 보내지 않는다. 그 뒤로는 전부 온디바이스다.",
    },
    Site {
        path: "commands/external_editor.rs",
        primitives: &["xdg-open"],
        control: Control::Guarded("open_url — http/https/mailto 스킴만"),
        reason: "링크를 OS 기본 브라우저에 넘긴다. 앱이 보내는 것이 아니라 사용자의 브라우저가 연다 (위임).",
    },
    Site {
        path: "commands/oculpm.rs",
        primitives: &["xdg-open"],
        control: Control::LocalOnly,
        reason: "로그 폴더·일지 파일을 OS 기본 앱으로 연다 — 로컬 경로뿐, URL 이 아니다.",
    },
    // ── 인바운드(듣는 쪽). 나가지는 않지만 경계는 경계다 ──
    Site {
        path: "mobile_bridge/server.rs",
        primitives: &["TcpListener"],
        control: Control::LocalOnly,
        reason: "폰 웹앱용 LAN 바인드 — 사용자가 켤 때만 뜨고, 나가는 것이 아니라 **듣는다**. 페어링 토큰이 문을 지킨다.",
    },
    Site {
        path: "oculpm/a2a/http.rs",
        primitives: &["TcpListener"],
        control: Control::LocalOnly,
        reason: "멀티에이전트 원장의 로컬 HTTP 문 — 127.0.0.1 에만 바인드한다 (기기 밖에서 닿지 않는다).",
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// 원장 — 목적지 호스트 (소스 전체 인구조사)
// ─────────────────────────────────────────────────────────────────────────────

/// 소스에 절대 URL 로 적힌 호스트 전부. **목적지가 아닌 것도 들어 있다** —
/// 스캐너에 "이건 세지 않아도 된다" 는 판단을 넣기 시작하면 언젠가 진짜
/// 목적지를 숨기기 때문이다. 사유가 그 구분을 적는다.
const HOST_LEDGER: &[(&str, &str)] = &[
    // ── 실제로 나가는 곳 ──
    ("api.anthropic.com", "약속의 예외 ① — Anthropic LLM 엔드포인트 (llm/anthropic.rs)."),
    ("api.openai.com", "약속의 예외 ① — OpenAI LLM 엔드포인트."),
    ("openrouter.ai", "약속의 예외 ① — OpenRouter (OpenAI 호환)."),
    ("generativelanguage.googleapis.com", "약속의 예외 ① — Gemini LLM 엔드포인트."),
    ("integrate.api.nvidia.com", "약속의 예외 ① — NVIDIA NIM LLM 엔드포인트."),
    ("api.github.com", "약속의 예외 ② — 릴리스 목록 읽기. `src/lib/updater.ts` 의 RELEASES_API 가 소유하고 Today 카드·설정 업데이트 탭이 부른다."),
    ("api.notion.com", "사용자가 Notion 연동을 켠 뒤의 아웃바운드 (notion.rs)."),
    ("codeload.github.com", "사용자가 명시적으로 요청한 플러그인 번들 zip 다운로드."),
    ("oculpm.com", "셋을 겸한다 — 테마 화이트리스트 호스트, Notion OAuth 교환 브로커(벤더 서버), OpenRouter 어트리뷰션 헤더 값. **약속 문구가 OAuth 브로커를 아직 안 적고 있다.**"),
    ("raw.githubusercontent.com", "테마 설치 화이트리스트의 두 번째 호스트 (deeplink::THEME_HOSTS)."),
    // ── 브라우저에 넘기는 링크 (앱이 보내지 않는다) ──
    ("github.com", "저장소·이슈·릴리스 링크 — open_url 로 OS 브라우저에 위임한다. plugins/source.rs 의 테스트 픽스처이기도 하다."),
    ("www.notion.so", "사용자의 Notion 페이지 링크 — 브라우저 위임. notion.rs 에서는 URL 파서의 테스트 픽스처다."),
    // ── 목적지가 아닌 것 ──
    ("127.0.0.1:8737", "루프백 — a2a 로컬 HTTP 문의 기본 주소. 기기 밖에서 닿지 않는다."),
    ("mcp.notion.com", "앱이 부르지 않는다 — 에이전트 CLI 설정 파일(.mcp.json/config.toml)에 **적히는 값**이고, 그 파서의 테스트 픽스처다."),
    ("www.w3.org", "SVG 네임스페이스 URI — 네트워크 요청이 아니다 (xmlns 속성)."),
    // ── 테스트 픽스처 ──
    ("OCULPM.com:443", "deeplink 테스트 — 대소문자·포트가 붙어도 같은 판정을 받는지."),
    ("evil.test", "deeplink 테스트 — 화이트리스트 밖 호스트가 거부되는지."),
    ("oculpm.com@evil.test", "deeplink 테스트 — `@` 자격증명 트릭으로 화이트리스트를 속일 수 없는지."),
    ("example.com", "lsp/discussion 파서 픽스처 — URI 를 파일 경로로 오인하지 않는지."),
    ("docs.example.com", "defer_ledger 픽스처 — 문자열 리터럴 속 `//` 를 주석으로 읽지 않는지."),
    ("rubygems.org", "stack_detect 픽스처 — Gemfile 내용 샘플."),
];

// ─────────────────────────────────────────────────────────────────────────────
// 원장 — 웹뷰
// ─────────────────────────────────────────────────────────────────────────────

const WEB_SITES: &[Site] = &[
    Site {
        path: "features/today/WhatsNewCard.tsx",
        primitives: &["fetch("],
        control: Control::Exempt,
        reason: "약속의 예외 ② — 릴리스 노트 읽기(GitHub public API). 보내는 것은 없다.",
    },
    Site {
        path: "features/settings/tabs/UpdateTab.tsx",
        primitives: &["fetch("],
        control: Control::Exempt,
        reason: "약속의 예외 ② — 같은 릴리스 목록을 설정 업데이트 탭에서.",
    },
    Site {
        path: "lib/transport/http.ts",
        primitives: &["fetch("],
        control: Control::LocalOnly,
        reason: "모바일 웹앱이 로컬 브리지에 커맨드를 부른다 — 상대 경로(`/api/invoke/…`)라 같은 출처, 즉 이 기기다.",
    },
    Site {
        path: "lib/transport/sse.ts",
        primitives: &["fetch("],
        control: Control::LocalOnly,
        reason: "같은 브리지의 이벤트 스트림(`/api/events`). EventSource 는 Authorization 헤더를 못 실어 fetch 스트리밍으로 읽는다. 상대 경로.",
    },
    Site {
        path: "mobile/MobileApp.tsx",
        primitives: &["fetch("],
        control: Control::LocalOnly,
        reason: "브리지 헬스 체크(`/api/ping`). 상대 경로.",
    },
    Site {
        path: "mobile/PairScreen.tsx",
        primitives: &["fetch("],
        control: Control::LocalOnly,
        reason: "브리지 페어링(`/pair`). 상대 경로.",
    },
    Site {
        path: "mobile/tabs/AiTab.tsx",
        primitives: &["fetch("],
        control: Control::LocalOnly,
        reason: "브리지 경유 채팅(`/api/chat`) — 실제 프로바이더 호출은 Rust 쪽 llm/ 이 한다. 상대 경로.",
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// 원장 — 모델에게 가는 프롬프트 ({#redact-doc-truth})
// ─────────────────────────────────────────────────────────────────────────────

/// 프롬프트가 리댁션을 어떻게 지나는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Redaction {
    /// 이 파일이 `redact_text`/`patterns_for_project` 를 직접 부른다.
    Direct,
    /// 마스킹된 캐시 투영이나 리댁션을 지난 모듈에서 재료를 받는다.
    ViaProjection,
    /// 지나지 않는다 — **면제**. 사유가 근거다.
    None,
}

struct PromptSite {
    path: &'static str,
    redaction: Redaction,
    reason: &'static str,
}

/// 모델 호출을 조립하는 자리 전부. 스캔 결과와 정확히 같아야 한다.
const LLM_PROMPT_SITES: &[PromptSite] = &[
    PromptSite {
        path: "commands/llm.rs",
        redaction: Redaction::None,
        reason: "면제 — AI 패널의 사용자 작성 대화. 사용자가 직접 만든 호출이 약속의 예외 ① 이고, 자기가 친 글을 자기에게서 가릴 이유가 없다.",
    },
    PromptSite {
        path: "mobile_bridge/server.rs",
        redaction: Redaction::None,
        reason: "면제 — 폰이 보낸 대화를 그대로 중계한다 (commands/llm.rs 와 같은 성격).",
    },
    PromptSite {
        path: "commands/overview.rs",
        redaction: Redaction::None,
        reason: "면제 — README·매니페스트·디렉터리 구조를 디스크에서 **직접** 읽어 보낸다. 에이전트가 쓴 글이 아니라 저장소 파일이라 캐시 투영을 지나지 않는다.",
    },
    PromptSite {
        path: "commands/greenfield.rs",
        redaction: Redaction::None,
        reason: "면제 — 사용자가 마법사에 방금 직접 쓴 청사진 텍스트. 에이전트가 쓴 글이 섞이지 않는다.",
    },
    PromptSite {
        path: "commands/summary.rs",
        redaction: Redaction::ViaProjection,
        reason: "`range_entries` 만 읽는다 — 캐시는 투영 시점에 마스킹된다 (모듈 문서 §원칙).",
    },
    PromptSite {
        path: "oculpm/reconcile.rs",
        redaction: Redaction::ViaProjection,
        reason: "`JournalCache::with_redaction` 으로 일지를 읽어 화해 프롬프트를 만든다.",
    },
    PromptSite {
        path: "commands/plan.rs",
        redaction: Redaction::ViaProjection,
        reason: "`project_redact_patterns` → `planner::dispatch` 가 프롬프트를 마스킹해 조립한다.",
    },
    PromptSite {
        path: "commands/rule_promotion.rs",
        redaction: Redaction::ViaProjection,
        reason: "규칙 승격의 증거 발췌를 `oculpm::rule_promotion` 이 리댁션을 지나 만들어 넘긴다.",
    },
    PromptSite {
        path: "commands/skill_promotion.rs",
        redaction: Redaction::ViaProjection,
        reason: "스킬 승격의 증거 발췌를 `oculpm::skill_promotion` 이 리댁션을 지나 만들어 넘긴다.",
    },
    PromptSite {
        path: "commands/retro.rs",
        redaction: Redaction::Direct,
        reason: "회고 신호(일지 제목·본문 발췌)를 보내기 전에 직접 마스킹한다.",
    },
    PromptSite {
        path: "commands/skills.rs",
        redaction: Redaction::Direct,
        reason: "스킬 초안·카탈로그 재료(일지 발췌)를 보내기 전에 직접 마스킹한다.",
    },
    PromptSite {
        path: "oculpm/journal_draft/mod.rs",
        redaction: Redaction::Direct,
        reason: "일지 초안의 입력과 모델 응답 양쪽을 마스킹한다 (이중 방어).",
    },
    PromptSite {
        path: "oculpm/automation/runner/mod.rs",
        redaction: Redaction::Direct,
        reason: "자동화 산출물에 이중 방어 — 응답에 섞여 돌아온 시크릿까지 일지에 닿기 전에 가린다.",
    },
];

/// 모델 호출을 실제로 여는 토큰.
const LLM_CALL_TOKENS: &[&str] = &[
    "llm::create",
    "commands::llm::chat",
    "commands::llm::chat_detailed",
    "commands::llm::run_chat_stream",
];

/// 리댁션 진입점 — `oculpm::redact` 를 부르는 토큰.
const REDACT_TOKENS: &[&str] = &[
    "redact_text",
    "compile_redact_patterns",
    "patterns_for_project",
];

// ─────────────────────────────────────────────────────────────────────────────
// 스캐너
// ─────────────────────────────────────────────────────────────────────────────

fn crate_src() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn web_src() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src")
}

fn walk(root: &Path, exts: &[&str], out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, exts, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| exts.contains(&e))
        {
            out.push(path);
        }
    }
}

/// 줄 전체 주석(`//` · `///` · `//!`)을 걷어낸다.
///
/// 줄 **끝** 주석은 걷지 않는다: `"https://api.example.com"` 안의 `//` 를
/// 주석 시작으로 읽으면 진짜 목적지가 사라진다. 숨기는 쪽으로 틀리는 규칙은
/// 원장 테스트에 둘 수 없다.
fn strip_line_comments(text: &str) -> String {
    text.lines()
        .map(|l| {
            if l.trim_start().starts_with("//") {
                ""
            } else {
                l
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 이 텍스트가 프리미티브를 들고 있는가. `fetch(` 만 인자 유무를 본다.
fn has_primitive(text: &str, primitive: &str) -> bool {
    if primitive != "fetch(" {
        return text.contains(primitive);
    }
    // `fetch(` 뒤에 인자가 오는 호출만 — `void fetch()` 는 지역 함수다.
    text.match_indices("fetch(").any(|(i, _)| {
        // `$fetch(` / `prefetch(` 같은 다른 식별자의 꼬리는 세지 않는다.
        let ok_prefix = i == 0
            || !text[..i]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '$' || c == '.');
        ok_prefix
            && text[i + "fetch(".len()..]
                .trim_start()
                .starts_with(|c: char| c != ')')
    })
}

/// 절대 URL 의 호스트(포트 포함)를 모은다. 보간 자리(`{bound}`)는 버린다.
fn hosts_in(text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for scheme in ["https://", "http://"] {
        let mut rest = text;
        while let Some(i) = rest.find(scheme) {
            let after = &rest[i + scheme.len()..];
            let host: String = after
                .chars()
                .take_while(|c| !matches!(c, '/' | '"' | '\'' | '`' | ')' | ' ' | '\\' | '?' | '#'))
                .collect();
            let consumed = host.len().min(after.len());
            if !host.is_empty() && !host.contains('{') && host.contains('.') {
                out.insert(host);
            }
            rest = &after[consumed..];
        }
    }
    out
}

/// `(상대경로, 프리미티브 목록)` — 프리미티브를 하나라도 든 파일만.
fn scan(
    root: &Path,
    exts: &[&str],
    primitives: &[&str],
    skip: &[&str],
) -> Vec<(String, Vec<String>)> {
    let mut files = Vec::new();
    walk(root, exts, &mut files);
    files.sort();

    let mut out = Vec::new();
    for path in files {
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if skip.iter().any(|s| rel.starts_with(s) || rel == *s) {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let text = strip_line_comments(&raw);
        let found: Vec<String> = primitives
            .iter()
            .filter(|p| has_primitive(&text, p))
            .map(|p| p.to_string())
            .collect();
        if !found.is_empty() {
            out.push((rel, found));
        }
    }
    out
}

/// 토큰을 하나라도 부르는 비테스트 파일의 상대 경로.
fn files_calling(root: &Path, exts: &[&str], tokens: &[&str], skip: &[&str]) -> BTreeSet<String> {
    let mut files = Vec::new();
    walk(root, exts, &mut files);
    let mut out = BTreeSet::new();
    for path in files {
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if rel.ends_with("tests.rs") || rel.contains("/tests/") || skip.contains(&rel.as_str()) {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let text = strip_line_comments(&raw);
        if tokens.iter().any(|t| text.contains(t)) {
            out.insert(rel);
        }
    }
    out
}

fn ledger_paths(sites: &[Site]) -> BTreeSet<String> {
    sites.iter().map(|s| s.path.to_string()).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 자리 대조
// ─────────────────────────────────────────────────────────────────────────────

/// 소스에서 네트워크 프리미티브를 든 Rust 파일의 집합이 원장과 **정확히**
/// 같다. 늘어도 실패, 줄어도 실패.
#[test]
fn every_rust_outbound_site_is_in_the_ledger() {
    let found = scan(&crate_src(), &["rs"], RUST_PRIMITIVES, &[]);
    let found_paths: BTreeSet<String> = found.iter().map(|(p, _)| p.clone()).collect();
    let declared = ledger_paths(RUST_SITES);

    let added: Vec<_> = found_paths.difference(&declared).collect();
    assert!(
        added.is_empty(),
        "원장에 없는 아웃바운드 자리가 생겼다: {added:?}\n\
         → tests/egress_inventory.rs 의 RUST_SITES 에 **사유 한 줄과 함께** 등록하라. \
         제품의 1번 약속이 걸린 표다."
    );
    let gone: Vec<_> = declared.difference(&found_paths).collect();
    assert!(
        gone.is_empty(),
        "원장에 있는데 소스에 없는 자리: {gone:?}\n\
         → 지웠다면 표에서도 지워라. 죽은 항목이 남으면 '가드가 있다'는 착시가 된다."
    );

    // 프리미티브 목록까지 같아야 한다 — 같은 파일이 새 능력을 들면 잡힌다.
    for (path, primitives) in &found {
        let site = RUST_SITES.iter().find(|s| s.path == path).unwrap();
        let declared: BTreeSet<&str> = site.primitives.iter().copied().collect();
        let actual: BTreeSet<&str> = primitives.iter().map(String::as_str).collect();
        assert_eq!(
            actual, declared,
            "{path} 의 네트워크 프리미티브가 원장과 다르다"
        );
    }
}

/// 같은 판정을 웹뷰 소스에도. `src/lib/bindings.ts`(생성물)와 테스트·스킬
/// 카탈로그(마크다운 예제)는 스캔에서 뺀다.
#[test]
fn every_webview_outbound_site_is_in_the_ledger() {
    let skip = ["lib/bindings.ts", "__tests__", "features/skills/catalog"];
    let found = scan(&web_src(), &["ts", "tsx"], WEB_PRIMITIVES, &skip);
    let found_paths: BTreeSet<String> = found.iter().map(|(p, _)| p.clone()).collect();
    let declared = ledger_paths(WEB_SITES);

    let added: Vec<_> = found_paths.difference(&declared).collect();
    assert!(
        added.is_empty(),
        "원장에 없는 웹뷰 아웃바운드 자리가 생겼다: {added:?}\n\
         → WEB_SITES 에 사유와 함께 등록하라. CSP 가 null 이라 웹뷰는 아무 데나 갈 수 있다."
    );
    let gone: Vec<_> = declared.difference(&found_paths).collect();
    assert!(gone.is_empty(), "원장에 있는데 소스에 없는 자리: {gone:?}");

    for (path, primitives) in &found {
        let site = WEB_SITES.iter().find(|s| s.path == path).unwrap();
        let declared: BTreeSet<&str> = site.primitives.iter().copied().collect();
        let actual: BTreeSet<&str> = primitives.iter().map(String::as_str).collect();
        assert_eq!(actual, declared, "{path} 의 프리미티브가 원장과 다르다");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// B. 목적지 대조
// ─────────────────────────────────────────────────────────────────────────────

/// 소스 전체의 절대 URL **호스트 인구조사**. 어디에 적히든 새 목적지가
/// 생기면 여기서 걸린다.
///
/// 파일 단위로 묶지 않는 이유는 실제 코드가 그렇지 않기 때문이다 —
/// `RELEASES_API` 는 `lib/updater.ts` 상수이고 그걸 `fetch` 하는 자리는 다른
/// 파일 둘이다. 자리와 목적지를 한 파일에 묶는 모델은 그 흔한 간접을 놓친다.
///
/// 목적지가 **아닌** 호스트(SVG 네임스페이스·테스트 픽스처·설정 값)도 표에
/// 있다. 뺄 수는 없다 — 빼려면 "이건 안 세도 된다" 는 판단을 스캐너에 넣어야
/// 하고, 그 판단이 언젠가 진짜 목적지를 숨긴다. 대신 사유가 그 사실을 적는다.
#[test]
fn no_absolute_url_host_appears_outside_the_ledger() {
    let mut found: BTreeSet<String> = BTreeSet::new();
    for (root, exts, skip) in [
        (crate_src(), &["rs"][..], &[][..]),
        (
            web_src(),
            &["ts", "tsx"][..],
            &["lib/bindings.ts", "__tests__", "features/skills/catalog"][..],
        ),
    ] {
        let mut files = Vec::new();
        walk(&root, exts, &mut files);
        for path in files {
            let rel = path
                .strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if skip.iter().any(|s| rel.starts_with(s)) {
                continue;
            }
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            found.extend(hosts_in(&strip_line_comments(&raw)));
        }
    }

    let declared: BTreeSet<String> = HOST_LEDGER.iter().map(|(h, _)| h.to_string()).collect();
    let added: Vec<_> = found.difference(&declared).collect();
    assert!(
        added.is_empty(),
        "원장에 없는 목적지 호스트가 소스에 나타났다: {added:?}\n\
         → tests/egress_inventory.rs 의 HOST_LEDGER 에 **사유 한 줄과 함께** 등록하라."
    );
    let gone: Vec<_> = declared.difference(&found).collect();
    assert!(
        gone.is_empty(),
        "원장에 있는데 소스에 없는 호스트: {gone:?} — 지웠으면 표에서도 지워라."
    );

    for (host, reason) in HOST_LEDGER {
        assert!(
            reason.trim().chars().count() >= 12,
            "{host}: 사유가 없다 — 목적지 목록은 근거 없이 유지되면 통과 의식이 된다"
        );
    }
}

/// 업데이터의 목적지는 **하나**다. 설정 파일이 원장의 두 번째 반쪽이라
/// 여기서 함께 잠근다.
#[test]
fn updater_endpoints_are_exactly_the_declared_one() {
    let conf: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
            .unwrap(),
    )
    .unwrap();
    let endpoints = conf["plugins"]["updater"]["endpoints"]
        .as_array()
        .expect("updater.endpoints");
    let got: Vec<&str> = endpoints.iter().filter_map(|v| v.as_str()).collect();
    assert_eq!(
        got,
        vec!["https://github.com/bunhine0452/Ocul-PM/releases/latest/download/latest.json"],
        "업데이트 확인의 목적지가 바뀌었다 — 약속의 예외 ② 는 이 한 곳이다"
    );
    assert!(
        conf["plugins"]["updater"]["pubkey"]
            .as_str()
            .is_some_and(|k| !k.is_empty()),
        "서명 검증 없는 업데이터는 임의 코드 실행 경로다"
    );
}

/// 테마 설치의 호스트 화이트리스트는 닫혀 있다 — `commands/themes.rs` 의
/// 유일한 가드라서, 여기가 열리면 그 자리는 "임의 서버 다운로더" 가 된다.
#[test]
fn theme_host_allowlist_stays_closed() {
    use ocul_pm_lib::deeplink;
    assert_eq!(
        deeplink::THEME_HOSTS,
        &["oculpm.com", "www.oculpm.com", "raw.githubusercontent.com"],
        "테마 호스트 화이트리스트가 넓어졌다"
    );
    assert!(deeplink::validate_theme_url("https://evil.test/t.json").is_err());
    assert!(deeplink::validate_theme_url("http://oculpm.com/t.json").is_err());
    assert!(deeplink::validate_theme_url("https://oculpm.com@evil.test/t.json").is_err());
}

/// git 은 로컬 전용이라는 주장(`git.rs` — "no token, no network")을 실제로
/// 잡는다.
///
/// **git 을 실제로 띄우는 파일만** 본다. 소스 전체에서 `"push"` 를 찾으면
/// LSP 자동완성 픽스처의 `{"label": "push"}` 가 걸린다 — 오탐이 한 번 나면
/// 다음 사람이 게이트를 느슨하게 만들고, 그때 진짜가 새어 나간다.
///
/// 자리 목록을 **손으로 들지 않는다**: 새 파일이 git 을 띄우기 시작하면
/// 스캔이 알아서 데려온다. 원장을 손으로 든 곳(RUST_SITES)과 다른 선택인
/// 이유는, 여기서 지키려는 것이 "누가 띄우는가" 가 아니라 "무엇을 띄우는가"
/// 이기 때문이다 — 전자는 늘어나도 무해하고 후자는 하나만 늘어도 약속이 깨진다.
#[test]
fn git_stays_local_only() {
    let spawners = files_calling(&crate_src(), &["rs"], &["Command::new(\"git\")"], &[]);
    assert!(
        spawners.len() >= 3,
        "git 을 띄우는 파일을 {}개밖에 못 찾았다 — 스캐너가 낡아 검사가 헛돌고 있다",
        spawners.len()
    );

    for rel in &spawners {
        let text = strip_line_comments(&std::fs::read_to_string(crate_src().join(rel)).unwrap());
        // 인자로 넘어가는 형태만 본다 (`&["push", …]` · `.arg("push")`).
        for banned in ["push", "clone", "fetch", "pull"] {
            for shape in [
                format!("\"{banned}\","),
                format!("\"{banned}\"]"),
                format!("arg(\"{banned}\")"),
            ] {
                assert!(
                    !text.contains(&shape),
                    "{rel}: git 네트워크 서브커맨드 `{banned}` — git 은 로컬 전용 계약이다 \
                     (토큰도 없고 원격도 안 건드린다는 것이 README 의 주장이다)"
                );
            }
        }
    }
}

/// 원장을 우회하는 고전적인 두 경로 — 하위 프로세스로 `curl`/`wget` 을 띄우기.
#[test]
fn nothing_shells_out_to_curl_or_wget() {
    let mut files = Vec::new();
    walk(&crate_src(), &["rs"], &mut files);
    for path in files {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let text = strip_line_comments(&raw);
        for banned in ["Command::new(\"curl\")", "Command::new(\"wget\")"] {
            assert!(
                !text.contains(banned),
                "{}: {banned} — 하위 프로세스로 나가면 유출 원장을 우회한다",
                path.display()
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// C. 사유 필수
// ─────────────────────────────────────────────────────────────────────────────

/// **사유 없는 면제는 거부한다.** 원장의 값은 목록이 아니라 근거다 — 근거가
/// 없으면 "왜 이게 여기 있지" 를 다음 사람이 다시 추측하게 되고, 그러면 표는
/// 통과 의식으로 전락한다.
#[test]
fn every_ledger_entry_carries_a_reason() {
    let mut seen = BTreeSet::new();
    for site in RUST_SITES.iter().chain(WEB_SITES) {
        assert!(seen.insert(site.path), "{} 가 원장에 두 번 있다", site.path);
        let reason = site.reason.trim();
        assert!(
            reason.chars().count() >= 20,
            "{}: 사유가 없거나 너무 짧다 — 사유 없는 면제는 면제가 아니라 방치다",
            site.path
        );
        // 가드가 있다고 적었으면 그 검사기의 이름을 적어야 한다.
        if let Control::Guarded(guard) = site.control {
            assert!(
                !guard.trim().is_empty(),
                "{}: 가드 이름이 비었다 — 이름 없는 가드는 확인할 수 없다",
                site.path
            );
        }
    }
    for site in LLM_PROMPT_SITES {
        assert!(
            site.reason.trim().chars().count() >= 20,
            "{}: 프롬프트 자리의 사유가 없다",
            site.path
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// {#redact-doc-truth} — 셀 수 있는 것은 센다
// ─────────────────────────────────────────────────────────────────────────────

/// `oculpm::redact` 모듈 문서가 주장하는 파일 수를 **실측과 대조**한다.
///
/// 그 문단은 "three places" 라고 적힌 채 석 달을 살아 있었다. 실제로는 스무
/// 곳이 넘었다. 손으로 세는 숫자는 낡는다 — 그러니 세지 말고 재게 한다.
#[test]
fn the_redaction_doc_count_matches_the_tree() {
    let files = files_calling(&crate_src(), &["rs"], REDACT_TOKENS, &["oculpm/redact.rs"]);
    assert_eq!(
        files.len(),
        ocul_pm_lib::oculpm::redact::CALL_SITE_FILES,
        "리댁션 호출 파일 수가 모듈 문서의 주장과 다르다.\n  실측 {}개: {files:#?}\n\
         → `redact::CALL_SITE_FILES` 를 같은 커밋에서 고쳐라.",
        files.len()
    );
}

/// 모델에게 프롬프트를 보내는 자리 전부가 원장에 있고, 그중 **리댁션을 안
/// 지나는 면제의 수**가 모듈 문서의 주장과 같다.
///
/// 새 LLM 호출을 붙이면 여기서 걸린다 — 그때 답해야 하는 질문은 하나다:
/// "이 프롬프트에 에이전트가 쓴 글이 섞이는가?"
#[test]
fn every_llm_prompt_site_declares_how_it_meets_redaction() {
    let found = files_calling(&crate_src(), &["rs"], LLM_CALL_TOKENS, &[]);
    let declared: BTreeSet<String> = LLM_PROMPT_SITES
        .iter()
        .map(|s| s.path.to_string())
        .collect();

    let added: Vec<_> = found.difference(&declared).collect();
    assert!(
        added.is_empty(),
        "원장에 없는 모델 호출 자리가 생겼다: {added:?}\n\
         → LLM_PROMPT_SITES 에 등록하고 리댁션을 어떻게 지나는지 적어라."
    );
    let gone: Vec<_> = declared.difference(&found).collect();
    assert!(
        gone.is_empty(),
        "원장에 있는데 소스에 없는 모델 호출: {gone:?}"
    );

    let exempt = LLM_PROMPT_SITES
        .iter()
        .filter(|s| s.redaction == Redaction::None)
        .count();
    assert_eq!(
        exempt,
        ocul_pm_lib::oculpm::redact::EXEMPT_LLM_PROMPT_SITES,
        "리댁션 면제 자리의 수가 모듈 문서의 주장과 다르다"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 자동화 배지의 근거 ({#automation-egress-badge})
// ─────────────────────────────────────────────────────────────────────────────

/// 배지가 찍는 호스트가 **실제 엔드포인트 상수**에서 왔는지 대조한다.
///
/// `automation::egress` 의 표가 손으로 관리되면 언젠가 어긋나고, 그때 배지는
/// 조용히 거짓말을 한다 ("openai 로 보냅니다" 라고 적으면서 실제로는 다른 데로
/// 가거나, 로컬이라고 적으면서 나가거나).
#[test]
fn the_automation_badge_hosts_come_from_the_real_llm_endpoints() {
    use ocul_pm_lib::oculpm::automation::egress;

    let llm_dir = crate_src().join("llm");
    let mut files = Vec::new();
    walk(&llm_dir, &["rs"], &mut files);
    let mut endpoint_hosts = BTreeSet::new();
    for path in files {
        let raw = std::fs::read_to_string(&path).unwrap();
        for line in raw.lines() {
            // `const BASE_URL: &str = "https://…";` 꼴만 본다.
            let t = line.trim();
            if t.starts_with("const ") && t.contains("URL") && t.contains("https://") {
                endpoint_hosts.extend(hosts_in(t));
            }
        }
    }
    assert!(
        !endpoint_hosts.is_empty(),
        "llm/ 에서 엔드포인트 상수를 하나도 못 찾았다 — 스캐너가 낡았다"
    );

    let table: BTreeSet<String> = egress::known_hosts().map(str::to_string).collect();
    assert_eq!(
        table, endpoint_hosts,
        "배지의 호스트 표가 실제 엔드포인트와 다르다.\n  표: {table:?}\n  실측: {endpoint_hosts:?}"
    );

    // 배지가 말하는 목적지는 전부 유출 원장에 사유와 함께 있어야 한다.
    let ledger_hosts: BTreeSet<&str> = HOST_LEDGER.iter().map(|(h, _)| *h).collect();
    for host in egress::known_hosts() {
        assert!(
            ledger_hosts.contains(host),
            "{host} 는 배지가 말하는 목적지인데 HOST_LEDGER 에 없다"
        );
    }
}
