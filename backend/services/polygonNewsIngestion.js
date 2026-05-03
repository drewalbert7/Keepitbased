const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { getWatchlistTickerJobs } = require('../utils/aggregatedWatchlistSymbols');
const { insertPolygonNewsArtifact } = require('./researchArtifactsService');

async function fetchPolygonNewsForTicker(ticker, limit) {
  const apiKey = config.POLYGON_API_KEY || config.MASSIVE_API_KEY;
  if (!apiKey) {
    throw new Error('POLYGON_API_KEY / MASSIVE_API_KEY not configured');
  }

  const url = `${config.MARKET_DATA_API_URL}/v2/reference/news`;
  const params = {
    ticker,
    limit,
    sort: 'published_utc',
    order: 'desc'
  };
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'X-Polygon-API-Key': apiKey
  };

  try {
    const { data } = await axios.get(url, { params, headers, timeout: 20000 });
    return data;
  } catch (err) {
    if (err.response?.status === 429) {
      await delay(2500);
      const { data } = await axios.get(url, { params, headers, timeout: 20000 });
      return data;
    }
    throw err;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pull Polygon reference news for **every ticker on any user watchlist** (all list names),
 * plus legacy stock alerts when lists are empty. Persists idempotently into `research_artifacts`.
 *
 * @returns {Promise<{ symbols: number, articlesFetched: number, rowsInserted: number, skipped: boolean, reason?: string }>}
 */
async function runPolygonNewsIngestionForWatchlists() {
  const apiKey = config.POLYGON_API_KEY || config.MASSIVE_API_KEY;
  if (!apiKey) {
    return { symbols: 0, articlesFetched: 0, rowsInserted: 0, skipped: true, reason: 'no_polygon_key' };
  }

  let jobs = await getWatchlistTickerJobs();
  const maxSym = config.RESEARCH_NEWS_MAX_SYMBOLS_PER_RUN;
  if (jobs.length > maxSym) {
    jobs = jobs.slice(0, maxSym);
  }

  if (jobs.length === 0) {
    return { symbols: 0, articlesFetched: 0, rowsInserted: 0, skipped: true, reason: 'no_watchlist_symbols' };
  }

  const perLimit = config.RESEARCH_NEWS_PER_SYMBOL_LIMIT;
  const gapMs = config.RESEARCH_NEWS_SYMBOL_DELAY_MS;

  let articlesFetched = 0;
  let rowsInserted = 0;

  for (const { symbol: ticker, assetType } of jobs) {
    try {
      const data = await fetchPolygonNewsForTicker(ticker, perLimit);
      const results = Array.isArray(data?.results) ? data.results : [];
      articlesFetched += results.length;

      for (const art of results) {
        const url = art.article_url || art.amp_url || null;
        const title = art.title || null;
        const published = art.published_utc || null;
        const summary =
          art.description || (typeof art.keywords === 'string' ? art.keywords : null) || title;

        const inserted = await insertPolygonNewsArtifact({
          symbol: ticker,
          assetType,
          url,
          title,
          contentSummary: summary,
          publishedAt: published,
          rawPayload: art
        });
        if (inserted) rowsInserted += 1;
      }
    } catch (err) {
      if (err.response?.status === 403) {
        logger.warn(
          'Polygon news: 403 (check plan / entitlements for /v2/reference/news). Stopping this tick.'
        );
        break;
      }
      logger.warn(`Polygon news failed for ${ticker} (${assetType}): ${err.message}`);
    }

    if (gapMs > 0) {
      await delay(gapMs);
    }
  }

  return {
    symbols: jobs.length,
    articlesFetched,
    rowsInserted,
    skipped: false
  };
}

module.exports = {
  getWatchlistTickerJobs,
  runPolygonNewsIngestionForWatchlists,
  fetchPolygonNewsForTicker
};
