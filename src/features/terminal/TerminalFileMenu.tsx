import { useEffect, useRef } from "react";

import { Eye, FileCode2, FolderOpen, ExternalLink } from "@/components/Icons";
import { fileOpenApi } from "@/api/fileOpen";
import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";
import { parseWindowRoute } from "@/lib/windowRoute";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toAppError } from "@/api/invoke";
import type { FileRefHit } from "./fileRefLinks";

// 터미널 출력의 파일 경로를 ⌘클릭했을 때 뜨는 선택 팝오버 (2026-09-07).
//
// 예전에는 곧장 **외부 편집기**로 갔다. 그런데 에이전트가 경로를 뱉는 순간
// 사람이 하고 싶은 일은 하나가 아니다 — 어디에 있는지 보고 싶을 때(Finder),
// 열지 않고 내용만 훑고 싶을 때(빠른 미리보기), 앱을 안 떠나고 읽고 싶을
// 때(ocul-pm 코드 화면), 그리고 실제로 고치러 갈 때(외부 편집기). 넷을 한
// 번의 클릭으로 갈라 준다.
//
// 팝오버 뼈대·CSS 는 명령 블록 메뉴(`TerminalBlockMenu`)와 같은 것을 쓴다 —
// 터미널 안에서 뜨는 메뉴가 두 종류로 보일 이유가 없다.

const MENU_WIDTH = 236;

export interface TerminalFileMenuProps {
  hit: FileRefHit;
  /** 프로젝트 절대 루트. 백엔드가 이 안쪽인지 다시 판정한다. */
  projectRoot: string;
  /** 설정의 외부 편집기 명령 템플릿. */
  externalEditorCommand: string;
  onClose: () => void;
}

export function TerminalFileMenu({
  hit,
  projectRoot,
  externalEditorCommand,
  onClose,
}: TerminalFileMenuProps) {
  const { t } = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 바깥 클릭·Esc 로 닫는다. 캡처 단계에서 듣는다 — 터미널 캔버스가 mousedown
  // 을 먼저 삼키면 팝오버가 열린 채 남는다 (블록 메뉴와 같은 이유).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  /** 거절 사유(루트 밖·없는 파일·Quick Look 미지원)를 삼키지 않고 보여 준다. */
  const run = (promise: Promise<unknown>) => {
    void promise.catch((e: unknown) => {
      toast.destructive(t("term.fileRef.failed", { error: tError(toAppError(e)) }));
    });
    onClose();
  };

  // 앱 안 편집기는 **코드 화면이 있는 창**에서만 열 수 있다. 떼어낸 터미널
  // 창에는 셸 자체가 없어 이 이벤트를 들을 사람이 없다 — 아무 일도 안 일어나는
  // 항목을 보여 주느니 감춘다.
  const inAppEditor = parseWindowRoute(window.location.search).kind !== "terminal";

  const openInApp = () => {
    // ShellV2 의 엔티티 점프는 줄을 **0-based** 로 받는다 (LSP 규약).
    const detail: OpenEntityDetail = {
      kind: "code",
      id: hit.path,
      ...(hit.line === null ? {} : { line: hit.line - 1 }),
    };
    window.dispatchEvent(new CustomEvent(NAV_BUS.openEntity, { detail }));
    onClose();
  };

  // 화면 밖으로 나가지 않게 자른다 — 오른쪽 끝 페인에서 누르면 메뉴 절반이
  // 잘려 나간다 (블록 메뉴와 같은 계산).
  const left = Math.min(hit.rect.right + 6, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(hit.rect.top, window.innerHeight - 190);

  return (
    <div
      ref={rootRef}
      className="term-block-menu"
      style={{ left: Math.max(8, left), top: Math.max(8, top), width: MENU_WIDTH }}
      role="menu"
      aria-label={t("term.fileRef.menu")}
    >
      <div className="tbm-head" title={hit.path}>
        <FileCode2 size={13} aria-hidden="true" />
        <span className="tbm-cmd">
          {hit.line === null ? hit.path : `${hit.path}:${hit.line}`}
        </span>
      </div>
      {inAppEditor ? (
        <button type="button" className="tbm-item" role="menuitem" onClick={openInApp}>
          <FileCode2 size={13} aria-hidden="true" />
          {t("term.fileRef.inApp")}
        </button>
      ) : null}
      <button
        type="button"
        className="tbm-item"
        role="menuitem"
        onClick={() => run(fileOpenApi.quickLook(projectRoot, hit.path))}
      >
        <Eye size={13} aria-hidden="true" />
        {t("term.fileRef.quickLook")}
      </button>
      <button
        type="button"
        className="tbm-item"
        role="menuitem"
        onClick={() => run(fileOpenApi.reveal(projectRoot, hit.path))}
      >
        <FolderOpen size={13} aria-hidden="true" />
        {t("term.fileRef.reveal")}
      </button>
      <div className="tbm-sep" role="separator" />
      <button
        type="button"
        className="tbm-item"
        role="menuitem"
        onClick={() =>
          run(fileOpenApi.inExternalEditor(projectRoot, hit.path, externalEditorCommand, hit.line))
        }
      >
        <ExternalLink size={13} aria-hidden="true" />
        {t("term.fileRef.external")}
      </button>
    </div>
  );
}
