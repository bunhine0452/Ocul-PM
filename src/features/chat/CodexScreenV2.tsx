import { AcpConversation } from "./AcpConversation";

/** OpenAI Codex running through the provider-neutral ACP work surface. */
export function CodexScreenV2({ projectId }: { projectId: number }) {
  return <AcpConversation projectId={projectId} provider="codex" />;
}
