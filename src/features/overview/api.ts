/**
 * Single-shot fetcher for the Overview widgets. Wraps the typed-error
 * envelope from `commands.oculpmOverviewStats` so callers see a clean
 * `Promise<OculpmOverviewStats>` and a thrown `Error` on failure.
 */

import { commands, type OculpmOverviewStats } from "@/lib/bindings";

export async function fetchOverviewStats(
  projectId: number,
  windowDays: number,
): Promise<OculpmOverviewStats> {
  const res = await commands.oculpmOverviewStats(projectId, windowDays);
  if (res.status === "error") {
    throw new Error(res.error);
  }
  return res.data;
}
