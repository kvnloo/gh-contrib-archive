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
  const recent = await collectSearch(reader, `is:public involves:${login} updated:>=${since}`, { now });
  const byId = new Map(authored.items.map(row => [row.id, row]));
  for (const row of recent.items) {
    const old = byId.get(row.id);
    if (!old || Date.parse(row.updatedAt) > Date.parse(old.updatedAt) || (row.updatedAt === old.updatedAt && row.state !== old.state)) byId.set(row.id, row);
  }
  const known = new Set([...byId.values()].map(row => row.repo.toLowerCase()));
  const pinned = []; let unavailablePins = 0;
  for (const repo of [...new Set(pins)]) {
    if (!validRepo(repo)) throw new CollectionError('invalid_repo_pin');
    // Positive public visibility is required even for a configured pin.
    try {
      const { data } = await reader.json(`/repos/${repo}`);
      if (data.private !== false || data.visibility !== 'public' || !validRepo(data.full_name)) throw new CollectionError('pin_not_public');
      known.add(data.full_name.toLowerCase());
      const result = await collectSearch(reader, `is:public repo:${data.full_name} involves:${login} is:open`, { now });
      pinned.push({ repo: data.full_name, coverage: result.coverage });
      for (const row of result.items) byId.set(row.id, row);
    } catch { unavailablePins++; }
  }
  const repositories = [...known].sort().map(repo => ({ repo, repoVisibility: 'public', reasons: [authored.items.some(r => r.repo.toLowerCase() === repo) ? 'open-authored-pr' : null,
    recent.items.some(r => r.repo.toLowerCase() === repo) ? 'recent-involvement' : null, pinned.some(r => r.repo.toLowerCase() === repo) ? 'pin' : null].filter(Boolean) }));
  return { items: [...byId.values()], repositories, coverage: { authored: authored.coverage, recent: recent.coverage, pinned,
    unavailablePins, complete: authored.coverage.complete && recent.coverage.complete && unavailablePins === 0 && pinned.every(p => p.coverage.complete),
    startedAt: new Date(now).toISOString(), recentSince: since, requests: reader.requests } };
}
/** Round-robin repos, oldest inspections first. New busy repos cannot starve older ones. */
function fairRefresh(rows, cache, limit, now, ttlMs = 24 * 3600_000) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000 || !Number.isFinite(ttlMs) || ttlMs < 1) throw new RangeError('invalid refresh bounds');
  const groups = new Map();
  for (const row of rows) {
    const c = cache[row.id];
    if (c?.complete && c.sourceUpdatedAt === row.updatedAt && Number.isFinite(Date.parse(c.inspectedAt)) && now - Date.parse(c.inspectedAt) >= 0 && now - Date.parse(c.inspectedAt) < ttlMs) continue;
    const group = groups.get(row.repo) ?? []; group.push(row); groups.set(row.repo, group);
  }
  const age = row => Date.parse(cache[row.id]?.inspectedAt ?? '') || 0;
  for (const group of groups.values()) group.sort((a, b) => age(a) - age(b) || a.number - b.number);
  const queues = [...groups.values()].sort((a, b) => age(a[0]) - age(b[0]) || a[0].repo.localeCompare(b[0].repo));
  const result = [];
  while (result.length < limit && queues.some(q => q.length)) for (const q of queues) { if (q.length && result.length < limit) result.push(q.shift()); }
  return result;
}

