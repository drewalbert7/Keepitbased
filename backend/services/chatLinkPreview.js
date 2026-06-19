const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_HTML_BYTES = 512 * 1024;
const cache = new Map();

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
  }
  return false;
}

async function assertSafePublicUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch {
    const err = new Error('Invalid URL');
    err.statusCode = 400;
    throw err;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err = new Error('Only http and https links are supported');
    err.statusCode = 400;
    throw err;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    const err = new Error('Link host not allowed');
    err.statusCode = 400;
    throw err;
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      const err = new Error('Link host not allowed');
      err.statusCode = 400;
      throw err;
    }
    return parsed.toString();
  }
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length) {
    const err = new Error('Could not resolve link host');
    err.statusCode = 400;
    throw err;
  }
  for (const entry of addrs) {
    if (isPrivateIp(entry.address)) {
      const err = new Error('Link host not allowed');
      err.statusCode = 400;
      throw err;
    }
  }
  return parsed.toString();
}

function extractMetaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeHtmlEntities(m[1]);
  }
  return '';
}

function extractTitleTag(html) {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? decodeHtmlEntities(m[1]) : '';
}

function resolveImageUrl(image, pageUrl) {
  if (!image) return null;
  try {
    return new URL(image, pageUrl).toString();
  } catch {
    return null;
  }
}

function parseOpenGraph(html, pageUrl) {
  const title =
    extractMetaContent(html, 'og:title') ||
    extractMetaContent(html, 'twitter:title') ||
    extractTitleTag(html);
  const description =
    extractMetaContent(html, 'og:description') || extractMetaContent(html, 'twitter:description') || '';
  const image = resolveImageUrl(
    extractMetaContent(html, 'og:image') || extractMetaContent(html, 'twitter:image'),
    pageUrl
  );
  const siteName = extractMetaContent(html, 'og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '');
  return {
    url: pageUrl,
    title: title.slice(0, 200) || new URL(pageUrl).hostname,
    description: description.slice(0, 400) || null,
    image,
    siteName: siteName.slice(0, 80)
  };
}

async function fetchLinkPreview(rawUrl) {
  const pageUrl = await assertSafePublicUrl(rawUrl);
  const cached = cache.get(pageUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const response = await axios.get(pageUrl, {
    timeout: 8000,
    maxRedirects: 3,
    maxContentLength: MAX_HTML_BYTES,
    responseType: 'text',
    transformResponse: [(data) => data],
    headers: {
      'User-Agent': 'KeepItBasedChatPreview/1.0 (+https://keepitbased.com)',
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
    },
    validateStatus: (s) => s >= 200 && s < 400
  });

  const contentType = String(response.headers['content-type'] || '');
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    const fallback = {
      url: pageUrl,
      title: new URL(pageUrl).hostname,
      description: null,
      image: null,
      siteName: new URL(pageUrl).hostname.replace(/^www\./, '')
    };
    cache.set(pageUrl, { data: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
    return fallback;
  }

  const html = String(response.data || '').slice(0, MAX_HTML_BYTES);
  const data = parseOpenGraph(html, pageUrl);
  cache.set(pageUrl, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

async function getLinkPreview(rawUrl) {
  try {
    return { ok: true, preview: await fetchLinkPreview(rawUrl) };
  } catch (error) {
    logger.warn(`chat link preview failed: ${error.message}`);
    const status = error.statusCode || error.response?.status;
    if (status === 400) {
      return { ok: false, error: error.message };
    }
    try {
      const safe = await assertSafePublicUrl(rawUrl);
      return {
        ok: true,
        preview: {
          url: safe,
          title: new URL(safe).hostname,
          description: null,
          image: null,
          siteName: new URL(safe).hostname.replace(/^www\./, '')
        }
      };
    } catch {
      return { ok: false, error: 'Could not preview link' };
    }
  }
}

module.exports = {
  getLinkPreview,
  assertSafePublicUrl
};
