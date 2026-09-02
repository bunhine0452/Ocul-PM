// svg 인라인 미리보기 — **에디터 옆에서** 지금 고치고 있는 그림을 그린다.
//
// svg 는 코드이자 그림이라 둘 중 하나를 고르면 반드시 하나를 잃는다. VS Code 는
// 텍스트 에디터와 이미지 미리보기를 **서로 다른 에디터**로 두고 제목줄의
// `Open Preview` / `Reopen as Text` 로 갈아탄다 (extensions/media-preview). 여기서는
// 갈아타는 대신 **옆에 붙인다** — 창을 새로 열지 않아도 되고, 무엇보다 저장 전
// 버퍼를 그대로 그릴 수 있다 (`fill` 을 고치는 즉시 색이 바뀐다).
//
// 왜 디스크가 아니라 버퍼인가: `code_asset` 은 저장된 바이트를 읽는다. 아이콘
// 작업의 순환은 "고친다 → 본다" 이지 "고친다 → 저장한다 → 본다" 가 아니다.
//
// 안전: 본문을 `<img src=blob:>` 로만 그린다. `<img>` 안의 svg 는 스크립트·외부
// 참조가 모두 죽는 모드라, 프로젝트에서 열어 본 svg 가 웹뷰 안에서 뭔가를
// 실행할 길이 없다 (인라인 `dangerouslySetInnerHTML` 이었다면 그 반대다).
import { useEffect, useMemo, useRef, useState } from "react";

import { t, useT } from "@/i18n";
import { Maximize2, Minimize2, X } from "@/components/Icons";
import { formatBytes } from "./treeUtils";

export interface SvgPreviewProps {
  /** 지금 버퍼의 본문 — 저장 전 편집이 그대로 보인다. */
  text: string;
  /** `<img alt>` 로 쓸 파일명. */
  name: string;
  onClose: () => void;
}

export function SvgPreview({ text, name, onClose }: SvgPreviewProps) {
  useT();
  /** 창에 맞출까(false) 원본 크기로 볼까(true) — 이미지 미리보기와 같은 손잡이. */
  const [actualSize, setActualSize] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const urlRef = useRef<string | null>(null);

  // 본문이 바뀔 때마다 새 blob — 앞의 것은 반드시 되돌려 준다 (안 하면 타자
  // 한 번에 사본이 한 장씩 쌓인다). 부모가 디바운스한 본문을 넘겨 준다.
  //
  // 크기·오류 표시도 여기서 함께 지운다: 앞 판의 값을 물려받으면 새 본문을
  // 아직 못 그린 동안 화면이 거짓말을 한다.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setNatural(null);
    setBroken(false);
    if (!text.trim()) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    urlRef.current = next;
    setUrl(next);
  }, [text]);

  // 언마운트에서 마지막 한 장을 정리한다 (위 effect 안에서 하면 본문이 바뀔
  // 때마다 도로 만들게 된다).
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  const bytes = useMemo(() => new TextEncoder().encode(text).length, [text]);

  return (
    <aside className="code-svgpane" aria-label={t("code.svg.paneAria")}>
      <div className="code-preview-bar">
        <span className="code-preview-meta">{formatBytes(bytes)}</span>
        {natural ? (
          <span className="code-preview-meta">
            {natural.w} × {natural.h}
          </span>
        ) : null}
        <span className="code-preview-bar-right">
          <button
            type="button"
            className="btn ghost sm"
            aria-pressed={actualSize}
            onClick={() => setActualSize((v) => !v)}
          >
            {actualSize ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {actualSize ? t("code.preview.fit") : t("code.preview.actual")}
          </button>
          <button
            type="button"
            className="code-svgpane-close"
            onClick={onClose}
            title={t("code.svg.hide")}
            aria-label={t("code.svg.hide")}
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </span>
      </div>

      {url && !broken ? (
        <div className={"code-preview-stage" + (actualSize ? " actual" : "")}>
          <img
            src={url}
            alt={name}
            className="code-preview-img"
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            onError={() => setBroken(true)}
          />
        </div>
      ) : (
        // 고치는 중에는 반드시 지나가는 상태다 (태그를 반쯤 지운 순간). 오류가
        // 아니라 "아직 그릴 수 없다" 로 말한다 — 계속 타자를 치면 돌아온다.
        <div className="code-preview-stage code-svgpane-broken">
          <span>{t("code.svg.invalid")}</span>
        </div>
      )}
    </aside>
  );
}
