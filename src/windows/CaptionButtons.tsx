/**
 * Windows 창 단추 — 최소화 · 최대화(복원) · 닫기 (2026-11-10).
 *
 * Windows 창은 제목줄이 없다(`decorations: false`) — 셸 윗줄이 제목줄이고, 이 단추 셋이 그
 * 오른쪽 끝에 얹힌다. macOS 의 신호등과 같은 모양이다: OS(여기서는 앱)가 창 맨 위 구석에
 * 단추를 띄우고, 윗줄은 그 자리를 비운다(`shell.css` 의 `:root[data-platform="windows"] .topbar`).
 *
 * 왜 윗줄 안이 아니라 창 위에 떠 있나 — 창의 어느 상태에서도 서 있어야 한다: 시작 창 · 프로젝트
 * 창 · 첫 프레임(부트 스플래시) · 화면이 깨져 대체 UI 가 선 창. 윗줄 안에 두면 윗줄이 없는 상태의
 * 창은 닫을 단추도 없다. 그래서 `AppWindow` 가 창마다 하나, 바깥 오류 경계 밖에 그린다.
 *
 * 생김새는 Windows 11 의 것을 따른다 — 단추 46px · 윗줄 높이 전체 · Segoe Fluent Icons 글리프 ·
 * 닫기만 빨강. 맨 오른쪽 위 구석까지 닫기 단추다(최대화한 창에서 마우스를 구석에 던지면 닫힌다).
 * 탭 순서에서는 뺀다 — 네이티브 단추도 Tab 으로 가지 않는다(키보드는 Ctrl+W · Alt+F4 · Alt+Space).
 */
import { useEffect, useState } from "react";

import { windowApi } from "@/api/window";
import { useT } from "@/i18n";
import { drawsCaptionButtons } from "@/lib/platform";

/** 창 끌기 동안 크기 변경이 줄지어 와도 최대화 여부는 잠잠해진 뒤 한 번 묻는다 (2026-11-11). */
export const MAXIMIZED_SYNC_DEBOUNCE_MS = 100;

export function CaptionButtons() {
  if (!drawsCaptionButtons()) return null;
  return <CaptionButtonRow />;
}

function CaptionButtonRow() {
  const { t } = useT();
  const [maximized, setMaximized] = useState(false);

  // 최대화 · 복원 · 스냅 · 두 번 눌러 확대 — 전부 크기 변경으로 온다. 단추가 그 결과를 따라간다.
  // 창을 끄는 동안 크기 변경은 프레임마다 오므로 IPC 는 마지막 것 뒤 한 번만(`MAXIMIZED_SYNC_DEBOUNCE_MS`).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = () => {
      windowApi
        .isMaximized()
        .then((m) => {
          if (alive) setMaximized(m);
        })
        .catch(() => {});
    };
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        sync();
      }, MAXIMIZED_SYNC_DEBOUNCE_MS);
    };
    sync();
    const off = windowApi.onResized(later);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      void off.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const maxLabel = maximized ? t("caption.restore") : t("caption.maximize");
  return (
    <div className="wincaption" role="group" aria-label={t("caption.group")}>
      <button
        type="button"
        className="wincaption-btn"
        data-caption="min"
        tabIndex={-1}
        aria-label={t("caption.minimize")}
        title={t("caption.minimize")}
        onClick={() => void windowApi.minimize().catch(() => {})}
      />
      <button
        type="button"
        className="wincaption-btn"
        data-caption={maximized ? "restore" : "max"}
        tabIndex={-1}
        aria-label={maxLabel}
        title={maxLabel}
        onClick={() => void windowApi.toggleMaximize().catch(() => {})}
      />
      <button
        type="button"
        className="wincaption-btn"
        data-caption="close"
        tabIndex={-1}
        aria-label={t("caption.close")}
        title={t("caption.close")}
        onClick={() => void windowApi.closeThisWindow().catch(() => {})}
      />
    </div>
  );
}
