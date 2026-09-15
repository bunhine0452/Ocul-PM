// 빈 상태 — 화면(모든 탭 닫힘)과 창(파일 미선택)이 공유한다. 빈 화면이 곧 치트시트다.
// `CodePane.tsx` 에서 그대로 들어냈다 (그쪽에서 재수출하므로 import 경로는 그대로다).
import { EmptyState } from "@/components/EmptyState";
import { t, useT } from "@/i18n";
import { FileCode } from "@/components/Icons";

/** 빈 상태 — 화면(모든 탭 닫힘)과 창(파일 미선택)이 공유한다. */
export function CodeEmptyState() {
  useT();
  const keys: Array<[string, string]> = [
    ["⌘K", t("code.empty.kPalette")],
    ["⌘P", t("code.empty.kQuickOpen")],
    ["F12", t("code.empty.kDef")],
    ["⇧F12", t("code.empty.kRefs")],
    ["⇧⌥F", t("code.empty.kFormat")],
    ["⌘N", t("code.empty.kNewFile")],
    ["⌘W", t("code.empty.kClose")],
    ["⇧⌘T", t("code.empty.kReopen")],
    ["⌃Tab", t("code.empty.kCycle")],
    ["⌘B", t("code.empty.kSidebar")],
    ["⌥Z", t("code.empty.kWrap")],
  ];
  // 바깥 .code-center-hint 는 남긴다 — flex:1 로 창을 채우는 건 이 자리의
  // 레이아웃이고, 안쪽 카드만 공용 EmptyState 로 옮겼다 (v3-surface).
  return (
    <div className="code-center-hint">
      <EmptyState density="rich" icon={FileCode} title={t("code.empty.title")}>
        {t("code.empty.desc")}
        {/* 단축키 표 — 빈 화면이 곧 치트시트다 (VS Code 와 같은 관례). */}
        <div className="code-empty-keys">
          {keys.map(([combo, label]) => (
            <span key={combo} className="code-empty-key"><kbd>{combo}</kbd><span>{label}</span></span>
          ))}
        </div>
      </EmptyState>
    </div>
  );
}
