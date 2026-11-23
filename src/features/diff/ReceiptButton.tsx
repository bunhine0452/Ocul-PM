/**
 * 「영수증 복사」 한 벌 (11-23 love-round #share-receipt-everywhere) — 변경 · 오늘 · 일지 상세가 같은 모양 · 같은 키를
 * 쓴다(영수증 규칙 4). 앞 단추가 바로 복사하고, 옆 ▾ 메뉴에 「마크다운으로 복사」 · 「HTML 파일로 저장…」 이 선다.
 * 키는 ⇧⌘C 하나 — 세 화면 중 떠 있는 하나가 듣는다(셋은 한 번에 하나만 선다).
 *
 * 영수증은 `receipt.ts` 하나뿐이다: 무엇을 담을지는 화면이 `build` 로 넘기고(가지 영수증 · 일지 한 건), HTML 저장도
 * 그 마크다운을 그대로 옮긴다(`receiptHtml.ts`). 복사는 클립보드, 저장은 사람이 고른 로컬 파일 하나 — 그 밖의 송출은 없다.
 */
import { useEffect, useRef, useState } from "react";

import { toAppError } from "@/api/invoke";
import { raceApi } from "@/api/race";
import { ChevronDown } from "@/components/Icons";
import { useMenuKeys } from "@/features/terminal/menuKeys";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { isModChord, isModalOpen, kbd } from "@/lib/kbd";
import { toast } from "@/lib/toast";
import { buildReceipt } from "./receipt";
import { receiptFileName, receiptHtmlDocument } from "./receiptHtml";
import "./receipt.css";

/** 메뉴 폭의 상한 — 오른쪽 끝에서 창 밖으로 넘지 않게 자리를 잡는다. */
const MENU_W = 240;

export interface ReceiptActions {
  copy: () => Promise<void>;
  saveHtml: () => Promise<void>;
}

/** 영수증을 만드는 길 하나로 복사 · HTML 저장 두 동작을. */
export function useReceiptActions(build: () => Promise<string>): ReceiptActions {
  const { t, lang } = useT();
  return {
    copy: () =>
      build()
        .then((md) => navigator.clipboard.writeText(md))
        .then(() => {
          toast.info(t("diff.receipt.copied"));
        })
        .catch((e) => {
          toast.destructive(t("diff.receipt.failed", { error: tError(toAppError(e)) }));
        }),
    saveHtml: () =>
      build()
        .then((md) =>
          raceApi.saveReceiptHtml(receiptFileName(md, "ocul-receipt"), receiptHtmlDocument(md, t("diff.receipt.title"), lang)),
        )
        .then((path) => {
          if (path) toast.info(t("diff.receipt.saved", { path }));
        })
        .catch((e) => {
          toast.destructive(t("diff.receipt.saveFailed", { error: tError(toAppError(e)) }));
        }),
  };
}

/** ⇧⌘C(그 밖 OS 는 Ctrl+Shift+C) 가 오늘 · 일지 · 변경에서 영수증을 복사한다. 대화상자가 떠 있으면 물러난다. */
export function isReceiptChord(e: KeyboardEvent): boolean {
  if (e.repeat || !isModChord(e, { shift: true }) || e.altKey) return false;
  return e.code === "KeyC" || e.key.toLowerCase() === "c";
}

export function useReceiptKey(onCopy: () => void): void {
  const ref = useRef(onCopy);
  ref.current = onCopy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isReceiptChord(e) || isModalOpen()) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** 이 가지의 PR 영수증 — 변경 · 오늘 화면의 툴바. 단추와 ⇧⌘C 를 함께 건다. */
export function BranchReceiptButton({ projectId }: { projectId: number }) {
  const { t } = useT();
  const actions = useReceiptActions(() => buildReceipt(projectId, t));
  useReceiptKey(() => void actions.copy());
  return <ReceiptButton actions={actions} title={t("diff.receipt.copyTitle")} />;
}

/**
 * 앞은 바로 복사, 옆 ▾ 는 메뉴. 툴바 · 일지 머리에 같은 모양으로 선다. 윗줄(툴바)에서는 고스트, 일지 머리처럼 테두리
 * 단추가 늘어선 줄에서는 `outlined` 로 이웃과 같은 테두리 — 한 줄에 단추 모양이 둘 서지 않게(최종 검수).
 */
export function ReceiptButton({
  actions,
  title,
  outlined = false,
}: {
  actions: ReceiptActions;
  title: string;
  outlined?: boolean;
}) {
  const { t } = useT();
  const btn = outlined ? "btn sm" : "btn ghost sm";
  const key = kbd("⇧⌘C");
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useMenuKeys(at != null, boxRef, (refocus) => {
    setAt(null);
    if (refocus) moreRef.current?.focus();
  }, moreRef);

  const toggle = () => {
    if (at) return setAt(null);
    const r = moreRef.current?.getBoundingClientRect();
    if (!r) return;
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)) });
  };
  const run = (job: () => Promise<void>) => {
    setAt(null);
    void job();
  };

  return (
    <span className="rcpt">
      <button type="button" className={btn} title={`${title} (${key})`} onClick={() => void actions.copy()}>
        {t("diff.receipt.copy")}
      </button>
      <button
        ref={moreRef}
        type="button"
        className={`${btn} rcpt-more`}
        aria-haspopup="menu"
        aria-expanded={at != null}
        aria-label={t("diff.receipt.menu")}
        title={t("diff.receipt.menu")}
        onClick={toggle}
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {at ? (
        <div ref={boxRef} className="rcpt-menu" role="menu" aria-label={t("diff.receipt.menu")} style={at}>
          <button type="button" role="menuitem" className="rcpt-item" onClick={() => run(actions.copy)}>
            <span>{t("diff.receipt.copyMd")}</span>
            <kbd className="kbd">{key}</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="rcpt-item"
            title={t("diff.receipt.saveHtmlTitle")}
            onClick={() => run(actions.saveHtml)}
          >
            <span>{t("diff.receipt.saveHtml")}</span>
          </button>
        </div>
      ) : null}
    </span>
  );
}
