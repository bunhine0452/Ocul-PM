import { createContext } from "react";

/**
 * 셸 윗줄의 「화면 동작」 자리 (4.0 — 사이드바 대신 윗줄 하나).
 *
 * 셸 안의 화면은 `<Toolbar>` 의 동작을 이 자리로 포털한다 — 제목은 윗줄의 탭이 대신하므로
 * 줄이 두 겹이 되지 않는다. 셸 밖(테스트·단독 렌더)에서는 `null` 이라 툴바가 제자리에 선다.
 */
export const ToolbarSlotContext = createContext<HTMLElement | null>(null);
