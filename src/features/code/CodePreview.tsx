// 이미지·PDF 미리보기 — 편집할 수 없는 파일을 **읽을 수는 있게** 하는 창.
//
// 왜 Blob URL 인가: 웹뷰는 `file:///…` 을 `<img src>` 로 못 읽는다 (Tauri 의
// 자산 프로토콜을 프로젝트 전체로 열면 그만큼 창구가 넓어진다). 그래서 바이트를
// base64 로 받아 이 안에서만 사는 `blob:` URL 로 되돌린다 — 다른 화면과 같은
// 백엔드 가드(프로젝트 루트 밖 불가)를 그대로 쓰면서 화면만 늘리는 방법이다.
//
// data: URI 가 아니라 blob: 인 이유는 크기다. 16MB 파일이면 data: URI 는 21MB
// 짜리 **문자열**이 되어 DOM 속성에 그대로 박힌다.
import { useEffect, useRef, useState } from "react";

import { commands } from "@/lib/bindings";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { ExternalLink, ImageFileIcon, Maximize2, Minimize2 } from "@/components/Icons";
import { baseName } from "./fileOps";
import { formatBytes } from "./treeUtils";
import type { PreviewKind } from "./previewKind";

type Asset = { url: string; mime: string; bytes: number };

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; asset: Asset };

/** base64 → Blob. `atob` 한 번 + 바이트 복사 한 번이 가장 짧은 경로다. */
function toBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export interface CodePreviewProps {
  projectId: number;
  /** 프로젝트 루트 기준 경로 — `code_asset` 인자와 같은 계약. */
  path: string;
  kind: PreviewKind;
  /** 디스크가 바뀔 때마다 오르는 값 — 바뀌면 다시 읽는다 (에이전트가 파일을 고친다). */
  epoch: number;
  /** 외부 앱으로 열 수 있는가 (프로젝트 경로를 아는가). */
  canOpenExternal: boolean;
  onOpenExternal: () => void;
}

export function CodePreview({
  projectId,
  path,
  kind,
  epoch,
  canOpenExternal,
  onOpenExternal,
}: CodePreviewProps) {
  useT();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  /** 이미지를 창에 맞출까(false) 원본 픽셀로 볼까(true). PDF 는 뷰어가 알아서 한다. */
  const [actualSize, setActualSize] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // 이전 blob: URL 은 반드시 되돌려 준다 — 안 하면 파일을 옮겨 다닐 때마다
  // 웹뷰 안에 사본이 쌓인다 (16MB 짜리가 몇 장이면 바로 체감된다).
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: "loading" });
    setNatural(null);
    void commands.codeAsset(projectId, path).then((res) => {
      if (!alive) return;
      if (res.status === "error") {
        setLoad({ kind: "error", message: tError(res.error) });
        return;
      }
      const { mime, base64, bytes } = res.data;
      const url = URL.createObjectURL(toBlob(base64, mime));
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setLoad({ kind: "ready", asset: { url, mime, bytes } });
    });
    return () => {
      alive = false;
    };
  }, [projectId, path, epoch]);

  // 언마운트에서 마지막 한 장을 정리한다 (effect 안에서 하면 리렌더마다 도로 만든다).
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  if (load.kind === "loading") {
    return <div className="code-center-hint">{t("common.loading")}</div>;
  }
  if (load.kind === "error") {
    return (
      <div className="code-center-hint code-unopenable">
        <ImageFileIcon size={30} strokeWidth={1.5} />
        <div className="code-unopenable-title">{t("code.preview.failed")}</div>
        <div className="code-unopenable-desc">{load.message}</div>
        {canOpenExternal ? (
          <button type="button" className="btn sm" onClick={onOpenExternal}>
            <ExternalLink size={13} /> {t("code.openExternal")}
          </button>
        ) : null}
      </div>
    );
  }

  const { asset } = load;
  const name = baseName(path);

  return (
    <div className="code-preview">
      <div className="code-preview-bar">
        <span className="code-preview-meta">{formatBytes(asset.bytes)}</span>
        {natural ? (
          <span className="code-preview-meta">
            {natural.w} × {natural.h}
          </span>
        ) : null}
        <span className="code-preview-bar-right">
          {kind === "image" ? (
            <button
              type="button"
              className="btn ghost sm"
              aria-pressed={actualSize}
              onClick={() => setActualSize((v) => !v)}
            >
              {actualSize ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {actualSize ? t("code.preview.fit") : t("code.preview.actual")}
            </button>
          ) : null}
          {canOpenExternal ? (
            <button type="button" className="btn ghost sm" onClick={onOpenExternal}>
              <ExternalLink size={13} /> {t("code.openExternal")}
            </button>
          ) : null}
        </span>
      </div>

      {kind === "image" ? (
        // 체커보드 바탕 — 투명 PNG 의 배경이 테마 색과 섞여 "흰 그림" 으로 보이는
        // 것을 막는다. 아이콘 작업에서 이 구분이 곧 정보다.
        <div className={"code-preview-stage" + (actualSize ? " actual" : "")}>
          <img
            src={asset.url}
            alt={name}
            className="code-preview-img"
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
          />
        </div>
      ) : (
        // 웹뷰 내장 PDF 뷰어에 맡긴다 — WKWebView·WebView2 모두 blob: 을 그린다.
        <iframe className="code-preview-pdf" src={asset.url} title={name} />
      )}
    </div>
  );
}
