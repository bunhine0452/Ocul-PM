// 이미지 첨부 — 썸네일과 라이트박스.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/Icons";
import { useT } from "@/i18n";
import { type AcpTurnImage } from "../acpTurns";

/** 크게 보기. Escape·바깥 클릭으로 닫힌다. */
export function Lightbox({ image, onClose }: { image: AcpTurnImage; onClose: () => void }) {
  const { t } = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 대화 화면의 Escape 는 "생성 중단"이다 — 여기까지 내려가면 보던 것을
        // 닫으려다 작업이 멎는다. 이 창이 떠 있는 동안은 우리가 먹는다.
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <figure className="lightbox-frame" onClick={(e) => e.stopPropagation()}>
        <img className="lightbox-img" alt={image.name} src={image.src} />
        <figcaption className="lightbox-cap">
          <span className="lightbox-name">{image.name}</span>
          {image.width > 0 ? (
            <span className="lightbox-dim">
              {image.width}×{image.height}
            </span>
          ) : null}
        </figcaption>
      </figure>
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label={t("acp.image.close")}
        title={t("acp.image.close")}
      >
        <X size={16} />
      </button>
    </div>,
    document.body,
  );
}

/**
 * 턴 한 줄. **memo 인 이유**: 스트리밍 중에는 마지막 턴만 바뀌는데, memo 가
 * 없으면 매 갱신마다 지난 턴의 마크다운까지 전부 다시 파싱된다 — 대화가 길수록
 * 심해져 "렉 걸린 타자"처럼 보인다. 리듀서가 바뀐 턴만 새 객체로 만들기 때문에
 * 기본 얕은 비교로 충분하다.
 */
/**
 * 보낸 이미지 한 장 — 파일 이름과 원본 픽셀 크기를 달고, 누르면 크게 본다.
 *
 * 대화에 원본을 그대로 박지 않는 이유: 스크린샷은 대개 대화 폭보다 크고,
 * 통째로 깔면 그 뒤의 지시문이 화면 밖으로 밀린다. 목록에서는 **무엇을
 * 붙였는지만** 알면 되고, 실제로 보고 싶을 때는 그때 크게 연다.
 */
export function ImageAttachment({ image }: { image: AcpTurnImage }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="user-file image"
        onClick={() => setOpen(true)}
        title={t("acp.image.view")}
      >
        <img className="user-file-thumb" alt="" src={image.src} />
        <span className="user-file-name">{image.name}</span>
        {image.width > 0 ? (
          <span className="user-file-dim">
            {image.width}×{image.height}
          </span>
        ) : null}
      </button>
      {open ? <Lightbox image={image} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
