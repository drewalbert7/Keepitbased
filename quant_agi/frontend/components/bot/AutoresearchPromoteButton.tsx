"use client";

import { useState } from "react";
import {
  fetchPaperBotAutoresearchLatest,
  promotePaperBotAutoresearchPatch,
  type PaperBotAutoresearchLatest
} from "../../lib/paperBotApi";

type Props = {
  data: PaperBotAutoresearchLatest | null;
  onPromoted?: () => void;
  compact?: boolean;
};

export function AutoresearchPromoteButton({ data, onPromoted, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const exp = data?.latestExperiment;
  const canPromote =
    Boolean(data?.promotion?.promotionReady) &&
    Boolean(exp?.improved) &&
    Boolean(exp?.commitSha) &&
    !data?.resetCooldown?.blocked;

  async function handlePromote() {
    if (!exp?.commitSha) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await promotePaperBotAutoresearchPatch({
        commitSha: exp.commitSha,
        experimentId: exp.id
      });
      setSuccess(`Promoted to ${result.branch} (${result.promotedSha?.slice(0, 8)})`);
      onPromoted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promote failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  return (
    <div className={compact ? "" : "mt-2"}>
      <button
        type="button"
        disabled={busy || !canPromote}
        onClick={() => void handlePromote()}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
          canPromote
            ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
            : "border border-white/15 bg-white/5 text-white/45"
        }`}
        title={
          data.resetCooldown?.blocked
            ? `Reset cooldown — ${data.resetCooldown.hoursRemaining}h remaining`
            : !data.promotion.promotionReady
              ? "Promotion gates not satisfied"
              : !exp?.improved
                ? "Latest experiment did not improve"
                : "Copy patch to promoted/staging branch (sandbox only)"
        }
      >
        {busy ? "Promoting…" : "Approve patch → staging"}
      </button>
      {error ? <p className="mt-1 text-[11px] text-warn">{error}</p> : null}
      {success ? <p className="mt-1 text-[11px] text-emerald-300">{success}</p> : null}
      {!compact && !canPromote && data.resetCooldown?.blocked ? (
        <p className="mt-1 text-[11px] text-amber-200/80">
          Reset cooldown active — {data.resetCooldown.hoursRemaining}h until promote is allowed.
        </p>
      ) : null}
    </div>
  );
}

/** Hook helper for CodeDiffPanel when strip data is not passed in. */
export async function loadAutoresearchForPromote(): Promise<PaperBotAutoresearchLatest | null> {
  try {
    return await fetchPaperBotAutoresearchLatest();
  } catch {
    return null;
  }
}
