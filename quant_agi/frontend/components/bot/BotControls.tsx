import type { PaperBotAccount, PaperBotUniverseMode } from "../../lib/paperBotApi";
import { money, pnlClass } from "./format";

const UNIVERSE_OPTIONS: Array<{
  value: PaperBotUniverseMode;
  label: string;
  detail: string;
}> = [
  {
    value: "curated",
    label: "My watchlist + deploy list",
    detail: "Trade symbols you curate on the dashboard (default)."
  },
  {
    value: "deploy_list_only",
    label: "Deploy list only",
    detail: "Restrict to deploy-list symbols only."
  },
  {
    value: "quant_auto",
    label: "Quant auto-pick",
    detail:
      "Bot scans momentum, Gardner, Gardner Early, and photonics rankers — trades highest scores first (paper only)."
  },
  {
    value: "quant_auto_agent",
    label: "Quant auto-pick (multi-agent)",
    detail:
      "Same rank universe with LangGraph entry/exit strategists (Grok when configured) — policy engine still enforces caps (paper only)."
  }
];

type Props = {
  account: PaperBotAccount;
  busy: boolean;
  onUniverseModeChange: (mode: PaperBotUniverseMode) => void;
};

export function BotControls({ account, busy, onUniverseModeChange }: Props) {
  const mode = account.universeMode ?? (account.tradeDeployListOnly ? "deploy_list_only" : "curated");
  const selected = UNIVERSE_OPTIONS.find((o) => o.value === mode) ?? UNIVERSE_OPTIONS[0];

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-panelAlt/50 px-3 py-3">
      <p className="text-[10px] uppercase tracking-wide text-white/45">Trading universe</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <select
            value={mode}
            disabled={busy}
            onChange={(e) => onUniverseModeChange(e.target.value as PaperBotUniverseMode)}
            className="w-full max-w-md rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {UNIVERSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-white/50">{selected.detail}</p>
          {mode === "quant_auto" || mode === "quant_auto_agent" ? (
            <div className="mt-2 space-y-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100/90">
              <p>
                <strong className="text-amber-50">Quant execution (paper):</strong> top rank scores ·
                equity-based sizing · entries 10:00–15:30 ET · exits on rank drop / 8% stop.
                {mode === "quant_auto_agent" ? (
                  <>
                    {" "}
                    <strong className="text-amber-50">Multi-agent:</strong> LangGraph scouts regime and
                    proposes entry/exit priorities each tick (logged in lab history).
                  </>
                ) : null}
              </p>
              <p className="text-amber-100/75">
                Aggressive experiment — no guarantee of profit. Not investment advice.
              </p>
            </div>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] text-white/50 sm:pt-2">
          Cumulative P&L:{" "}
          <span className={pnlClass(account.cumPnlUsd)}>
            {account.cumPnlUsd >= 0 ? "+" : ""}
            {money(account.cumPnlUsd)}
          </span>
        </span>
      </div>
    </div>
  );
}
