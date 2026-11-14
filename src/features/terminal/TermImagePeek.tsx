/**
 * 터미널 이미지 미리보기 (2026-10-30, 3.12.0 의 것을 4.x 디자인으로 다시).
 *
 * 링크에 올리면 **카드** — 마우스를 가로채지 않는다(가로채면 xterm 이 곧바로 leave 를 쏘아
 * 카드가 깜빡인다). 누르면 그 파일을 Finder 에서 연다(11-04). ⌘ 를 누른 채 누르면 **크게** — 스크림 위,
 * Esc · 바깥 클릭으로 닫고 경로를 복사할 수 있다.
 * 그림 뒤는 바둑판이라 투명 PNG(스크린숏 · 아이콘)가 바탕에 묻히지 않는다. 같은 경로를 다시
 * 가리키면 읽은 것을 쓴다(최근 넷).
 *
 * 카드의 글은 두 줄 — 이름(긴 이름은 가운데를 접어 확장자가 남는다), 그 아래 크기와 힌트. 한 줄이던 때는
 * 크기 · 힌트가 자리를 먼저 차지해 이름이 가장 먼저 잘렸다.
 */
import { useEffect, useRef, useState } from "react";

import { toAppError } from "@/api/invoke";
import { terminalApi } from "@/api/terminal";
import { Copy, X } from "@/components/Icons";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { formatBytes } from "@/lib/format";
import { kbd } from "@/lib/kbd";
import { isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { closePeek, useImagePeek, type Peek } from "./imagePeek";

/** 카드 바깥 폭의 상한 — 자리 계산에만 쓴다 (실제 상한은 CSS). */
const CARD_W = 360;
const CACHE_MAX = 4;
/** 카드 한 줄에 드는 이름 글자 수 — 넘으면 가운데를 접는다. */
const NAME_MAX = 40;

/** 가운데 말줄임 — 앞과 확장자 쪽 끝이 남는다(`screenshot-2026-…-1830.png`). */
export function middleEllipsis(name: string, max = NAME_MAX): string {
  if (name.length <= max) return name;
  const tail = Math.ceil((max - 1) * 0.45);
  return name.slice(0, max - 1 - tail) + "…" + name.slice(name.length - tail);
}

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
  const figureRef = useRef<HTMLElement | null>(null);

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

  // 크게 띄우면 그림 자체(figure)에 포커스 — 열자마자 단추에 2px 링이 서지 않게. 포커스는 안에 가두고,
  // 닫으면 연 자리(터미널)로 돌려준다(`useModalBehavior`). Esc 는 캡처 단계에서도 — 터미널이 먼저 삼키지 않게.
  useModalBehavior({ open: pinned, onClose: closePeek, panelRef: figureRef, initialFocusRef: figureRef });
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closePeek();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
          ref={figureRef}
          className="tm-peek-full"
          role="dialog"
          aria-modal="true"
          aria-label={name}
          tabIndex={-1}
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
  // 수정키 이름 — `kbd("⌘")` 만으로는 그 밖 OS 에서 「Ctrl+」 로 끝이 빈 채 나왔다.
  const mod = isMac() ? kbd("⌘") : "Ctrl";
  return (
    <div className="tm-peek" style={{ left, ...place }} role="tooltip">
      {stage}
      <div className="tm-peek-cap">
        <span className="tm-peek-name" title={name}>
          {middleEllipsis(name)}
        </span>
        {facts || load.status === "ready" ? (
          <span className="tm-peek-sub">
            {facts ? <span className="tm-peek-facts">{facts}</span> : null}
            {load.status === "ready" ? <span className="tm-peek-hint">{t("terminal.peek.hint", { mod })}</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
