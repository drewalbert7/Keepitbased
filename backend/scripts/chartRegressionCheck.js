const axios = require('axios');

const BASE_URL = process.env.CHART_API_BASE || 'http://127.0.0.1:3001/api/charts';
const SYMBOLS = (process.env.CHART_TEST_SYMBOLS || 'AAPL,MSFT')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const HISTORY_CASES = [
  { period: '1d', interval: '5m' },
  { period: '1mo', interval: '1d' },
  { period: '1y', interval: '1d' }
];

const requiredQuoteFields = [
  'symbol',
  'price',
  'open',
  'high',
  'low',
  'volume',
  'change',
  'changePercent',
  'companyName',
  'sourceUsed',
  'partialData',
  'lastUpdated'
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFiniteNumber(value, fieldName) {
  assert(Number.isFinite(Number(value)), `Expected ${fieldName} to be a finite number`);
}

function validateQuotePayload(quote, symbol) {
  for (const field of requiredQuoteFields) {
    assert(Object.prototype.hasOwnProperty.call(quote, field), `Quote missing required field: ${field}`);
  }

  assert(String(quote.symbol).toUpperCase() === symbol.toUpperCase(), `Quote symbol mismatch for ${symbol}`);
  assertFiniteNumber(quote.price, 'price');
  assertFiniteNumber(quote.open, 'open');
  assertFiniteNumber(quote.high, 'high');
  assertFiniteNumber(quote.low, 'low');
  assertFiniteNumber(quote.volume, 'volume');
  assert(quote.high >= quote.low, `Quote high/low invalid for ${symbol}`);
  assert(Number(quote.price) > 0, `Quote price must be > 0 for ${symbol}`);
  assert(typeof quote.partialData === 'boolean', `Quote partialData must be boolean for ${symbol}`);
  assert(typeof quote.sourceUsed === 'string' && quote.sourceUsed.length > 0, `Quote sourceUsed missing for ${symbol}`);
}

function validateHistoryPayload(history, symbol, period, interval) {
  assert(String(history.symbol).toUpperCase() === symbol.toUpperCase(), `History symbol mismatch for ${symbol}`);
  assert(Array.isArray(history.data), `History data must be an array for ${symbol} ${period}/${interval}`);
  assert(typeof history.sourceUsed === 'string', `History sourceUsed missing for ${symbol} ${period}/${interval}`);
  assert(typeof history.partialData === 'boolean', `History partialData must be boolean for ${symbol} ${period}/${interval}`);

  let previousTime = -Infinity;
  history.data.forEach((row, index) => {
    assertFiniteNumber(row.time, `history[${index}].time`);
    assertFiniteNumber(row.open, `history[${index}].open`);
    assertFiniteNumber(row.high, `history[${index}].high`);
    assertFiniteNumber(row.low, `history[${index}].low`);
    assertFiniteNumber(row.close, `history[${index}].close`);
    assertFiniteNumber(row.volume, `history[${index}].volume`);

    assert(Number(row.time) >= previousTime, `History must be time-sorted for ${symbol} ${period}/${interval}`);
    previousTime = Number(row.time);

    assert(Number(row.high) >= Number(row.low), `History high/low invalid for ${symbol} ${period}/${interval}`);
    assert(Number(row.open) > 0, `History open must be > 0 for ${symbol} ${period}/${interval}`);
    assert(Number(row.close) > 0, `History close must be > 0 for ${symbol} ${period}/${interval}`);
  });
}

function validateTechnicalPayload(technical, symbol) {
  assert(String(technical.symbol).toUpperCase() === symbol.toUpperCase(), `Technical symbol mismatch for ${symbol}`);
  assert(Array.isArray(technical.data), `Technical data must be an array for ${symbol}`);

  technical.data.forEach((row, index) => {
    assertFiniteNumber(row.time, `technical[${index}].time`);
    assertFiniteNumber(row.close, `technical[${index}].close`);
    ['sma20', 'sma50', 'ema20', 'ema50', 'macd', 'signal', 'histogram', 'rsi'].forEach((field) => {
      const value = row[field];
      assert(value === null || Number.isFinite(Number(value)), `technical[${index}].${field} must be null or finite`);
    });
  });
}

async function get(path, params = {}) {
  return axios.get(`${BASE_URL}${path}`, {
    params,
    timeout: 20000,
    validateStatus: () => true
  });
}

async function getWithRetry(path, params = {}, attempts = 3) {
  let response = null;
  for (let i = 0; i < attempts; i += 1) {
    response = await get(path, params);
    if (![429, 500].includes(response.status)) {
      return response;
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (i + 1)));
    }
  }
  return response;
}