const bot = login => /\[bot\]$/i.test(login ?? '') || ['github-actions', 'dependabot'].includes((login ?? '').toLowerCase());
const REQUEST = /\b(please|could you|can you|must|required|missing|needs? (?:a |an )?(?:test|fix|rebase))\b/i;
/** A later acknowledgement is not evidence that a maintainer's request was resolved. */
function conservativeRecord(classify, root, feedback, login) {
  const snapshot = { repo: root.repo, repoVisibility: 'public', number: root.number, title: root.title, url: root.url,
    state: root.state.toUpperCase(), isDraft: root.draft, author: root.author, reviewDecision: root.reviewDecision,
    mergeState: root.mergeState, updatedAt: root.updatedAt, notificationReasons: [], activities: feedback.activities, checks: [] };
  const record = classify(snapshot, login);
  record.threadState = root.state; record.threadKind = root.kind;
  record.ciState = 'none'; // This collector has not inspected exact-head checks.
  if (!feedback.complete) {
    record.priority = 'P1'; record.blocker = 'inspection_pending';
    record.nextAction = 'Feedback coverage is incomplete. Refresh this thread before concluding that no response or action is needed.';
  } else {
    const self = login.toLowerCase();
    const requests = feedback.activities.filter(a => a.actor.toLowerCase() !== self && !bot(a.actor) && (a.reviewState === 'CHANGES_REQUESTED' || REQUEST.test(a.body)))
      .sort((a, b) => b.at.localeCompare(a.at));
    const latest = requests[0];
    const laterApproval = latest && feedback.activities.some(a => a.actor === latest.actor && a.at > latest.at && ['APPROVED', 'DISMISSED'].includes(a.reviewState));
    if (latest && !laterApproval && record.lastSelfAt && record.lastSelfAt > latest.at && record.priority === 'P2') {
      record.priority = 'P1'; record.blocker = 'awaiting_rereview';
      record.nextAction = 'The author replied after a human request; resolution has not been verified. Check the requested evidence or await re-review.';
    }
    if (record.blocker === 'approved') {
      record.blocker = 'verification_pending';
      record.nextAction = 'Review is approved, but current-head checks and mergeability still need verification.';
    }
    if (root.state === 'closed') {
      record.priority = 'P2'; record.blocker = 'closed_thread';
      record.nextAction = 'Historical context only. Do not treat this closed thread as an active promotion candidate.';
    }
  }
  // Whitelist output even when a future classifier starts returning raw fields.
  const allowed = ['repo', 'repoVisibility', 'number', 'title', 'url', 'priority', 'blocker', 'nextAction', 'updatedAt', 'lastExternalAt',
    'latestExternalActor', 'latestExternalKind', 'latestExternalReviewState', 'lastSelfAt', 'ciState', 'reviewDecision', 'mergeState', 'threadState', 'threadKind'];
  return Object.fromEntries(allowed.map(k => [k, record[k] ?? null]));
}
async function readFeedback(reader, root) {
  const prefix = `/repos/${root.repo}`;
  const sources = [['comment', `${prefix}/issues/${root.number}/comments?per_page=100`]];
  if (root.kind === 'pull_request') sources.push(['review', `${prefix}/pulls/${root.number}/reviews?per_page=100`], ['review_comment', `${prefix}/pulls/${root.number}/comments?per_page=100`]);
  const activities = [], events = [], ids = new Set();
  try {
    for (const [kind, url] of sources) for (const raw of await reader.collection(url)) {
      const id = `${kind}:${raw.id}`;
      if (!Number.isSafeInteger(raw.id) || raw.id < 1 || typeof raw.user?.login !== 'string' || raw.user.login.length > 64 || ids.has(id)) throw new CollectionError('invalid_feedback_record');
      const at = kind === 'review' ? raw.submitted_at : raw.created_at;
      if (!Number.isFinite(Date.parse(at))) throw new CollectionError('invalid_feedback_time');
      ids.add(id);
      activities.push({ actor: raw.user.login, body: String(raw.body ?? ''), at, kind: kind === 'review' ? 'review' : 'comment', reviewState: raw.state ?? null });
      const u = new URL(raw.html_url ?? root.url);
      const expected = `/${root.repo}/${root.kind === 'pull_request' ? 'pull' : 'issues'}/${root.number}`;
      const safeUrl = u.origin === 'https://github.com' && !u.username && !u.password && !u.search && u.pathname === expected ? u.href : root.url;
      events.push({ id, kind: kind === 'review' ? 'review' : 'comment', actor: raw.user.login, at,
        actorType: ['User', 'Bot', 'Organization', 'Mannequin'].includes(raw.user.type) ? raw.user.type : null,
        authorAssociation: ['COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN', 'MEMBER', 'NONE', 'OWNER'].includes(raw.author_association) ? raw.author_association : null,
        reviewState: typeof raw.state === 'string' ? raw.state : null, url: safeUrl });
    }
    return { complete: true, activities, events: events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)), reason: null };
  } catch (e) { return { complete: false, activities, events, reason: e instanceof CollectionError ? e.code : 'feedback_failed' }; }
}
async function materializeAttention(reader, work, { classify, sort = rows => rows, login = 'kvnloo', cache = {}, now = Date.now(), deepLimit = 48, ttlMs = 24 * 3600_000, eventLimit = 64, maxCacheBytes = 16 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 1024) throw new RangeError('invalid cache byte budget');
  if (!Number.isInteger(eventLimit) || eventLimit < 1 || eventLimit > 512) throw new RangeError('invalid event limit');
  const cleanCache = {};
  for (const root of work.items) { const entry = sanitizeCache(cache?.[root.id], root); if (entry) cleanCache[root.id] = entry; }
  cache = cleanCache;
  const refreshOrder = fairRefresh(work.items, cache, deepLimit, now, ttlMs);
  const selected = new Set(refreshOrder.map(r => r.id));
  const items = [], threads = [], coverage = [], nextCache = { ...cache }; let refreshed = 0, cacheHits = 0;
  for (const root of [...refreshOrder, ...work.items.filter(r => !selected.has(r.id))]) {
    const old = cache[root.id]; let entry;
    if (selected.has(root.id) && reader.remaining >= (root.kind === 'pull_request' ? 3 : 1)) {
      const feedback = await readFeedback(reader, root);
      const record = conservativeRecord(classify, root, feedback, login);
      entry = { sourceUpdatedAt: root.updatedAt, inspectedAt: new Date(now).toISOString(), complete: feedback.complete, reason: feedback.reason,
        record, events: feedback.events.slice(-eventLimit), eventCount: feedback.events.length };
      nextCache[root.id] = entry; refreshed++;
    } else if (old?.complete && old.sourceUpdatedAt === root.updatedAt && now - Date.parse(old.inspectedAt) >= 0 && now - Date.parse(old.inspectedAt) < ttlMs) {
      // The current inventory positively observed this public root again.
      entry = old; cacheHits++;
    } else {
      entry = { sourceUpdatedAt: root.updatedAt, inspectedAt: null, complete: false, reason: 'refresh_pending',
        record: conservativeRecord(classify, root, { complete: false, activities: [] }, login), events: [], eventCount: 0 };
    }
    items.push(entry.record);
    threads.push({ repo: root.repo, repoVisibility: 'public', number: root.number, events: entry.events });
    coverage.push({ repo: root.repo, number: root.number, kind: root.kind, state: root.state, sourceUpdatedAt: root.updatedAt,
      inspectedAt: entry.inspectedAt, feedbackComplete: entry.complete, checksComplete: false, reason: entry.reason,
      eventsReturned: entry.events.length, eventsTotal: entry.eventCount, eventsTruncated: entry.eventCount > entry.events.length });
  }
  // Bound retained last-good cache; never use non-observed entries as public output.
  for (const [key, entry] of Object.entries(nextCache)) if (now - Date.parse(entry.inspectedAt ?? '') > 30 * 86400_000) delete nextCache[key];
  const kept = Object.entries(nextCache).sort((a, b) => (Date.parse(b[1].inspectedAt) || 0) - (Date.parse(a[1].inspectedAt) || 0)).slice(0, 20_000);
  const bounded = []; let cacheBytes = 2;
  for (const [key, entry] of kept) {
    const bytes = Buffer.byteLength(JSON.stringify(key) + ':' + JSON.stringify(entry)) + (bounded.length ? 1 : 0);
    if (cacheBytes + bytes > maxCacheBytes) continue;
    bounded.push([key, entry]); cacheBytes += bytes;
  }
  return { items: sort(items), threads, coverage, cache: Object.fromEntries(bounded), refreshed, cacheHits, cacheBytes, cacheEvicted: kept.length - bounded.length };
}

