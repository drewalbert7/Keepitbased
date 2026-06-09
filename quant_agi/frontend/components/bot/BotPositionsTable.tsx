import type { PaperBotPosition } from "../../lib/paperBotApi";
import { moneyPrecise, pnlClass } from "./format";

export function BotPositionsTable({ positions }: { positions: PaperBotPosition[] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-panelAlt/60 p-3">
      <h3 className="text-sm font-semibold text-white/80">Open positions</h3>
      {positions.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-white/50">
              <tr>
                <th className="pb-1 pr-2">Symbol</th>
                <th className="pb-1 pr-2">Qty</th>
                <th className="pb-1 pr-2">Mkt val</th>
                <th className="pb-1">Unreal P&L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.symbol} className="border-t border-white/10 text-white/85">
                  <td className="py-1.5 pr-2 font-medium">{p.symbol}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{p.quantity.toFixed(4)}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{moneyPrecise(p.marketValueUsd)}</td>
                  <td className={`py-1.5 tabular-nums ${pnlClass(p.unrealizedPnlUsd)}`}>
                    {p.unrealizedPnlUsd >= 0 ? "+" : ""}
                    {moneyPrecise(p.unrealizedPnlUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-xs text-white/50">
          No open positions — disarm kill switch, add deploy-list symbols on dashboard, then Simulate day.
        </p>
      )}
    </div>
  );
}
