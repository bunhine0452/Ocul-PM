/**
 * 화면 **밖에서 온 이동 요청**과 그 한 번짜리 핸드오프 (플랜 `v3-release`
 * {#big-files-watch}).
 *
 * `ShellV2` 에서 그대로 들어냈다. 셸이 하는 일은 둘인데 — 사이드바 + 16화면
 * 라우터 — 그 사이에 "트레이 딥링크·⌘K 엔티티 점프·터미널의 「일지로 남기기」·
 * 플래너의 📓" 처럼 **다른 화면이 쏜 요청을 받아 옮기는** 코드가 160줄 끼어
 * 있었다. 셋 다 같은 모양이다: 창 전역 버스를 듣고 → 화면을 옮기고 → 목적
 * 화면이 mount 뒤 소비할 한 번짜리 값을 남긴다. 그 한 결을 여기 모은다.
 *
 * 규약은 `features/sessions/useSessionBoard.ts` 와 같다 — 이 훅이 상태와 구독을
 * 소유하고, 화면은 결과를 배치하기만 한다.
 *
 * **한 번짜리 값들은 소비되면 지워진다**(`clear*`) — 안 지우면 그 화면에 다시
 * 들어올 때마다 지난 점프가 되살아난다.
 */

import { useCallback, useEffect, useState } from "react";

import { consumeEntryJump, onEntryJump } from "@/lib/entryJump";
import { holdAgentContextIntent, onAgentContextRequest } from "@/lib/agentContextNav";
import { holdManualEntryRequest, onManualEntryRequest } from "@/lib/journalCompose";
import { onOpenSettingsRequest } from "@/lib/settingsNav";
import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";
import { UI_V2_VIEWS, type UiPrefsValue, type UiV2View } from "@/contexts/WorkspaceContext";

/**
 * 트레이 딥링크·URL 이 실어 오는 화면 이름의 허용 목록.
 *
 * 손으로 적은 두 번째 사본이었다 (2026-09-06). 이제 영속값을 거르는 목록과
 * **같은 배열**(`UI_V2_VIEWS`)을 쓴다 — 화면을 하나 없앨 때 한 곳만 고치면
 * 딥링크와 저장된 값이 함께 따라온다.
 */
export const KNOWN_VIEWS: readonly string[] = UI_V2_VIEWS;

export interface ShellNavOptions {
  /** 이 탭이 화면에 보이는가 (크롬식 탭에서 숨은 탭도 마운트된 채라 필요하다). */
  active: boolean;
  /** 지금 화면 — 이미 목적지에 있으면 그 화면의 구독이 먼저 소비한다. */
  view: UiV2View;
  projectId: number | null;
  setUiV2View: UiPrefsValue["setUiV2View"];
  setPrefs: UiPrefsValue["setPrefs"];
  /** 트레이 딥링크가 URL 로 실어 온 목적 화면 — mount 시 1회 적용. */
  initialView: string | null;
  /** 트레이 딥링크가 URL 로 실어 온 `.oculpm` 상대 일지 경로. */
  initialEntryPath: string | null;
}

export interface ShellNav {
  /** 일지 타임라인의 ring-highlight 목표 (Today MiniEntry → 작업 일지). */
  journalFocus: string | null;
  setJournalFocus: (path: string | null) => void;
  /** 상세 뷰로 곧장 열 일지 경로 — 날짜 창 밖의 오래된 일지도 닿는다. */
  journalOpenEntry: string | null;
  setJournalOpenEntry: (path: string | null) => void;
  clearJournalOpenEntry: () => void;
  /** 일지 상세의 「뒤로」가 돌아갈 출발 화면. */
  journalReturnView: UiV2View | null;
  setJournalReturnView: (view: UiV2View | null) => void;
  /** 코드 화면이 열 파일·줄 (nonce 로 같은 자리 연속 점프도 구분). */
  codeTarget: { path: string; line: number | null; nonce: number } | null;
  openInCode: (path: string, line: number | null) => void;
  clearCodeTarget: () => void;
  /** 플래너/토의/문서는 영속 필드를 mount 시에만 읽어 remount 가 필요하다. */
  jumpNonce: number;
}