/** Never spread cache data into a public packet. Rebind identity to the current root. */
function sanitizeCache(entry, root) {
  if (!entry || entry.complete !== true || entry.sourceUpdatedAt !== root.updatedAt || !Number.isFinite(Date.parse(entry.inspectedAt)) ||
      !entry.record || entry.record.repo !== root.repo || entry.record.number !== root.number || entry.record.url !== root.url ||
      !Array.isArray(entry.events) || !Number.isSafeInteger(entry.eventCount) || entry.eventCount < entry.events.length) return null;
  const r = entry.record;
  if (!['P0', 'P1', 'P2'].includes(r.priority) || typeof r.blocker !== 'string' || typeof r.nextAction !== 'string') return null;
  const events = [];
  for (const e of entry.events) {
    if (!e || typeof e.id !== 'string' || !/^(?:comment|review|review_comment):[0-9]+$/.test(e.id) || !['comment', 'review'].includes(e.kind) ||
        typeof e.actor !== 'string' || e.actor.length > 64 || !Number.isFinite(Date.parse(e.at))) return null;
    let url; try { url = new URL(e.url); } catch { return null; }
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.pathname !== new URL(root.url).pathname) return null;
    events.push({ id: e.id, kind: e.kind, actor: e.actor, at: e.at, url: url.href,
      actorType: ['User', 'Bot', 'Organization', 'Mannequin'].includes(e.actorType) ? e.actorType : null,
      authorAssociation: ['COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN', 'MEMBER', 'NONE', 'OWNER'].includes(e.authorAssociation) ? e.authorAssociation : null,
      reviewState: ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'].includes(e.reviewState) ? e.reviewState : null });
  }
  const timestamp = x => Number.isFinite(Date.parse(x ?? '')) ? x : null;
  const record = { repo: root.repo, repoVisibility: 'public', number: root.number, title: root.title, url: root.url,
    priority: r.priority, blocker: r.blocker.slice(0, 96), nextAction: r.nextAction.slice(0, 768), updatedAt: root.updatedAt,
    lastExternalAt: timestamp(r.lastExternalAt), latestExternalActor: typeof r.latestExternalActor === 'string' ? r.latestExternalActor.slice(0, 64) : null,
    latestExternalKind: ['comment', 'review'].includes(r.latestExternalKind) ? r.latestExternalKind : null,
    latestExternalReviewState: ['APPROVED', 'CHANG