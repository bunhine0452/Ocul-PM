import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "@/components/Icons";
import { useT } from "@/i18n";
import { splitPath } from "@/lib/filePath";
import { blocked } from "@/lib/blocked";
import type { FileRow } from "./EntryFileList";

// diff 칸의 머리 한 줄 (2026-09-11 원장의 한 장 리디자인) — [‹ ›] 경로 [1/9].
// 파일 목록이 왼쪽 칸 **부록**으로 내려가면서, 아무 파일이나 바로 여는 길이
// 하나 더 필요해졌다: 경로 자체가 버튼이고 누르면 목록이 메뉴로 떨어진다.
// 앞뒤 화살표와 j/k 는 그대로다.

interface EntryFileBarProps {
  rows: FileRow[];
  /** diff 가 기록된 경로만, 목록 순서대로 — 앞뒤 이동의 궤도. */
  orderedPaths: string[];
  activePath: string;
  activeIdx: number;
  onSelect: (path: string) => void;
}

export function EntryFileBar({ rows, orderedPaths, activePath, activeIdx, onSelect }: EntryFileBarProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const many = rows.length > 1;

  const close = useCallback(() => setOpen(false), []);

  // 바깥 클릭·Esc 로 닫는다. Esc 는 **캡처 단계의 document** 에서 삼킨다 —
  // 부모의 window 리스너(Esc = 목록으로)가 뒤에 오므로, 메뉴만 닫고 화면은
  // 그대로 있어야 한다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  // 다른 파일로 옮기면(화살표·j/k 포함) 메뉴는 할 일을 마친 것이다.
  useEffect(() => {
    close();
  }, [activePath, close]);

  const { dir, base } = splitPath(activePath, "", Infinity);

  return (
    <div className="entry-file-bar" ref={barRef}>
      {orderedPaths.length > 1 ? (
        <div className="efb-steps">
          <button
            type="button"
            className="efb-step"
            onClick={() => onSelect(orderedPaths[activeIdx - 1])}
            aria-label={t("entry.prevFile")}
            {...blocked(activeIdx <= 0 ? t("entry.blockedFirstFile") : null, `${t("entry.prevFile")} (k)`)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="efb-step"
            onClick={() => onSelect(orderedPaths[activeIdx + 1])}
            aria-label={t("entry.nextFile")}
            {...blocked(
              activeIdx < 0 || activeIdx >= orderedPaths.length - 1 ? t("entry.blockedLastFile") : null,
              `${t("entry.nextFile")} (j)`,
            )}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="efb-file"
        title={many ? t("entry.fileMenu") : activePath}
        aria-haspopup={many ? "listbox" : undefined}
        aria-expanded={many ? open : undefined}
        data-static={many ? undefined : "true"}
        onClick={() => many && setOpen((o) => !o)}
      >
        <span className="efb-path">
          {dir ? <span className="efb-dir">{dir}</span> : null}
          <span className="efb-base">{base}</span>
        </span>
        {many ? <ChevronDown size={13} /> : null}
      </button>
      {orderedPaths.length > 1 ? (
        <span className="efb-count">
          {Math.max(activeIdx, 0) + 1}
          <span className="efb-count-sep">/</span>
          {orderedPaths.length}
        </span>
      ) : null}
      {open ? (
        <div className="efb-menu" role="listbox" aria-label={t("entry.fileMenu")}>
          {rows.map((r) => {
            const p = splitPath(r.path, "", Infinity);
            const isActive = r.path === activePath;
            return (
              <button
                key={r.path}
                type="button"
                role="option"
                aria-selected={isActive}
                className={"dfile" + (isActive ? " active" : "") + (r.hasDiff ? "" : " muted")}
                onClick={() => {
                  if (!r.hasDiff) return;
                  onSelect(r.path);
                  close();
                }}
                {...blocked(r.hasDiff ? null : t("entry.blockedNoDiff"), r.path)}
              >
                <span className={"dstatus " + r.op}>{r.op}</span>
                <span className="dfile-name">
                  {p.dir ? <span className="dfile-dir">{p.dir}</span> : null}
                  <span className="dfile-base">{p.base}</span>
                </span>
                {r.note ? <span className="dfile-note">{r.note}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
