import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

type ExperimentRow = {
  id?: number;
  branch?: string;
  commit_sha?: string;
  improved?: boolean;
  candidate_sharpe?: number | null;
  baseline_sharpe?: number | null;
  created_at?: string | null;
};

const SIDEcar_BASE = process.env.REACT_APP_QUANT_AGI_URL?.replace(/\/$/, '') || '';

/**
 * In-app documentation tab for the Quant AGI Python sidecar (repo: `quant_agi/`).
 * The heavy compute runs outside the browser — this page is the operator guide.
 */
const QuantAgiPage: React.FC = () => {
  const [experiments, setExperiments] = useState<ExperimentRow[]>([]);
  const [diagError, setDiagError] = useState<string>('');

  useEffect(() => {
    if (!SIDEcar_BASE) {
      setDiagError('Set REACT_APP_QUANT_AGI_URL in frontend env to load recent experiments.');
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`${SIDEcar_BASE}/diag/experiments?limit=5`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        setExperiments(Array.isArray(data.experiments) ? data.experiments : []);
      } catch (e) {
        const msg =
          e instanceof Error && e.name === 'AbortError'
            ? ''
            : `${e instanceof Error ? e.message : 'Failed'} (is python main.py serve running?)`;
        if (msg) setDiagError(msg);
      }
    })();
    return () => ctrl.abort();
  }, []);

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8 sm:px-6 lg:px-8">
      <p className="font-mono text-xs uppercase tracking-wider text-kib-cyber mb-2">Research sidecar</p>
      <h1 className="text-3xl font-bold text-kib-fg tracking-tight">Quant AGI</h1>
      <p className="mt-3 text-kib-muted leading-relaxed">
        Swarm simulation plus optional autoresearch that enriches KeepItBased dip alerts with emergent
        probability-style forecasts and reflexivity tags. Runs as a separate Python process or container,
        not in this SPA bundle.
      </p>

      <div className="mt-8 rounded-xl border border-white/[0.08] bg-kib-card/80 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-kib-fg">Quick commands</h2>
        <pre className="text-xs sm:text-sm font-mono text-kib-fg/90 bg-black/40 rounded-lg p-4 overflow-x-auto whitespace-pre">{`cd quant_agi
python3.11 -m venv .venv && source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt

python main.py enhance-alerts --symbol AAPL --baseline 205
python main.py swarm-once --symbol NVDA --agents 4096
python main.py run-loop --nights 4
python main.py serve --port 8844   # POST /webhook/swarm-enhance`}
        </pre>
      </div>

      <div className="mt-8 rounded-xl border border-white/[0.08] bg-kib-card/80 p-6 space-y-3">
        <h2 className="text-lg font-semibold text-kib-fg">Webhook curl</h2>
        <p className="text-sm text-kib-muted leading-relaxed">
          With the sidecar listening on port 8844, you can mirror what the backend does (
          <code className="text-xs font-mono text-kib-fg/80">POST /webhook/swarm-enhance</code>
          ).
        </p>
        <pre className="text-xs sm:text-sm font-mono text-kib-fg/90 bg-black/40 rounded-lg p-4 overflow-x-auto whitespace-pre">{`curl -sS -X POST http://127.0.0.1:8844/webhook/swarm-enhance \\
  -H 'Content-Type: application/json' \\
  -d '{"symbol":"MSFT","baseline_price":380,"alertId":"demo"}'`}</pre>
      </div>

      <div className="mt-8 rounded-xl border border-white/[0.08] bg-kib-card/80 p-6 space-y-3">
        <h2 className="text-lg font-semibold text-kib-fg">Recent autoresearch (SQLite)</h2>
        {diagError ? (
          <p className="text-sm text-kib-muted">{diagError}</p>
        ) : experiments.length === 0 ? (
          <p className="text-sm text-kib-muted">No rows yet — run python main.py run-loop once.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm text-kib-muted border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-kib-fg/80">
                  <th className="py-2 pr-3 font-medium">created</th>
                  <th className="py-2 pr-3 font-medium">branch</th>
                  <th className="py-2 pr-3 font-medium">improved</th>
                  <th className="py-2 pr-3 font-medium">cand Sharpe</th>
                  <th className="py-2 font-mono font-medium">sha</th>
                </tr>
              </thead>
              <tbody>
                {experiments.map((r) => (
                  <tr key={r.id ?? r.commit_sha ?? String(r.created_at)} className="border-b border-white/[0.04]">
                    <td className="py-2 pr-3 whitespace-nowrap font-mono text-[11px] sm:text-xs">
                      {r.created_at?.replace('T', ' ').slice(0, 19) ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-kib-fg/90">{r.branch ?? '—'}</td>
                    <td className="py-2 pr-3">{r.improved ? 'yes' : 'no'}</td>
                    <td className="py-2 pr-3">{r.candidate_sharpe != null ? r.candidate_sharpe.toFixed(3) : '—'}</td>
                    <td className="py-2 font-mono text-[11px] sm:text-xs">{(r.commit_sha || '').slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-kib-muted">
          Backend integration: set <code className="font-mono text-kib-fg/80">QUANT_AGI_ENHANCE_URL</code> on the Node
          API so opportunity payloads include additive <code className="font-mono text-kib-fg/80">quantAgi</code> and the
          row stores <code className="font-mono text-kib-fg/80">ai_assessment.quant_agi</code>.
        </p>
      </div>

      <div className="mt-8 space-y-4 text-sm text-kib-muted leading-relaxed">
        <p>
          <strong className="text-kib-fg/90">Docs:</strong> see{' '}
          <code className="text-kib-fg/80 font-mono text-xs">quant_agi/README.md</code> for env vars, Docker, and safety
          rails.
        </p>
        <p>
          <strong className="text-kib-fg/90">Disclaimer:</strong> simulated crowds and heuristics — not investment
          advice.
        </p>
        <Link to="/dashboard" className="inline-flex text-kib-cyber hover:underline text-sm font-medium">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
};

export default QuantAgiPage;
