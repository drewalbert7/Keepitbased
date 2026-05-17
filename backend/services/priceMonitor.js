const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { getRedisClient } = require('../utils/redis');
const db = require('../models/database');
const {
  evaluateWatchlistOpportunity,
  floorTimeBucketUtc
} = require('./watchlistOpportunityEvaluator');
const {
  mergeNotificationPreferences,
  passesOpportunityEmailTierFilter
} = require('../utils/notificationPreferences');
const {
  logOpportunityEmailEvent,
  isOpportunityQuietHours,
  isOpportunityDailyEmailCapReached,
  recordOpportunityEmailSent,
  markLegacyAlertBlocked
} = require('../utils/opportunityEmailPolicy');
const {
  registerOpportunityEmailConfirmationPoll,
  isOpportunityEmailSentThisHour,
  markOpportunityEmailSentThisHour
} = require('../utils/opportunityEmailConfirmation');
const {
  enqueuePendingOpportunityEmail,
  listPendingOpportunityUserIds,
  drainPendingOpportunityEmails
} = require('../utils/opportunityEmailPending');
const { shouldPollStockSymbolThisCycle } = require('../utils/opportunityPollCadence');
const {
  enqueueEmail,
  buildOpportunityOutboxSchedule
} = require('./emailOutboxService');
const {
  qualifiesForDipInsightTier,
  isDipInsightDailyCapReached
} = require('../utils/dipInsightEmailPolicy');
const { isUsStockRegularTradingHours } = require('../utils/researchAlertGates');
const {
  recordOpportunitySignal,
  patchOpportunitySignalAiAssessment
} = require('./opportunitySignalsPersistence');
const { fetchQuantAgiEnrichment } = require('../utils/quantAgiClient');
const emailService = require('./emailService');
const { tryDipInsightEmailOrThrow } = require('./dipInsightEmailService');
const { evaluateDipInsightFusionGate } = require('./researchFusionGate');
const { getOpportunityTechnicalBundle } = require('./dailyAtrService');
const openbbClient = require('./openbbClient');
const { resolveUsStockSnapshotTicker } = require('../utils/stockSnapshotQuote');
const { parseStockAlertSymbol, parseWatchlistToken } = require('../utils/stockMarketIdentity');
const itickClient = require('./itickClient');

class PriceMonitor {
  constructor(io) {
    this.io = io;
    this.redis = getRedisClient();
    /** Fallback when Redis SET NX fails — Map key → expiry ms */
    this.opportunityDedupeMemory = new Map();
    this.lastPrices = new Map();
    this.polygonCryptoUnavailable = false;
    this.polygonStocksUnavailable = false;
    this.coinGeckoRateLimitedUntil = 0;
    this.logCooldownMs = 5 * 60 * 1000;
    this.lastLogByKey = new Map();
    
    // Popular symbols to track by default
    this.defaultSymbols = {
      crypto: ['BTC', 'ETH'],
      stocks: []
    };
  }

