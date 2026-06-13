const axios = require('axios');
const db = require('../models/database');
const config = require('../config');
const logger = require('../utils/logger');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');
const deployListService = require('./deployListService');
const { stampPaperBotFillReason, stampShadowOrderPayload } = require('../utils/paperBotNamespace');
const { emitPaperBotUpdate } = require('./paperBotSocket');
const xInvestorFeedService = require('./xInvestorFeedService');
const trustedXTradersService = require('./trustedXTradersService');
const { isUsStockRegularTradingHours } = require('../utils/researchAlertGates');

function notifyPaperBotClients(userId, eventType, hint) {
  try {
    emitPaperBotUpdate(userId, {
      eventType: String(eventType || 'update'),
      hint: hint || null
    });
  } catch (err) {
    logger.warn(`paperBot socket notify failed: ${err.message}`);
  }
}

const DEFAULT_STARTING_CASH = 10000;
const DISARM_CONFIRM_PHRASE = 'ENABLE PAPER TRADES';
const DEFAULT_POLICY = {
  max_position_pct: 10,
  max_notional_per_trade: 750,
  min_cash_reserve: 500,
  max_open_positions: 5
};
const POLICY_PRECEDENCE =
  'kill_switch > user caps > active approved rules > engine defaults';
const RANK_STRATEGIES_FOR_BRAIN = ['momentum_liquidity', 'rule_breaker_gardner'];
const QUANT_AUTO_STRATEGIES = [
  'momentum_liquidity',
  'rule_breaker_gardner',
  'rule_breaker_gardner_early',
  'photonics_chokepoint'
];
const QUANT_AUTO_TOP_PER_STRATEGY = 8;
const QUANT_AUTO_MAX_SYMBOLS = 20;
const X_TRUSTED_UNIVERSE_MAX = (() => {
  const n = parseInt(process.env.PAPER_BOT_X_TRUSTED_UNIVERSE_MAX, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 10;
})();
const X_TRUSTED_SCORE_BASE = 68;
const VALID_UNIVERSE_MODES = new Set(['curated', 'deploy_list_only', 'quant_auto', 'quant_auto_agent']);

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function mapPosition(row, priceMap) {
  const qty = Number(row.quantity);
  const avgCost = Number(row.avg_cost_usd);
  const lastPrice = priceMap[row.symbol.toUpperCase()] ?? null;
  const marketValue = lastPrice != null ? qty * lastPrice : qty * avgCost;
  const costBasis = qty * avgCost;
  return {
    symbol: row.symbol,
    assetType: row.asset_type,
    quantity: qty,
    avgCostUsd: avgCost,
    lastPriceUsd: lastPrice,
    marketValueUsd: round2(marketValue),
    unrealizedPnlUsd: round2(marketValue - costBasis)
  };
}

function mapTrade(row) {
  const reasonJson =
    row.reason_json && typeof row.reason_json === 'object' && !Array.isArray(row.reason_json)
      ? row.reason_json
      : {};
  return {
    id: row.id,
    symbol: row.symbol,
    assetType: row.asset_type,
    side: row.side,
    quantity: Number(row.quantity),
    priceUsd: Number(row.price_usd),
    notionalUsd: Number(row.notional_usd),
    reasonTags: Array.isArray(row.reason_tags) ? row.reason_tags : [],
    reasonJson,
    policyVersion: row.policy_version,
    createdAt: row.created_at
  };
}

function coercePolicyValue(key, value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (key === 'max_open_positions') return Math.max(1, Math.min(20, Math.round(n)));
  return Math.round(n * 100) / 100;
}

function mergeActiveRulesFromRows(ruleRows) {
  const policy = { ...DEFAULT_POLICY };
  for (const row of ruleRows || []) {
    const payload = row.rule_json && typeof row.rule_json === 'object' ? row.rule_json : {};
    const ruleType = String(payload.rule_type || row.rule_type || '').trim();
    if (ruleType && Object.prototype.hasOwnProperty.call(DEFAULT_POLICY, ruleType)) {
      const val = coercePolicyValue(ruleType, payload.value ?? payload[ruleType]);
      if (val != null) policy[ruleType] = val;
    }
    for (const key of Object.keys(DEFAULT_POLICY)) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        const val = coercePolicyValue(key, payload[key]);
        if (val != null) policy[key] = val;
      }
    }
  }
  return policy;
}

function mapSnapshot(row) {
  return {
    snapshotDate: row.snapshot_date,
    equityUsd: Number(row.equity_usd),
    cashUsd: Number(row.cash_usd),
    dayPnlUsd: Number(row.day_pnl_usd),
    cumPnlUsd: Number(row.cum_pnl_usd)
  };
}

