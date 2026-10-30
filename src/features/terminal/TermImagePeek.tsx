/**
 * 터미널 이미지 미리보기 (2026-10-30, 3.12.0 의 것을 4.x 디자인으로 다시).
 *
 * 링크에 올리면 **카드** — 마우스를 가로채지 않는다(가로채면 xterm 이 곧바로 leave 를 쏘아
 * 카드가 깜빡인다). 누르면 **크게** — 스크림 위, Esc · 바깥 클릭으로 닫고 경로를 복사할 수 있다.
 * 그림 뒤는 바둑판이라 투명 PNG(스크린숏 · 아이콘)가 바탕에 묻히지 않는다. 같은 경로를 다시
 * 가리키면 읽은 것을 쓴다(최근 넷).
 */
import { useEffect, useRef, useState } from "react";

import { toAppError } from "@/api/invoke";
import { terminalApi } from "@/api/terminal";
import { Copy, X } from "@/components/Icons";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { formatBytes } from "@/lib/format";
import { toast } from "@/lib/toast";
import { closePeek, useImagePeek, type Peek } from "./imagePeek";

/** 카드 바깥 폭의 상한 — 자리 계산에만 쓴다 (실제 상한은 CSS). */
const CARD_W = 360;
const CACHE_MAX = 4;

type Load =
  | { status: "loading" }
  | { status: "ready"; src: string; bytes: number }
  | { status: "error"; message: string };

const cache = new Map<string, { src: string; bytes: number }>();

function remember(path: string, value: { src: string; bytes: number }) {
  cache.delete(path);
  cache.set(path, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

export function TermImagePeekHost() {
  const peek = useImagePeek();
  // 카드 → 크게 로 넘어갈 때 다시 읽지 않도록 경로로만 다시 그린다.
  return peek ? <TermImagePeek key={peek.path} {...peek} /> : null;
}

function TermImagePeek({ path, x, y, pinned }: Peek) {
  const { t } = useT();
  const [load, setLoad] = useState<Load>(() => {
    const hit = cache.get(path);
    return hit ? { status: "ready", ...hit } : { status: "loading" };
  });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (cache.has(path)) return;
    let alive = true;
    terminalApi.imagePreview(path).then(
      (img) => {
        const value = { src: `data:${img.mime};base64,${img.base64}`, bytes: img.bytes };
        remember(path, value);
        if (alive) setLoad({ status: "ready", ...value });
      },
      (e: unknown) => alive && setLoad({ status: "error", message: tError(toAppError(e)) }),
    );
    return () => {
      alive = false;
    };
  }, [path]);

  // 크게 띄우면 닫기 단추로 포커스를 옮기고, 닫으면 돌려준다(터미널이 다시 키를 받는다).
  // Esc 는 캡처 단계에서 — 터미널이 키를 먼저 삼키지 않게.
  useEffect(() => {
    if (!pinned) return;
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closePeek();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
  }, [pinned]);

  const name = path.split(/[\\/]/).pop() || path;
  const facts = [size ? `${size.w}×${size.h}` : null, load.status === "ready" ? formatBytes(load.bytes) : null]
    .filter(Boolean)
    .join(" · ");

  const stage = (
    <div className="tm-peek-stage">
      {load.status === "ready" ? (
        <img
          src={load.src}
          alt={name}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      ) : load.status === "error" ? (
        <p className="tm-peek-error">{load.message}</p>
      ) : (
        <span className="skel tm-peek-skel" role="status" aria-label={t("terminal.peek.loading")} />
      )}
    </div>
  );

  if (pinned) {
    const copy = () =>
      void navigator.clipboard
        ?.writeText(path)
        .then(() => toast.info(t("terminal.peek.copied")))
        .catch(() => {});
    return (
      <div className="scrim tm-peek-scrim" onMouseDown={closePeek}>
        <figure
          className="tm-peek-full"
          role="dialog"
          aria-modal="true"
          aria-label={name}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {stage}
          <figcaption>
            <span className="tm-peek-name">{name}</span>
            {facts ? <span className="tm-peek-facts">{facts}</span> : null}
            <span className="tm-peek-dir" title={path}>
              {path}
            </span>
            <button type="button" className="btn sm" onClick={copy}>
              <Copy size={13} aria-hidden="true" />
              {t("terminal.peek.copyPath")}
            </button>
            <button
              ref={closeRef}
              type="button"
              className="iconbtn sm"
              onClick={closePeek}
              aria-label={t("terminal.peek.close")}
              title={t("terminal.peek.close")}
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
    <div className="tm-peek" style={{ left, ...place }} role="tooltip">
      {stage}
      <div className="tm-peek-cap">
        <span className="tm-peek-name">{name}</span>
        {facts ? <span className="tm-peek-facts">{facts}</span> : null}
        {load.status === "ready" ? <span className="tm-peek-hint">{t("terminal.peek.hint")}</span> : null}
      </div>
    </div>
  );
}