  async getCryptoPrice(symbol) {
    try {
      if (config.OPENBB_ENABLED) {
        try {
          const row = await openbbClient.fetchCryptoPriceMonitorRow(symbol);
          if (row) return row;
        } catch (_e) {
          /* fall through */
        }
      }
      if (this.polygonCryptoUnavailable) {
        return this.getCryptoPriceFromBinance(symbol);
      }

      const polygonSymbol = this.toPolygonCryptoSymbol(symbol);
      const response = await this.makePolygonRequest(`/v2/snapshot/locale/global/markets/crypto/tickers/${encodeURIComponent(polygonSymbol)}`);
      const ticker = response.ticker;

      if (!ticker) {
        throw new Error(`No Polygon crypto snapshot found for ${polygonSymbol}`);
      }

      const open = Number(ticker.day?.o ?? ticker.day?.c ?? 0);
      const close = Number(ticker.day?.c ?? ticker.lastTrade?.p ?? open);
      const changePercent = open ? ((close - open) / open) * 100 : 0;

      const out = {
        symbol: symbol,
        price: close,
        change24h: changePercent,
        timestamp: Date.now(),
        type: 'crypto',
        sourceUsed: 'polygon_crypto_snapshot'
      };
      const d = ticker.day;
      if (d && typeof d === 'object') {
        const o0 = d.o != null ? Number(d.o) : NaN;
        if (Number.isFinite(o0) && o0 > 0) out.dayOpen = o0;
        const vw = d.vw != null ? Number(d.vw) : NaN;
        if (Number.isFinite(vw) && vw > 0) out.sessionVwap = vw;
        const dh = d.h != null ? Number(d.h) : NaN;
        const dl = d.l != null ? Number(d.l) : NaN;
        const dv = d.v != null ? Number(d.v) : NaN;
        if (Number.isFinite(dh)) out.dayHigh = dh;
        if (Number.isFinite(dl)) out.dayLow = dl;
        if (Number.isFinite(dv)) out.volume = dv;
      }
      const lq = ticker.lastQuote;
      if (lq && typeof lq === 'object') {
        const bid = lq.p != null ? Number(lq.p) : NaN;
        const ask = lq.P != null ? Number(lq.P) : NaN;
        if (Number.isFinite(bid) && bid > 0) out.bidPrice = bid;
        if (Number.isFinite(ask) && ask > 0) out.askPrice = ask;
      }
      return out;
    } catch (error) {
      if (error.response?.status === 403 && !this.polygonCryptoUnavailable) {
        this.polygonCryptoUnavailable = true;
        this.logWithCooldown('polygon-crypto-entitlement', 'warn', 'Polygon crypto snapshot endpoints are unavailable for this API key; using fallback providers.');
      }
      this.logWithCooldown(`polygon-crypto-failure-${symbol}`, 'warn', `Polygon crypto price fetch failed for ${symbol}; falling back to Binance.`);
      return this.getCryptoPriceFromBinance(symbol);
    }
  }
  async getCryptoPriceFromBinance(symbol) {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
        params: { symbol: `${symbol.toUpperCase()}USDT` },
        timeout: 10000
      });

      const d = response.data;
      const out = {
        symbol,
        price: Number(d.lastPrice),
        change24h: Number(d.priceChangePercent || 0),
        timestamp: Date.now(),
        type: 'crypto',
        sourceUsed: 'binance_24h'
      };
      const op = d.openPrice != null ? Number(d.openPrice) : NaN;
      if (Number.isFinite(op) && op > 0) out.dayOpen = op;
      const bp = d.bidPrice != null ? Number(d.bidPrice) : NaN;
      const ap = d.askPrice != null ? Number(d.askPrice) : NaN;
      if (Number.isFinite(bp) && bp > 0) out.bidPrice = bp;
      if (Number.isFinite(ap) && ap > 0) out.askPrice = ap;
      const hi = d.highPrice != null ? Number(d.highPrice) : NaN;
      const lo = d.lowPrice != null ? Number(d.lowPrice) : NaN;
      const vol = d.volume != null ? Number(d.volume) : NaN;
      if (Number.isFinite(hi)) out.dayHigh = hi;
      if (Number.isFinite(lo)) out.dayLow = lo;
      if (Number.isFinite(vol)) out.volume = vol;
      return out;
    } catch (error) {
      this.logWithCooldown(`binance-crypto-failure-${symbol}`, 'warn', `Binance crypto fallback failed for ${symbol}; trying CoinGecko.`);
      return this.getCryptoPriceFromCoinGecko(symbol);
    }
  }


  async getStockPrice(symbol) {
    const stockId = parseStockAlertSymbol(symbol);
    if (stockId?.market === 'TW') {
      try {
        if (!config.ITICK_TW_ENABLED || !itickClient.isConfigured()) {
          return null;
        }
        return await itickClient.fetchTaiwanStockPriceRow(stockId.code);
      } catch (e) {
        this.logWithCooldown(
          `itick-tw-failure-${stockId.code}`,
          'warn',
          `iTick Taiwan quote failed for ${stockId.alertSymbol}: ${e.message}`
        );
        return null;
      }
    }

    const usSymbol = stockId?.market === 'US' ? stockId.code : String(symbol || '').toUpperCase();

    try {
      if (config.OPENBB_ENABLED) {
        try {
          const row = await openbbClient.fetchStockPriceMonitorRow(usSymbol);
          if (row) return row;
        } catch (_e) {
          /* fall through */
        }
      }
      if (this.polygonStocksUnavailable) {
        return null;
      }

      const response = await this.makePolygonRequest(
        `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(usSymbol)}`
      );
      const resolved = resolveUsStockSnapshotTicker(response.ticker);

      if (!resolved) {
        throw new Error(`No usable Polygon stock snapshot for ${usSymbol}`);
      }

      const out = {
        symbol: usSymbol,
        price: resolved.close,
        change24h: resolved.change,
        changePercent: resolved.changePercent,
        timestamp: Date.now(),
        type: 'stock',
        sourceUsed: 'polygon_snapshot'
      };
      if (resolved.high != null) out.dayHigh = resolved.high;
      if (resolved.low != null) out.dayLow = resolved.low;
      if (Number.isFinite(resolved.volume)) out.volume = resolved.volume;
      if (resolved.prevClose != null) out.prevClose = resolved.prevClose;
      if (resolved.dayOpen != null) out.dayOpen = resolved.dayOpen;
      if (resolved.sessionVwap != null) out.sessionVwap = resolved.sessionVwap;

      const lq = resolved.lastQuote;
      if (lq && typeof lq === 'object') {
        const bidR = lq.p != null ? Number(lq.p) : lq.bid != null ? Number(lq.bid) : NaN;
        const askR = lq.P != null ? Number(lq.P) : lq.ask != null ? Number(lq.ask) : NaN;
        if (Number.isFinite(bidR) && bidR > 0) out.bidPrice = bidR;
        if (Number.isFinite(askR) && askR > 0) out.askPrice = askR;
      }

      return out;
    } catch (error) {
      if (error.response?.status === 403 && !this.polygonStocksUnavailable) {
        this.polygonStocksUnavailable = true;
        this.logWithCooldown('polygon-stock-entitlement', 'warn', 'Polygon stock snapshot endpoints are unavailable for this API key.');
      }
      this.logWithCooldown(
        `polygon-stock-failure-${usSymbol}`,
        'warn',
        `Polygon stock price fetch failed for ${usSymbol}.`
      );
      return null;
    }
  }

  async getCryptoPriceFromCoinGecko(symbol) {
    try {
      if (Date.now() < this.coinGeckoRateLimitedUntil) {
        return this.getLastKnownPrice('crypto', symbol);
      }

      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: this.getCoinGeckoId(symbol),
          vs_currencies: 'usd',
          include_24hr_change: true
        },
        timeout: 10000
      });

      const coinId = this.getCoinGeckoId(symbol);
      const data = response.data[coinId];
      if (!data) {
        throw new Error(`No CoinGecko data found for ${symbol}`);
      }

      return {
        symbol,
        price: Number(data.usd),
        change24h: Number(data.usd_24h_change || 0),
        timestamp: Date.now(),
        type: 'crypto'
      };
    } catch (error) {
      if (error.response?.status === 429) {
        this.coinGeckoRateLimitedUntil = Date.now() + 60 * 1000;
        this.logWithCooldown('coingecko-rate-limit', 'warn', 'CoinGecko rate-limited. Using cached crypto prices for 60s.');
        return this.getLastKnownPrice('crypto', symbol);
      }
      this.logWithCooldown(`coingecko-failure-${symbol}`, 'error', `CoinGecko fallback failed for ${symbol}.`);
      return null;
    }
  }

  async makePolygonRequest(path, params = {}) {
    const apiKey = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY;
    if (!apiKey) {
      throw new Error('POLYGON_API_KEY is not configured');
    }

    const response = await axios.get(`${config.MARKET_DATA_API_URL}${path}`, {
      params: {
        ...params,
        apiKey
      },
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Polygon-API-Key': apiKey
      },
      timeout: 10000
    });

    return response.data;
  }

  toPolygonCryptoSymbol(symbol) {
    return `X:${symbol.toUpperCase()}USD`;
  }

  getLastKnownPrice(type, symbol) {
    const key = `${type}:${symbol}`;
    return this.lastPrices.get(key) || null;
  }

  logWithCooldown(key, level, message) {
    const last = this.lastLogByKey.get(key) || 0;
    if (Date.now() - last < this.logCooldownMs) {
      return;
    }
    this.lastLogByKey.set(key, Date.now());
    logger[level](message);
  }

  getCoinGeckoId(symbol) {
    const coinMap = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      ADA: 'cardano',
      DOT: 'polkadot',
      SOL: 'solana',
      MATIC: 'matic-network',
      LINK: 'chainlink',
      UNI: 'uniswap'
    };
    return coinMap[symbol] || symbol.toLowerCase();
  }

  async checkAllPrices() {
    logger.info('Starting price check cycle...');

    try {
      await this.flushPendingOpportunityEmails();
    } catch (flushErr) {
      logger.warn(`Pending opportunity email flush skipped: ${flushErr.message}`);
    }

    try {
      // Get user watchlists from database
      const watchlists = await this.getUserWatchlists();
      const allSymbols = new Set();
      
      // Collect all symbols from user watchlists
      watchlists.forEach(watchlist => {
        watchlist.symbols.forEach(symbol => allSymbols.add(symbol));
      });
      
      // Add default symbols if no user symbols
      if (allSymbols.size === 0) {
        this.defaultSymbols.crypto.forEach(symbol => allSymbols.add(`CRYPTO:${symbol}`));
        this.defaultSymbols.stocks.forEach(symbol => allSymbols.add(`STOCK:${symbol}`));
      }
      
      const pricePromises = [];
      
      for (const symbolWithType of allSymbols) {
        const parsed = parseWatchlistToken(symbolWithType);
        if (!parsed) {
          this.logWithCooldown(
            `unknown-watchlist-token-${symbolWithType}`,
            'warn',
            `Skipping watchlist price token: ${symbolWithType}`
          );
          continue;
        }

        if (parsed.assetType === 'crypto') {
          pricePromises.push(this.getCryptoPrice(parsed.symbol));
          continue;
        }

        if (parsed.assetType === 'stock') {
          const twStock = parsed.market === 'TW';
          if (
            twStock ||
            shouldPollStockSymbolThisCycle(new Date(), config.OPPORTUNITY_STOCK_OFFHOURS_POLL_MIN)
          ) {
            pricePromises.push(this.getStockPrice(parsed.alertSymbol));
          }
        }
      }
      
      const results = await Promise.allSettled(pricePromises);
      const prices = [];

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const priceData = result.value;
          prices.push(priceData);

          // Store in Redis for caching (await — fire-and-forget was dropping writes under load)
          try {
            await this.redis.setEx(
              `price:${String(priceData.type).toLowerCase()}:${String(priceData.symbol).toUpperCase()}`,
              300,
              JSON.stringify(priceData)
            );
          } catch (redisErr) {
            logger.warn(`Redis setEx failed for ${priceData.type}:${priceData.symbol}: ${redisErr.message}`);
          }

          this.checkPriceDrops(priceData);
          try {
            await this.emitWatchlistOpportunitySignals(priceData);
          } catch (oppErr) {
            logger.warn(`Opportunity signals skipped: ${oppErr.message}`);
          }
        }
      }
      
      // Emit prices to connected clients
      this.io.to('price-updates').emit('priceUpdate', prices);
      
      logger.info(`Price check completed: ${prices.length} symbols updated`);
      return prices;
      
    } catch (error) {
      logger.error('Error in checkAllPrices:', error);
      return [];
    }
  }

  async checkPriceDrops(currentPrice) {
    const key = `${currentPrice.type}:${currentPrice.symbol}`;
    const lastPrice = this.lastPrices.get(key);
    
    if (lastPrice && lastPrice.price > currentPrice.price) {
      const dropPercentage = ((lastPrice.price - currentPrice.price) / lastPrice.price) * 100;
      
      if (dropPercentage >= 5) { // Minimum 5% drop
        logger.info(`Price drop detected: ${key} dropped ${dropPercentage.toFixed(2)}%`);
        
        // Emit price drop event
        this.io.emit('priceDrop', {
          symbol: currentPrice.symbol,
          type: currentPrice.type,
          currentPrice: currentPrice.price,
          previousPrice: lastPrice.price,
          dropPercentage: dropPercentage,
          timestamp: currentPrice.timestamp
        });
      }
    }
    
    this.lastPrices.set(key, currentPrice);
  }

  /**
   * Deterministic opportunity flags vs alert baseline_price; Redis dedupe per user/symbol/hour bucket.
   */
  async emitWatchlistOpportunitySignals(priceData) {
    const assetType = priceData.type === 'stock' ? 'stock' : 'crypto';
    const symbol = String(priceData.symbol || '').toUpperCase();
    if (!symbol) return;

    const dayChangePct =
      assetType === 'stock'
        ? Number(priceData.changePercent)
        : Number(priceData.change24h);

    let rows;
    try {
      const result = await db.query(
        `SELECT ua.user_id, ua.baseline_price, u.notification_preferences, u.email
         FROM user_alerts ua
         INNER JOIN users u ON u.id = ua.user_id
         WHERE ua.active = true
           AND UPPER(TRIM(ua.symbol)) = $1
           AND ua.asset_type = $2
           AND ua.baseline_price IS NOT NULL`,
        [symbol, assetType]
      );
      rows = result.rows;
    } catch (err) {
      logger.error('emitWatchlistOpportunitySignals query failed:', err);
      return;
    }

    if (!rows.length) return;

    let tech = { atr14: null, atr50: null, week52High: null, athHigh: null };
    if (config.POLYGON_API_KEY || config.MASSIVE_API_KEY) {
      try {
        tech = await getOpportunityTechnicalBundle(symbol, assetType, this.redis);
      } catch (e) {
        logger.warn(`Opportunity technical bundle skipped for ${assetType}:${symbol}: ${e.message}`);
      }
    }

    const evalInputBase = {
      symbol,
      assetType,
      price: priceData.price,
      dayChangePct: Number.isFinite(dayChangePct) ? dayChangePct : null,
      recentAbsAvgMovePct: null,
      /** Short tiers use this only when OPPORTUNITY_TRIGGER_MODE=atr; capitulation tier always can use ATR + structure. */
      atr14: tech.atr14,
      atr50: tech.atr50,
      week52High: tech.week52High,
      athHigh: tech.athHigh,
      smaTrend: tech.smaTrend
    };

    for (const row of rows) {
      const baselinePrice = Number(row.baseline_price);
      const fullEval = evaluateWatchlistOpportunity({
        ...evalInputBase,
        baselinePrice
      });

      if (!fullEval.evaluated || !fullEval.flags.length) continue;

      const prefs = mergeNotificationPreferences(row.notification_preferences);
      const passesEmailTierEarly = passesOpportunityEmailTierFilter(
        fullEval.flags,
        prefs.opportunityEmailNotifyLevel
      );
      const emailChannelReady =
        prefs.email !== false &&
        prefs.opportunityEmail !== false &&
        row.email &&
        emailService.isConfigured();

      if (passesEmailTierEarly && emailChannelReady && config.OPPORTUNITY_EMAIL_CONFIRM_ENABLED) {
        await registerOpportunityEmailConfirmationPoll(this.redis, row.user_id, assetType, symbol, {
          requiredHits: config.OPPORTUNITY_EMAIL_CONFIRM_HITS,
          windowPolls: config.OPPORTUNITY_EMAIL_CONFIRM_POLLS
        });
      }

      const hasCap = fullEval.flags.includes('capitulation');
      const hasShort =
        fullEval.flags.includes('on_sale') || fullEval.flags.includes('overreaction');

      const shortBucket = floorTimeBucketUtc(new Date(), 60);
      const shortKey = `oppdedupe:${row.user_id}:${assetType}:${symbol}:${shortBucket}`;
      const capBucket = floorTimeBucketUtc(new Date(), 24 * 60);
      const capKey = `oppdedupe:cap:${row.user_id}:${assetType}:${symbol}:${capBucket}`;

      const shortOk =
        !hasShort ||
        (await this.tryOpportunityDedupeWithTtl(
          shortKey,
          config.OPPORTUNITY_DEDUPE_TTL_SEC
        ));
      const capOk =
        !hasCap ||
        (await this.tryOpportunityDedupeWithTtl(
          capKey,
          config.OPPORTUNITY_CAPITULATION_DEDUPE_TTL_SEC
        ));

      if (!shortOk && !capOk) continue;

      let evalResult = fullEval;
      if (!shortOk && hasShort && capOk && hasCap) {
        evalResult = evaluateWatchlistOpportunity(
          { ...evalInputBase, baselinePrice },
          { skipShortTiers: true }
        );
      } else if (!capOk && hasCap && shortOk && hasShort) {
        evalResult = evaluateWatchlistOpportunity(
          { ...evalInputBase, baselinePrice },
          { skipCapitulation: true }
        );
      } else if (!shortOk && hasShort && (!hasCap || !capOk)) {
        continue;
      } else if (!capOk && hasCap && (!hasShort || !shortOk)) {
        continue;
      }

      if (!evalResult.evaluated || !evalResult.flags.length) continue;

      const signalId = await recordOpportunitySignal({
        userId: row.user_id,
        symbol,
        assetType,
        flags: evalResult.flags,
        reasons: evalResult.reasons,
        vsBaselinePct: evalResult.vsBaselinePct,
        price: priceData.price
      });

      let quantAgiEnrichment = null;
      if (config.QUANT_AGI_ENHANCE_URL && Number.isFinite(baselinePrice)) {
        quantAgiEnrichment = await fetchQuantAgiEnrichment({
          symbol,
          baselinePrice,
          alertId: signalId != null ? String(signalId) : undefined,
          message:
            `deterministic_flags=${evalResult.flags.join(',')} vs_baseline_pct=${evalResult.vsBaselinePct ?? ''}`,
          assetType
        });
      }
      if (signalId != null && quantAgiEnrichment) {
        await patchOpportunitySignalAiAssessment(row.user_id, signalId, { quant_agi: quantAgiEnrichment });
      }

      const payload = {
        kind: 'opportunity_signal',
        symbol,
        assetType,
        flags: evalResult.flags,
        reasons: evalResult.reasons,
        vsBaselinePct: evalResult.vsBaselinePct,
        price: priceData.price,
        timestamp: new Date().toISOString(),
        ...(quantAgiEnrichment ? { quantAgi: quantAgiEnrichment } : {})
      };

      const notifyLevel = prefs.opportunityNotifyLevel === 'overreaction_only' ? 'overreaction_only' : 'all';
      const passesNotifyFilters =
        notifyLevel === 'all' ||
        (Array.isArray(evalResult.flags) &&
          (evalResult.flags.includes('overreaction') ||
            evalResult.flags.includes('capitulation')));

      const passesEmailTier = passesOpportunityEmailTierFilter(
        evalResult.flags,
        prefs.opportunityEmailNotifyLevel
      );

      const stockOutsideRth =
        assetType === 'stock' &&
        prefs.opportunityStockMarketHoursOnly !== false &&
        !isUsStockRegularTradingHours(new Date());

      const passesToastOutbound = passesNotifyFilters && !stockOutsideRth;
      const passesEmailOutbound = passesEmailTier && !stockOutsideRth;

      if (prefs.opportunityToasts && passesToastOutbound) {
        this.io.to(`user_${row.user_id}`).emit('opportunitySignal', payload);
      }

      const wantOppEmail =
        passesEmailOutbound &&
        prefs.email !== false &&
        prefs.opportunityEmail !== false &&
        row.email &&
        emailService.isConfigured();

      const morningBatchEligible =
        stockOutsideRth &&
        config.OPPORTUNITY_EMAIL_MORNING_BATCH_ENABLED &&
        passesEmailTier &&
        emailChannelReady;

      if (morningBatchEligible) {
        const queued = await enqueuePendingOpportunityEmail(this.redis, row.user_id, {
          userId: row.user_id,
          symbol,
          assetType,
          email: row.email,
          notification_preferences: row.notification_preferences,
          payload,
          evalResult,
          dayChangePct: Number.isFinite(dayChangePct) ? dayChangePct : null,
          signalId,
          tech,
          priceData,
          queuedAt: new Date().toISOString()
        });
        if (queued) {
          logOpportunityEmailEvent({
            action: 'suppressed',
            reason: 'morning_batch_queued',
            userId: row.user_id,
            symbol,
            assetType,
            flags: evalResult.flags
          });
        }
      } else if (wantOppEmail) {
        await this.trySendOpportunityEmail({
          row,
          email: row.email,
          payload,
          prefs,
          priceData,
          evalResult,
          dayChangePct,
          assetType,
          symbol,
          signalId,
          tech,
          skipConfirmation: false
        });
      } else if (passesEmailTier && emailChannelReady && stockOutsideRth && !morningBatchEligible) {
        logOpportunityEmailEvent({
          action: 'suppressed',
          reason: 'stock_outside_rth',
          userId: row.user_id,
          symbol,
          assetType,
          flags: evalResult.flags
        });
      }

      logger.info(
        `Opportunity signal [${evalResult.flags.join(',')}] → user ${row.user_id} ${assetType}:${symbol}` +
          (prefs.opportunityToasts && passesToastOutbound ? '' : ' (toast muted)') +
          (passesNotifyFilters ? '' : ' (toast tier filtered)') +
          (passesEmailTier ? '' : ' (email tier filtered)') +
          (stockOutsideRth ? ' (stock outside RTH)' : '')
      );
    }
  }

  /**
   * @param {object} ctx
   * @param {boolean} [ctx.skipConfirmation]
   */
  async trySendOpportunityEmail(ctx) {
    const {
      row,
      email,
      payload,
      prefs,
      priceData,
      evalResult,
      dayChangePct,
      assetType,
      symbol,
      signalId,
      tech,
      skipConfirmation = false
    } = ctx;

    const skipConfirmTier =
      config.OPPORTUNITY_EMAIL_CONFIRM_SKIP_CAPITULATION &&
      Array.isArray(evalResult.flags) &&
      evalResult.flags.includes('capitulation');

    if (
      !skipConfirmation &&
      config.OPPORTUNITY_EMAIL_CONFIRM_ENABLED &&
      !skipConfirmTier
    ) {
      const confirmation = await registerOpportunityEmailConfirmationPoll(
        this.redis,
        row.user_id,
        assetType,
        symbol,
        {
          requiredHits: config.OPPORTUNITY_EMAIL_CONFIRM_HITS,
          windowPolls: config.OPPORTUNITY_EMAIL_CONFIRM_POLLS
        }
      );
      if (!confirmation.confirmed) {
        logOpportunityEmailEvent({
          action: 'suppressed',
          reason: 'awaiting_confirmation',
          userId: row.user_id,
          symbol,
          assetType,
          flags: evalResult.flags,
          hits: confirmation.hits,
          required: confirmation.required
        });
        return;
      }
    }

    if (await isOpportunityEmailSentThisHour(this.redis, row.user_id, assetType, symbol)) {
      logOpportunityEmailEvent({
        action: 'suppressed',
        reason: 'email_already_sent_this_hour',
        userId: row.user_id,
        symbol,
        assetType,
        flags: evalResult.flags
      });
      return;
    }

    const suppressReason = await this.getOpportunityEmailSuppressReason(row.user_id, prefs);
    if (suppressReason) {
      logOpportunityEmailEvent({
        action: 'suppressed',
        reason: suppressReason,
        userId: row.user_id,
        symbol,
        assetType,
        flags: evalResult.flags
      });
      return;
    }

    const deliveryMode =
      prefs.opportunityEmailDeliveryMode === 'hourly_digest' ? 'hourly_digest' : 'instant';
    const schedule = buildOpportunityOutboxSchedule(deliveryMode, row.user_id);

    if (config.ENABLE_EMAIL_OUTBOX) {
      const q = await enqueueEmail({
        userId: row.user_id,
        toEmail: email,
        messageType: 'opportunity_signal',
        payload: {
          opportunity: payload,
          deliverCtx: {
            notification_preferences: row.notification_preferences,
            prefs,
            priceData,
            evalResult,
            dayChangePct,
            assetType,
            symbol,
            signalId,
            tech,
            payload
          }
        },
        batchKey: schedule.batchKey,
        scheduledFor: schedule.scheduledFor
      });
      logOpportunityEmailEvent({
        action: q.enqueued ? 'queued' : 'queue_failed',
        userId: row.user_id,
        symbol,
        assetType,
        flags: evalResult.flags,
        deliveryMode,
        outboxId: q.id
      });
      return;
    }

    await this.deliverOpportunityEmail({
      row,
      email,
      payload,
      prefs,
      priceData,
      evalResult,
      dayChangePct,
      assetType,
      symbol,
      signalId,
      tech
    });
    await markOpportunityEmailSentThisHour(
      this.redis,
      row.user_id,
      assetType,
      symbol,
      config.OPPORTUNITY_DEDUPE_TTL_SEC
    );
    await recordOpportunityEmailSent(this.redis, row.user_id);
    await markLegacyAlertBlocked(this.redis, row.user_id, assetType, symbol);
    logOpportunityEmailEvent({
      action: 'sent',
      userId: row.user_id,
      symbol,
      assetType,
      flags: evalResult.flags
    });
  }

  /**
   * Send queued stock opportunity emails at US RTH open (morning batch).
   */
  async flushPendingOpportunityEmails() {
    if (!config.OPPORTUNITY_EMAIL_MORNING_BATCH_ENABLED) return;
    if (!isUsStockRegularTradingHours(new Date())) return;

    const userIds = await listPendingOpportunityUserIds(this.redis);
    if (!userIds.length) return;

    logger.info(`Flushing pending opportunity emails for ${userIds.length} user(s)`);

    for (const userId of userIds) {
      const items = await drainPendingOpportunityEmails(this.redis, userId);
      for (const item of items) {
        if (!item?.email || !item?.payload || !item?.evalResult) continue;
        const prefs = mergeNotificationPreferences(item.notification_preferences);
        if (
          !passesOpportunityEmailTierFilter(
            item.evalResult.flags,
            prefs.opportunityEmailNotifyLevel
          )
        ) {
          continue;
        }
        await this.trySendOpportunityEmail({
          row: { user_id: userId, notification_preferences: item.notification_preferences },
          email: item.email,
          payload: item.payload,
          prefs,
          priceData: item.priceData,
          evalResult: item.evalResult,
          dayChangePct: item.dayChangePct,
          assetType: item.assetType,
          symbol: item.symbol,
          signalId: item.signalId,
          tech: item.tech || {},
          skipConfirmation: true
        });
      }
    }
  }

  /**
   * @returns {Promise<string|null>} suppress reason or null if send allowed
   */
  async getOpportunityEmailSuppressReason(userId, prefs) {
    if (isOpportunityQuietHours(prefs)) {
      return 'quiet_hours';
    }
    const capReached = await isOpportunityDailyEmailCapReached(
      this.redis,
      userId,
      prefs.opportunityMaxEmailsPerDay
    );
    if (capReached) {
      return 'daily_cap_reached';
    }
    return null;
  }

  async deliverOpportunityEmail(ctx) {
    const {
      row,
      email,
      payload,
      prefs,
      priceData,
      evalResult,
      dayChangePct,
      assetType,
      symbol,
      signalId,
      tech
    } = ctx;

    const insightBaseEnabled =
      config.ENABLE_DIP_INSIGHT_EMAIL &&
      !config.DISABLE_DIP_INSIGHT_EMAIL &&
      prefs.dipInsightEmail &&
      prefs.opportunityEmailDeliveryMode !== 'hourly_digest';

    let runInsight = insightBaseEnabled;

    if (runInsight && config.DIP_INSIGHT_REQUIRE_OVERREACTION_TIER) {
      if (!qualifiesForDipInsightTier(evalResult.flags)) {
        logger.info(
          `Dip insight skipped (tier): user ${row.user_id} ${assetType}:${symbol} flags=${evalResult.flags.join(',')}`
        );
        runInsight = false;
      }
    }

    if (runInsight) {
      const dipCap = await isDipInsightDailyCapReached(
        this.redis,
        row.user_id,
        prefs.dipInsightMaxEmailsPerDay
      );
      if (dipCap) {
        logger.info(`Dip insight skipped (daily cap): user ${row.user_id} ${assetType}:${symbol}`);
        runInsight = false;
      }
    }

    if (runInsight) {
      const fusion = await evaluateDipInsightFusionGate(prefs, evalResult, symbol);
      runInsight = fusion.allowDipInsight;
      if (prefs.researchDigestEmail && !fusion.allowDipInsight) {
        logger.info(
          `Dip insight skipped (research fusion): user ${row.user_id} ${assetType}:${symbol} artifacts=${fusion.artifactCount} reasons=${fusion.fusionReasons.join(',')}`
        );
      }
    }

    const dipInsightCtx = {
      userId: row.user_id,
      email,
      row,
      priceData,
      evalResult,
      dayChangePct: Number.isFinite(dayChangePct) ? dayChangePct : null,
      assetType,
      symbol,
      prefs,
      signalId,
      tech
    };

    if (runInsight && config.DIP_INSIGHT_ASYNC_VIA_OUTBOX && config.ENABLE_EMAIL_OUTBOX) {
      const q = await enqueueEmail({
        userId: row.user_id,
        toEmail: email,
        messageType: 'opportunity_dip_insight',
        payload: { deliverCtx: dipInsightCtx },
        batchKey: null,
        scheduledFor: new Date()
      });
      logOpportunityEmailEvent({
        action: q.enqueued ? 'queued' : 'queue_failed',
        reason: 'dip_insight_async',
        userId: row.user_id,
        symbol,
        assetType,
        flags: evalResult.flags,
        outboxId: q.id
      });
      return;
    }

    if (runInsight) {
      try {
        await tryDipInsightEmailOrThrow(dipInsightCtx);
      } catch (insightErr) {
        logger.warn(
          `Dip insight email failed for user ${row.user_id} ${assetType}:${symbol}, sending plain opportunity email: ${insightErr?.message || insightErr}`
        );
        await emailService.sendOpportunitySignalEmail(email, payload);
      }
    } else {
      await emailService.sendOpportunitySignalEmail(email, payload);
    }
  }

  async tryOpportunityDedupe(redisKey) {
    return this.tryOpportunityDedupeWithTtl(redisKey, config.OPPORTUNITY_DEDUPE_TTL_SEC);
  }

  /**
   * @param {string} redisKey
   * @param {number} ttlSec
   */
  async tryOpportunityDedupeWithTtl(redisKey, ttlSec) {
    const ex = Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : config.OPPORTUNITY_DEDUPE_TTL_SEC;
    try {
      const setResult = await this.redis.set(redisKey, '1', {
        NX: true,
        EX: ex
      });
      return setResult === 'OK';
    } catch {
      const now = Date.now();
      const ttlMs = ex * 1000;
      const until = this.opportunityDedupeMemory.get(redisKey);
      if (until && until > now) return false;
      this.opportunityDedupeMemory.set(redisKey, now + ttlMs);
      return true;
    }
  }

  async getUserWatchlists() {
    try {
      const result = await db.query(`
        SELECT symbols FROM user_watchlists WHERE name = 'Main'
      `);

      const allSymbols = new Set();
      for (const row of result.rows) {
        const raw = row.symbols;
        const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? JSON.parse(raw || '[]') : [];
        for (const t of arr) {
          if (typeof t === 'string' && t.includes(':')) {
            allSymbols.add(t);
          }
        }
      }

      if (allSymbols.size > 0) {
        return [{ symbols: [...allSymbols] }];
      }

      const legacy = await db.query(`
        SELECT DISTINCT symbol, asset_type
        FROM user_alerts
        WHERE active = true
      `);
      const symbols = legacy.rows.map((row) => `${row.asset_type.toUpperCase()}:${row.symbol}`);
      return [{ symbols }];
    } catch (error) {
      logger.error('Error getting user watchlists:', error);
      return [];
    }
  }

  async getCachedPrice(type, symbol) {
    try {
      const cached = await this.redis.get(
        `price:${String(type).toLowerCase()}:${String(symbol).toUpperCase()}`
      );
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error(`Error getting cached price for ${type}:${symbol}:`, error);
      return null;
    }
  }
}

module.exports = PriceMonitor;