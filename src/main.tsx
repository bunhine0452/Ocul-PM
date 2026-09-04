import React from "react";
import ReactDOM from "react-dom/client";
import { SettingsProvider } from "./contexts/SettingsContext";
import { Toaster } from "./components/ui/Toaster";
import { parseWindowRoute } from "./lib/windowRoute";
import { installExternalLinkGuard } from "./lib/externalLinks";
import { installNativeDragGuard } from "./lib/nativeDrag";
import { bootI18n } from "./i18n";
import { commands } from "./lib/bindings";

// 바깥 링크 → 기본 브라우저. 세 갈래 창 어디서 눌러도 같아야 하므로 갈림길
// **위**에서 한 번 건다 (externalLinks.ts 참고).
installExternalLinkGuard();
// 네이티브 드래그도 같은 이유로 갈림길 위다 — 끌 수 있는 표면(탭·세션 레일·
// 페인 손잡이)이 세 갈래에 흩어져 있어 창마다 걸면 반드시 한 군데가 샌다.
installNativeDragGuard();

// 리로드 원인 캡처 (dev 전용 — 2026-07-20 "ai-pm 선택 직후 웹뷰 리로드" 수사).
// Vite 클라이언트가 전체 리로드를 명령하는 순간과 사유(payload)를 콘솔로 남기면
// 콘솔 브리지(App 마운트 시 설치)가 oculpm.log / 앱데이터 로그로 전달한다.
// 판정 규칙: 리로드 직전에 [vite-diag] beforeFullReload 가 찍히면 Vite 가 원인
// (payload 에 트리거 파일), 아무것도 없이 App mounted 만 다시 찍히면 웹뷰
// 프로세스 크래시다. import.meta.hot 은 프로덕션 빌드에서 undefined — 번들 제외.
if (import.meta.hot) {
  const diag = (event: string) => (payload: unknown) => {
    console.warn(`[vite-diag] ${event}`, JSON.stringify(payload ?? {}));
  };
  import.meta.hot.on("vite:beforeFullReload", diag("beforeFullReload"));
  import.meta.hot.on("vite:invalidate", diag("invalidate"));
  import.meta.hot.on("vite:error", diag("error"));
  import.meta.hot.on("vite:ws:disconnect", diag("ws-disconnect"));
  import.meta.hot.on("vite:ws:connect", diag("ws-connect"));
}

// 세 갈래 (크롬식 탭 §2 + 2026-08-15 터미널 도크) — 트레이 팝오버냐, 떼어낸
// 터미널이냐, 탭을 문 앱 창이냐. 어느 갈래인지는 URL 이 정하고 런타임에 바뀌지
// 않는다. "런처 전용 창" 은 시작 탭이 대체했다.
const route = parseWindowRoute(window.location.search);
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// 초기 페인트 자동 측정 (dev 전용 — `v242-load-bearing {#measure-once}`).
// 프로덕션 번들에서는 이 분기와 모듈이 통째로 지워진다. 사람 손이 필요 없어
// `{#measure-after}` 가 같은 방법으로 다시 잰다.
if (import.meta.env.DEV) {
  void import("./lib/perfProbe").then((m) => m.installPerfProbe(route.kind));
}

// 모바일 브리지 (#mb3-tabs): 웹뷰가 아니면(= 폰/브라우저가 axum 정적 서빙으로
// 로드) 데스크톱 셸 대신 모바일 셸. ?desktop=1 은 데스크톱-브라우저 스모크용
// 탈출구 (#mb2-smoke). SettingsProvider 는 올리지 않는다 — settings_get_all 이
// 모바일 화이트리스트 밖이라 401/404 소음만 낸다.
const isWebview = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// 언어 사전은 동적 청크다 (완성도 라운드 Phase 3) — 설정의 언어를 읽어 그 사전
// 하나를 받은 뒤 그린다. 웹뷰 밖(모바일)에선 설정 IPC 가 없으니 OS 로케일.
void bootI18n(async () => {
  if (!isWebview) return null;
  const res = await commands.settingsGetAll();
  if (res.status !== "ok") return null;
  return res.data.find(([key]) => key === "language")?.[1] ?? null;
}).then(renderApp);

function renderApp() {
if (!isWebview && !window.location.search.includes("desktop=1")) {
  const MobileApp = React.lazy(() => import("./mobile/MobileApp"));
  root.render(
    <React.StrictMode>
      <React.Suspense fallback={null}>
        <MobileApp />
      </React.Suspense>
    </React.StrictMode>,
  );
} else if (route.kind === "terminal") {
  // 분리 터미널 창 — 셸 하나만 사는 경량 진입점. 설정(테마·편집기 명령)은
  // 필요하므로 SettingsProvider 는 그대로 두른다.
  const TerminalWindow = React.lazy(() => import("./windows/TerminalWindow"));
  root.render(
    <React.StrictMode>
      <SettingsProvider>
        <React.Suspense fallback={null}>
          <TerminalWindow projectId={route.projectId} />
        </React.Suspense>
        <Toaster />
      </SettingsProvider>
    </React.StrictMode>,
  );
} else if (route.kind === "tray") {
  // v2.3.0 메뉴바 — 트레이 팝오버 창(label `tray`). 본 앱 셸·워크스페이스를
  // 로드하지 않는 경량 진입점.
  const TrayApp = React.lazy(() => import("./features/tray/TrayApp"));
  root.render(
    <React.StrictMode>
      <React.Suspense fallback={null}>
        <TrayApp />
      </React.Suspense>
    </React.StrictMode>,
  );
} else {
  // 프로젝트 창 — 탭 여러 개를 물고, 탭마다 WorkspaceProvider 를 마운트한다
  // (그 배선은 TabbedWindow 안에 있다 — 탭 집합이 런타임에 바뀌므로).
  const TabbedWindow = React.lazy(() => import("./windows/TabbedWindow"));
  root.render(
    <React.StrictMode>
      <SettingsProvider>
        <React.Suspense fallback={null}>
          <TabbedWindow
            windowLabel={route.label}
            initialView={route.view}
            initialEntryPath={route.entryPath}
            tearingOff={route.tearoff}
          />
        </React.Suspense>
        <Toaster />
      </SettingsProvider>
    </React.StrictMode>,
  );
}
}
