import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";
import "./copyCommand.css";

/**
 * 터미널에 붙여 넣을 명령 한 덩이 + 「복사」 — 여러 줄이면 줄바꿈으로 이어 한 번에
 * 복사한다. 실패(권한·비활성 창)를 「복사됨」으로 보이면 안 된다 — 그때는 직접
 * 입력하라고 말한다.
 */
export function CopyCommand({ lines, label }: { lines: readonly string[]; label?: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
    } catch {
      toast.warning(t("op.copyFailed"));
    }
  };

  return (
    <div className="copy-cmd">
      <code className="copy-cmd-text mono" aria-label={label}>
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </code>
      <button type="button" className="btn sm" onClick={() => void copy()}>
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}