function mapAccount(row, metrics) {
  const starting = Number(row.starting_cash_usd);
  const cash = Number(row.cash_usd);
  const equity = metrics?.equityUsd ?? cash;
  const dayPnl = metrics?.dayPnlUsd ?? 0;
  return {
    userId: row.user_id,
    startingCashUsd: starting,
    cashUsd: cash,
    equityUsd: round2(equity),
    dayPnlUsd: round2(dayPnl),
    cumPnlUsd: round2(equity - starting),
    openRiskPct: metrics?.openRiskPct ?? 0,
    mode: row.mode,
    killSwitchArmed: row.kill_switch_armed,
    autoRunEnabled: Boolean(row.auto_run_enabled),
    lastAutoRunAt: row.last_auto_run_at || null,
    tradeDeployListOnly: normalizeUniverseMode(row) === 'deploy_list_only',
    universeMode: normalizeUniverseMode(row),
    policyVersion: row.policy_version,
    lastTradeAt: row.last_trade_at,
    daysSinceLastTrade: row.last_trade_at
      ? Math.floor((Date.now() - new Date(row.last_trade_at).getTime()) / (24 * 60 * 60 * 1000))
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function computeBotRuntime(row) {
  const autoRun = Boolean(row.auto_run_enabled);
  const killArmed = Boolean(row.kill_switch_armed);
  const marketOpen = isUsStockRegularTradingHours();
  const botOn = autoRun && !killArmed;
  const intervalMin = Math.round((config.PAPER_BOT_AUTO_RUN_INTERVAL_MS || 900000) / 60000);

  let status = 'off';
  let label = 'Bot OFF';
  let detail = 'Turn the bot on to run policy automatically during US market hours.';

  if (botOn && marketOpen) {
    status = 'running';
    label = 'Bot ON';
    detail = `Trading during market hours — policy check about every ${intervalMin} min.`;
  } else if (botOn && !marketOpen) {
    status = 'waiting';
    label = 'Bot ON';
    detail = 'Market closed — resumes Mon–Fri 9:30 AM–4:00 PM ET.';
  } else if (autoRun && killArmed) {
    status = 'paused';
    label = 'Bot PAUSED';
    detail = 'Kill switch armed — turn the bot on again to resume.';
  }

  return {
    status,
    label,
    detail,
    botOn,
    autoRunEnabled: autoRun,
    marketOpen,
    lastAutoRunAt: row.last_auto_run_at || null,
    autoRunIntervalMinutes: intervalMin,
    schedulerEnabled: Boolean(config.ENABLE_PAPER_BOT_AUTO_RUN)
  };
}

function mapRule(row) {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    ruleText: row.rule_text,
    ruleJson: row.rule_json || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadRulesByStatus(userId, status) {
  const { rows } = await db.query(
    `SELECT * FROM paper_bot_rules
     WHERE user_id = $1 AND status = $2
     ORDER BY created_at DESC`,
    [userId, status]
  );
  return rows;
}

async function loadActiveRulesPayload(userId) {
  const rows = await loadRulesByStatus(userId, 'active');
  return rows.map((r) => ({
    rule_type: r.rule_json?.rule_type,
    rule_json: r.rule_json,
    rule_text: r.rule_text
  }));
}

async function loadPositions(userId) {
  const { rows } = await db.query(
    `SELECT * FROM paper_bot_positions WHERE user_id = $1 ORDER BY symbol ASC`,
    [userId]
  );
  return rows;
}

async function loadRecentTrades(userId, limit = 20) {
  const { rows } = await db.query(
    `SELECT * FROM paper_bot_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

const IMPROVEMENT_EVENT_EXCLUDE = ['dry_run', 'shadow_order'];

async function loadRecentEvents(userId, limit = 20, { scope } = {}) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  const params = [userId];
  let sql = `SELECT id, event_type, payload, created_at
     FROM paper_bot_events
     WHERE user_id = $1`;
  if (scope === 'improvement') {
    params.push(IMPROVEMENT_EVENT_EXCLUDE);
    sql += ` AND event_type <> ALL($${params.length}::text[])`;
  }
  params.push(lim);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await db.query(sql, params);
  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    payload: r.payload || {},
    createdAt: r.created_at
  }));
}

async function fetchRankLeadersForBrain() {
  const base = resolveQuantAgiBaseUrl();
  const timeout = config.QUANT_AGI_RANK_TIMEOUT_MS || 45000;
  const out = [];
  for (const strategy of RANK_STRATEGIES_FOR_BRAIN) {
    try {
      const { data } = await axios.get(`${base}/diag/market-universe-rank`, {
        params: { strategy, top_n: 5 },
        timeout
      });
      const rows = Array.isArray(data?.positions)
        ? data.positions
        : Array.isArray(data?.rows)
          ? data.rows
          : [];
      out.push({
        strategy,
        leaders: rows.slice(0, 5).map((row) => ({
          symbol: String(row.symbol || '').toUpperCase(),
          score: typeof row.score === 'number' ? row.score : Number(row.tape_score_raw ?? row.score ?? 0)
        }))
      });
    } catch (err) {
      logger.warn(`Brain rank fetch failed (${strategy}): ${err.message}`);
      out.push({ strategy, leaders: [], error: err.message });
    }
  }
  return out;
}

function buildBotRunDayBody(ctx, accountRow, { killSwitchArmed } = {}) {
  const mode = normalizeUniverseMode(accountRow);
  const quantMode =
    mode === 'quant_auto' || mode === 'quant_auto_agent' || mode === 'quant_auto_fallback';
  const agentMode = mode === 'quant_auto_agent';
  return {
    cash_usd: Number(accountRow.cash_usd),
    kill_switch_armed:
      killSwitchArmed !== undefined ? Boolean(killSwitchArmed) : Boolean(accountRow.kill_switch_armed),
    policy_version: accountRow.policy_version,
    universe_symbols: ctx.universe,
    prices: ctx.priceMap,
    positions: ctx.positionsPayload,
    active_rules: ctx.activeRulesPayload,
    active_policy: ctx.mergedPolicy,
    universe_source: ctx.universeSource,
    quant_rank_by_symbol: ctx.quantRankBySymbol || {},
    quant_mode: quantMode,
    agent_mode: agentMode,
    run_at_iso: new Date().toISOString(),
    learning_memory: accountRow.learning_memory || null
  };
}

async function buildRunContext(userId) {
  const accountRow = await ensureAccount(userId);
  const positionsRaw = await loadPositions(userId);
  const universeResolved = await resolveUniverse(userId, accountRow);
  const universe = universeResolved.symbols;
  const priceSymbols = [...new Set([...universe, ...positionsRaw.map((p) => p.symbol)])];
  const priceMap = await fetchSymbolPrices(priceSymbols);
  const activeRuleRows = await loadRulesByStatus(userId, 'active');
  const activeRules = activeRuleRows.map(mapRule);
  const activeRulesPayload = await loadActiveRulesPayload(userId);
  const mergedPolicy = mergeActiveRulesFromRows(activeRuleRows);
  const positionsPayload = positionsRaw.map((p) => ({
    symbol: p.symbol,
    quantity: Number(p.quantity),
    avg_cost_usd: Number(p.avg_cost_usd)
  }));

  return {
    accountRow,
    positionsRaw,
    universe,
    priceMap,
    activeRules,
    activeRulesPayload,
    mergedPolicy,
    positionsPayload,
    universeSource: universeSourceLabel(universeResolved.mode),
    quantRankBySymbol: universeResolved.quantRankBySymbol
  };
}

async function loadSnapshots(userId, limit = 90) {
  const { rows } = await db.query(
    `SELECT * FROM paper_bot_daily_snapshots
     WHERE user_id = $1
     ORDER BY snapshot_date DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows.reverse();
}

async function fetchSymbolPrices(symbols) {
  const uniq = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  if (!uniq.length) return {};

  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/diag/market-snapshot`, {
      params: { symbols: uniq.join(',') },
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
    });
    const out = {};
    for (const row of data?.symbols || []) {
      const sym = String(row.symbol || '').toUpperCase();
      const px = Number(row.last_close);
      if (sym && Number.isFinite(px) && px > 0) out[sym] = px;
    }
    return out;
  } catch (err) {
    logger.warn(`Paper bot price fetch failed: ${err.message}`);
    return {};
  }
}

async function computeMetrics(accountRow, positions, priceMap) {
  const cash = Number(accountRow.cash_usd);
  let invested = 0;
  for (const p of positions) {
    const px = priceMap[p.symbol.toUpperCase()] ?? Number(p.avg_cost_usd);
    invested += Number(p.quantity) * px;
  }
  const equity = cash + invested;
  const starting = Number(accountRow.starting_cash_usd);
  const openRiskPct = equity > 0 ? (invested / equity) * 100 : 0;

  const today = new Date().toISOString().slice(0, 10);
  const snapRes = await db.query(
    `SELECT equity_usd FROM paper_bot_daily_snapshots
     WHERE user_id = $1 AND snapshot_date < $2::date
     ORDER BY snapshot_date DESC LIMIT 1`,
    [accountRow.user_id, today]
  );
  const prevEquity = snapRes.rows.length ? Number(snapRes.rows[0].equity_usd) : starting;
  const dayPnlUsd = equity - prevEquity;

  return { equityUsd: equity, dayPnlUsd, openRiskPct: round2(openRiskPct) };
}

async function upsertDailySnapshot(userId, accountRow, metrics) {
  const today = new Date().toISOString().slice(0, 10);
  const starting = Number(accountRow.starting_cash_usd);
  await db.query(
    `INSERT INTO paper_bot_daily_snapshots
       (user_id, snapshot_date, equity_usd, cash_usd, day_pnl_usd, cum_pnl_usd)
     VALUES ($1, $2::date, $3, $4, $5, $6)
     ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
       equity_usd = EXCLUDED.equity_usd,
       cash_usd = EXCLUDED.cash_usd,
       day_pnl_usd = EXCLUDED.day_pnl_usd,
       cum_pnl_usd = EXCLUDED.cum_pnl_usd`,
    [
      userId,
      today,
      round2(metrics.equityUsd),
      round2(Number(accountRow.cash_usd)),
      round2(metrics.dayPnlUsd),
      round2(metrics.equityUsd - starting)
    ]
  );
}

async function loadDeployListSymbols(userId) {
  const rows = await deployListService.listDeployList(userId);
  return rows
    .filter((r) => r.alert_active !== false)
    .map((r) => String(r.symbol || '').toUpperCase())
    .filter(Boolean);
}

async function loadWatchlistSymbols(userId, limit = 25) {
  const { rows } = await db.query(
    `SELECT symbol FROM user_alerts
     WHERE user_id = $1 AND active = true AND asset_type = 'stock'
     ORDER BY updated_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => String(r.symbol).toUpperCase()).filter(Boolean);
}

function mergeUniverseSymbols(deploySymbols, watchSymbols, maxSymbols = 30) {
  const seen = new Set();
  const out = [];
  for (const sym of [...deploySymbols, ...watchSymbols]) {
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= maxSymbols) break;
  }
  return out;
}

function normalizeUniverseMode(row) {
  const raw = String(row?.universe_mode || '').trim();
  if (VALID_UNIVERSE_MODES.has(raw)) return raw;
  return row?.trade_deploy_list_only ? 'deploy_list_only' : 'curated';
}

function universeSourceLabel(mode) {
  if (mode === 'deploy_list_only') return 'deploy_list_only';
  if (mode === 'quant_auto' || mode === 'quant_auto_agent' || mode === 'quant_auto_fallback') {
    return mode === 'quant_auto_agent' ? 'quant_auto_agent' : 'quant_auto';
  }
  return 'watchlist_and_deploy_list';
}

function universeModeHint(mode) {
  if (mode === 'deploy_list_only') return 'Universe: deploy list only';
  if (mode === 'quant_auto_agent') return 'Universe: quant auto-pick (multi-agent LangGraph)';
  if (mode === 'quant_auto') return 'Universe: quant auto-pick (best rank scores)';
  return 'Universe: watchlist + deploy list';
}

async function fetchQuantAutoUniverse() {
  const base = resolveQuantAgiBaseUrl();
  const timeout = config.QUANT_AGI_RANK_TIMEOUT_MS || 45000;
  const bySymbol = new Map();

  for (const strategy of QUANT_AUTO_STRATEGIES) {
    try {
      const { data } = await axios.get(`${base}/diag/market-universe-rank`, {
        params: { strategy, top_n: QUANT_AUTO_TOP_PER_STRATEGY },
        timeout
      });
      const rows = Array.isArray(data?.positions)
        ? data.positions
        : Array.isArray(data?.rows)
          ? data.rows
          : [];
      for (const row of rows) {
        const symbol = String(row.symbol || '')
          .toUpperCase()
          .trim();
        if (!symbol) continue;
        const score =
          typeof row.score === 'number' ? row.score : Number(row.tape_score_raw ?? row.score ?? 0);
        const prev = bySymbol.get(symbol);
        if (!prev || score > prev.score) {
          bySymbol.set(symbol, { score, strategy });
        }
      }
    } catch (err) {
      logger.warn(`Quant auto universe rank failed (${strategy}): ${err.message}`);
    }
  }

  const ranked = [...bySymbol.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, QUANT_AUTO_MAX_SYMBOLS);

  return {
    symbols: ranked.map(([symbol]) => symbol),
    rankBySymbol: Object.fromEntries(
      ranked.map(([symbol, meta]) => [symbol, { score: meta.score, strategy: meta.strategy }])
    )
  };
}

function trustedSymbolsFromLearningMemory(learningMemory) {
  const raw = learningMemory?.coaching_directives?.trusted_symbols;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => String(s || '').toUpperCase().trim())
    .filter((s) => /^[A-Z]{1,5}$/.test(s))
    .slice(0, X_TRUSTED_UNIVERSE_MAX);
}

async function fetchTrustedPostsViaXSearch(handles) {
  const uniq = [...new Set(handles.map((h) => String(h || '').replace(/^@/, '').toLowerCase()).filter(Boolean))];
  if (!uniq.length) return [];

  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.post(
      `${base}/bot/x-trusted-posts`,
      { handles: uniq },
      { timeout: Math.max(config.QUANT_AGI_RANK_TIMEOUT_MS || 45000, 90000) }
    );
    return Array.isArray(data?.posts) ? data.posts : [];
  } catch (err) {
    logger.warn(`x_search trusted posts failed: ${err.message}`);
    return [];
  }
}

function postsToTweetShape(posts, accounts) {
  const byUser = new Map(accounts.map((a) => [String(a.username).toLowerCase(), a]));
  return posts.map((p, idx) => {
    const handle =
      String(p.monitor_username || p.author || '')
        .replace(/^@/, '')
        .toLowerCase() || 'unknown';
    const acc = byUser.get(handle);
    const text = String(p.snippet || p.title || '').trim();
    return {
      id: String(idx),
      text,
      authorUsername: handle,
      createdAt: new Date().toISOString(),
      cashtags: xInvestorFeedService.extractCashtags(text),
      monitorLabel: acc?.label || handle,
      monitorUsername: handle,
      monitorSource: 'x_search',
      sourceUrl: p.url || null
    };
  });
}

