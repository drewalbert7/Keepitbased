#!/usr/bin/env node
/**
 * Build backend/data/twEnglishAliases.json from StockAnalysis English names + twstock codes.
 * Run: node scripts/buildTwEnglishAliases.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/twEnglishAliases.json');
const TWSE_CSV =
  'https://raw.githubusercontent.com/mlouielu/twstock/dev/twstock/codes/twse_equities.csv';
const TPEX_CSV =
  'https://raw.githubusercontent.com/mlouielu/twstock/dev/twstock/codes/tpex_equities.csv';

const LEGAL_SUFFIX_RE =
  /\b(Taiwan|Taipei|The|New|Cayman Islands|Holding|Holdings|Limited|Ltd\.?|Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Group|International|Industries|Industry|Enterprise|Enterprises|Precision|Technology|Technologies|Electronics|Electronic|Semiconductor|Financial|Manufacturing|Motor|Motors|Bank|Insurance|Investment|Investments|Development|Communications|Communication|Systems|System|Solutions|Solution|Services|Service|Materials|Material|Plastics|Plastic|Petrochemical|Petrochemicals|Engineering|Construction|Trading|Retail|Wholesale|Logistics|Transport|Transportation|Airways|Marine|Lines|Line|Stores|Store|Chain|Commercial|Savings|Cooperative|Microelectronics|Microelectronics)\b/gi;

const MANUAL = {
  FOCI: '3363',
  TSM: '2330',
  TSMC: '2330',
  UMC: '2303',
  MTK: '2454',
  MEDIATEK: '2454',
  HON: '2317',
  HONHAI: '2317',
  FOXCONN: '2317',
  SHUNSIN: '6451',
  SHUNSHIN: '6451',
  SHUNSINTECH: '6451',
  ASUS: '2357',
  ACER: '2353',
  DELTA: '2308',
  QUANTA: '2382',
  WISTRON: '3231',
  PEGATRON: '4938',
  REALTEK: '2379',
  MEDIATEK: '2454',
  ASE: '3711',
  WIWYNN: '6669'
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'keepitbased-alias-build/1' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode, body });
        });
      })
      .on('error', reject);
  });
}

function parseCsvEquities(csv, stockType = '股票') {
  const lines = csv.split(/\r?\n/).slice(1);
  const codes = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    const [type, code] = line.split(',');
    if (type !== stockType) continue;
    const digits = String(code || '').replace(/\D/g, '');
    if (/^\d{4}$/.test(digits)) codes.add(digits);
  }
  return codes;
}

function parseStockAnalysisPage(html) {
  const rows = [];
  const parts = html.split(/href="\/quote\/tpe\/([0-9]+[A-Z]?)\/?"/i);
  for (let i = 1; i < parts.length; i++) {
    const sym = parts[i].split('"')[0];
    const chunk = parts[i];
    const nm = chunk.match(/<td class="slw[^"]*"[^>]*>([^<]+)</);
    if (!nm) continue;
    const code = sym.replace(/[A-Z]$/, '');
    rows.push({ sym, code, name: nm[1].trim() });
  }
  return rows;
}

function normalizeAlias(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function aliasesFromEnglishName(name) {
  const out = new Set();
  let cleaned = String(name || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/,/g, ' ')
    .replace(/&/g, ' and ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned
    .split(' ')
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter((w) => w.length > 1);

  if (words.length === 0) return out;

  if (words.length >= 2) {
    const acr = words.map((w) => w[0]).join('');
    const a = normalizeAlias(acr);
    if (a.length >= 3 && a.length <= 12) out.add(a);
  }

  const compact = normalizeAlias(words.join(''));
  if (compact.length >= 3 && compact.length <= 16) out.add(compact);

  if (words[0].length >= 4) {
    out.add(normalizeAlias(words[0]));
  }

  if (words.length >= 2) {
    const two = normalizeAlias(words.slice(0, 2).join(''));
    if (two.length >= 4 && two.length <= 16) out.add(two);
  }

  return out;
}

async function fetchAllStockAnalysisRows() {
  const byCode = new Map();
  for (let page = 1; page <= 15; page += 1) {
    const url =
      page === 1
        ? 'https://stockanalysis.com/list/taiwan-stock-exchange/'
        : `https://stockanalysis.com/list/taiwan-stock-exchange/?page=${page}`;
    const { status, body: html } = await fetchText(url);
    if (status === 404) break;
    if (status !== 200) {
      throw new Error(`HTTP ${status} for ${url}`);
    }
    const rows = parseStockAnalysisPage(html);
    if (!rows.length) break;
    for (const row of rows) {
      if (!byCode.has(row.code)) byCode.set(row.code, row);
    }
    process.stderr.write(`stockanalysis page ${page}: ${rows.length} rows\n`);
  }
  return byCode;
}

async function main() {
  const [twseRes, tpexRes] = await Promise.all([fetchText(TWSE_CSV), fetchText(TPEX_CSV)]);
  const twseCsv = twseRes.body;
  const tpexCsv = tpexRes.body;
  const validCodes = new Set([
    ...parseCsvEquities(twseCsv),
    ...parseCsvEquities(tpexCsv)
  ]);
  process.stderr.write(`valid 4-digit stock codes: ${validCodes.size}\n`);

  const englishByCode = await fetchAllStockAnalysisRows();
  process.stderr.write(`english names from stockanalysis: ${englishByCode.size}\n`);

  const aliasToCode = new Map();
  const conflicts = [];

  const addAlias = (alias, code, source) => {
    const key = normalizeAlias(alias);
    if (!key || key.length < 3) return;
    if (!validCodes.has(code)) return;
    const prev = aliasToCode.get(key);
    if (prev && prev !== code) {
      conflicts.push({ alias: key, was: prev, now: code, source });
      return;
    }
    aliasToCode.set(key, code);
  };

  for (const [alias, code] of Object.entries(MANUAL)) {
    addAlias(alias, code, 'manual');
  }

  for (const code of validCodes) {
    addAlias(code, code, 'code');
  }

  for (const [code, row] of englishByCode) {
    if (!validCodes.has(code)) continue;
    for (const alias of aliasesFromEnglishName(row.name)) {
      addAlias(alias, code, row.name);
    }
  }

  const sorted = Object.fromEntries(
    [...aliasToCode.entries()].sort(([a], [b]) => a.localeCompare(b))
  );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        aliasCount: Object.keys(sorted).length,
        stockCodeCount: validCodes.size,
        conflictCount: conflicts.length,
        aliases: sorted
      },
      null,
      2
    )
  );

  process.stderr.write(`wrote ${Object.keys(sorted).length} aliases -> ${OUT}\n`);
  if (conflicts.length) {
    process.stderr.write(`skipped ${conflicts.length} alias conflicts (first 5):\n`);
    console.error(JSON.stringify(conflicts.slice(0, 5), null, 2));
  }
  console.log(
    JSON.stringify({
      aliasCount: Object.keys(sorted).length,
      hasFOCI: sorted.FOCI,
      hasSHUNSIN: sorted.SHUNSIN
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
