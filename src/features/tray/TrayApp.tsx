// 트레이 팝오버 창 전용 루트 (main.tsx 의 `?tray=1` 분기).
//
// 본 앱 셸을 로드하지 않는 경량 진입점 (D2) — WorkspaceContext 는 의도적으로
// 마운트하지 않는다: localStorage(aipm:workspace:v1)를 두 창이 동시에 쓰면
// 상태가 서로를 덮어쓴다. 테마만 SettingsContext 로 공유한다 (data-theme
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
