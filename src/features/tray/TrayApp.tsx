// 트레이 팝오버 창 전용 루트 (main.tsx 의 `?tray=1` 분기).
//
// 본 앱 셸을 로드하지 않는 경량 진입점 (D2) — WorkspaceContext 는 의도적으로
// 마운트하지 않는다 — 트레이 창에는 프로젝트가 없어(멀티 창 I3) 워크스페이스
// 상태라는 개념 자체가 없다. 테마만 SettingsContext 로 공유한다 (data-theme
// 어트리뷰트 적용을 SettingsContext 가 담당).

import { SettingsProvider } from "@/contexts/SettingsContext";
import { TrayPopover } from "./TrayPopover";
import "@/App.css";

export default function TrayApp() {
  return (
    <SettingsProvider>
      <TrayPopover />
    </SettingsProvider>
  );
}
