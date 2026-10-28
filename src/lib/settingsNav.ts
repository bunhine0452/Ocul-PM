/**
 * "설정의 이 칸을 열어라" — 화면 트리 밖에서 전달하는 딥링크 버스.
 *
 * 안내 문구가 "설정 → 어디" 를 말로만 가리키면 사용자가 손으로 찾아가야 한다. 문구
 * 대신 버튼이 이 함수를 부르면 셸이 설정 화면으로 옮기고 설정이 그 칸으로 스크롤한다.
 * `journalCompose` 와 같은 끈적 플래그 규약 — 설정이 아직 마운트되지 않았으면 마운트
 * 시 `consumeSettingsSection` 으로 회수. (뼈대는 `lib/createStore.createIntentSlot`.)
 *
 * 4.0 의 설정은 한 쪽 네 칸이다 (에이전트 연결 · 이 프로젝트 · 표시 · 데이터).
 */
import { createIntentSlot } from "@/lib/createStore";

export type SettingsSection = "agents" | "project" | "display" | "data";

/**
 * 3.x 설정 탭 id — 그 탭을 가리키던 안내 버튼이 아직 남아 있는 화면이 있어 받는다.
 * 지금의 칸으로 접힌다 (없어진 탭은 칸 없이 설정 맨 위).
 */
type LegacyTab = "appearance" | "llm" | "indexing" | "data" | "oculpm" | "automation" | "diagnostics" | "update";

const LEGACY: Record<LegacyTab, SettingsSection | null> = {
  appearance: "display",
  oculpm: "agents",
  data: "data",
  diagnostics: "data",
  update: "data",
  llm: null,
  indexing: null,
  automation: null,
};

function sectionOf(target: SettingsSection | LegacyTab | undefined): SettingsSection | null {
  if (!target) return null;
  if (target in LEGACY) return LEGACY[target as LegacyTab];
  return target as SettingsSection;
}

const slot = createIntentSlot<SettingsSection | null>("oculpm:open-settings");

/** 설정 화면을 열고(셸이 듣는다) 칸을 고른다. */
export function openSettings(target?: SettingsSection | LegacyTab): void {
  slot.request(sectionOf(target));
}

/** 설정 마운트 시 한 번 — 대기 중인 칸이 있으면 돌려주고 비운다. */
export function consumeSettingsSection(): SettingsSection | null {
  return slot.consume();
}

/**
 * 이미 마운트된 셸·설정용 구독. 플래그는 **남긴다** — 셸은 화면만 바꾸고 칸 선택은
 * 설정이 `consumeSettingsSection` 으로 가져간다.
 */
export function onOpenSettingsRequest(fn: (section: SettingsSection | null) => void): () => void {
  return slot.subscribe((section) => fn(section ?? null), { consume: false });
}