function aggregateTickerBuzz(tweets) {
  const counts = new Map();
  for (const tw of tweets) {
    for (const t of tw.cashtags || []) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([symbol, mentions]) => ({ symbol, mentions }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 12);
}

function mergeTrustedAccounts(userAccounts, envAccounts) {
  const seen = new Set();
  const out = [];
  for (const acc of [...userAccounts, ...envAccounts]) {
    const u = String(acc.username || '').toLowerCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(acc);
  }
  return out;
}

async function loadXTrustedPulse(userId) {
  try {
    const userAccounts = userId ? await trustedXTradersService.accountsForPulse(userId) : [];
    const envAccounts = xInvestorFeedService.parseMonitoredAccounts().map((a) => ({
      id: a.username,
      username: a.username,
      label: a.label,
      source: 'env'
    }));
    const accounts = mergeTrustedAccounts(userAccounts, envAccounts);

    if (!accounts.length) {
      return {
        configured: false,
        xSearchOnly: true,
        warning: 'Add trusted @handles below — posts are fetched via Grok x_search (no X API).',
        accounts: [],
        tickerBuzz: [],
        tweets: []
      };
    }

    const posts = await fetchTrustedPostsViaXSearch(accounts.map((a) => a.username));
    const tweets = postsToTweetShape(posts, accounts);
    const tickerBuzz = aggregateTickerBuzz(tweets);

    return {
      configured: true,
      xSearchOnly: true,
      warning: tweets.length
        ? null
        : 'No posts returned — ensure XAI_API_KEY or GROK_API_KEY is set for x_search.',
      accounts,
      tickerBuzz,
      tweets
    };
  } catch (err) {
    logger.warn(`X trusted pulse failed: ${err.message}`);
    return {
      configured: false,
      xSearchOnly: true,
      warning: err.message,
      accounts: [],
      tickerBuzz: [],
      tweets: []
    };
  }
}

function mergeXTrustedUniverse(base, { tickerBuzz, learningMemory } = {}) {
  const symbols = [...(base.symbols || [])];
  const rankBySymbol = { ...(base.rankBySymbol || {}) };
  const seen = new Set(symbols);
  let added = 0;

  const rows = [];
  for (const row of tickerBuzz || []) {
    const sym = String(row?.symbol || '').toUpperCase().trim();
    if (!sym) continue;
    rows.push({ sym, mentions: Number(row.mentions) || 1, source: 'x_live' });
  }
  for (const sym of trustedSymbolsFromLearningMemory(learningMemory)) {
    rows.push({ sym, mentions: 2, source: 'x_learning' });
  }

  for (const row of rows) {
    const { sym, mentions, source } = row;
    if (seen.has(sym)) {
      const prev = rankBySymbol[sym] || { score: 0, strategy: 'curated' };
      rankBySymbol[sym] = {
        ...prev,
        x_trusted: true,
        x_mentions: Math.max(Number(prev.x_mentions) || 0, mentions),
        x_source: prev.x_source || source
      };
      continue;
    }
    if (added >= X_TRUSTED_UNIVERSE_MAX) continue;
    symbols.push(sym);
    seen.add(sym);
    rankBySymbol[sym] = {
      score: X_TRUSTED_SCORE_BASE + Math.min(12, mentions * 3),
      strategy: 'x_trusted',
      x_trusted: true,
      x_mentions: mentions,
      x_source: source
    };
    added += 1;
  }

  return { symbols, rankBySymbol, xTrustedAdded: added };
}

function wrapUniverseResolved(base, xPulse, learningMemory) {
  const merged = mergeXTrustedUniverse(
    { symbols: base.symbols, rankBySymbol: base.quantRankBySymbol || {} },
    { tickerBuzz: xPulse?.tickerBuzz, learningMemory }
  );
  return {
    symbols: merged.symbols,
    mode: base.mode,
    quantRankBySymbol: Object.keys(merged.rankBySymbol).length ? merged.rankBySymbol : base.quantRankBySymbol,
    xTrustedMeta: {
      configured: Boolean(xPulse?.configured),
      accounts: xPulse?.accounts || [],
      tickerBuzz: xPulse?.tickerBuzz || [],
      symbolsAdded: merged.xTrustedAdded || 0,
      warning: xPulse?.warning || null
    }
  };
}

async function resolveCuratedUniverse(userId, deployListOnly) {
  const deploySymbols = await loadDeployListSymbols(userId);
  if (deployListOnly) {
    if (deploySymbols.length) return deploySymbols;
    return loadWatchlistSymbols(userId);
  }
  const watchSymbols = await loadWatchlistSymbols(userId);
  return mergeUniverseSymbols(deploySymbols, watchSymbols);
}

async function resolveUniverse(userId, accountRow) {
  const mode = normalizeUniverseMode(accountRow);
  const xPulse = await loadXTrustedPulse(userId);
  const learningMemory = accountRow?.learning_memory || null;

  if (mode === 'quant_auto' || mode === 'quant_auto_agent') {
    const quant = await fetchQuantAutoUniverse();
    if (quant.symbols.length) {
      return wrapUniverseResolved(
        { symbols: quant.symbols, mode, quantRankBySymbol: quant.rankBySymbol },
        xPulse,
        learningMemory
      );
    }
    logger.warn('Quant auto universe empty — falling back to curated watchlist + deploy list');
    return wrapUniverseResolved(
      {
        symbols: await resolveCuratedUniverse(userId, false),
        mode: 'quant_auto_fallback',
        quantRankBySymbol: null
      },
      xPulse,
      learningMemory
    );
  }
  if (mode === 'deploy_list_only') {
    return wrapUniverseResolved(
      {
        symbols: await resolveCuratedUniverse(userId, true),
        mode,
        quantRankBySymbol: null
      },
      xPulse,
      learningMemory
    );
  }
  return wrapUniverseResolved(
    {
      symbols: await resolveCuratedUniverse(userId, false),
      mode: 'curated',
      quantRankBySymbol: null
    },
    xPulse,
    learningMemory
  );
}

async function ensureAccount(userId) {
  const existing = await db.query(`SELECT * FROM paper_bot_accounts WHERE user_id = $1`, [userId]);
  if (existing.rows.length) {
    return existing.rows[0];
  }
  const inserted = await db.query(
    `INSERT INTO paper_bot_accounts
       (user_id, starting_cash_usd, cash_usd, kill_switch_armed, trade_deploy_list_only, universe_mode)
     VALUES ($1, $2, $2, true, false, 'quant_auto')
     RETURNING *`,
    [userId, DEFAULT_STARTING_CASH]
  );
  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'account_created', $2)`,
    [userId, JSON.stringify({ startingCashUsd: DEFAULT_STARTING_CASH })]
  );
  logger.info(`Paper bot account created for user ${userId}`);
  return inserted.rows[0];
}

async function applyFill(userId, accountRow, fill) {
  const symbol = String(fill.symbol).toUpperCase();
  const side = fill.side === 'sell' ? 'sell' : 'buy';
  const qty = Number(fill.quantity);
  const price = Number(fill.price_usd);
  const notional = round2(Number(fill.notional_usd ?? qty * price));
  const reasonTags = JSON.stringify(Array.isArray(fill.reason_tags) ? fill.reason_tags : ['manual']);
  const reasonJson = JSON.stringify(stampPaperBotFillReason(fill.reason_json));

  if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
    const err = new Error('Invalid fill');
    err.statusCode = 400;
    throw err;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const acctRes = await client.query(`SELECT * FROM paper_bot_accounts WHERE user_id = $1 FOR UPDATE`, [
      userId
    ]);
    const acct = acctRes.rows[0];
    let cash = Number(acct.cash_usd);

    if (side === 'buy') {
      if (cash + 0.01 < notional) {
        const err = new Error('Insufficient cash for buy');
        err.statusCode = 400;
        throw err;
      }
      cash = round2(cash - notional);
      const posRes = await client.query(
        `SELECT * FROM paper_bot_positions WHERE user_id = $1 AND symbol = $2`,
        [userId, symbol]
      );
      if (posRes.rows.length) {
        const prev = posRes.rows[0];
        const prevQty = Number(prev.quantity);
        const newQty = prevQty + qty;
        const newAvg = (prevQty * Number(prev.avg_cost_usd) + notional) / newQty;
        await client.query(
          `UPDATE paper_bot_positions
           SET quantity = $3, avg_cost_usd = $4, updated_at = NOW()
           WHERE user_id = $1 AND symbol = $2`,
          [userId, symbol, newQty, round2(newAvg)]
        );
      } else {
        await client.query(
          `INSERT INTO paper_bot_positions (user_id, symbol, asset_type, quantity, avg_cost_usd)
           VALUES ($1, $2, 'stock', $3, $4)`,
          [userId, symbol, qty, price]
        );
      }
    } else {
      const posRes = await client.query(
        `SELECT * FROM paper_bot_positions WHERE user_id = $1 AND symbol = $2 FOR UPDATE`,
        [userId, symbol]
      );
      if (!posRes.rows.length) {
        const err = new Error('No position to sell');
        err.statusCode = 400;
        throw err;
      }
      const prevQty = Number(posRes.rows[0].quantity);
      if (prevQty + 1e-9 < qty) {
        const err = new Error('Sell quantity exceeds position');
        err.statusCode = 400;
        throw err;
      }
      cash = round2(cash + notional);
      const remaining = round2(prevQty - qty);
      if (remaining <= 1e-9) {
        await client.query(`DELETE FROM paper_bot_positions WHERE user_id = $1 AND symbol = $2`, [
          userId,
          symbol
        ]);
      } else {
        await client.query(
          `UPDATE paper_bot_positions SET quantity = $3, updated_at = NOW() WHERE user_id = $1 AND symbol = $2`,
          [userId, symbol, remaining]
        );
      }
    }

    await client.query(
      `UPDATE paper_bot_accounts SET cash_usd = $2, last_trade_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId, cash]
    );

    await client.query(
      `INSERT INTO paper_bot_trades
         (user_id, symbol, asset_type, side, quantity, price_usd, notional_usd, reason_tags, reason_json, policy_version)
       VALUES ($1, $2, 'stock', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [userId, symbol, side, qty, price, notional, reasonTags, reasonJson, accountRow.policy_version]
    );

    await client.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'fill', $2)`,
      [
        userId,
        JSON.stringify({ symbol, side, quantity: qty, priceUsd: price, notionalUsd: notional })
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getState(userId) {
  const row = await ensureAccount(userId);
  const positionsRaw = await loadPositions(userId);
  const tradesRaw = await loadRecentTrades(userId);

  const symbols = positionsRaw.map((p) => p.symbol);
  const priceMap = await fetchSymbolPrices(symbols);
  const metrics = await computeMetrics(row, positionsRaw, priceMap);
  await upsertDailySnapshot(userId, row, metrics);

  const snapshotsRaw = await loadSnapshots(userId);
  const account = mapAccount(row, metrics);
  const positions = positionsRaw.map((p) => mapPosition(p, priceMap));
  const recentTrades = tradesRaw.map(mapTrade);
  const snapshots = snapshotsRaw.map(mapSnapshot);

  const botRuntime = computeBotRuntime(row);

  let whyNoTradesToday = null;
  if (!botRuntime.botOn) {
    whyNoTradesToday = 'Bot is off — turn it on to trade automatically during market hours.';
  } else if (!botRuntime.marketOpen) {
    whyNoTradesToday = 'Bot is on but the market is closed — no fills until the next session.';
  } else if (
    (account.universeMode === 'quant_auto' || account.universeMode === 'quant_auto_agent') &&
    !recentTrades.length
  ) {
    whyNoTradesToday =
      account.universeMode === 'quant_auto_agent'
        ? 'Bot is on in quant multi-agent mode — LangGraph is planning entries/exits from rank strategies.'
        : 'Bot is on in quant auto-pick mode — scanning rank strategies for the best candidate.';
  } else if (!recentTrades.length) {
    whyNoTradesToday = 'Bot is on — waiting for policy to find a fill in your universe.';
  } else if (account.daysSinceLastTrade != null && account.daysSinceLastTrade > 0) {
    whyNoTradesToday = `Last fill was ${account.daysSinceLastTrade} day(s) ago. Bot keeps checking while the market is open.`;
  }

  const pendingRules = (await loadRulesByStatus(userId, 'pending')).map(mapRule);
  const activeRules = (await loadRulesByStatus(userId, 'active')).map(mapRule);

  return {
    account,
    positions,
    recentTrades,
    pendingRules,
    activeRules,
    snapshots,
    whyNoTradesToday,
    autoresearch: null,
    disclaimer:
      'Educational paper simulation only — not investment advice. No brokerage orders are placed.',
    phase: '5c-brain-monitor',
    botRuntime
  };
}

async function setKillSwitch(userId, { armed, confirmPhrase }) {
  if (armed === false) {
    if (String(confirmPhrase || '').trim() !== DISARM_CONFIRM_PHRASE) {
      const err = new Error(`Type ${DISARM_CONFIRM_PHRASE} to disarm the kill switch`);
      err.statusCode = 400;
      err.code = 'CONFIRM_PHRASE_REQUIRED';
      throw err;
    }
  }
  await ensureAccount(userId);
  const armedVal = Boolean(armed);
  const { rows } = await db.query(
    `UPDATE paper_bot_accounts
     SET kill_switch_armed = $2,
         auto_run_enabled = CASE WHEN $2 THEN false ELSE auto_run_enabled END,
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId, armedVal]
  );
  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'kill_switch', $2)`,
    [userId, JSON.stringify({ armed: Boolean(armed) })]
  );
  notifyPaperBotClients(
    userId,
    'kill_switch',
    armedVal ? 'Bot paused — kill switch armed' : 'Kill switch disarmed'
  );
  return mapAccount(rows[0], null);
}

async function setBotRun(userId, { on, confirmPhrase }) {
  await ensureAccount(userId);
  if (on) {
    if (String(confirmPhrase || '').trim() !== DISARM_CONFIRM_PHRASE) {
      const err = new Error(`Type ${DISARM_CONFIRM_PHRASE} to turn the bot on`);
      err.statusCode = 400;
      err.code = 'CONFIRM_PHRASE_REQUIRED';
      throw err;
    }
    const { rows } = await db.query(
      `UPDATE paper_bot_accounts
       SET auto_run_enabled = true, kill_switch_armed = false, updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId]
    );
    await db.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'bot_started', $2)`,
      [userId, JSON.stringify({ marketOpen: isUsStockRegularTradingHours() })]
    );
    notifyPaperBotClients(userId, 'bot_started', 'Bot ON — auto-trading during market hours');
    return { account: mapAccount(rows[0], null), botRuntime: computeBotRuntime(rows[0]) };
  }

  const { rows } = await db.query(
    `UPDATE paper_bot_accounts
     SET auto_run_enabled = false, kill_switch_armed = true, updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId]
  );
  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload) VALUES ($1, 'bot_stopped', $2)`,
    [userId, JSON.stringify({})]
  );
  notifyPaperBotClients(userId, 'bot_stopped', 'Bot OFF — auto-trading stopped');
  return { account: mapAccount(rows[0], null), botRuntime: computeBotRuntime(rows[0]) };
}

async function setPaperBotSettings(userId, { universeMode, tradeDeployListOnly }) {
  await ensureAccount(userId);
  let mode = universeMode;
  if (!mode && typeof tradeDeployListOnly === 'boolean') {
    mode = tradeDeployListOnly ? 'deploy_list_only' : 'curated';
  }
  if (!VALID_UNIVERSE_MODES.has(mode)) {
    const err = new Error('Invalid universe mode');
    err.statusCode = 400;
    throw err;
  }
  const deployOnly = mode === 'deploy_list_only';
  const { rows } = await db.query(
    `UPDATE paper_bot_accounts
     SET universe_mode = $2,
         trade_deploy_list_only = $3,
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId, mode, deployOnly]
  );
  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'settings_updated', $2)`,
    [userId, JSON.stringify({ universeMode: mode, tradeDeployListOnly: deployOnly })]
  );
  notifyPaperBotClients(userId, 'settings_updated', universeModeHint(mode));
  return mapAccount(rows[0], null);
}

async function setTradeDeployListOnly(userId, enabled) {
  return setPaperBotSettings(userId, {
    universeMode: enabled ? 'deploy_list_only' : 'curated'
  });
}

async function simulateDay(userId, { source = 'manual' } = {}) {
  const ctx = await buildRunContext(userId);
  const { accountRow, universe, priceMap, activeRulesPayload, positionsPayload, universeSource } =
    ctx;
  const base = resolveQuantAgiBaseUrl();

  const runBody = buildBotRunDayBody(ctx, accountRow);
  const { data } = await axios.post(`${base}/bot/run-day`, runBody, {
    timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
  });

  if (runBody.agent_mode && data?.agent_plan_result) {
    await db.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'agent_plan_tick', $2)`,
      [
        userId,
        JSON.stringify({
          regimeLabel: data.regime_label || data.agent_plan_result.regime_label || null,
          grokUsed: Boolean(data.grok_used ?? data.agent_plan_result.grok_used),
          rationale: data.agent_plan_result.rationale || data.agent_plan?.rationale || null,
          tradeIntents: data.agent_plan_result.trade_intents || data.agent_plan?.trade_intents || [],
          plan: data.agent_plan || data.agent_plan_result.plan || null,
          skipped: Boolean(data.agent_plan_result.skipped),
          source
        })
      ]
    );
    notifyPaperBotClients(
      userId,
      'agent_plan_tick',
      data.agent_plan_result.rationale || 'Agent plan tick completed'
    );
  }

  if (data?.skipped) {
    await db.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'run_day_skipped', $2)`,
      [userId, JSON.stringify({ reason: data.reason || 'skipped' })]
    );
    if (source === 'auto') {
      await db.query(
        `UPDATE paper_bot_accounts SET last_auto_run_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
        [userId]
      );
      await db.query(
        `INSERT INTO paper_bot_events (user_id, event_type, payload)
         VALUES ($1, 'auto_run_tick', $2)`,
        [userId, JSON.stringify({ skipped: true, reason: data.reason || 'skipped' })]
      );
      notifyPaperBotClients(userId, 'auto_run_tick', data.reason || 'Auto-run skipped');
    } else {
      notifyPaperBotClients(userId, 'run_day_skipped', data.reason || 'Simulate day skipped');
    }
    return { ...((await getState(userId)) || {}), runDay: { skipped: true, reason: data.reason } };
  }

  const fills = Array.isArray(data?.fills) ? data.fills : [];
  for (const fill of fills) {
    await applyFill(userId, accountRow, fill);
  }

  const refreshed = await ensureAccount(userId);
  const posAfter = await loadPositions(userId);
  const metrics = await computeMetrics(refreshed, posAfter, priceMap);
  await upsertDailySnapshot(userId, refreshed, metrics);

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'run_day_completed', $2)`,
    [userId, JSON.stringify({ fillCount: fills.length, fills })]
  );

  if (source === 'auto') {
    await db.query(
      `UPDATE paper_bot_accounts SET last_auto_run_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
    await db.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'auto_run_tick', $2)`,
      [userId, JSON.stringify({ fillCount: fills.length, skipped: false })]
    );
    notifyPaperBotClients(
      userId,
      'auto_run_tick',
      fills.length ? `Auto-run — ${fills.length} fill(s)` : 'Auto-run — no fills this tick'
    );
  } else {
    notifyPaperBotClients(
      userId,
      'run_day_completed',
      `Simulated day — ${fills.length} fill(s)`
    );
  }

  return { ...(await getState(userId)), runDay: { skipped: false, fillCount: fills.length } };
}

async function getPolicySnapshot(userId) {
  const ctx = await buildRunContext(userId);
  const { accountRow, universe, activeRules, mergedPolicy, positionsRaw, universeSource } = ctx;
  const rankLeaders = await fetchRankLeadersForBrain();
  const cash = Number(accountRow.cash_usd);

  return {
    policyVersion: accountRow.policy_version,
    precedence: POLICY_PRECEDENCE,
    mergedPolicy,
    activeRules,
    gates: {
      killSwitchArmed: accountRow.kill_switch_armed,
      tradeDeployListOnly: normalizeUniverseMode(accountRow) === 'deploy_list_only',
      universeMode: normalizeUniverseMode(accountRow),
      agentModeEnabled: normalizeUniverseMode(accountRow) === 'quant_auto_agent',
      cashUsd: round2(cash),
      cashHeadroomUsd: round2(Math.max(0, cash - Number(mergedPolicy.min_cash_reserve))),
      openPositions: positionsRaw.length,
      maxOpenPositions: mergedPolicy.max_open_positions
    },
    universe: {
      source: universeSource,
      symbolCount: universe.length,
      symbolsSample: universe.slice(0, 10)
    },
    inputSignals: {
      rankLeaders,
      regimeLabel: null
    },
    disclaimer:
      'Grok proposes rules; bot_policy_engine merges approved rules into deterministic intents.'
  };
}

function mapShadowOrdersFromDryRun(data) {
  const fills = Array.isArray(data?.fills) ? data.fills : [];
  if (fills.length) {
    return fills.map((f) => ({
      symbol: String(f.symbol || '').toUpperCase(),
      side: f.side === 'sell' ? 'sell' : 'buy',
      quantity: Number(f.quantity),
      priceUsd: Number(f.price_usd),
      notionalUsd: Number(f.notional_usd),
      reasonTags: Array.isArray(f.reason_tags) ? f.reason_tags : [],
      reasonJson: f.reason_json && typeof f.reason_json === 'object' ? f.reason_json : {}
    }));
  }
  return (Array.isArray(data?.intents) ? data.intents : [])
    .filter((i) => i?.action === 'buy' && i?.symbol)
    .map((i) => ({
      symbol: String(i.symbol).toUpperCase(),
      side: 'buy',
      quantity: Number(i.quantity) || 0,
      priceUsd: Number(i.priceUsd ?? i.price_usd) || 0,
      notionalUsd: Number(i.notionalUsd ?? i.notional_usd) || 0,
      reasonTags: Array.isArray(i.reason_tags) ? i.reason_tags : [],
      reasonJson: i.reason_json && typeof i.reason_json === 'object' ? i.reason_json : { detail: i.detail, reason: i.reason }
    }));
}

async function shadowPreview(userId) {
  const ctx = await buildRunContext(userId);
  const {
    accountRow,
    universe,
    priceMap,
    activeRulesPayload,
    positionsPayload,
    mergedPolicy,
    universeSource
  } = ctx;
  const base = resolveQuantAgiBaseUrl();
  const killSwitchArmed = Boolean(accountRow.kill_switch_armed);

  const { data } = await axios.post(
    `${base}/bot/dry-run`,
    buildBotRunDayBody(ctx, accountRow, { killSwitchArmed: false }),
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  const orders = mapShadowOrdersFromDryRun(data);
  const skippedIntents = (Array.isArray(data?.intents) ? data.intents : []).filter(
    (i) => i?.action && i.action !== 'buy'
  );

  for (const order of orders) {
    const payload = stampShadowOrderPayload(
      {
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        priceUsd: order.priceUsd,
        notionalUsd: order.notionalUsd,
        reasonTags: order.reasonTags,
        reasonJson: order.reasonJson,
        policyVersion: data?.policy_version ?? accountRow.policy_version
      },
      { killSwitchArmed }
    );
    await db.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'shadow_order', $2)`,
      [userId, JSON.stringify(payload)]
    );
  }

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'shadow_run', $2)`,
    [
      userId,
      JSON.stringify({
        skipped: Boolean(data?.skipped),
        reason: data?.reason || null,
        orderCount: orders.length,
        skippedIntentCount: skippedIntents.length,
        assumedDisarmed: true,
        killSwitchArmedAtRun: killSwitchArmed,
        policyVersion: data?.policy_version ?? accountRow.policy_version
      })
    ]
  );

  notifyPaperBotClients(
    userId,
    'shadow_run',
    orders.length
      ? `Shadow preview — ${orders.length} hypothetical order(s)`
      : 'Shadow preview — no orders'
  );

  return {
    skipped: Boolean(data?.skipped),
    reason: data?.reason || null,
    assumedDisarmed: true,
    killSwitchArmedAtRun: killSwitchArmed,
    orders,
    skippedIntents,
    orderCount: orders.length,
    policyVersion: data?.policy_version ?? accountRow.policy_version,
    appliedPolicy: data?.applied_policy || mergedPolicy
  };
}

async function getShadowOrders(userId, limit = 20) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  const { rows } = await db.query(
    `SELECT id, payload, created_at
     FROM paper_bot_events
     WHERE user_id = $1 AND event_type = 'shadow_order'
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, lim]
  );
  return rows.map((r) => {
    const p = r.payload && typeof r.payload === 'object' ? r.payload : {};
    return {
      id: r.id,
      symbol: p.symbol,
      side: p.side || 'buy',
      quantity: Number(p.quantity) || 0,
      priceUsd: Number(p.priceUsd) || 0,
      notionalUsd: Number(p.notionalUsd) || 0,
      reasonTags: Array.isArray(p.reasonTags) ? p.reasonTags : [],
      fillNamespace: p.fill_namespace || null,
      killSwitchArmedAtRun: Boolean(p.kill_switch_armed_at_run),
      policyVersion: p.policyVersion,
      createdAt: r.created_at
    };
  });
}

function mapQuantDryRunResponse(data, accountRow, mergedPolicy) {
  const agentPlan = data?.agent_plan && typeof data.agent_plan === 'object' ? data.agent_plan : null;
  return {
    skipped: Boolean(data?.skipped),
    reason: data?.reason || null,
    intents: Array.isArray(data?.intents) ? data.intents : [],
    fills: Array.isArray(data?.fills) ? data.fills : [],
    policyVersion: data?.policy_version ?? accountRow.policy_version,
    appliedPolicy: data?.applied_policy || mergedPolicy,
    agentPlan,
    regimeLabel: data?.regime_label || agentPlan?.regime_label || null,
    grokUsed: Boolean(data?.grok_used ?? agentPlan?.grok_used),
    debateSummary: agentPlan?.debate_summary || null,
    debateResults: Array.isArray(agentPlan?.debate_results) ? agentPlan.debate_results : [],
    tradeIntents: Array.isArray(agentPlan?.trade_intents) ? agentPlan.trade_intents : []
  };
}

async function dryRun(userId) {
  const ctx = await buildRunContext(userId);
  const { accountRow, mergedPolicy } = ctx;
  const base = resolveQuantAgiBaseUrl();

  const { data } = await axios.post(
    `${base}/bot/dry-run`,
    buildBotRunDayBody(ctx, accountRow),
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'dry_run', $2)`,
    [
      userId,
      JSON.stringify({
        skipped: Boolean(data?.skipped),
        reason: data?.reason || null,
        intentCount: Array.isArray(data?.intents) ? data.intents.length : 0,
        agentMode: Boolean(buildBotRunDayBody(ctx, accountRow).agent_mode)
      })
    ]
  );

  return mapQuantDryRunResponse(data, accountRow, mergedPolicy);
}

async function getBrainMonitor(userId) {
  const ctx = await buildRunContext(userId);
  const { accountRow, mergedPolicy, positionsRaw, priceMap } = ctx;
  const mode = normalizeUniverseMode(accountRow);
  const base = resolveQuantAgiBaseUrl();
  const timeout = config.QUANT_AGI_RANK_TIMEOUT_MS || 45000;
  const body = buildBotRunDayBody(ctx, accountRow);

  const snapshot = await getPolicySnapshot(userId);
  const latestPlanEvent = (await loadRecentEvents(userId, 12)).find(
    (e) => e.eventType === 'agent_plan_tick'
  );
  if (!snapshot.inputSignals.regimeLabel && latestPlanEvent?.payload?.regimeLabel) {
    snapshot.inputSignals.regimeLabel = latestPlanEvent.payload.regimeLabel;
  }

  const { data: primaryData } = await axios.post(`${base}/bot/dry-run`, body, { timeout });

  const dryRunResult = mapQuantDryRunResponse(primaryData, accountRow, mergedPolicy);
  if (!snapshot.inputSignals.regimeLabel && dryRunResult.regimeLabel) {
    snapshot.inputSignals.regimeLabel = dryRunResult.regimeLabel;
  }

  const agentPlanHistory = (await loadRecentEvents(userId, 10)).filter(
    (e) => e.eventType === 'agent_plan_tick'
  );
  const lastReflection = (await loadRecentEvents(userId, 8)).find(
    (e) => e.eventType === 'brain_reflection'
  );

  const pendingRules = (await loadRulesByStatus(userId, 'pending')).map(mapRule);
  const brainPendingRules = pendingRules.filter(
    (r) => r.ruleJson && r.ruleJson.brain_reflection === true
  );

  const snapshotsRaw = await loadSnapshots(userId);
  const tradesRaw = await loadRecentTrades(userId, 30);
  const metrics = computePaperBotMetrics(
    accountRow,
    snapshotsRaw,
    Number(accountRow.cash_usd) +
      positionsRaw.reduce(
        (sum, p) =>
          sum + Number(p.quantity) * (priceMap[p.symbol.toUpperCase()] ?? Number(p.avg_cost_usd)),
        0
      ),
    tradesRaw.length
  );

  const agentTaggedFills = tradesRaw.filter((t) => {
    const rj = t.reason_json && typeof t.reason_json === 'object' ? t.reason_json : {};
    return Boolean(rj.agent_plan);
  }).length;

  return {
    snapshot,
    dryRun: dryRunResult,
    agentPlanHistory,
    lastReflection: lastReflection || null,
    brainPendingRules,
    performance: {
      ...metrics,
      agentPlanTicks: agentPlanHistory.length,
      agentTaggedFills,
      universeMode: mode
    },
    disclaimer:
      'Brain monitor is educational — agent debate and reflection propose changes; you approve rules before they affect the ledger.'
  };
}

async function runBrainReflection(userId) {
  await ensureAccount(userId);
  const monitor = await getBrainMonitor(userId);
  const base = resolveQuantAgiBaseUrl();
  const ctx = await buildRunContext(userId);
  const { accountRow, mergedPolicy } = ctx;
  const tradesRaw = await loadRecentTrades(userId, 25);

  const { data } = await axios.post(
    `${base}/bot/brain-reflect`,
    {
      agent_plans: monitor.agentPlanHistory.map((e) => e.payload || {}),
      recent_trades: tradesRaw.map(mapTrade),
      metrics: monitor.performance,
      current_policy: mergedPolicy,
      universe_mode: normalizeUniverseMode(accountRow)
    },
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  if (!data?.ok) {
    const err = new Error(data?.error || 'Brain reflection failed');
    err.statusCode = 502;
    throw err;
  }

  const proposals = Array.isArray(data.proposals) ? data.proposals : [];
  const createdRuleIds = [];

  for (const p of proposals) {
    const ruleText = String(p.rule_text || p.ruleText || 'Brain reflection proposal').slice(0, 500);
    const ruleJson = {
      ...(p.payload && typeof p.payload === 'object' ? p.payload : {}),
      rule_type: p.rule_type || p.payload?.rule_type,
      rationale: p.rationale || null,
      brain_reflection: true
    };
    const { rows } = await db.query(
      `INSERT INTO paper_bot_rules (user_id, source, status, rule_text, rule_json)
       VALUES ($1, 'bot_suggested', 'pending', $2, $3::jsonb)
       RETURNING id`,
      [userId, ruleText, JSON.stringify(ruleJson)]
    );
    if (rows[0]?.id) createdRuleIds.push(rows[0].id);
  }

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'brain_reflection', $2)`,
    [
      userId,
      JSON.stringify({
        summary: data.summary || null,
        insights: data.insights || {},
        proposalCount: proposals.length,
        createdRuleIds,
        grokUsed: Boolean(data.grok_used)
      })
    ]
  );

  notifyPaperBotClients(
    userId,
    'brain_reflection',
    proposals.length
      ? `Brain reflection — ${proposals.length} proposal(s) in rules inbox`
      : 'Brain reflection complete — no policy changes suggested'
  );

  return getBrainMonitor(userId);
}

async function fetchLearningCapabilities() {
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/bot/learning/capabilities`, {
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 15000
    });
    return data?.capabilities || { arxiv: true, x_search: false, x: false };
  } catch (err) {
    logger.warn(`Learning capabilities fetch failed: ${err.message}`);
    return { arxiv: true, x_search: false, x_monitor: false, x: false };
  }
}

