/**
 * 강조색 6종의 **미리보기 색** — 스와치를 그리는 쪽이 공유하는 한 벌.
 *
 * 실제 적용은 `tokens.css` 의 `[data-accent]` 팔레트가 하고(라이트/다크에서
 * 서로 다른 값), 여기 있는 hex 는 **버튼 위에 칠하는 견본**이다. 원래
 * 설정 → 모양 안에 있었는데, 첫 실행 마법사가 같은 6색을 그리게 되면서
 * 사전(`labelKey`)까지 딸린 이 표를 두 벌 두지 않으려고 밖으로 냈다.
 */
import type { I18nKey } from "@/i18n";
import type { ColorTheme } from "@/lib/settings";

export const ACCENTS: Array<{ id: ColorTheme; labelKey: I18nKey; color: string }> = [
  { id: "green", labelKey: "settings.accent.green", color: "#0e8a60" },
  { id: "blue", labelKey: "settings.accent.blue", color: "#2570e0" },
  { id: "purple", labelKey: "settings.accent.purple", color: "#7c5cdb" },
  { id: "orange", labelKey: "settings.accent.orange", color: "#e07b12" },
  { id: "rose", labelKey: "settings.accent.rose", color: "#e0524b" },
  { id: "teal", labelKey: "settings.accent.teal", color: "#0e9aa0" },
];
