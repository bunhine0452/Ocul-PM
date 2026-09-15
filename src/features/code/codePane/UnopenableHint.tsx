// 바이너리·너무 큰 파일 — 편집기 대신 크기와 「외부 편집기로」 를 보여 준다.
// `CodePane.tsx` 에서 그대로 들어냈다.
import { t } from "@/i18n";
import { ExternalLink, FileCode } from "@/components/Icons";

import { formatBytes } from "../treeUtils";

interface Props {
  kind: "binary" | "tooLarge";
  bytes: number;
  projectRoot: string | null;
  openExternal: () => Promise<void>;
}

export function UnopenableHint({ kind, bytes, projectRoot, openExternal }: Props) {
  return (
    <div className="code-center-hint code-unopenable">
      <FileCode size={30} strokeWidth={1.5} />
      <div className="code-unopenable-title">
        {kind === "binary" ? t("code.binary") : t("code.tooLarge")}
      </div>
      <div className="code-unopenable-desc">{formatBytes(bytes)}</div>
      {projectRoot ? (
        <button type="button" className="btn sm" onClick={() => void openExternal()}>
          <ExternalLink size={13} /> {t("code.openExternal")}
        </button>
      ) : null}
    </div>
  );
}
