import { useEffect } from "react";
import { type UiV2View } from "@/contexts/WorkspaceContext";
import { navViewForKey, NAV_BUS } from "@/lib/navRegistry";
import { requestCheatsheet } from "@/lib/projectActions";
import { readChord } from "@/lib/kbd";

// 프로젝트 창의 전역 단축키 (v2 01-ux-spec.md §1 → 4.0).
//   ⌘1~⌘4 : 화면 전환 — navRegistry 배열 순서(=사이드바 표시 순서)에 자동 부여.
//   ⌘K : 팔레트 (화면 · 프로젝트 · 일지 · 계획).
//   ⌘O : 최근 프로젝트 목록 (사이드바 머리의 프로젝트 이름 버튼).
//   ⌘, : 설정 화면.
//   ⌘/ : 단축키 치트시트.
//   ⌘[ / ⌘] : 화면 뒤로/앞으로 (`useNavHistory` 의 발자국).
// ⌘W(창 닫기)·⇧⌘N(새 창)은 macOS 앱 메뉴가, Windows·Linux 는 `useWindowKeys` 가 받는다.
// 입력 필드 안에서도 동작한다 (기존 정책 유지). 수정키 판정은 lib/kbd.ts 가 갖는다 —
// macOS 는 ⌘ 또는 ⌃, Windows·Linux 는 Ctrl.

interface Options {
  onOpenPalette: () => void;
  /** 셸 화면 이동 — ⌘번호 + ⌘, */
  uiV2Nav: (view: UiV2View) => void;
  /** ⌘[ / ⌘] — 화면 뒤로/앞으로. */
  onNavBack?: () => void;
  onNavForward?: () => void;
  enabled?: boolean;
}

export function useGlobalShortcuts({ onOpenPalette, uiV2Nav, onNavBack, onNavForward, enabled = true }: Options) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const c = readChord(e);
      if (!c.mod) return;
      const key = c.key.toLowerCase();

      // ⌘K — 팔레트
      if (key === "k" && !c.shift) {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      // ⌘[ / ⌘] — 화면 뒤로/앞으로.
      if (!c.shift && !c.alt && (c.key === "[" || c.key === "]")) {
        const go = c.key === "[" ? onNavBack : onNavForward;
        if (go) {
          e.preventDefault();
          go();
          return;
        }
      }
      // ⌘O — 최근 프로젝트 목록 (사이드바 머리가 NAV_BUS 를 듣는다)
      if (key === "o" && !c.shift && !c.alt) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(NAV_BUS.openProjectSwitcher));
        return;
      }
      // ⌘/ — 단축키 치트시트 (창에 하나, AppWindow 가 그린다)
      if (c.key === "/") {
        e.preventDefault();
        requestCheatsheet();
        return;
      }
      // ⌘, — 설정 화면
      if (c.key === ",") {
        e.preventDefault();
        uiV2Nav("settings");
        return;
      }
      // ⌘1~⌘4 — navRegistry 순서
      const view = navViewForKey(c.key);
      if (view) {
        e.preventDefault();
        uiV2Nav(view);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenPalette, uiV2Nav, onNavBack, onNavForward, enabled]);
}
