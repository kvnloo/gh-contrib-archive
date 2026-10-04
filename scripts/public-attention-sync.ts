// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { classifyPullRequest, sortAttention } from '../lib/attention.ts';


/** Bounded, read-only GitHub collection. No raw response is persisted here. */
class CollectionError extends Error {
  constructor(code) { super(code); this.name = 'CollectionError'; this.code = code; }
}
const validRepo = (s) => typeof s === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s) && !s.split('/').some(p => p === '.' || p === '..');
const validLogin = s => typeof s === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(s);
const iso = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
const firstSecond = Date.parse('2008-01-01T00:00:00Z');
const nowSecond = ms => Math.floor(ms / 1000) * 1000;
function safeApiUrl(value) {
  const u = new URL(value, 'https://api.github.com');
  if (u.origin !== 'https://api.github.com' || u.username || u.password || u.hash) throw new CollectionError('unsafe_api_url');
  return u;
}
function nextLink(header, current) {
  if (!header) return null;
  const matches = [...header.matchAll(/<([^>]+)>\s*;\s*rel="([^"]+)"/g)];
  const next = matches.find(([, , rel]) => rel.split(' ').includes('next'));
  if (!next) return null;
  const url = safeApiUrl(next[1]);
  if (url.pathname !== safeApiUrl(current).pathname) throw new CollectionError('pagination_path_changed');
  const before = safeApiUrl(current);
  for (const key of new Set([...before.searchParams.keys(), ...url.searchParams.keys()])) {
    if (key !== 'page' && before.searchParams.get(key) !== url.searchParams.get(key)) throw new CollectionError('pagination_query_changed');
  }
  return url.href;
}
class GithubReader {
  constructor({ token = '', fetchImpl = globalThis.fetch, requestLimit = token ? 220 : 55, timeoutMs = 20_000, maxBodyBytes = 8 * 1024 * 1024, searchIntervalMs = token ? 2100 : 6100, clock = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    if (!Number.isSafeInteger(requestLimit) || requestLimit < 1 || requestLimit > 1000) throw new RangeError('requestLimit must be 1..1000');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || !Number.isFinite(searchIntervalMs) || searchIntervalMs < 0) throw new RangeError('invalid reader bounds');
    this.searchIntervalMs = searchIntervalMs; this.clock = clock; this.sleep = sleep; this.lastSearchAt = null;
    this.token = token; this.fetchImpl = fetchImpl; this.requestLimit = requestLimit;
    this.timeoutMs = timeoutMs; this.maxBodyBytes = maxBodyBytes; this.requests = 0; this.stopped = null;
  }
  get remaining() { return this.requestLimit - this.requests; }
  async json(url, { query, variables } = {}) {
    const target = safeApiUrl(url);
    if (query && (target.pathname !== '/graphql' || !/^\s*query\b/.test(query))) throw new CollectionError('read_only_query_required');
    if (this.stopped) throw new CollectionError(this.stopped);
    if (this.remaining <= 0) throw new CollectionError('request_budget_exhausted');
    if (target.pathname === '/search/issues') {
      if (this.lastSearchAt !== null) await this.sleep(Math.max(0, this.searchIntervalMs - (this.clock() - this.lastSearchAt)));
      this.lastSearchAt = this.clock();
    }
    this.requests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'gh-contrib-archive/covered-read-model', 'X-GitHub-Api-Version': '2022-11-28' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (query) headers['Content-Type'] = 'application/json';
      const r = await this.fetchImpl(target.href, { method: query ? 'POST' : 'GET', headers, redirect: 'error', signal: controller.signal, ...(query ? { body: JSON.stringify({ query, variables }) } : {}) });
      if (!r.ok) {
        const code = r.status === 429 || (r.status === 403 && (r.headers.get('x-ratelimit-remaining') === '0' || r.headers.has('retry-after'))) ? 'rate_limited' : `http_${r.status}`;
        // Stop globally rather than multiplying a rate-limit failure across workers.
        if (r.status === 429 || r.status === 403 || r.status === 401) this.stopped = code;
        throw new CollectionError(code);
      }
      if (Number(r.headers.get('content-length')) > this.maxBodyBytes) throw new CollectionError('response_too_large');
      const chunks = []; let bytes = 0;
      if (!r.body) throw new CollectionError('empty_response');
      for await (const chunk of r.body) {
        bytes += chunk.byteLength;
        if (bytes > this.maxBodyBytes) { controller.abort(); throw new CollectionError('response_too_large'); }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CollectionError('invalid_json'); }
      if (query && data.errors?.length) throw new CollectionError('graphql_error');
      return { data, next: nextLink(r.headers.get('link'), target.href) };
    } catch (e) {
      if (e instanceof CollectionError) throw e;
      throw new CollectionError(controller.signal.aborted ? 'request_timeout' : 'network_error');
    } finally { clearTimeout(timer); }
  }
  async collection(url, maxPages = 30) {
    const rows = [], seen = new Set(); let next = safeApiUrl(url).href;
    while (next) {
      if (seen.has(next)) throw new CollectionError('pagination_loop');
      if (seen.size >= maxPages) throw new CollectionError('pagination_budget_exhausted');
      seen.add(next);
      const response = await this.json(next);
      if (!Array.isArray(response.data)) throw new CollectionError('invalid_collection');
      rows.push(...response.data); next = response.next;
    }
    return rows;
  }
}
/** Only call with rows returned by a query containing is:public, or a PUBLIC GraphQL repository. */
function projectSearchRow(row) {
  const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)$/.exec(row?.repository_url ?? '');
  const repo = match?.[1];
  if (!validRepo(repo) || !Number.isSafeInteger(row.number) || row.number < 1 || !validLogin(row.user?.login) || !['open', 'closed'].includes(row.state)) return null;
  if (row.repository?.private === true || (row.repository?.visibility && row.repository.visibility !== 'public')) return null;
  const isPr = Boolean(row.pull_request);
  const url = `https://github.com/${repo}/${isPr ? 'pull' : 'issues'}/${row.number}`;
  if (row.html_url !== url || typeof row.title !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) return null;
  return { id: `${repo.toLowerCase()}#${row.number}`, repo, number: row.number, title: row.title.slice(0, 512), url, kind: isPr ? 'pull_request' : 'issue', state: row.state,
    author: row.user.login, draft: Boolean(row.draft), updatedAt: row.updated_at, commentCount: Number.isSafeInteger(row.comments) ? row.comments : null,
    reviewDecision: ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(row.reviewDecision) ? row.reviewDecision : null, mergeState: ['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE'].includes(row.mergeState) ? row.mergeState : null };
}
/** Search is capped at 1,000. Split disjoint creation-second intervals before paginating. */
async function collectSearch(reader, query, { now = Date.now(), start = firstSecond, end = nowSecond(now) } = {}) {
  if (!/(?:^|\s)is:public(?:\s|$)/.test(query)) throw new CollectionError('public_query_required');
  const items = new Map(), partitions = []; let rootReported = null;
  const walk = async (lo, hi) => {
    const proof = { from: iso(lo), to: iso(hi), reported: null, fetched: 0, complete: false, reason: null };
    try {
      const url = new URL('https://api.github.com/search/issues');
      url.searchParams.set('q', `${query} created:${proof.from}..${proof.to}`);
      url.searchParams.set('per_page', '100'); url.searchParams.set('sort', 'created'); url.searchParams.set('order', 'asc');
      let result = await reader.json(url.href);
      const total = result.data.total_count;
      if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(result.data.items)) throw new CollectionError('invalid_search');
      if (rootReported === null) rootReported = total;
      proof.reported = total;
      if (result.data.incomplete_results) throw new CollectionError('github_search_incomplete');
      if (total >= 1000) {
        if (lo === hi) throw new CollectionError('search_second_saturated');
        const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
        await walk(mid + 1000, hi); await walk(lo, mid); return;
      }
      const ids = new Set(), pages = new Set(); let pageUrl = url.href;
      while (true) {
        if (pages.has(pageUrl)) throw new CollectionError('pagination_loop');
        pages.add(pageUrl);
        if (result.data.incomplete_results || result.data.total_count !== total) throw new CollectionError('search_changed_during_scan');
        for (const raw of result.data.items) {
          const row = projectSearchRow(raw);
          if (!row) throw new CollectionError('invalid_public_row');
          ids.add(row.id); items.set(row.id, row);
        }
        proof.fetched = ids.size;
        if (!result.next) break;
        if (pages.size >= 10) throw new CollectionError('search_page_cap');
        pageUrl = result.next; result = await reader.json(pageUrl);
      }
      if (ids.size !== total) throw new CollectionError('search_count_mismatch');
      proof.complete = true;
    } catch (e) { proof.reason = e instanceof CollectionError ? e.code : 'collection_error'; }
    partitions.push(proof);
  };
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new RangeError('invalid search interval');
  await walk(nowSecond(start), nowSecond(end));
  const complete = partitions.every(p => p.complete) && items.size === rootReported;
  return { items: [...items.values()], coverage: { source: 'github-public-search', scope: query, reported: rootReported, fetched: items.size, complete, partitions,
    reason: complete ? null : partitions.find(p => !p.complete)?.reason ?? 'search_changed_during_scan' } };
}
const PR_QUERY = `query($login:String!,$after:String){user(login:$login){pullRequests(first:100,after:$after,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{number title url state isDraft updatedAt author{login} comments(first:1){totalCount} reviewDecision mergeStateStatus repository{nameWithOwner isPrivate visibility}}}}}`;
async function collectAuthored(reader, login, { now = Date.now() } = {}) {
  if (!validLogin(login)) throw new CollectionError('invalid_login');
  if (!reader.token) return collectSearch(reader, `is:public is:pr is:open author:${login}`, { now });
  const items = new Map(), seen = new Set(); let after = null, reported = null, walked = 0, suppressed = 0, unknownVisibility = 0, complete = false, reason = null;
  try {
    do {
      const { data } = await reader.json('/graphql', { query: PR_QUERY, variables: { login, after } });
      const c = data.data?.user?.pullRequests;
      if (!c || !Array.isArray(c.nodes) || !Number.isSafeInteger(c.totalCount) || c.totalCount < 0 || typeof c.pageInfo?.hasNextPage !== 'boolean') throw new CollectionError('invalid_connection');
      if (reported !== null && reported !== c.totalCount) throw new CollectionError('inventory_changed_during_scan');
      reported = c.totalCount;
      for (const node of c.nodes) {
        walked++;
        if (!node?.repository || node.repository.isPrivate !== false || node.repository.visibility !== 'PUBLIC') {
          suppressed++;
          if (node?.repository?.isPrivate !== true && !['PRIVATE', 'INTERNAL'].includes(node?.repository?.visibility)) unknownVisibility++;
          continue;
        }
        const repo = node.repository.nameWithOwner;
        if (node.author?.login?.toLowerCase() !== login.toLowerCase() || node.state !== 'OPEN') throw new CollectionError('inventory_scope_mismatch');
        const row = projectSearchRow({ repository_url: `https://api.github.com/repos/${repo}`, number: node.number, title: node.title, html_url: node.url, user: node.author,
          pull_request: {}, state: 'open', draft: node.isDraft, updated_at: node.updatedAt, comments: node.comments?.totalCount, reviewDecision: node.reviewDecision, mergeState: node.mergeStateStatus });
        if (!row || items.has(row.id)) throw new CollectionError('inventory_duplicate_or_invalid');
        items.set(row.id, row);
      }
      if (!c.pageInfo?.hasNextPage) { complete = walked === reported && unknownVisibility === 0; if (!complete) reason = unknownVisibility ? 'visibility_unverified' : 'inventory_count_mismatch'; break; }
      const next = c.pageInfo.endCursor;
      if (!next || seen.has(next)) throw new CollectionError('pagination_loop');
      seen.add(next); after = next;
    } while (true);
  } catch (e) { reason = e instanceof CollectionError ? e.code : 'collection_error'; }
  return { items: [...items.values()], coverage: { source: 'github-user-pullRequests', scope: 'authored-open-prs', reported, fetched: walked, public: items.size, suppressed, unknownVisibility, complete, reason } };
}
async function discoverWork(reader, { login = 'kvnloo', recentDays = 60, pins = [], now = Date.now() } = {}) {
  if (!Array.isArray(pins) || pins.length > 500 || pins.some(r => !validRepo(r))) throw new RangeError('pins must contain at most 500 valid repository names');
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 365) throw new RangeError('recentDays must be 1..365');
  const authored = await collectAuthored(reader, login, { now });
  const since = new Date(now - recentDays * 86400_000).toISOString().slice(0, 10);
  const recent = await collectSearch(reader, `is:public involves:${logi