async function getBotLearningLatest(userId) {
  const accountRow = await ensureAccount(userId);
  const positionsRaw = await loadPositions(userId);
  const symbols = positionsRaw.map((p) => p.symbol);
  const priceMap = await fetchSymbolPrices(symbols);
  const liveMetrics = await computeMetrics(accountRow, positionsRaw, priceMap);
  const snapshotsRaw = await loadSnapshots(userId);
  const tradeCount = await countTrades(userId);
  const metrics = computePaperBotMetrics(
    accountRow,
    snapshotsRaw,
    liveMetrics.equityUsd,
    tradeCount
  );
  const nightlyContext = await buildNightlyContext(
    userId,
    accountRow,
    snapshotsRaw,
    metrics,
    tradeCount
  );

  const [capabilitiesRaw, lastLearningEvent, xPulse, trustedTraders] = await Promise.all([
    fetchLearningCapabilities(),
    loadRecentEvents(userId, 8).then((rows) => rows.find((e) => e.eventType === 'bot_learning')),
    loadXTrustedPulse(userId),
    trustedXTradersService.listTrustedTraders(userId)
  ]);

  const capabilities = {
    ...capabilitiesRaw,
    x_monitor: Boolean(capabilitiesRaw.x_monitor || trustedTraders.length || xPulse?.accounts?.length),
    x: Boolean(capabilitiesRaw.x || capabilitiesRaw.x_search || trustedTraders.length)
  };

  const pendingRules = (await loadRulesByStatus(userId, 'pending')).map(mapRule);
  const learningPendingRules = pendingRules.filter(
    (r) => r.source === 'autoresearch' || (r.ruleJson && r.ruleJson.bot_learning === true)
  );

  return {
    metrics,
    nightlyContext,
    capabilities,
    lastLearning: lastLearningEvent || null,
    learningPendingRules,
    activeLearningMemory: accountRow.learning_memory || null,
    xTrusted: {
      configured: Boolean(xPulse?.configured || trustedTraders.length),
      xSearchOnly: true,
      accounts: xPulse?.accounts || [],
      tickerBuzz: (xPulse?.tickerBuzz || []).slice(0, 8),
      trustedSymbols: trustedSymbolsFromLearningMemory(accountRow.learning_memory),
      warning: xPulse?.warning || null
    },
    trustedTraders,
    maxTrustedTraders: trustedXTradersService.MAX_TRUSTED,
    autoLearning: {
      schedulerEnabled: Boolean(config.ENABLE_PAPER_BOT_LEARNING_AUTO_RUN),
      runsWhenBotOn: true,
      autoApproveTightening: Boolean(config.PAPER_BOT_LEARNING_AUTO_APPROVE),
      intervalHours: Math.round((config.PAPER_BOT_LEARNING_INTERVAL_MS || 86400000) / 3600000),
      lastAutoLearningAt: accountRow.last_auto_learning_at || null,
      marketOpen: isUsStockRegularTradingHours(),
      botOn: Boolean(accountRow.auto_run_enabled && !accountRow.kill_switch_armed)
    },
    asOf: new Date().toISOString(),
    disclaimer: config.PAPER_BOT_LEARNING_AUTO_APPROVE
      ? 'Learning runs automatically after hours when the bot is ON. Conservative tightening rules may auto-apply; others stay in the inbox.'
      : 'Learning runs automatically after hours when the bot is ON — review and approve rule proposals in the inbox.'
  };
}

