# OpenBB Platform sidecar

This folder runs the [OpenBB](https://github.com/OpenBB-finance/OpenBB) **Open Data Platform** REST API so KeepItBased can route **stocks and crypto** chart/quote/ATR flows through one hub while you attach **provider keys** where needed (Polygon/Massive on equity; `openbb-yfinance` for crypto OHLC by default).

The Node API calls OpenBB **when** `OPENBB_ENABLED=true`. **Direct Polygon/Binance/CoinGecko code remains** and is used when OpenBB is disabled, returns no rows, or exclusivity flags are off—so you can compare or fail over.

## License

OpenBB core is distributed under **AGPL-3.0**. Understand your obligations before shipping a networked product built on AGPL components. Links: repository [OpenBB-finance/OpenBB](https://github.com/OpenBB-finance/OpenBB), docs [openbb-api](https://docs.openbb.co/odp/python/extensions/interface/openbb-api).

## Python

Use **Python 3.10–3.14** (per OpenBB docs).

## First run

```bash
cd openbb-service
export POLYGON_API_KEY="your_polygon_or_massive_key"   # same value you use for Node MARKET_DATA
chmod +x start.sh
./start.sh
```

- API (with extensions installed): default `http://127.0.0.1:6900`
- Explore routes: `/docs` or `/openapi.json`

Keys are synced into `~/.openbb_platform/.env` on start (override with `OPENBB_SETTINGS_DIR`). See OpenBB credential docs for [environment variables](https://docs.openbb.co/odp/python/settings/environment_variables) and [user settings](https://docs.openbb.co/odp/python/settings/user_settings/api_keys).

## Stock quotes: OpenBB-only trial (KeepItBased Node)

Leave **Polygon/Massive direct** code paths in place; toggle behavior with env on the Node API:

| Env | Behavior |
| --- | -------- |
| `OPENBB_ENABLED=true` | **OpenBB-first** for equity: `/api/charts/quote`, `/api/charts/history`, `/api/charts/technical`; opportunity ATR bundle (`dailyAtrService`); crypto: `/api/crypto/ticker/:pair`, `/api/crypto/ohlc/:pair`; **`priceMonitor`** snapshots when OpenBB responds. |
| `OPENBB_CRYPTO_PROVIDER` | Default `yfinance` (install `openbb-yfinance` in this venv). |
| `OPENBB_STOCK_QUOTE_EXCLUSIVE` | Stock **quote** OpenBB-only (see prior). Aliases: `OPENBB_EXCLUSIVE=true` or `OPENBB_EXCLUSIVE_ALL=true`. |
| `OPENBB_STOCK_HISTORY_EXCLUSIVE` | Stock **history + technical** OpenBB-only after cache miss (else 503). Included in `OPENBB_EXCLUSIVE_ALL`. |
| `OPENBB_CRYPTO_EXCLUSIVE` | Crypto ticker + OHLC OpenBB-only after OpenBB misses (else 503). Included in `OPENBB_EXCLUSIVE_ALL`. |
| `OPENBB_EXCLUSIVE_ALL=true` | All of the above exclusives at once. |

Example full-OpenBB experiment:

```bash
export OPENBB_ENABLED=true OPENBB_EXCLUSIVE_ALL=true
# reload keepitbased-api + running openbb-api
```

Unset exclusives to allow automatic fall back to Node Polygon / Binance / CoinGecko.

## PM2

From repo root:

```bash
pm2 start ecosystem.openbb.config.js
pm2 save
```

## Polygon vs quote endpoint

OpenBB `equity/price/historical` supports the **polygon** provider (needs `POLYGON_API_KEY`). The **`equity/price/quote`** route in upstream docs targets other vendors (yfinance / FMP / etc.), not Polygon. KeepItBased therefore derives a dashboard-style OHLC snapshot from recent **polygon daily bars**. Add **FMP** (or enable yfinance routes) separately if you need true NBBO-style quotes via OpenBB.

## Next steps

- Optional `FMP_API_KEY` in merged `.env` — `equity.price.quote` vendors (see [OpenBB reference](https://docs.openbb.co/odp/python/reference/equity/price/quote)).
- Add more crypto providers (FMP, Tiingo) if you outgrow yfinance intervals.
