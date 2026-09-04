import { useState } from "react";
import { useSettings } from "@/contexts/SettingsContext";
import { useSaveSetting } from "@/features/settings/saveSetting";
import { TERM_FONT_DEFAULT, clampTermFont } from "./fontSize";

/**
 * 터미널 글자 크기 조작 — 값·초안·클램프·커밋 (`TerminalSurface` 에서 갈라 나옴).
 *
 * 값은 앱 전역 설정(SQLite)에 산다. 설정 화면·상태바·⌘± 가 한 값을 공유하고,
 * 창을 여러 개 띄워도 전부 같은 크기가 되기 때문이다.
 *
 * 파일로 나온 이유는 둘이다. (1) `TerminalSurface.tsx` 는 1,500줄을 넘어 크기
 * 래칫이 걸려 있어, 새 배선을 넣으려면 먼저 자리를 만들어야 했다. (2) 여기 있던
 * 쓰기가 `void setSetting(...)` 이라 **실패를 삼켰다** — 이제 `useSaveSetting`
 * 이 그것을 말한다 (v2.42.0 `{#settings-set-unhandled}`).
 */
export interface TerminalFont {
  /** 지금 크기 (범위 밖 저장값도 여기서 잘린다). */
  fontSize: number;
  /** px 직접 입력의 타이핑 초안 — `null` 이면 편집 중이 아니다. */
  fontDraft: string | null;
  setFontDraft: (draft: string | null) => void;
  setFont: (px: number) => void;
  /** ⌘+ / ⌘− 한 칸. */
  fontDelta: (d: number) => void;
  fontReset: () => void;
  /** 초안 커밋 — 빈 값·범위 밖은 현재 값으로 되돌린다. */
  commitFontDraft: () => void;
}

export function useTerminalFont(): TerminalFont {
  const { settings } = useSettings();
  const save = useSaveSetting();
  const fontSize = clampTermFont(settings.terminalFontSize || TERM_FONT_DEFAULT);
  const [fontDraft, setFontDraft] = useState<string | null>(null);

  const setFont = (px: number) => save("terminalFontSize", clampTermFont(px));
  // 델타는 화면에 보이는 값 기준이다 — 설정이 범위 밖 값을 들고 있어도
  // (수동 편집·과거 값) ⌘+ 한 번이 눈에 보이는 크기에서 한 칸 움직인다.
  const fontDelta = (d: number) => setFont(fontSize + d);
  const fontReset = () => setFont(TERM_FONT_DEFAULT);

  const commitFontDraft = () => {
    if (fontDraft === null) return;
    const parsed = Number.parseInt(fontDraft, 10);
    if (Number.isFinite(parsed)) setFont(parsed);
    setFontDraft(null);
  };

  return { fontSize, fontDraft, setFontDraft, setFont, fontDelta, fontReset, commitFontDraft };
}
