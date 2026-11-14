import { useEffect } from "react";
import { type UiV2View } from "@/contexts/WorkspaceContext";
import { navViewForKey, NAV_BUS } from "@/lib/navRegistry";
import { requestCheatsheet } from "@/lib/projectActions";
import { isModalOpen, readChord } from "@/lib/kbd";

// 프로젝트 창의 전역 단축키 (v2 01-ux-spec.md §1 → 4.0).
//   ⌘1~⌘5 : 화면 전환 — navRegistry 배열 순서(=탭 표시 순서)에 자동 부여.
//   ⌘K : 팔레트 (세션 · 화면 · 동작 · 프로젝트 · 일지 · 계획).
//   ⌘J : 내 차례 — 기다리는 세션으로 (`features/shell/jumpWaiting`, 11-15).
//   ⌘O : 최근 프로젝트 목록 (윗줄의 프로젝트 이름 버튼).
//   ⌘, : 설정 화면.
//   ⌘/ : 단축키 치트시트.
//   ⌘[ / ⌘] : 화면 뒤로/앞으로 (`useNavHistory` 의 발자국).
// ⌘W(창 닫기)·⇧⌘N(새 창)은 macOS 앱 메뉴가, Windows·Linux 는 `useWindowKeys` 가 받는다.
// 입력 필드 안에서도 동작한다 (기존 정책 유지). 수정키 판정은 lib/kbd.ts 가 갖는다 —
// macOS 는 ⌘ 또는 (입력칸 · 터미널 밖의) ⌃, Windows·Linux 는 Ctrl.
//
// **모달이 떠 있으면 물러난다** (11-15) — 팔레트 · 확인 창이 떠 있는 채 ⌘2 · ⌘, 가 뒤 화면을 바꿨다.
// 그때 듣는 것은 ⌘K(팔레트 닫기) 하나고, Esc 는 모달이 스스로 받는다.

interface Options {
  onOpenPalette: () => void;
  /** 모달이 떠 있을 때의 ⌘K — 팔레트면 닫는다. 다른 대화상자 위에 팔레트를 겹쳐 열지 않는다. */
  onClosePalette?: () => void;
  /** 셸 화면 이동 — ⌘번호 + ⌘, */
  uiV2Nav: (view: UiV2View) => void;
  /** ⌘[ / ⌘] — 화면 뒤로/앞으로. */
  onNavBack?: () => void;
  onNavForward?: () => void;
  /** ⌘J — 가장 오래 기다린 세션으로. 다시 누르면 다음 세션. */
  onJumpWaiting?: () => void;
  enabled?: boolean;
}

export function useGlobalShortcuts({
  onOpenPalette,
  onClosePalette,
  uiV2Nav,
  onNavBack,
  onNavForward,
  onJumpWaiting,
  enabled = true,
}: Options) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const c = readChord(e);
      if (!c.mod) return;
      const key = c.key.toLowerCase();

      // ⌘K — 팔레트. 모달이 떠 있으면 닫기만 한다(팔레트 자신이면 닫히고, 다른 대화상자면 그대로).
      if (key === "k" && !c.shift) {
        e.preventDefault();
        if (isModalOpen()) onClosePalette?.();
        else onOpenPalette();
        return;
      }
      if (isModalOpen()) return;
      // ⌘J — 내 차례 (터미널 안의 Windows·Linux 는 Ctrl+Shift+J — `readChord` 의 터미널 가족).
      if (key === "j" && !c.shift && !c.alt && onJumpWaiting) {
        e.preventDefault();
        onJumpWaiting();
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
      // ⌘O — 최근 프로젝트 목록 (윗줄의 프로젝트 이름 버튼이 NAV_BUS 를 듣는다)
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
      // ⌘1~⌘5 — navRegistry 순서
      const view = navViewForKey(c.key);
      if (view) {
        e.preventDefault();
        uiV2Nav(view);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenPalette, onClosePalette, uiV2Nav, onNavBack, onNavForward, onJumpWaiting, enabled]);
}
