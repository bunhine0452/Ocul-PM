// 턴의 조각 흐름을 **활동으로** 그린다 (플랜 `v3-surface` `{#activity-layer}`).
//
// `TurnRow` 안에 있던 `blocks.map(...)` 이 여기로 왔다. 옮긴 이유는 크기가
// 아니라 **책임**이다: 그 map 은 이제 "무슨 활동인가"를 판정하고(classify),
// 이웃끼리 묶고(group), 어휘가 정한 얼굴로 그린다(presenters). 셋 다 조용히
// 틀리기 쉬운 자리라 화면 조각 하나가 통째로 소유하는 편이 낫다.

import { memo } from "react";
import { ChevronDown } from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import { useT } from "@/i18n";
import type { AcpBlock } from "../acpTurns";
import { StreamingMarkdown } from "../conversation/Markdown";
import { streamNodes, type BlockActivity } from "./fromBlocks";
import { PRESENTERS } from "./presenters";

/**
 * 접힌 묶음 한 줄 — "파일 12개 읽음".
 *
 * `<details>` 를 쓴다: 이 줄은 턴마다 여러 개 생기는데 여는 상태를 React 로
 * 들면 스트리밍 프레임마다 그만큼의 상태가 함께 다시 그려진다. 그리고 접힘이
 * 기본값이라는 사실이 마크업에 그대로 적힌다.
 */
function ActivityRun({ items }: { items: BlockActivity[] }) {
  const { t } = useT();
  const present = PRESENTERS[items[0].kind];
  const { Icon } = present;
  // 첫 대상 하나만 미리 보여 준다 — "무엇을 읽었나"의 첫 실마리. 전부 적으면
  // 접은 이유가 없어진다.
  const first = items.find((item) => item.call?.locations.length)?.call?.locations[0];
  return (
    <details className="activity-run">
      <summary>
        <ChevronDown size={11} className="activity-run-caret" />
        <span className="activity-run-icon">
          <Icon size={13} />
        </span>
        <span className="activity-run-text">{t(present.runKey, { n: items.length })}</span>
        {first ? <span className="activity-run-path">{first}</span> : null}
      </summary>
      <div className="activity-run-body">
        {items.map((item) => {
          const { Row } = PRESENTERS[item.kind];
          return <Row key={item.id} activity={item} />;
        })}
      </div>
    </details>
  );
}

/**
 * 조각들을 순서 그대로 그린다.
 *
 * `live` 는 **마지막 산문 조각에만** 흐르는 마크다운을 붙이는 표다 — 앞의
 * 것들은 이미 끝났고, 매 프레임 전체를 다시 파싱하면 스트리밍이 끊겨 보인다.
 */
export const ActivityStream = memo(function ActivityStream({
  blocks,
  live,
}: {
  blocks: readonly AcpBlock[];
  live: boolean;
}) {
  return (
    <>
      {streamNodes(blocks).map((node, i) => {
        if (node.node === "text") {
          return (
            <div className="msg-md" key={node.key}>
              {live && node.last ? (
                <StreamingMarkdown text={node.text} />
              ) : (
                <Markdown>{node.text}</Markdown>
              )}
            </div>
          );
        }
        if (node.node === "run") {
          return <ActivityRun key={`r${i}-${node.items[0].id}`} items={node.items} />;
        }
        const { Row } = PRESENTERS[node.item.kind];
        return <Row key={node.item.id} activity={node.item} />;
      })}
    </>
  );
});
