import React from "react";
import ReactDOM from "react-dom/client";
import { SettingsProvider } from "./contexts/SettingsContext";
import { Toaster } from "./components/ui/Toaster";
import { parseWindowRoute } from "./lib/windowRoute";
import { installExternalLinkGuard } from "./lib/externalLinks";
import { installNativeDragGuard } from "./lib/nativeDrag";
import { installIdleMotionPause } from "./lib/idleMotion";
import { installNativeDialogGuard } from "./lib/nativeDialogs";
import { getPlatform, isMac } from "./lib/platform";
import { bootI18n } from "./i18n";
import { commands } from "./lib/bindings";
import { watchCspViolations } from "./lib/oculpmLog";

// 웹뷰 CSP 위반을 맨 먼저 듣는다 — 막힌 것은 화면이 조용히 비는 것으로만 보인다
// (oculpmLog.ts `watchCspViolations`). 첫 화면의 위반까지 잡으려면 다른 무엇보다 앞이다.
if ("__TAURI_INTERNALS__" in window) watchCspViolations();

// 바깥 링크 → 기본 브라우저. 어느 창에서 눌러도 같아야 하므로 부팅 맨 위에서 한 번 건다
// (externalLinks.ts 참고).
installExternalLinkGuard();
// 네이티브 드래그도 같은 이유로 부팅 맨 위다 — 끌 수 있는 표면(목록·diff …)이 여럿이라
// 표면마다 걸면 반드시 한 군데가 샌다.
installNativeDragGuard();
// 창을 보고 있지 않으면 무한 반복 애니메이션을 멈춘다 — 같은 이유로 부팅 맨 위 (idleMotion.ts).
installIdleMotionPause();
// Windows·Linux 의 표시 갈래(글꼴 폴백)는 CSS 가 `:root[data-platform]` 으로 가른다
// (tokens.css 끝). macOS 는 속성을 달지 않는다 — DOM 까지 예전 그대로 (D3).
if (!isMac()) document.documentElement.dataset.platform = getPlatform();

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

// 창은 한 갈래다 — 시작 창이거나 프로젝트 하나의 셸(4.0). 라벨과 딥링크 목적지는 URL 이
// 싣는다.
const route = parseWindowRoute(window.location.search);
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// 초기 페인트 자동 측정 (dev 전용 — `v242-load-bearing {#measure-once}`).
// 프로덕션 번들에서는 이 분기와 모듈이 통째로 지워진다. 사람 손이 필요 없어
// `{#measure-after}` 가 같은 방법으로 다시 잰다.
if (import.meta.env.DEV) {
  void import("./lib/perfProbe").then((m) => m.installPerfProbe(route.kind));
}

// 웹뷰 밖(`pnpm dev` 를 브라우저로 연 경우)에는 IPC 가 없다 — 셸은 그대로 그리되
// 설정 조회는 건너뛰고 OS 로케일로 시작한다.
const isWebview = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// bare `confirm()` 는 웹뷰에서 묻지도 않고 "예" 가 된다 — dialog 플러그인이 async 로
// 덮어써 truthy Promise 를 돌려준다(nativeDialogs.ts). 브라우저의 진짜 동기
// 대화상자는 건드리지 않는다.
if (isWebview) installNativeDialogGuard();

// 언어 사전은 동적 청크다 (완성도 라운드 Phase 3) — 설정의 언어를 읽어 그 사전
// 하나를 받은 뒤 그린다. 웹뷰 밖에선 설정 IPC 가 없으니 OS 로케일.
void bootI18n(async () => {
  if (!isWebview) return null;
  const res = await commands.settingsGetAll();
  if (res.status !== "ok") return null;
  return res.data.find(([key]) => key === "language")?.[1] ?? null;
}).then(renderApp);

function renderApp() {
  // 앱 창 — 시작 창이거나 프로젝트 하나의 셸이다 (창 하나 = 프로젝트 하나, 4.0).
  // 어느 쪽인지는 창이 마운트 직후 백엔드에 묻는다 — 시작 창이 프로젝트를 고르면
  // 런타임에 바뀌므로 URL 에 싣지 않는다.
  const AppWindow = React.lazy(() => import("./windows/AppWindow"));
  root.render(
    <React.StrictMode>
      <SettingsProvider>
        <React.Suspense fallback={null}>
          <AppWindow
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
