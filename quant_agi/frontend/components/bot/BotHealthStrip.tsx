import type { PaperBotAccount } from "../../lib/paperBotApi";
import { money, pnlClass } from "./format";

export function BotHealthStrip({ account }: { account: PaperBotAccount }) {
  const cells: Array<[string, string, string]> = [
    ["Equity", money(account.equityUsd), "text-white"],
    ["Cash", money(account.cashUsd), "text-white"],
    ["Day P&L", `${account.dayPnlUsd >= 0 ? "+" : ""}${money(account.dayPnlUsd)}`, pnlClass(account.dayPnlUsd)],
    ["Open risk", `${account.openRiskPct.toFixed(1)}%`, "text-white"],
    [
      "Last trade",
      account.daysSinceLastTrade == null ? "—" : `${account.daysSinceLastTrade}d ago`,
      "text-white"
    ]
  ];

  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {cells.map(([label, value, cls]) => (
        <div key={label} className="rounded-xl border border-white/10 bg-panelAlt/70 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-white/50">{label}</p>
          <p className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}
