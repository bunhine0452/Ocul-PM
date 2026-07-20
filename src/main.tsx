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
