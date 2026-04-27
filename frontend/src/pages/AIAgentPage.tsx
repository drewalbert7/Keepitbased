import React, { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  AgentMessage,
  AgentPlan,
  AgentOutputV1,
  AgentPreferences,
  applyAgentPlan,
  chatWithAgent
} from '../services/aiAgentService';

const seedMessages: AgentMessage[] = [
  {
    id: 'm-1',
    role: 'system',
    content: 'AI Agent ready. Ask for alert strategies, symbol monitoring rules, or risk guardrails.',
    timestamp: new Date().toISOString()
  }
];

export const AIAgentPage: React.FC = () => {
  const [messages, setMessages] = useState<AgentMessage[]>(seedMessages);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<AgentPlan | null>(null);
  const [currentOutput, setCurrentOutput] = useState<AgentOutputV1 | null>(null);
  const [currentRunMetadata, setCurrentRunMetadata] = useState<{
    runId: string;
    nodeTimings: { langgraphInvokeMs: number; totalMs: number };
    providerUsed: string;
    fallbackUsed: boolean;
  } | null>(null);
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferences>({
    topN: 3,
    confidenceFloor: 0.55,
    maxPositionSizePct: 10,
    watchlistOnly: true,
    scoringWeights: {
      momentum: 0.35,
      trend: 0.3,
      liquidity: 0.2,
      eventRiskPenalty: 0.15
    }
  });

  const latestPlan = useMemo(() => {
    return currentPlan;
  }, [currentPlan]);

  const addMessage = (role: AgentMessage['role'], content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        content,
        timestamp: new Date().toISOString()
      }
    ]);
  };

  const handleSend = async () => {
    if (!input.trim() || isBusy) return;
    const prompt = input.trim();
    setInput('');
    setIsBusy(true);
    addMessage('user', prompt);

    try {
      const mode = autoApply ? 'auto_apply_low_risk' : 'recommend_only';
      const response = await chatWithAgent(prompt, mode, agentPreferences);
      setCurrentPlan(response.plan);
      setCurrentOutput(response.output);
      setCurrentRunMetadata(response.runMetadata || null);
      setAgentPreferences(response.preferencesUsed);
      addMessage('agent', response.reply);

      if (autoApply && response.plan.proposedAlert) {
        try {
          const applied = await applyAgentPlan(response.plan);
          addMessage('system', applied.message);
          toast.success(applied.message);
        } catch (error: any) {
          const msg = error?.response?.data?.message || 'Failed to apply alert draft';
          addMessage('system', `Apply failed: ${msg}`);
          toast.error(msg);
        }
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Agent request failed';
      addMessage('system', `Agent failed: ${msg}`);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  };

  const applyLatestPlan = async () => {
    if (!latestPlan?.proposedAlert) return;
    try {
      setIsBusy(true);
      const response = await applyAgentPlan(latestPlan);
      toast.success(response.message);
      addMessage('system', response.message);
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Failed to create alert from plan';
      toast.error(msg);
      addMessage('system', `Apply failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-robinhood-gray-900">AI Agent</h1>
        <p className="text-robinhood-gray-600 mt-2">
          Build and operate your stock-alert assistant with guided planning and one-click alert execution.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-robinhood-gray-200 bg-robinhood-gray-50 flex items-center justify-between">
            <h2 className="font-semibold text-robinhood-gray-900">Agent Console</h2>
            <span className={`text-xs px-2 py-1 rounded-full ${isBusy ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
              {isBusy ? 'Processing' : 'Ready'}
            </span>
          </div>

          <div className="h-[480px] overflow-y-auto p-4 space-y-3 bg-white">
            {messages.map((message) => (
              <div key={message.id} className={`max-w-[90%] ${message.role === 'user' ? 'ml-auto' : ''}`}>
                <div
                  className={`rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : message.role === 'agent'
                        ? 'bg-robinhood-gray-100 text-robinhood-gray-900'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-robinhood-gray-200 bg-robinhood-gray-50">
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setInput('Create a stock alert strategy for AAPL with 4% and 9% dip thresholds')}
                className="text-xs px-2 py-1 rounded bg-white border border-robinhood-gray-200 hover:bg-robinhood-gray-100"
              >
                AAPL Strategy
              </button>
              <button
                onClick={() => setInput('Monitor TSLA volatility and suggest safer thresholds')}
                className="text-xs px-2 py-1 rounded bg-white border border-robinhood-gray-200 hover:bg-robinhood-gray-100"
              >
                TSLA Volatility Plan
              </button>
            </div>
            <div className="flex gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSend();
                }}
                placeholder="Tell the agent what alert strategy to build..."
                className="flex-1 input-field"
              />
              <button onClick={handleSend} disabled={isBusy || !input.trim()} className="btn-primary disabled:opacity-50">
                Send
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-robinhood-gray-900 mb-3">Agent Controls</h3>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-robinhood-gray-700">Top candidates</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={agentPreferences.topN}
                  onChange={(e) => setAgentPreferences((prev) => ({ ...prev, topN: Number(e.target.value) }))}
                  className="input-field mt-1 w-full"
                />
              </label>
              <label className="block">
                <span className="text-robinhood-gray-700">Confidence floor (0-1)</span>
                <input
                  type="number"
                  step={0.01}
                  min={0.1}
                  max={0.95}
                  value={agentPreferences.confidenceFloor}
                  onChange={(e) => setAgentPreferences((prev) => ({ ...prev, confidenceFloor: Number(e.target.value) }))}
                  className="input-field mt-1 w-full"
                />
              </label>
              <label className="block">
                <span className="text-robinhood-gray-700">Max position size %</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={agentPreferences.maxPositionSizePct}
                  onChange={(e) => setAgentPreferences((prev) => ({ ...prev, maxPositionSizePct: Number(e.target.value) }))}
                  className="input-field mt-1 w-full"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={agentPreferences.watchlistOnly}
                  onChange={(e) => setAgentPreferences((prev) => ({ ...prev, watchlistOnly: e.target.checked }))}
                />
                Watchlist only
              </label>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-robinhood-gray-900 mb-3">Execution Controls</h3>
            <label className="flex items-center gap-2 text-sm text-robinhood-gray-700 mb-4">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => setAutoApply(e.target.checked)}
              />
              Auto-apply alert drafts after agent reply
            </label>
            <button
              onClick={applyLatestPlan}
              disabled={isBusy || !latestPlan?.proposedAlert}
              className="w-full btn-secondary disabled:opacity-50"
            >
              Apply Latest Plan
            </button>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-robinhood-gray-900 mb-3">Latest Plan</h3>
            {latestPlan?.proposedAlert ? (
              <div className="text-sm text-robinhood-gray-700 space-y-2">
                <p><span className="font-medium">Symbol:</span> {latestPlan.proposedAlert.symbol}</p>
                <p><span className="font-medium">Asset:</span> {latestPlan.proposedAlert.assetType}</p>
                <p>
                  <span className="font-medium">Thresholds:</span>{' '}
                  {latestPlan.proposedAlert.smallThreshold}% / {latestPlan.proposedAlert.mediumThreshold}% / {latestPlan.proposedAlert.largeThreshold}%
                </p>
                <p className="text-robinhood-gray-600">{latestPlan.summary}</p>
                <ul className="list-disc pl-4 text-robinhood-gray-600">
                  {latestPlan.riskNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-robinhood-gray-600">No plan yet. Send a prompt to generate one.</p>
            )}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-robinhood-gray-900 mb-3">Top Opportunities (AgentOutputV1)</h3>
            {currentOutput?.topCandidates?.length ? (
              <div className="space-y-3 text-sm text-robinhood-gray-700">
                {currentOutput.topCandidates.map((candidate) => (
                  <div key={candidate.symbol} className="rounded border border-robinhood-gray-200 p-3">
                    <p><span className="font-medium">Symbol:</span> {candidate.symbol}</p>
                    <p><span className="font-medium">Score:</span> {candidate.score}</p>
                    <p><span className="font-medium">Confidence:</span> {candidate.confidence}</p>
                    <p><span className="font-medium">Why now:</span> {candidate.whyNow}</p>
                    <p><span className="font-medium">Limit band:</span> {candidate.suggestedLimitBand.min} - {candidate.suggestedLimitBand.max}</p>
                    <p><span className="font-medium">Risk flags:</span> {candidate.riskFlags.join(', ')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-robinhood-gray-600">No opportunities yet. Send a prompt to generate ranked candidates.</p>
            )}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-robinhood-gray-900 mb-3">Run Metadata</h3>
            {currentRunMetadata ? (
              <div className="text-sm text-robinhood-gray-700 space-y-1">
                <p><span className="font-medium">Run ID:</span> {currentRunMetadata.runId}</p>
                <p><span className="font-medium">Provider:</span> {currentRunMetadata.providerUsed}</p>
                <p><span className="font-medium">Fallback Used:</span> {currentRunMetadata.fallbackUsed ? 'Yes' : 'No'}</p>
                <p><span className="font-medium">LangGraph ms:</span> {currentRunMetadata.nodeTimings.langgraphInvokeMs}</p>
                <p><span className="font-medium">Total ms:</span> {currentRunMetadata.nodeTimings.totalMs}</p>
              </div>
            ) : (
              <p className="text-sm text-robinhood-gray-600">No run metadata yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIAgentPage;
