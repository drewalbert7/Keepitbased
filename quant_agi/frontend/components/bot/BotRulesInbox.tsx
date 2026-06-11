"use client";

import type { PaperBotRule } from "../../lib/paperBotApi";

type Props = {
  pendingRules: PaperBotRule[];
  activeRules: PaperBotRule[];
  busy: boolean;
  onSubmitNote: (note: string) => void;
  onApprove: (ruleId: number) => void;
  onRemove: (ruleId: number) => void;
  onClearPending?: () => void;
};

function ruleSourceBadge(rule: PaperBotRule) {
  if (rule.ruleJson?.brain_reflection) {
    return (
      <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-[10px] text-violet-200">
        Brain reflection
      </span>
    );
  }
  if (rule.source === "autoresearch") {
    return (
      <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[10px] text-cyan-200">
        Autoresearch
      </span>
    );
  }
  return null;
}

function RuleCard({
  rule,
  busy,
  variant,
  onApprove,
  onRemove
}: {
  rule: PaperBotRule;
  busy: boolean;
  variant: "pending" | "active";
  onApprove?: (ruleId: number) => void;
  onRemove: (ruleId: number) => void;
}) {
  const policyHint =
    rule.ruleJson?.rule_type && rule.ruleJson?.value != null
      ? `${String(rule.ruleJson.rule_type).replace(/_/g, " ")} → ${String(rule.ruleJson.value)}`
      : null;

  return (
    <li className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-white">{rule.ruleText}</p>
            {ruleSourceBadge(rule)}
          </div>
          {policyHint ? <p className="mt-1 text-[11px] text-white/40">{policyHint}</p> : null}
          {rule.ruleJson?.rationale ? (
            <p className="mt-1 text-white/50">{String(rule.ruleJson.rationale)}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {variant === "pending" && onApprove ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove(rule.id)}
              className="rounded-md border border-mint/40 bg-mint/15 px-2.5 py-1 text-[11px] text-mint disabled:opacity-50"
            >
              Approve
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(rule.id)}
            className="rounded-md border border-warn/35 bg-warn/10 px-2.5 py-1 text-[11px] text-warn disabled:opacity-50"
            title={variant === "active" ? "Stop applying this rule to the bot" : "Remove without approving"}
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

export function BotRulesInbox({
  pendingRules,
  activeRules,
  busy,
  onSubmitNote,
  onApprove,
  onRemove,
  onClearPending
}: Props) {
  const hasRules = pendingRules.length > 0 || activeRules.length > 0;

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-panelAlt/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white/80">Trading rules inbox</h3>
          <p className="mt-1 text-xs text-white/50">
            Approve proposals before they affect auto-run — remove any rule anytime to revert toward defaults.
          </p>
        </div>
        {pendingRules.length > 1 && onClearPending ? (
          <button
            type="button"
            disabled={busy}
            onClick={onClearPending}
            className="shrink-0 rounded-md border border-warn/30 px-2.5 py-1 text-[11px] text-warn hover:bg-warn/10 disabled:opacity-50"
          >
            Remove all pending ({pendingRules.length})
          </button>
        ) : null}
      </div>

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
          Send to Grok Bot
        </button>
      </form>

      {activeRules.length ? (
        <div className="mt-4">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-white/45">
            Active rules — applied to policy
          </p>
          <ul className="space-y-2">
            {activeRules.map((r) => (
              <RuleCard
                key={r.id}
                rule={r}
                busy={busy}
                variant="active"
                onRemove={onRemove}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {pendingRules.length ? (
        <div className="mt-4">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-white/45">Pending approval</p>
          <ul className="space-y-2">
            {pendingRules.map((r) => (
              <RuleCard
                key={r.id}
                rule={r}
                busy={busy}
                variant="pending"
                onApprove={onApprove}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </div>
      ) : hasRules ? null : (
        <p className="mt-3 text-xs text-white/45">No rules yet — add a trading note above or run brain reflection.</p>
      )}
    </div>
  );
}
