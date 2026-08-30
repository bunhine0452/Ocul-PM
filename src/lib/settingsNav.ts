/**
 * "설정의 이 탭을 열어라" — 화면 트리 밖에서 전달하는 딥링크 버스.
 *
 * 지금까지 안내 문구가 "설정 → 터미널" · "설정 → 통합" · "에이전트 연동" 처럼
 * **존재하지 않는 경로**를 가리켰고(2026-08-30 감사), 가리키더라도 사용자가
 * 손으로 찾아가야 했다. 문구 대신 버튼이 이 함수를 부르면 셸이 설정 화면으로
 * 옮기고 패널이 해당 탭을 편다. `journalCompose` 와 같은 끈적 플래그 규약 —
 * 패널이 아직 마운트되지 않았으면 마운트 시 `consumeSettingsTab` 으로 회수.
 */
export type SettingsTabId =
  | "appearance"
  | "llm"
  | "code"
  | "indexing"
  | "graph"
  | "data"
  | "oculpm"
  | "mobile"
  | "diagnostics"
  | "update";

const EVENT = "oculpm:open-settings";

let pendingTab: SettingsTabId | null = null;

/** 설정 화면을 열고(셸이 듣는다) 탭을 고른다. */
export function openSettings(tab?: SettingsTabId): void {
  pendingTab = tab ?? null;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { tab: pendingTab } }));
}

/** 패널 마운트 시 한 번 — 대기 중인 탭이 있으면 돌려주고 비운다. */
export function consumeSettingsTab(): SettingsTabId | null {
  const tab = pendingTab;
  pendingTab = null;
  return tab;
}

/** 이미 마운트된 셸/패널용 구독. */
export function onOpenSettingsRequest(
  fn: (tab: SettingsTabId | null) => void,
): () => void {
  const handler = (event: Event) => {
    const tab = (event as CustomEvent<{ tab: SettingsTabId | null }>).detail?.tab ?? null;
    fn(tab);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