function isConservativeTightening(ruleType, newVal, currentPolicy) {
  const cur = Number(currentPolicy[ruleType] ?? DEFAULT_POLICY[ruleType]);
  if (!Number.isFinite(newVal)) return false;
  switch (ruleType) {
    case 'min_cash_reserve':
      return newVal >= cur;
    case 'max_notional_per_trade':
    case 'max_position_pct':
    case 'max_open_positions':
      return newVal <= cur;
    default:
      return false;
  }
}

async function autoApproveConservativeLearningRules(userId, ruleIds, mergedPolicy) {
  if (!config.PAPER_BOT_LEARNING_AUTO_APPROVE || !ruleIds?.length) {
    return [];
  }
  const approved = [];
  for (const ruleId of ruleIds) {
    if (approved.length >= 1) break;
    const { rows } = await db.query(
      `SELECT id, rule_json FROM paper_bot_rules
       WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [ruleId, userId]
    );
    if (!rows.length) continue;
    const rj = rows[0].rule_json || {};
    if (!rj.bot_learning) continue;
    const ruleType = rj.rule_type || rj.ruleType;
    const val = Number(rj.value ?? rj[ruleType]);
    if (!isConservativeTightening(ruleType, val, mergedPolicy)) continue;
    await approveRule(userId, ruleId);
    approved.push(ruleId);
  }
  return approved;
}

async function loadXMonitorPostsForLearning(userId) {
  try {
    const pulse = await loadXTrustedPulse(userId);
    const tweets = Array.isArray(pulse?.tweets) ? pulse.tweets : [];
    return {
      posts: tweets.slice(0, 24).map((tw) => ({
        id: tw.id,
        text: tw.text,
        authorUsername: tw.authorUsername || tw.monitorUsername,
        createdAt: tw.createdAt,
        monitorLabel: tw.monitorLabel,
        cashtags: tw.cashtags || []
      })),
      accounts: pulse.accounts || [],
      tickerBuzz: pulse.tickerBuzz || [],
      configured: Boolean(pulse.configured)
    };
  } catch (err) {
    logger.warn(`X monitor posts for learning failed: ${err.message}`);
    return { posts: [], accounts: [], tickerBuzz: [], configured: false };
  }
}

async function runBotLearningCycle(userId, { source = 'manual' } = {}) {
  await ensureAccount(userId);
  const latest = await getBotLearningLatest(userId);
  const ctx = await buildRunContext(userId);
  const { accountRow, mergedPolicy } = ctx;
  const tradesRaw = await loadRecentTrades(userId, 25);
  const agentPlanHistory = (await loadRecentEvents(userId, 12)).filter(
    (e) => e.eventType === 'agent_plan_tick'
  );
  const xMonitorBundle = await loadXMonitorPostsForLearning(userId);

  const base = resolveQuantAgiBaseUrl();
  const { data } = await axios.post(
    `${base}/bot/learning-cycle`,
    {
      agent_plans: agentPlanHistory.map((e) => e.payload || {}),
      recent_trades: tradesRaw.map(mapTrade),
      metrics: latest.metrics,
      nightly_context: latest.nightlyContext,
      current_policy: mergedPolicy,
      universe_mode: normalizeUniverseMode(accountRow),
      x_monitor_posts: xMonitorBundle.posts,
      x_monitor_accounts: xMonitorBundle.accounts,
      x_ticker_buzz: xMonitorBundle.tickerBuzz
    },
    { timeout: Math.max(config.QUANT_AGI_RANK_TIMEOUT_MS || 45000, 90000) }
  );

  if (!data?.ok) {
    const err = new Error(data?.error || 'Bot learning cycle failed');
    err.statusCode = 502;
    throw err;
  }

  const proposals = Array.isArray(data.proposals) ? data.proposals : [];
  const createdRuleIds = [];

  for (const p of proposals) {
    const ruleText = String(p.rule_text || p.ruleText || 'Learning lab proposal').slice(0, 500);
    const ruleJson = {
      ...(p.payload && typeof p.payload === 'object' ? p.payload : {}),
      rule_type: p.rule_type || p.payload?.rule_type,
      rationale: p.rationale || null,
      bot_learning: true,
      research_queries: data.research_queries || [],
      source_count: Array.isArray(data.sources) ? data.sources.length : 0
    };
    const { rows } = await db.query(
      `INSERT INTO paper_bot_rules (user_id, source, status, rule_text, rule_json)
       VALUES ($1, 'autoresearch', 'pending', $2, $3::jsonb)
       RETURNING id`,
      [userId, ruleText, JSON.stringify(ruleJson)]
    );
    if (rows[0]?.id) createdRuleIds.push(rows[0].id);
  }

  let autoApprovedRuleIds = [];
  if (source === 'auto' && createdRuleIds.length) {
    autoApprovedRuleIds = await autoApproveConservativeLearningRules(
      userId,
      createdRuleIds,
      mergedPolicy
    );
  }

  await db.query(
    `UPDATE paper_bot_accounts
     SET last_auto_learning_at = NOW(),
         learning_memory = $2::jsonb,
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId, JSON.stringify(data.learning_memory || null)]
  );

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'bot_learning', $2)`,
    [
      userId,
      JSON.stringify({
        source,
        summary: data.summary || null,
        lessons: data.lessons || [],
        agentHints: data.agent_hints || [],
        coachingDirectives: data.coaching_directives || data.learning_memory?.coaching_directives || null,
        trustedSymbols: data.coaching_directives?.trusted_symbols || data.trusted_x?.trusted_symbols || [],
        trustedXAccounts: (xMonitorBundle.accounts || []).slice(0, 6),
        learningMemoryUpdatedAt: data.learning_memory?.updated_at || null,
        sources: (data.sources || []).slice(0, 12),
        researchQueries: data.research_queries || [],
        proposalCount: proposals.length,
        createdRuleIds,
        autoApprovedRuleIds,
        grokUsed: Boolean(data.grok_used),
        capabilities: data.capabilities || latest.capabilities
      })
    ]
  );

  notifyPaperBotClients(
    userId,
    'bot_learning',
    autoApprovedRuleIds.length
      ? `Auto-learning applied ${autoApprovedRuleIds.length} conservative rule(s)`
      : proposals.length
        ? `Learning cycle — ${proposals.length} proposal(s) in rules inbox`
        : 'Learning cycle complete — review lessons in the learning lab'
  );

  return getBotLearningLatest(userId);
}

async function getRecentEvents(userId, limit = 15, options = {}) {
  return loadRecentEvents(userId, limit, options);
}

const BASELINE_MAX_DRAWDOWN_PCT = 0.15;
const RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function sharpeProxy(returns) {
  if (!returns || returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std < 1e-12) return 0;
  return (mean / std) * Math.sqrt(252);
}

function maxDrawdownPct(snapshots, startingEquity) {
  let peak = Number(startingEquity || 0);
  let maxDd = 0;
  for (const row of snapshots) {
    const eq = Number(row.equity_usd ?? row.equityUsd ?? 0);
    peak = Math.max(peak, eq);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - eq) / peak);
  }
  return round2(maxDd);
}

function computePaperBotMetrics(accountRow, snapshotsRaw, liveEquityUsd, tradeCount) {
  const starting = Number(accountRow.starting_cash_usd);
  const equity = Number(liveEquityUsd ?? starting);
  const returns = [];
  for (let i = 1; i < snapshotsRaw.length; i++) {
    const prev = Number(snapshotsRaw[i - 1].equity_usd);
    const curr = Number(snapshotsRaw[i].equity_usd);
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  const prior5 = returns.length >= 10 ? returns.slice(-10, -5) : [];
  const recent5 = returns.length >= 5 ? returns.slice(-5) : [];

  return {
    startingCashUsd: starting,
    equityUsd: round2(equity),
    cumPnlUsd: round2(equity - starting),
    paperDays: snapshotsRaw.length,
    tradeCount: Number(tradeCount) || 0,
    sharpeProxy: round2(sharpeProxy(returns)),
    sharpe7d: round2(sharpeProxy(returns.slice(-7))),
    sharpeHoldout5dDelta: round2(sharpeProxy(recent5) - sharpeProxy(prior5)),
    maxDrawdownPct: maxDrawdownPct(snapshotsRaw, starting)
  };
}

function accountPromotionCooldown(accountRow) {
  const resetAt = accountRow?.reset_at ? new Date(accountRow.reset_at).getTime() : 0;
  if (!resetAt || !Number.isFinite(resetAt)) {
    return { blocked: false, hoursRemaining: 0 };
  }
  const elapsed = Date.now() - resetAt;
  if (elapsed >= RESET_COOLDOWN_MS) {
    return { blocked: false, hoursRemaining: 0 };
  }
  return {
    blocked: true,
    hoursRemaining: Math.ceil((RESET_COOLDOWN_MS - elapsed) / (60 * 60 * 1000))
  };
}

function evaluatePromotionGates(metrics, { walkForward = null, resetCooldown = null } = {}) {
  const gates = [
    {
      id: 'paper_days',
      label: '≥10 paper days',
      pass: metrics.paperDays >= 10,
      actual: metrics.paperDays,
      required: 10
    },
    {
      id: 'trade_count',
      label: '≥20 fills',
      pass: metrics.tradeCount >= 20,
      actual: metrics.tradeCount,
      required: 20
    },
    {
      id: 'sharpe_holdout',
      label: 'Sharpe Δ > 0 (last 5d vs prior 5d)',
      pass: metrics.sharpeHoldout5dDelta > 0,
      actual: metrics.sharpeHoldout5dDelta,
      required: 0
    },
    {
      id: 'max_drawdown',
      label: 'Max drawdown ≤ 15%',
      pass: metrics.maxDrawdownPct <= BASELINE_MAX_DRAWDOWN_PCT,
      actual: metrics.maxDrawdownPct,
      required: BASELINE_MAX_DRAWDOWN_PCT
    }
  ];

  if (walkForward) {
    gates.push({
      id: 'walk_forward',
      label: 'Walk-forward Sharpe Δ > 0 (Massive holdout)',
      pass: Boolean(walkForward.pass),
      actual: Number(walkForward.avgHoldoutSharpeDelta ?? walkForward.avg_holdout_sharpe_delta ?? 0),
      required: 0
    });
  }

  const cooldownBlocked = Boolean(resetCooldown?.blocked);
  gates.push({
    id: 'reset_cooldown',
    label: '24h cooldown after account reset',
    pass: !cooldownBlocked,
    actual: cooldownBlocked ? 1 : 0,
    required: 0
  });

  const passedCount = gates.filter((g) => g.pass).length;
  return {
    gates,
    passedCount,
    totalCount: gates.length,
    promotionReady: passedCount === gates.length
  };
}

async function countTrades(userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c FROM paper_bot_trades WHERE user_id = $1`,
    [userId]
  );
  return rows[0]?.c ?? 0;
}

