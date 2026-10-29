/**
 * 창마다 하나 — 첫 실행 안내를 언제 띄울지 가른다.
 *
 * 처음 한 번: 설정을 읽은 뒤 `tourSeen` 이 비었고 **이 창이 앞에 있을 때** 연다. 열 때 바로
 * `tourSeen` 을 적는다 — 여러 창이 함께 떠 있어도(업데이트 뒤 창 되살리기) 한 창에서만 뜬다.
 * 다시 열기: ⌘K 「처음 쓰는 법」(`requestTour`) · 도움말 메뉴(`TourRequested`, 그 창에만 온다).
 */
import { useEffect, useRef, useState } from "react";

import { windowApi } from "@/api/window";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { onTourRequest } from "@/lib/projectActions";
import { TourDialog } from "./TourDialog";

export function TourHost() {
  // 설정 공급자 밖(창 껍데기만 그리는 테스트)이면 저절로 띄우지 않는다 — 다시 열기는 그대로.
  const ctx = useOptionalSettings();
  const loaded = ctx?.loaded ?? false;
  const seen = ctx?.settings.tourSeen ?? "1";
  const set = ctx?.set;
  const [open, setOpen] = useState(false);
  const autoTried = useRef(false);

  useEffect(() => {
    if (!loaded || !set || autoTried.current || seen === "1") return;
    const show = () => {
      if (autoTried.current) return;
      autoTried.current = true;
      setOpen(true);
      void set("tourSeen", "1");
    };
    if (document.hasFocus()) {
      show();
      return;
    }
    // 아직 앞에 오지 않은 창 — 처음 앞에 올 때까지 기다린다(그사이 다른 창이 보였으면 안 뜬다).
    window.addEventListener("focus", show, { once: true });
    return () => window.removeEventListener("focus", show);
  }, [loaded, seen, set]);

  useEffect(() => onTourRequest(() => setOpen(true)), []);
  useEffect(() => {
    const off = windowApi.onTourRequested(() => setOpen(true));
    return () => void off.then((fn) => fn());
  }, []);

  return <TourDialog open={open} onClose={() => setOpen(false)} />;
}
