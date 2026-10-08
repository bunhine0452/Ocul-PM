// 논의 편집기의 개요 — 문서의 `##`·`###` 제목을 목차로 두고, 누르면 그 자리로 간다.
//
// 이 문서 형식은 섹션이 곧 구조다(문제 → 배경 → 후보 방안 → 토의 → 결론 → 다음 단계).
// 긴 문서에서 "지금 어디를 쓰고 있나" 를 본문을 스크롤하지 않고 보게 하고, 파서가
// 모르는 `##` 제목(저장하면 읽기 화면에서 그 아래가 사라진다)을 그 자리에서 표시한다.

import { AlertTriangle } from "@/components/Icons";
import { useT } from "@/i18n";

import type { OutlineItem } from "./outline";

interface Props {
  items: readonly OutlineItem[];
  /** 커서가 있는 항목 (-1 = 첫 제목 위). */
  current: number;
  onJump: (index: number) => void;
}

export function DiscussionOutline({ items, current, onJump }: Props) {
  const { t } = useT();
  return (
    <nav className="disc-outline" aria-label={t("disc.editor.outline")}>
      <div className="disc-outline-head">{t("disc.editor.outline")}</div>
      {items.length === 0 ? (
        <p className="disc-outline-empty">{t("disc.editor.outlineEmpty")}</p>
      ) : (
        <ol className="disc-outline-list">
          {items.map((item, i) => {
            const unknown = item.level === 2 && item.kind === "unknown";
            return (
              <li key={`${item.line}:${item.title}`}>
                <button
                  type="button"
                  className={`disc-outline-item l${item.level}${i === current ? " on" : ""}${unknown ? " unknown" : ""}`}
                  aria-current={i === current ? "location" : undefined}
                  title={unknown ? t("disc.editor.outlineUnknown") : item.title}
                  onClick={() => onJump(i)}
                >
                  {unknown ? <AlertTriangle size={11} aria-hidden /> : null}
                  <span>{item.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