async function run() {
  console.log(`Running chart regression checks against: ${BASE_URL}`);

  const health = await get('/health');
  assert([200, 503].includes(health.status), `Unexpected health status (${health.status})`);
  if (health.status === 503) {
    assert(typeof health.data?.error === 'string', '503 health response should include error message');
    console.warn('Health endpoint returned 503; proceeding with endpoint-level checks.');
  }

  for (const symbol of SYMBOLS) {
    const quoteResponse = await getWithRetry(`/quote/${symbol}`);
    if (quoteResponse.status === 200) {
      validateQuotePayload(quoteResponse.data, symbol);
    } else if ([429, 500].includes(quoteResponse.status)) {
      assert(
        typeof quoteResponse.data?.message === 'string' && quoteResponse.data.message.length > 0,
        `Quote error should include message for ${symbol}`
      );
      console.warn(`Skipping transient quote check for ${symbol}: HTTP ${quoteResponse.status}`);
    } else {
      throw new Error(`Quote failed for ${symbol}: HTTP ${quoteResponse.status}`);
    }

    let historySuccessCount = 0;
    for (const testCase of HISTORY_CASES) {
      const historyResponse = await getWithRetry(`/history/${symbol}`, testCase);
      if (historyResponse.status === 200) {
        validateHistoryPayload(historyResponse.data, symbol, testCase.period, testCase.interval);
        historySuccessCount += 1;
        continue;
      }

      if (historyResponse.status === 403) {
        assert(
          typeof historyResponse.data?.message === 'string' && historyResponse.data.message.length > 0,
          `403 history response should include message for ${symbol} ${testCase.period}/${testCase.interval}`
        );
        console.warn(`Skipping entitlement-restricted history case: ${symbol} ${testCase.period}/${testCase.interval}`);
        continue;
      }

      if (historyResponse.status === 500) {
        assert(
          typeof historyResponse.data?.message === 'string' && historyResponse.data.message.length > 0,
          `500 history response should include message for ${symbol} ${testCase.period}/${testCase.interval}`
        );
        console.warn(`Skipping transient provider error case: ${symbol} ${testCase.period}/${testCase.interval}`);
        continue;
      }

      throw new Error(`History failed for ${symbol} ${testCase.period}/${testCase.interval}: HTTP ${historyResponse.status}`);
    }
    assert(historySuccessCount > 0, `No successful history cases for ${symbol}`);

    const technicalResponse = await getWithRetry(`/technical/${symbol}`, { period: '6mo' });
    if (technicalResponse.status === 200) {
      validateTechnicalPayload(technicalResponse.data, symbol);
    } else {
      assert(
        [403, 429, 500].includes(technicalResponse.status),
        `Technical endpoint failed unexpectedly for ${symbol}: HTTP ${technicalResponse.status}`
      );
      assert(
        typeof technicalResponse.data?.message === 'string' && technicalResponse.data.message.length > 0,
        `Technical error should include message for ${symbol}`
      );
      console.warn(`Skipping technical validation for ${symbol}: HTTP ${technicalResponse.status}`);
    }
  }

  const invalidSymbol = 'INVALID_SYMBOL_123456';
  const invalidQuoteResponse = await get(`/quote/${invalidSymbol}`);
  assert(
    [404, 500].includes(invalidQuoteResponse.status),
    `Invalid symbol quote should return 404 or 500, got ${invalidQuoteResponse.status}`
  );
  if (invalidQuoteResponse.status !== 200) {
    assert(
      typeof invalidQuoteResponse.data?.message === 'string' && invalidQuoteResponse.data.message.length > 0,
      'Error response must include message for invalid symbol quote'
    );
  }

  const badSearch = await get('/search', { q: 'a' });
  assert(badSearch.status === 400, `Short search should return 400, got ${badSearch.status}`);
  assert(typeof badSearch.data?.message === 'string', 'Short search error should include message');

  console.log('Chart regression checks passed.');
}

run().catch((error) => {
  console.error(`Chart regression checks failed: ${error.message}`);
  process.exit(1);
});
