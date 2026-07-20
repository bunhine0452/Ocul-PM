import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./contexts/SettingsContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { Toaster } from "./components/ui/Toaster";

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

// v2.3.0 메뉴바 — 트레이 팝오버 창(label `tray`)은 `?tray=1` 로 뜬다.
// 본 앱 셸·WorkspaceProvider 를 로드하지 않는 경량 진입점 (D2; 두 창이
// 같은 localStorage 키를 쓰는 충돌도 회피).
const isTrayWindow = new URLSearchParams(window.location.search).has("tray");

if (isTrayWindow) {
  const TrayApp = React.lazy(() => import("./features/tray/TrayApp"));
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <React.Suspense fallback={null}>
        <TrayApp />
      </React.Suspense>
    </React.StrictMode>,
  );
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <SettingsProvider>
        <WorkspaceProvider>
          <App />
          <Toaster />
        </WorkspaceProvider>
      </SettingsProvider>
    </React.StrictMode>,
  );
}