async function fetchTradedSymbols(userId, limit = 12) {
  const { rows } = await db.query(
    `SELECT symbol, COUNT(*)::int AS fills
     FROM paper_bot_trades
     WHERE user_id = $1
     GROUP BY symbol
     ORDER BY fills DESC, symbol ASC
     LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => String(r.symbol).toUpperCase());
}

async function buildNightlyContext(userId, accountRow, snapshotsRaw, metrics, tradeCount) {
  let worstDay = null;
  let positiveDays = 0;
  for (const row of snapshotsRaw) {
    const dayPnl = Number(row.day_pnl_usd);
    if (dayPnl > 0) positiveDays += 1;
    if (!worstDay || dayPnl < worstDay.dayPnlUsd) {
      worstDay = { snapshotDate: row.snapshot_date, dayPnlUsd: round2(dayPnl) };
    }
  }

  const symRes = await db.query(
    `SELECT symbol, COUNT(*)::int AS fills
     FROM paper_bot_trades WHERE user_id = $1
     GROUP BY symbol ORDER BY fills DESC LIMIT 10`,
    [userId]
  );
  const tagRes = await db.query(
    `SELECT tag, COUNT(*)::int AS n FROM (
       SELECT jsonb_array_elements_text(reason_tags) AS tag FROM paper_bot_trades
       WHERE user_id = $1
         AND reason_tags IS NOT NULL
         AND jsonb_typeof(reason_tags) = 'array'
         AND jsonb_array_length(reason_tags) > 0
     ) t GROUP BY tag ORDER BY n DESC LIMIT 8`,
    [userId]
  );

  return {
    equityUsd: metrics.equityUsd,
    cumPnlUsd: metrics.cumPnlUsd,
    paperDays: metrics.paperDays,
    tradeCount,
    winRateDays: snapshotsRaw.length ? round2(positiveDays / snapshotsRaw.length) : 0,
    worstDay,
    symbolsTraded: symRes.rows.map((r) => ({
      symbol: r.symbol,
      fills: Number(r.fills)
    })),
    topReasonTags: tagRes.rows.map((r) => ({
      tag: r.tag,
      count: Number(r.n)
    }))
  };
}

async function fetchWalkForwardEval(symbols) {
  if (!symbols.length) return null;
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.post(
      `${base}/diag/paper-bot/walk-forward`,
      { symbols, holdout_days: 5 },
      { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 60000 }
    );
    if (!data?.ok) return null;
    return {
      symbolsRequested: data.symbols_requested ?? symbols.length,
      symbolsEvaluated: data.symbols_evaluated ?? 0,
      holdoutDays: data.holdout_days ?? 5,
      avgHoldoutSharpeDelta: round2(data.avg_holdout_sharpe_delta ?? 0),
      pass: Boolean(data.pass),
      reason: data.reason ?? null,
      perSymbol: Array.isArray(data.per_symbol) ? data.per_symbol.slice(0, 6) : []
    };
  } catch (err) {
    logger.warn(`Walk-forward eval failed: ${err.message}`);
    return null;
  }
}

async function fetchLatestPatchPreview() {
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/diag/terminal-feed`, {
      params: { limit: 1 },
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
    });
    const patch = data?.latestPatch;
    if (!patch?.patch) return null;
    return {
      commitSha: patch.commitSha || null,
      createdAt: patch.createdAt || null,
      patchPreview: String(patch.patch).split('\n').slice(0, 12).join('\n'),
      truncated: Boolean(patch.truncated)
    };
  } catch (err) {
    logger.warn(`Latest patch preview failed: ${err.message}`);
    return null;
  }
}

