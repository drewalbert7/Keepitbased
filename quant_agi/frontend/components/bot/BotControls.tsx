import { PAPER_BOT_DISARM_PHRASE } from "../../lib/paperBotApi";
import type { PaperBotAccount } from "../../lib/paperBotApi";
import { money, pnlClass } from "./format";

type Props = {
  account: PaperBotAccount;
  busy: boolean;
  disarmOpen: boolean;
  confirmPhrase: string;
  onConfirmPhraseChange: (v: string) => void;
  onToggleKillSwitch: () => void;
  onConfirmDisarm: () => void;
  onCancelDisarm: () => void;
  onToggleDeployListOnly: () => void;
};

export function BotControls({
  account,
  busy,
  disarmOpen,
  confirmPhrase,
  onConfirmPhraseChange,
  onToggleKillSwitch,
  onConfirmDisarm,
  onCancelDisarm,
  onToggleDeployListOnly
}: Props) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-panelAlt/50 px-3 py-3">
        <button
          type="button"
          disabled={busy}
          onClick={onToggleKillSwitch}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
            account.killSwitchArmed
              ? "bg-mint/20 text-mint ring-1 ring-mint/30"
              : "bg-warn/20 text-warn ring-1 ring-warn/30"
          }`}
        >
          Kill switch: {account.killSwitchArmed ? "Armed" : "Disarmed"}
        </button>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={account.tradeDeployListOnly}
            disabled={busy}
            onChange={onToggleDeployListOnly}
            className="rounded border-white/20"
          />
          Trade deploy list only
        </label>
        <span className="text-[11px] text-white/50">
          Cumulative P&L:{" "}
          <span className={pnlClass(account.cumPnlUsd)}>
            {account.cumPnlUsd >= 0 ? "+" : ""}
            {money(account.cumPnlUsd)}
          </span>
        </span>
      </div>

      {disarmOpen ? (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 p-3">
          <p className="text-sm text-warn">
            Type <strong className="font-mono">{PAPER_BOT_DISARM_PHRASE}</strong> to disarm the kill switch.
          </p>
          <input
            type="text"
            value={confirmPhrase}
            onChange={(e) => onConfirmPhraseChange(e.target.value)}
            className="mt-2 w-full max-w-md rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            placeholder={PAPER_BOT_DISARM_PHRASE}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmDisarm}
              className="rounded-lg border border-neon/40 bg-neon/15 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              Confirm disarm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancelDisarm}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
