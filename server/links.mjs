// Page titles for link cards: GET /api/link-preview?url=<address> → { title }.
// Browsers can't read other sites, so the server fetches the page and reads its
// <title> (or og:title). To keep the board from being used to reach machines on
// your own network, addresses that resolve to private, loopback or link-local IPs
// are refused, redirects are checked the same way (at most 3), and only a small
// part of the page is read, with a short timeout.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;

/** Whether an IP address is inside a private / local / special range. */
function isPrivate(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function assertPublic(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) links.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivate)) throw new Error('Address not allowed.');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();

/** The page's title, or null. Throws for addresses that aren't allowed. */
export async function linkTitle(raw) {
  let url = new URL(raw);
  for (let hop = 0; hop <= 3; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'niro-link-preview/1.0', Accept: 'text/html' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      await res.body?.cancel();
      continue;
    }
    if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel();
      return null;
    }
    // Read only the start of the page; the title is near the top.
    const reader = res.body.getReader();
    let html = '';
    let size = 0;
    const decoder = new TextDecoder();
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    await reader.cancel().catch(() => {});
    const og = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html);
    const title = og?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    return title ? decode(title).slice(0, 200) || null : null;
  }
  return null;
}