async function fetchLatestAutoresearchExperiment() {
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/diag/experiments`, {
      params: { limit: 1 },
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
    });
    const exp = (data?.experiments || [])[0];
    if (!exp) return null;
    const sharpeDelta =
      exp.baseline_sharpe != null && exp.candidate_sharpe != null
        ? round2(Number(exp.candidate_sharpe) - Number(exp.baseline_sharpe))
        : null;
    return {
      id: exp.id,
      branch: exp.branch,
      commitSha: exp.commit_sha,
      improved: Boolean(exp.improved),
      sharpeDelta,
      rejectionReason: exp.rejection_reason || null,
      createdAt: exp.created_at || null
    };
  } catch (err) {
    logger.warn(`Autoresearch experiment fetch failed: ${err.message}`);
    return null;
  }
}

async function fetchAutoresearchScorecard() {
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/diag/scorecard`, {
      params: { limit: 20 },
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
    });
    if (!data?.ok) return null;
    return {
      testedExperiments: data.tested_experiments ?? 0,
      improvedExperiments: data.improved_experiments ?? 0,
      promotionRate: data.promotion_rate ?? 0,
      avgSharpeDelta: data.avg_sharpe_delta ?? 0
    };
  } catch (err) {
    logger.warn(`Autoresearch scorecard fetch failed: ${err.message}`);
    return null;
  }
}

async function getAutoresearchLatest(userId) {
  const accountRow = await ensureAccount(userId);
  const positionsRaw = await loadPositions(userId);
  const symbols = positionsRaw.map((p) => p.symbol);
  const priceMap = await fetchSymbolPrices(symbols);
  const liveMetrics = await computeMetrics(accountRow, positionsRaw, priceMap);
  await upsertDailySnapshot(userId, accountRow, liveMetrics);

  const snapshotsRaw = await loadSnapshots(userId);
  const tradeCount = await countTrades(userId);
  const metrics = computePaperBotMetrics(
    accountRow,
    snapshotsRaw,
    liveMetrics.equityUsd,
    tradeCount
  );
  const nightlyContext = await buildNightlyContext(
    userId,
    accountRow,
    snapshotsRaw,
    metrics,
    tradeCount
  );
  const resetCooldown = accountPromotionCooldown(accountRow);
  const tradedSymbols = await fetchTradedSymbols(userId);

  const [walkForward, latestExperiment, autoresearchScorecard, latestPatch] =
    await Promise.all([
      fetchWalkForwardEval(tradedSymbols),
      fetchLatestAutoresearchExperiment(),
      fetchAutoresearchScorecard(),
      fetchLatestPatchPreview()
    ]);

  const promotion = evaluatePromotionGates(metrics, { walkForward, resetCooldown });

  return {
    metrics,
    nightlyContext,
    walkForward,
    resetCooldown,
    promotion,
    latestExperiment,
    autoresearchScorecard,
    latestPatch,
    asOf: new Date().toISOString()
  };
}

