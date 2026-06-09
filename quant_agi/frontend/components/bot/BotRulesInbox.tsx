"use client";

import type { PaperBotRule } from "../../lib/paperBotApi";

type Props = {
  pendingRules: PaperBotRule[];
  activeRules: PaperBotRule[];
  busy: boolean;
  onSubmitNote: (note: string) => void;
  onApprove: (ruleId: number) => void;
  onDismiss: (ruleId: number) => void;
};

export function BotRulesInbox({
  pendingRules,
  activeRules,
  busy,
  onSubmitNote,
  onApprove,
  onDismiss
}: Props) {
  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-panelAlt/50 p-3">
      <h3 className="text-sm font-semibold text-white/80">Trading rules inbox</h3>
      <p className="mt-1 text-xs text-white/50">
        Describe your style in plain English — Grok proposes rules you approve before they affect simulate-day.
      </p>

      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const note = String(fd.get("note") || "").trim();
          if (note) onSubmitNote(note);
          e.currentTarget.reset();
        }}
      >
        <textarea
          name="note"
          rows={2}
          disabled={busy}
          placeholder='e.g. "Keep each position under 5% and stay conservative."'
          className="min-h-[44px] flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-lg border border-neon/40 bg-neon/15 px-3 py-2 text-xs font-medium text-white hover:bg-neon/25 disabled:opacity-50"
        >
          Send to Grok
        </button>
      </form>

      {activeRules.length ? (
        <div className="mt-4">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-white/45">Active rules</p>
          <ul className="flex flex-wrap gap-2">
            {activeRules.map((r) => (
              <li
                key={r.id}
                className="rounded-full border border-mint/30 bg-mint/10 px-2.5 py-1 text-[11px] text-mint"
                title={r.ruleJson?.rationale ? String(r.ruleJson.rationale) : undefined}
              >
                {r.ruleText}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingRules.length ? (
        <ul className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Pending approval</p>
          {pendingRules.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs">
              <p className="font-medium text-white">{r.ruleText}</p>
              {r.ruleJson?.rationale ? (
                <p className="mt-1 text-white/50">{String(r.ruleJson.rationale)}</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onApprove(r.id)}
                  className="rounded-md border border-mint/40 bg-mint/15 px-2.5 py-1 text-[11px] text-mint disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDismiss(r.id)}
                  className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/70 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-white/45">No pending rules — add a trading note above.</p>
      )}
    </div>
  );
}
