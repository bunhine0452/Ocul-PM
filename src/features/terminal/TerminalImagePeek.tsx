import { useEffect, useState } from "react";

import { X } from "@/components/Icons";
import { ptyApi } from "@/api/terminal";
import { toAppError } from "@/api/invoke";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { formatBytes } from "@/lib/format";

// 터미널 이미지 링크의 미리보기 (2026-10-09) — 띄우는 때는 `useTerminalFileLinks`.
//
// 두 모양이 같은 데이터를 쓴다: 링크에 올리면 **카드**(마우스를 가로채지 않는다
// — 가로채면 xterm 이 곧바로 leave 를 쏘아 카드가 깜빡인다), 누르면 **고정**
// (스크림 위에 크게, Esc·바깥 클릭으로 닫힘). 카드에서 고정으로 넘어갈 때
// 경로가 같으면 다시 읽지 않는다.

/** 카드의 바깥 크기 — 자리 계산에만 쓴다 (실제 상한은 CSS). */
const CARD_W = 380;

type Load =
  | { status: "loading" }
  | { status: "ready"; src: string; bytes: number }
  | { status: "error"; message: string };

export interface TerminalImagePeekProps {
  /** 절대경로. 그림인지는 백엔드가 시그니처로 다시 본다. */
  path: string;
  /** 마우스가 링크에 들어온 화면 좌표. */
  x: number;
  y: number;
  pinned: boolean;
  onClose: () => void;
}

export function TerminalImagePeek({ path, x, y, pinned, onClose }: TerminalImagePeekProps) {
  const { t } = useT();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoad({ status: "loading" });
    setSize(null);
    ptyApi.imagePreview(path).then(
      (a) => alive && setLoad({ status: "ready", src: `data:${a.mime};base64,${a.base64}`, bytes: a.bytes }),
      (e: unknown) => alive && setLoad({ status: "error", message: tError(toAppError(e)) }),
    );
    return () => {
      alive = false;
    };
  }, [path]);

  // 고정일 때만 Esc 로 닫는다. 캡처 단계 — 터미널이 키를 먼저 삼키지 않게.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pinned, onClose]);

  const name = path.split(/[\\/]/).pop() || path;
  const facts = [
    size ? `${size.w}×${size.h}` : null,
    load.status === "ready" ? formatBytes(load.bytes) : null,
  ].filter(Boolean);

  const body =
    load.status === "ready" ? (
      <img
        src={load.src}
        alt={name}
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
    ) : load.status === "error" ? (
      <p className="tip-error">{t("term.imagePeek.failed", { error: load.message })}</p>
    ) : (
      <span className="skel tip-skel" role="status" aria-label={t("term.imagePeek.loading")} />
    );

  const caption = (
    <>
      <span className="tip-name" title={path}>
        {name}
      </span>
      {facts.length > 0 ? <span className="tip-facts">{facts.join(" · ")}</span> : null}
    </>
  );

  if (pinned) {
    return (
      <div className="scrim term-image-scrim" onMouseDown={onClose}>
        <figure
          className="term-image-full"
          role="dialog"
          aria-modal="true"
          aria-label={name}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {body}
          <figcaption>
            {caption}
            <button
              type="button"
              className="ts-btn"
              onClick={onClose}
              aria-label={t("term.imagePeek.close")}
              title={t("term.imagePeek.close")}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </figcaption>
        </figure>
      </div>
    );
  }

  // 아래로 펼 자리가 모자라면 위로 — 화면 아래쪽 줄의 경로가 흔하다(TUI 의 최신 출력).
  const below = y < window.innerHeight * 0.55;
  const left = Math.max(8, Math.min(x + 12, window.innerWidth - CARD_W - 8));
  const place = below ? { top: y + 18 } : { bottom: window.innerHeight - y + 12 };
  return (
    <div className="term-image-peek" style={{ left, ...place }} role="tooltip">
      {body}
      <div className="tip-cap">
        {caption}
        {load.status === "ready" ? <span className="tip-hint">{t("term.imagePeek.hint")}</span> : null}
      </div>
    </div>
  );
}
