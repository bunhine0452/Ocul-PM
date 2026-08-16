import { useEffect, useState } from "react";
import { commands, type BinaryPreview, type BinarySide } from "@/lib/bindings";
import { File as FileIcon, ImageFileIcon } from "@/components/Icons";
import { useT } from "@/i18n";

// 변경 diff — 바이너리 파일 전용 뷰. 이미지/기타 바이너리는 텍스트 diff 가
// 의미가 없으므로(깨진 문자 나열) 파일 카드로 렌더한다: 종류·이전/현재 크기,
// 이미지는 baseline 기준 이전/현재 프리뷰(diff_binary_preview → data URI)까지.
// compute_diff 가 DiffSource::Binary 를 내려준 파일에서만 쓰인다.

/** 사람이 읽는 파일 크기. `null` = 해당 쪽이 존재하지 않음 (신규/삭제). */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface BinaryFileViewProps {
  projectId: number;
  path: string;
  isImage: boolean;
  oldSize: number | null;
  newSize: number | null;
  /** compute_diff 에 넘긴 것과 같은 baseline — 프리뷰의 이전/현재 리비전을 맞춘다. */
  baseline: "working" | "last_commit";
}

export function BinaryFileView({
  projectId,
  path,
  isImage,
  oldSize,
  newSize,
  baseline,
}: BinaryFileViewProps) {
  const { t } = useT();
  const [preview, setPreview] = useState<BinaryPreview | "loading" | "error">("loading");

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    setPreview("loading");
    commands
      .diffBinaryPreview(projectId, path, baseline === "last_commit" ? "last_commit" : null)
      .then((res) => {
        if (!cancelled) setPreview(res.status === "ok" ? res.data : "error");
      })
      .catch(() => {
        if (!cancelled) setPreview("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, path, isImage, baseline]);

  const delta = oldSize != null && newSize != null ? newSize - oldSize : null;

  return (
    <div className="diff-binary">
      <div className="diff-binary-card">
        {isImage ? (
          <ImageFileIcon size={22} color="var(--text-2)" />
        ) : (
          <FileIcon size={22} color="var(--text-2)" />
        )}
        <div className="diff-binary-meta">
          <div className="diff-binary-kind">
            {isImage ? t("diff.binaryImage") : t("diff.binaryFile")}
          </div>
          <div className="diff-binary-size">
            <span title={t("diff.imageOld")}>{formatBytes(oldSize)}</span>
            <span className="diff-binary-arrow" aria-hidden="true">
              →
            </span>
            <span title={t("diff.imageNew")}>{formatBytes(newSize)}</span>
            {delta != null && delta !== 0 ? (
              <span className={"diff-binary-delta" + (delta > 0 ? " add" : " del")}>
                {delta > 0 ? "+" : "−"}
                {formatBytes(Math.abs(delta))}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {isImage ? (
        preview === "loading" ? (
          <div className="empty-hint" style={{ padding: 16 }}>
            {t("diff.previewLoading")}
          </div>
        ) : preview === "error" || (!preview.old && !preview.new) ? (
          <div className="empty-hint" style={{ padding: 16 }}>
            {t("diff.previewUnavailable")}
          </div>
        ) : (
          <div className="diff-binary-panes">
            {preview.old ? (
              <ImagePane label={t("diff.imageOld")} side={preview.old} dim />
            ) : null}
            {preview.new ? <ImagePane label={t("diff.imageNew")} side={preview.new} /> : null}
          </div>
        )
      ) : null}

      <div className="diff-foot" style={{ borderTop: "none", padding: "0 2px" }}>
        {t("diff.binaryNote")}
      </div>
    </div>
  );
}

/** 프리뷰 한 쪽 (이전/현재). 렌더 실패(webview 미지원 포맷)는 안내 문구로 강등. */
function ImagePane({
  label,
  side,
  dim = false,
}: {
  label: string;
  side: BinarySide;
  dim?: boolean;
}) {
  const { t } = useT();
  const [broken, setBroken] = useState(false);
  return (
    <figure className={"diff-binary-pane" + (dim ? " dim" : "")}>
      <figcaption className="diff-binary-pane-head">
        <span>{label}</span>
        <span className="mono">{formatBytes(side.size)}</span>
      </figcaption>
      <div className="diff-binary-img">
        {broken ? (
          <span className="diff-binary-broken">{t("diff.previewUnavailable")}</span>
        ) : (
          <img
            src={`data:${side.mime};base64,${side.base64}`}
            alt={label}
            onError={() => setBroken(true)}
          />
        )}
      </div>
    </figure>
  );
}
