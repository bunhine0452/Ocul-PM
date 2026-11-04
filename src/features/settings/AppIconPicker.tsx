/**
 * 앱 아이콘 고르기 (11-04) — 아홉 변형을 실제 아이콘 모양 그대로 작게 세운다. 글자 단추(「컬러 · 흑백」)로는
 * 무엇이 될지 안 보였다. 그림은 Dock 에 거는 PNG 와 같은 함수(`appIconSvg`)에서 나온다.
 * 방향키로 옮기는 라디오 묶음 — 고른 것은 바깥 고리 하나.
 */
import { useId, useRef, type KeyboardEvent } from "react";

import { useT } from "@/i18n";
import { APP_ICON_IDS, appIconSvg, type AppIconId } from "./appIconArt";

export function AppIconPicker({ value, onChange }: { value: AppIconId; onChange: (next: AppIconId) => void }) {
  const { t } = useT();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const box = useRef<HTMLDivElement | null>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = APP_ICON_IDS.indexOf(value);
    const next = APP_ICON_IDS[(at + step + APP_ICON_IDS.length) % APP_ICON_IDS.length];
    onChange(next);
    box.current?.querySelector<HTMLButtonElement>(`[data-icon="${next}"]`)?.focus();
  };
  return (
    <div className="app-icons" role="radiogroup" aria-label={t("prefs.display.appIcon")} ref={box} onKeyDown={onKey}>
      {APP_ICON_IDS.map((id) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-icon={id}
            className="app-icon-opt"
            title={t(`appIcon.${id}`)}
            aria-label={t(`appIcon.${id}`)}
            onClick={() => onChange(id)}
            // 그림은 이 모듈의 상수 색 벌로 만든 SVG 문자열이다 — 바깥 입력이 섞이지 않는다.
            dangerouslySetInnerHTML={{ __html: appIconSvg(id, `${uid}${id}`, 34) }}
          />
        );
      })}
    </div>
  );
}
