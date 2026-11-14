/**
 * 오늘 화면을 실제 공급자(설정 · 워크스페이스)와 함께 그린다 — `todayFixture` 의 가짜 백엔드 위에서 (11-15).
 * 시험 파일이 `vi.mock("@/lib/bindings", …)` 을 먼저 건 뒤에 import 한다.
 */
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { WORKDAY } from "./todayFixture";

export const DATE_LABEL = "DATE-LABEL";

/** `extra` — 같은 공급자 안에 함께 그릴 것(배지처럼 같은 저장소를 구독하는 둘째 인스턴스). */
export function renderToday(extra?: ReactNode) {
  const onNavigate = vi.fn();
  const onOpenEntry = vi.fn();
  const tree = (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <TodayScreenV2 projectId={1} workday={WORKDAY} oculpmReady onNavigate={onNavigate} onOpenEntry={onOpenEntry} dateLabel={DATE_LABEL} />
        {extra}
      </WorkspaceProvider>
    </SettingsProvider>
  );
  const utils = render(tree);
  return { ...utils, onNavigate, onOpenEntry };
}
