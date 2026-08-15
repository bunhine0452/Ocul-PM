import React from "react";
import ReactDOM from "react-dom/client";
import { SettingsProvider } from "./contexts/SettingsContext";
import { Toaster } from "./components/ui/Toaster";
import { parseWindowRoute } from "./lib/windowRoute";
import { installExternalLinkGuard } from "./lib/externalLinks";

// 바깥 링크 → 기본 브라우저. 세 갈래 창 어디서 눌러도 같아야 하므로 갈림길
// **위**에서 한 번 건다 (externalLinks.ts 참고).
installExternalLinkGuard();

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

if (route.kind === "terminal") {
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
          />
        </React.Suspense>
        <Toaster />
      </SettingsProvider>
    </React.StrictMode>,
  );
}