export function useShellNav({
  active,
  view,
  projectId,
  setUiV2View,
  setPrefs,
  initialView,
  initialEntryPath,
}: ShellNavOptions): ShellNav {
  // 터미널 「일지로 남기기」·팔레트 「수동 일지」 는 일지 화면이 마운트돼 있을 때만
  // 들렸다 — 다른 화면(터미널 ⌘0, 도크 위)에서 누르면 무반응처럼 보이고 일지
  // 화면에 가야 뒤늦게 모달이 떴다 (2026-08-30 감사). 여기서 요청을 붙들어 두고
  // 일지 화면으로 옮긴다; 일지 화면이 이미 떠 있으면 그쪽 구독이 먼저 소비한다.
  // 비활성 탭은 아예 구독하지 않는다 (`active`) — 크롬식 탭에선 숨은 탭도
  // 마운트된 채라, 창 전역 슬롯을 그대로 들으면 A 탭에서 누른 「일지로
  // 남기기」가 B 탭까지 일지 화면으로 옮기고 B 프로젝트에 A 의 내용을 적는다.
  // 아래 `NAV_BUS.openEntity` 가 이미 같은 이유로 `active` 를 본다.
  useEffect(() => {
    if (!active) return;
    return onManualEntryRequest((seed) => {
      if (view === "journal") return;
      holdManualEntryRequest(seed);
      setUiV2View("journal");
    });
  }, [active, view, setUiV2View]);

  // 설정 딥링크(`openSettings(tab)`) — 안내 문구의 "설정 → 어디" 를 버튼으로
  // 바꾸는 쪽 절반. 패널이 탭을 고르고, 셸은 화면만 옮긴다.
  // 활성 탭만 — 게이트가 없으면 `openSettings(tab)` 한 번이 **모든** 탭을 설정
  // 화면으로 옮기고, `uiV2View` 는 프로젝트별로 영속되므로 나중에 B 탭에 돌아온
  // 사용자는 떠났던 화면 대신 설정을 만난다.
  useEffect(() => {
    if (!active) return;
    return onOpenSettingsRequest(() => setUiV2View("settings"));
  }, [active, setUiV2View]);

  // AD-4 — 일지·diff·터미널·팔레트에서 온 "규칙/스킬로" 요청. 화면이 이미 떠
  // 있으면 그쪽 구독이 먼저 소비하고, 아니면 여기서 붙들어 두고 옮긴다.
  useEffect(() => {
    if (!active) return;
    return onAgentContextRequest((intent) => {
      if (view === "skills") return;
      holdAgentContextIntent(intent);
      setUiV2View("skills");
    });
  }, [active, view, setUiV2View]);

  // One-shot focus handoff: Today's MiniEntry → 작업 일지 ring-highlight. Kept
  // as shell-local ephemeral state (focus is not persisted; it's a single
  // event, mirroring the diffActivePath one-shot handoff in DiffScreenV2).
  const [journalFocus, setJournalFocus] = useState<string | null>(null);

  // 검색·코드맵 → 코드 화면 열기 목표 (one-shot, journalFocus 와 같은 패턴).
  // nonce 로 같은 파일·같은 라인의 연속 점프도 구분한다.
  const [codeTarget, setCodeTarget] = useState<
    { path: string; line: number | null; nonce: number } | null
  >(null);
  const openInCode = useCallback(
    (path: string, line: number | null) => {
      setCodeTarget((prev) => ({ path, line, nonce: (prev?.nonce ?? 0) + 1 }));
      setUiV2View("code");
    },
    [setUiV2View],
  );
  const clearCodeTarget = useCallback(() => setCodeTarget(null), []);

  // Planner 📓 → open a specific journal entry's detail view directly. Distinct
  // from `journalFocus` (timeline ring-highlight): this resolves the entry by
  // path even when it's older than the loaded day window, so completed plans
  // whose work is weeks old still navigate. Cleared once the journal consumes it.
  const [journalOpenEntry, setJournalOpenEntry] = useState<string | null>(null);
  const clearJournalOpenEntry = useCallback(() => setJournalOpenEntry(null), []);

  // When a journal entry is opened from another screen (e.g. the Planner's 일지
  // link), remember where to send the detail view's "back" button so the user
  // returns to that origin screen instead of the journal timeline.
  const [journalReturnView, setJournalReturnView] = useState<UiV2View | null>(null);

  // v2 U7 — 팔레트 엔티티 점프. 플래너/토의/문서 화면은 영속 필드
  // (plannerPlanId 등)를 mount 시에만 읽으므로, 이미 그 화면에 있어도 점프가
  // 반영되도록 nonce 로 remount 를 강제한다 (화면은 mount 시 재조회).
  const [jumpNonce, setJumpNonce] = useState(0);
  useEffect(() => {
    if (!active) return;
    const onOpenEntity = (e: Event) => {
      const detail = (e as CustomEvent<OpenEntityDetail>).detail;
      if (!detail?.kind || !detail?.id) return;
      if (detail.kind === "journal") {
        setJournalReturnView(null);
        setJournalOpenEntry(detail.id);
        setUiV2View("journal");
      } else if (detail.kind === "plan" || detail.kind === "plan_item") {
        const planId = detail.id.split("#")[0];
        setPrefs(() => ({ plannerPlanId: planId }));
        setJumpNonce((n) => n + 1);
        setUiV2View("planner");
      } else if (detail.kind === "discussion") {
        setPrefs(() => ({ discussionActiveId: detail.id }));
        setJumpNonce((n) => n + 1);
        setUiV2View("discussion");
      } else if (detail.kind === "doc") {
        setPrefs(() => ({ docsActivePath: detail.id }));
        setJumpNonce((n) => n + 1);
        setUiV2View("docs");
      } else if (detail.kind === "code") {
        // 워크스페이스 심볼(⌘K) — 코드 화면의 기존 열기 핸드오프를 그대로 탄다.
        // LSP 는 0-based, jumpLine 은 1-based.
        openInCode(detail.id, detail.line == null ? null : detail.line + 1);
      }
    };
    window.addEventListener(NAV_BUS.openEntity, onOpenEntity);
    return () => window.removeEventListener(NAV_BUS.openEntity, onOpenEntity);
  }, [setPrefs, setUiV2View, openInCode, active]);

  // 트레이 딥링크로 갓 열린 창 — URL 이 실어 온 목적지를 mount 시 1회 적용한다
  // (새 창의 프런트는 아직 리스너를 달기 전이라 emit 을 받을 수 없다).
  useEffect(() => {
    if (!active) return;
    if (initialEntryPath) {
      setJournalReturnView(null);
      setJournalOpenEntry(initialEntryPath);
      setUiV2View("journal");
      return;
    }
    if (initialView && KNOWN_VIEWS.includes(initialView)) {
      setUiV2View(initialView as UiV2View);
    }
    // 최초 1회 — 이후 사용자의 화면 이동을 되돌리면 안 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 메인 화면 "오늘의 흐름" → 그 일지 항목 (`lib/entryJump`).
  //
  // `active` 로 막지 않는다 — 시작 탭이 승격하거나 숨은 탭이 활성화되는 것은
  // 이 effect 가 도는 **뒤**라, 활성 여부로 걸면 정작 목적지 탭이 요청을 흘린다.
  // 대신 프로젝트 id 로 거른다: 한 창의 모든 탭이 같은 버스를 듣기 때문이다.
  useEffect(() => {
    if (projectId == null) return;
    const open = (path: string) => {
      setJournalReturnView(null);
      setJournalOpenEntry(path);
      setUiV2View("journal");
    };
    const pending = consumeEntryJump(projectId);
    if (pending) open(pending);
    return onEntryJump(projectId, open);
  }, [projectId, setUiV2View]);

  // 트레이 팝오버 딥링크(`events.trayNavigate`)만 셸에 남아 있다 — 새 파일이
  // `events` 를 직접 부르면 `lint:bindings` 가 막고, 그 이벤트를 접는 `@/api/*`
  // 래퍼는 아직 없다 ({#big-files-watch} 의 이월). 래퍼가 생기면 그 구독도
  // 이 훅으로 들어온다.

  return {
    journalFocus,
    setJournalFocus,
    journalOpenEntry,
    setJournalOpenEntry,
    clearJournalOpenEntry,
    journalReturnView,
    setJournalReturnView,
    codeTarget,
    openInCode,
    clearCodeTarget,
    jumpNonce,
  };
}