async function promoteAutoresearchPatch(userId, { commitSha, experimentId } = {}) {
  const accountRow = await ensureAccount(userId);
  const resetCooldown = accountPromotionCooldown(accountRow);
  if (resetCooldown.blocked) {
    const err = new Error(
      `Account reset cooldown — wait ${resetCooldown.hoursRemaining}h before promoting patches`
    );
    err.statusCode = 403;
    err.code = 'RESET_COOLDOWN';
    throw err;
  }

  const latest = await getAutoresearchLatest(userId);
  if (!latest.promotion?.promotionReady) {
    const err = new Error('Promotion gates not satisfied — review the checklist in the strip');
    err.statusCode = 403;
    err.code = 'GATES_NOT_MET';
    throw err;
  }

  const exp = latest.latestExperiment;
  if (!exp?.improved) {
    const err = new Error('Latest experiment did not improve — nothing to promote');
    err.statusCode = 400;
    throw err;
  }

  const sha = String(commitSha || exp.commitSha || '').trim();
  if (!sha) {
    const err = new Error('No commit sha to promote');
    err.statusCode = 400;
    throw err;
  }

  const base = resolveQuantAgiBaseUrl();
  const { data } = await axios.post(
    `${base}/diag/autoresearch/promote`,
    {
      commit_sha: sha,
      experiment_id: experimentId ?? exp.id,
      promoted_by: `user:${userId}`
    },
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  if (!data?.ok) {
    const err = new Error(data?.error || 'Promote failed');
    err.statusCode = 400;
    throw err;
  }

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'autoresearch_promoted', $2)`,
    [
      userId,
      JSON.stringify({
        sourceSha: data.source_sha || sha,
        promotedSha: data.promoted_sha,
        branch: data.branch,
        experimentId: experimentId ?? exp.id
      })
    ]
  );

  notifyPaperBotClients(userId, 'autoresearch_promoted', 'Autoresearch patch promoted to staging');

  return {
    ok: true,
    sourceSha: data.source_sha || sha,
    promotedSha: data.promoted_sha,
    branch: data.branch,
    files: data.files || [],
    promotion: latest.promotion
  };
}

async function resetAccount(userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await ensureAccount(userId);
    await client.query(`DELETE FROM paper_bot_positions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM paper_bot_trades WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM paper_bot_daily_snapshots WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE paper_bot_rules SET status = 'dismissed', updated_at = NOW()
       WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );
    const { rows } = await client.query(
      `UPDATE paper_bot_accounts
       SET cash_usd = starting_cash_usd,
           policy_version = 1,
           last_trade_at = NULL,
           last_auto_run_at = NULL,
           auto_run_enabled = false,
           reset_at = NOW(),
           kill_switch_armed = true,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId]
    );
    await client.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'account_reset', $2)`,
      [userId, JSON.stringify({ startingCashUsd: Number(rows[0]?.starting_cash_usd) })]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  notifyPaperBotClients(userId, 'account_reset', 'Paper account reset');
  return getState(userId);
}

async function manualTrade(userId, { symbol, side, notionalUsd }) {
  const accountRow = await ensureAccount(userId);
  if (accountRow.kill_switch_armed) {
    const err = new Error('Kill switch is armed — disarm before manual paper trades');
    err.statusCode = 403;
    throw err;
  }

  const sym = String(symbol || '')
    .toUpperCase()
    .trim();
  if (!sym) {
    const err = new Error('Symbol required');
    err.statusCode = 400;
    throw err;
  }

  const priceMap = await fetchSymbolPrices([sym]);
  const price = priceMap[sym];
  if (!price) {
    const err = new Error(`No price for ${sym}`);
    err.statusCode = 400;
    throw err;
  }

  const notional = round2(Number(notionalUsd));
  if (!Number.isFinite(notional) || notional <= 0) {
    const err = new Error('notionalUsd must be positive');
    err.statusCode = 400;
    throw err;
  }

  const tradeSide = side === 'sell' ? 'sell' : 'buy';
  const qty = round2(notional / price);
  if (qty <= 0) {
    const err = new Error('Notional too small for one share');
    err.statusCode = 400;
    throw err;
  }

  await applyFill(userId, accountRow, {
    symbol: sym,
    side: tradeSide,
    quantity: qty,
    price_usd: price,
    notional_usd: round2(qty * price),
    reason_tags: ['manual', 'dev']
  });

  const refreshed = await ensureAccount(userId);
  const posAfter = await loadPositions(userId);
  const metrics = await computeMetrics(refreshed, posAfter, priceMap);
  await upsertDailySnapshot(userId, refreshed, metrics);

  notifyPaperBotClients(userId, 'fill', `Manual paper fill — ${tradeSide.toUpperCase()} ${sym}`);
  return getState(userId);
}

async function interpretNote(userId, noteText) {
  await ensureAccount(userId);
  const cleaned = String(noteText || '').trim();
  if (!cleaned) {
    const err = new Error('Note text required');
    err.statusCode = 400;
    throw err;
  }

  const state = await getState(userId);
  const base = resolveQuantAgiBaseUrl();

  const { data } = await axios.post(
    `${base}/bot/interpret-note`,
    {
      note: cleaned,
      context: {
        equity_usd: state.account.equityUsd,
        cash_usd: state.account.cashUsd,
        policy_version: state.account.policyVersion,
        active_rules_count: state.activeRules?.length ?? 0
      }
    },
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  if (!data?.ok) {
    const err = new Error(data?.error || 'Grok could not interpret note');
    err.statusCode = 502;
    throw err;
  }

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'user_note', $2)`,
    [userId, JSON.stringify({ note: cleaned.slice(0, 500), usedGrok: Boolean(data.used_grok) })]
  );

  const proposals = Array.isArray(data.proposals) ? data.proposals : [];
  for (const p of proposals) {
    const ruleText = String(p.rule_text || p.ruleText || 'Proposed rule').slice(0, 500);
    const ruleJson = {
      ...(p.payload && typeof p.payload === 'object' ? p.payload : {}),
      rule_type: p.rule_type || p.payload?.rule_type,
      rationale: p.rationale || null
    };
    await db.query(
      `INSERT INTO paper_bot_rules (user_id, source, status, rule_text, rule_json)
       VALUES ($1, 'user', 'pending', $2, $3::jsonb)`,
      [userId, ruleText, JSON.stringify(ruleJson)]
    );
  }

  notifyPaperBotClients(
    userId,
    'user_note',
    proposals.length ? `Grok proposed ${proposals.length} rule(s)` : 'Trading note recorded'
  );
  return getState(userId);
}

async function approveRule(userId, ruleId) {
  const id = Number(ruleId);
  if (!Number.isFinite(id)) {
    const err = new Error('Invalid rule id');
    err.statusCode = 400;
    throw err;
  }

  const check = await db.query(
    `SELECT * FROM paper_bot_rules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!check.rows.length) {
    const err = new Error('Rule not found');
    err.statusCode = 404;
    throw err;
  }
  if (check.rows[0].status !== 'pending') {
    const err = new Error('Only pending rules can be approved');
    err.statusCode = 400;
    throw err;
  }

  await db.query(
    `UPDATE paper_bot_rules SET status = 'active', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  await db.query(
    `UPDATE paper_bot_accounts
     SET policy_version = policy_version + 1, updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'rule_applied', $2)`,
    [userId, JSON.stringify({ ruleId: id, action: 'approved' })]
  );

  notifyPaperBotClients(userId, 'rule_applied', 'Grok rule approved — policy version bumped');
  return getState(userId);
}

async function removeRule(userId, ruleId) {
  const id = Number(ruleId);
  if (!Number.isFinite(id)) {
    const err = new Error('Invalid rule id');
    err.statusCode = 400;
    throw err;
  }

  const check = await db.query(
    `SELECT id, status, rule_text FROM paper_bot_rules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!check.rows.length) {
    const err = new Error('Rule not found');
    err.statusCode = 404;
    throw err;
  }

  const row = check.rows[0];
  const fromStatus = String(row.status || '');
  if (fromStatus !== 'pending' && fromStatus !== 'active') {
    const err = new Error('Rule is already removed');
    err.statusCode = 400;
    throw err;
  }

  const updateResult = await db.query(
    `UPDATE paper_bot_rules
     SET status = 'dismissed', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'active')`,
    [id, userId]
  );

  if (!updateResult.rowCount) {
    const err = new Error('Rule not found');
    err.statusCode = 404;
    throw err;
  }

  if (fromStatus === 'active') {
    await db.query(
      `UPDATE paper_bot_accounts
       SET policy_version = policy_version + 1, updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );
  }

  const eventType = fromStatus === 'active' ? 'rule_revoked' : 'rule_dismissed';
  const hint =
    fromStatus === 'active'
      ? 'Active rule removed — policy version bumped'
      : 'Pending rule removed';

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [
      userId,
      eventType,
      JSON.stringify({
        ruleId: id,
        fromStatus,
        ruleText: row.rule_text || null
      })
    ]
  );

  notifyPaperBotClients(userId, eventType, hint);
  return getState(userId);
}

async function dismissRule(userId, ruleId) {
  return removeRule(userId, ruleId);
}

async function removeAllPendingRules(userId) {
  const { rows } = await db.query(
    `SELECT id FROM paper_bot_rules WHERE user_id = $1 AND status = 'pending' ORDER BY id ASC`,
    [userId]
  );
  if (!rows.length) {
    return getState(userId);
  }

  const ids = rows.map((r) => r.id);
  await db.query(
    `UPDATE paper_bot_rules
     SET status = 'dismissed', updated_at = NOW()
     WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'rule_dismissed', $2)`,
    [
      userId,
      JSON.stringify({
        bulk: true,
        removedCount: ids.length,
        ruleIds: ids
      })
    ]
  );

  notifyPaperBotClients(userId, 'rule_dismissed', `Removed ${ids.length} pending rule(s)`);
  return getState(userId);
}

async function listTrustedXTraders(userId) {
  return trustedXTradersService.listTrustedTraders(userId);
}

async function addTrustedXTrader(userId, { username, label } = {}) {
  const row = await trustedXTradersService.addTrustedTrader(userId, { username, label });
  xInvestorFeedService.invalidateXPulseCache(userId);
  return row;
}

async function removeTrustedXTrader(userId, traderId) {
  const result = await trustedXTradersService.removeTrustedTrader(userId, traderId);
  xInvestorFeedService.invalidateXPulseCache(userId);
  return result;
}

module.exports = {
  DISARM_CONFIRM_PHRASE,
  getState,
  getPolicySnapshot,
  getBrainMonitor,
  runBrainReflection,
  getBotLearningLatest,
  runBotLearningCycle,
  listTrustedXTraders,
  addTrustedXTrader,
  removeTrustedXTrader,
  getAutoresearchLatest,
  promoteAutoresearchPatch,
  resetAccount,
  shadowPreview,
  getShadowOrders,
  dryRun,
  getRecentEvents,
  setKillSwitch,
  setBotRun,
  setPaperBotSettings,
  setTradeDeployListOnly,
  simulateDay,
  manualTrade,
  interpretNote,
  approveRule,
  dismissRule,
  removeRule,
  removeAllPendingRules
};
