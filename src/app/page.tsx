'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ─────────────────────────────────────────────────────────
interface RankedTrend {
  rank: number;
  keyword: string;
  normalizedKeyword: string;
  sources: ('google' | 'twitter')[];
  googleCount: number;
  twitterCount: number;
  score: number;
  isCovered: boolean;
  matchedArticles: { title: string; url: string }[];
  velocity?: number | 'new';
}

interface Stats {
  totalGoogleTrends: number;
  totalTwitterTrends: number;
  totalRawTrends: number;
  uniqueAfterDedup: number;
  articlesScanned: number;
  coveragePercent: number;
  coveredCount: number;
  uncoveredCount: number;
}

/** Article row from sitemap (merge API + filter POST body). */
interface SitemapArticleRow {
  url: string;
  title: string;
  keywords: string[];
  publishedAt: string;
}

interface MergeResponse {
  trends: RankedTrend[];
  /** Same sitemap batch used for scoring — use for Explore / LLM filter. */
  articles: SitemapArticleRow[];
  stats: Stats;
  errors: { sitemap: string | null; google: string | null; twitter: string | null };
  fetchedAt: string;
}

interface FilteredArticle extends SitemapArticleRow {
  relevanceScore: number;
  reason: string;
  method: 'llm' | 'keyword';
}

// ─── Auto Refresh Config ───────────────────────────────────────────
const AUTO_REFRESH_INTERVAL = 30 * 60; // 30 minutes in seconds

function matchedToFiltered(
  matched: { title: string; url: string }[]
): FilteredArticle[] {
  return matched.map((a) => ({
    ...a,
    keywords: [] as string[],
    publishedAt: '',
    relevanceScore: 0.42,
    reason: 'Coverage heuristic (unverified)',
    method: 'keyword' as const,
  }));
}

// ─── Tooltip Component ─────────────────────────────────────────────
function InfoTooltip({ text, position = 'top' }: { text: string; position?: 'top' | 'bottom' }) {
  const isTop = position === 'top';
  return (
    <span className="relative group/tip inline-flex items-center">
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 border border-slate-200 text-slate-400 cursor-help group-hover/tip:bg-[#4285f4]/10 group-hover/tip:border-[#4285f4]/30 group-hover/tip:text-[#4285f4] transition-all duration-200">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </span>
      <span className={`pointer-events-none absolute left-1/2 -translate-x-1/2 w-56 rounded-xl bg-slate-800 text-white text-[11px] leading-relaxed font-normal normal-case tracking-normal px-3.5 py-2.5 opacity-0 scale-95 group-hover/tip:opacity-100 group-hover/tip:scale-100 transition-all duration-200 shadow-lg shadow-slate-900/20 z-50 ${
        isTop ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'
      }`}>
        {text}
        <span className={`absolute left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent ${
          isTop ? 'top-full border-t-[5px] border-t-slate-800' : 'bottom-full border-b-[5px] border-b-slate-800'
        }`} />
      </span>
    </span>
  );
}

// ─── Main Dashboard Component ──────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState<MergeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Article panel state
  const [selectedTrend, setSelectedTrend] = useState<RankedTrend | null>(null);
  const [filteredArticles, setFilteredArticles] = useState<FilteredArticle[]>([]);
  const [filterLoading, setFilterLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_INTERVAL);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // All articles cache for LLM filtering
  const [allArticles, setAllArticles] = useState<SitemapArticleRow[]>([]);

  // ─── Fetch Merged Trends ──────────────────────────────────────────
  const fetchTrends = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trends/merge');
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const json: MergeResponse = await res.json();
      setData(json);
      setAllArticles(Array.isArray(json.articles) ? json.articles : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
      setCountdown(AUTO_REFRESH_INTERVAL);
    }
  }, []);

  // ─── Filter Articles by Trend (LLM or keyword) ───────────────────
  const filterByTrend = useCallback(
    async (trend: RankedTrend) => {
      setSelectedTrend(trend);
      setPanelOpen(true);
      setFilterLoading(true);
      setFilteredArticles([]);

      const pool =
        allArticles.length > 0
          ? allArticles
          : (data?.articles ?? []);

      // If no article pool available, use pre-matched articles from merge
      if (pool.length === 0) {
        setFilteredArticles(matchedToFiltered(trend.matchedArticles));
        setFilterLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/llm/filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trend: trend.keyword,
            articles: pool,
          }),
        });

        if (!res.ok) throw new Error(`Filter API returned ${res.status}`);
        const json = await res.json();
        const list: FilteredArticle[] = json.articles || [];

        if (list.length > 0) {
          setFilteredArticles(list);
        } else {
          // Fall back to pre-matched articles from the merge API
          setFilteredArticles(matchedToFiltered(trend.matchedArticles));
        }
      } catch {
        // On any error, fall back to pre-matched articles
        setFilteredArticles(matchedToFiltered(trend.matchedArticles));
      } finally {
        setFilterLoading(false);
      }
    },
    [allArticles, data]
  );

  // ─── Auto-Refresh Logic ──────────────────────────────────────────
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchTrends, AUTO_REFRESH_INTERVAL * 1000);
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => (prev <= 1 ? AUTO_REFRESH_INTERVAL : prev - 1));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(AUTO_REFRESH_INTERVAL);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, fetchTrends]);

  // Format countdown
  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Format time ago
  const formatTimeAgo = (isoStr: string) => {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  };

  // ─── Export Logic ────────────────────────────────────────────────
  const exportToJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trends-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen relative text-slate-800">
      <div className="gradient-mesh" aria-hidden />

      <div className="relative z-10 max-w-[1520px] mx-auto px-4 sm:px-6 lg:px-10 py-8 sm:py-10">
        <header className="mb-10 lg:mb-12 animate-fade-in-up">
          <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-8 pb-8 border-b border-slate-200">
            <div className="flex gap-4 sm:gap-5">
              <div className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white flex items-center justify-center shadow-sm border border-slate-200">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <div className="min-w-0 space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Times Internet
                </p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-800">
                  Trending Engine
                </h1>
                <p className="text-sm text-slate-500 max-w-lg leading-relaxed">
                  Live Google and X signals, deduplicated and scored against your newsroom sitemap. Explore coverage in one place.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {data && (
                <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 backdrop-blur-md px-3 py-1.5 text-xs text-slate-500 shadow-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34a853]" />
                  </span>
                  <span>Synced</span>
                  <span className="text-slate-700 font-semibold tabular-nums">{formatTimeAgo(data.fetchedAt)}</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold transition-all-smooth focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-100 ${
                  autoRefresh
                    ? 'bg-blue-50 text-[#1a73e8] border border-blue-200 shadow-sm'
                    : 'bg-white/80 text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-800 shadow-sm'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={autoRefresh ? 'animate-spin-slow' : ''}>
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                {autoRefresh ? formatCountdown(countdown) : 'Auto refresh · 30m'}
              </button>

              <button
                id="fetch-now-btn"
                type="button"
                onClick={fetchTrends}
                disabled={loading}
                className="btn-primary"
              >
                {loading ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin-slow">
                      <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="15" />
                    </svg>
                    Fetching...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                    Fetch now
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={exportToJson}
                disabled={!data || loading}
                className="btn-secondary"
                title="Export JSON"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-8 p-4 sm:p-5 card-glass border-[#ea4335]/30 bg-red-50 flex items-start gap-4 animate-fade-in"
          >
            <div className="mt-0.5 shrink-0 w-9 h-9 rounded-xl bg-white flex items-center justify-center border border-[#ea4335]/20 shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ea4335" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Request failed</p>
              <p className="text-sm text-slate-600 mt-1">{error}</p>
            </div>
          </div>
        )}

        {!data && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-20 sm:py-28 px-4 animate-fade-in">
            <div className="card-glass w-full max-w-xl p-8 sm:p-10 text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-6 border border-slate-200 shadow-sm">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-slate-800 mb-2">
                No snapshot yet
              </h2>
              <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                Run a fetch to merge Google Trends, X trends, and your latest sitemap. Ranked topics and coverage appear below.
              </p>
              <ul className="text-left text-sm text-slate-600 space-y-3 mb-8 max-w-sm mx-auto font-medium">
                <li className="flex gap-2">
                  <span className="text-[#4285f4] mt-0.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg></span>
                  <span>Deduplication across languages and sources</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[#34a853] mt-0.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg></span>
                  <span>Editorial coverage vs. trending keywords</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[#fbbc04] mt-0.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg></span>
                  <span>Optional AI article matching per topic</span>
                </li>
              </ul>
              <button
                type="button"
                onClick={fetchTrends}
                className="btn-primary w-full sm:w-auto"
              >
                Fetch latest trends
              </button>
            </div>
          </div>
        )}

        {loading && !data && (
          <div className="space-y-8 animate-fade-in">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="card-glass p-6">
                  <div className="h-3 w-24 animate-shimmer rounded-md mb-4 bg-slate-200" />
                  <div className="h-9 w-20 animate-shimmer rounded-md bg-slate-200" />
                </div>
              ))}
            </div>
            <div className="card-glass p-6 sm:p-8">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 py-4 border-b border-slate-100 last:border-0">
                  <div className="h-4 w-8 animate-shimmer rounded bg-slate-200" />
                  <div className="h-4 flex-1 max-w-md animate-shimmer rounded bg-slate-200" />
                  <div className="h-4 w-14 animate-shimmer rounded hidden sm:block bg-slate-200" />
                </div>
              ))}
            </div>
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-8">
              <StatCard
                label="Google Trends"
                value={data.stats.totalGoogleTrends}
                tooltip="Total number of trending keywords fetched from Google Trends India. These are real-time rising search queries."
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                    <polyline points="17 6 23 6 23 12" />
                  </svg>
                }
                color="blue"
                delay={0}
              />
              <StatCard
                label="Twitter/X Trends"
                value={data.stats.totalTwitterTrends}
                tooltip="Total trending topics pulled from Twitter/X for India. Includes hashtags and popular phrases."
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4l11.733 16h4.267l-11.733 -16h-4.267z" />
                    <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
                  </svg>
                }
                color="purple"
                delay={1}
              />
              <StatCard
                label="Articles Scanned"
                value={data.stats.articlesScanned}
                tooltip="Number of recent articles scanned from your sitemap. These are matched against trending topics to determine editorial coverage."
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                }
                color="amber"
                delay={2}
              />
              <StatCard
                label="Coverage"
                value={`${data.stats.coveragePercent}%`}
                subtitle={`${data.stats.coveredCount} of ${data.trends.length} covered`}
                tooltip="Percentage of top trending topics that have at least one matching article in your sitemap. Higher = your newsroom is covering more trends."
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                }
                color="green"
                delay={3}
              />
            </div>

            {(data.errors.sitemap || data.errors.google || data.errors.twitter) && (
              <div className="mb-6 p-4 sm:px-5 card-glass border-[#fbbc04]/40 bg-[#fbbc04]/5 animate-fade-in">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-800">
                  <span className="inline-flex items-center gap-1.5 font-bold text-[#f29900]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Partial data
                  </span>
                  <span className="text-slate-600">Some feeds failed. Rankings use available sources.</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.errors.sitemap && (
                    <span className="inline-flex items-center rounded-lg border border-[#fbbc04]/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                      Sitemap
                    </span>
                  )}
                  {data.errors.google && (
                    <span className="inline-flex items-center rounded-lg border border-[#fbbc04]/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                      Google
                    </span>
                  )}
                  {data.errors.twitter && (
                    <span className="inline-flex items-center rounded-lg border border-[#fbbc04]/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                      X / Twitter
                    </span>
                  )}
                </div>
              </div>
            )}

            <div
              className="mb-8 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 text-xs animate-fade-in"
              style={{ animationDelay: '0.12s' }}
            >
              <span className="text-slate-400 font-bold uppercase tracking-wider">Pipeline</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-slate-200 bg-white/70 px-3 py-1.5 text-slate-600 font-semibold tabular-nums shadow-sm">
                  {data.stats.totalRawTrends} raw
                </span>
                <span className="text-slate-400">→</span>
                <span className="rounded-md border border-slate-200 bg-white/70 px-3 py-1.5 text-slate-600 font-semibold tabular-nums shadow-sm">
                  {data.stats.uniqueAfterDedup} deduped
                </span>
                <span className="text-slate-400">→</span>
                <span className="rounded-md border border-[#4285f4]/30 bg-[#4285f4]/10 px-3 py-1.5 text-[#1a73e8] font-bold tabular-nums">
                  Top {data.trends.length} ranked
                </span>
              </div>
            </div>

            <div className="card-glass overflow-hidden animate-fade-in-up shadow-md" style={{ animationDelay: '0.15s' }}>
              <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/50">
                <div>
                  <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-slate-200 shadow-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </span>
                    Ranked trends
                  </h2>
                </div>
                <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                  {data.trends.length} topics
                </span>
              </div>

              <div className="overflow-x-auto trend-table-wrap scrollbar-hide">
                <table className="w-full min-w-[720px]">
                  <thead className="trend-table-head">
                    <tr className="text-[11px] text-slate-500 font-bold uppercase tracking-[0.12em]">
                      <th className="px-6 py-4 text-left w-12">#</th>
                      <th className="px-6 py-4 text-left">Trend</th>
                      <th className="px-6 py-4 text-left">Source</th>
                      <th className="px-6 py-4 text-center">
                        <span className="inline-flex items-center gap-1.5">
                          Score
                          <InfoTooltip text="Composite ranking score based on: source count (Google + X), position in each feed, and cross-platform overlap. Higher score = stronger trend signal." position="bottom" />
                        </span>
                      </th>
                      <th className="px-6 py-4 text-center">Velocity</th>
                      <th className="px-6 py-4 text-center">Coverage</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trends.map((trend) => (
                      <tr
                        key={`${trend.normalizedKeyword}-${trend.rank}`}
                        className="trend-row cursor-pointer stagger-row animate-fade-in-up"
                        onClick={() => filterByTrend(trend)}
                      >
                        <td className="px-6 py-5">
                          <span className={`text-sm font-bold ${
                            trend.rank <= 3 ? 'text-[#f29900]' : 'text-slate-400'
                          }`}>
                            {trend.rank}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-800">
                                {trend.keyword}
                              </span>
                              <div className="flex gap-1">
                                <a
                                  href={`https://trends.google.com/trends/explore?q=${encodeURIComponent(trend.keyword)}&geo=IN`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-400 hover:text-[#4285f4] transition-colors"
                                  title="Google Trends"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                                  </svg>
                                </a>
                                <a
                                  href={`https://x.com/search?q=${encodeURIComponent(trend.keyword)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-400 hover:text-slate-800 transition-colors"
                                  title="Twitter/X"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M4 4l11.733 16h4.267l-11.733 -16h-4.267z" />
                                  </svg>
                                </a>
                              </div>
                            </div>
                            {trend.matchedArticles.length > 0 && (
                              <span className="ml-0.5 mt-1 text-xs font-medium text-slate-500">
                                {trend.matchedArticles.length} article{trend.matchedArticles.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-1.5">
                            {trend.sources.includes('google') && (
                              <span className="badge badge-google">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                                </svg>
                                G
                              </span>
                            )}
                            {trend.sources.includes('twitter') && (
                              <span className="badge badge-twitter">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <path d="M4 4l11.733 16h4.267l-11.733 -16h-4.267z" />
                                </svg>
                                X
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-center">
                          <span className="text-sm font-semibold text-slate-600">{trend.score.toFixed(2)}</span>
                        </td>
                        <td className="px-6 py-5 text-center">
                          {trend.velocity === 'new' ? (
                            <span className="text-[10px] bg-[#4285f4]/10 text-[#1a73e8] px-2 py-0.5 rounded font-bold border border-[#4285f4]/20 uppercase">New</span>
                          ) : typeof trend.velocity === 'number' && trend.velocity !== 0 ? (
                            <div className="flex flex-col items-center">
                              <span className={`text-xs font-bold flex items-center gap-0.5 ${trend.velocity > 0 ? 'text-[#34a853]' : 'text-[#ea4335]'}`}>
                                {trend.velocity > 0 ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                    <polyline points="18 15 12 9 6 15" />
                                  </svg>
                                ) : (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                    <polyline points="6 9 12 15 18 9" />
                                  </svg>
                                )}
                                {Math.abs(trend.velocity)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 font-bold">—</span>
                          )}
                        </td>
                        <td className="px-6 py-5 text-center">
                          {trend.isCovered ? (
                            <span className="badge badge-covered">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Covered
                            </span>
                          ) : (
                            <span className="badge badge-uncovered">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                              Not Covered
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              filterByTrend(trend);
                            }}
                            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-[#1a73e8] bg-[#4285f4]/10 border border-[#4285f4]/20 hover:bg-[#4285f4]/20 transition-all-smooth ml-auto focus:outline-none focus:ring-4 focus:ring-[#4285f4]/20 active:scale-95"
                          >
                            Explore
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              className="mt-8 card-glass p-6 sm:p-8 animate-fade-in-up"
              style={{ animationDelay: '0.28s' }}
            >
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.14em] mb-5">
                Source mix · top {data.trends.length}
              </h3>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-5 sm:gap-10 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#4285f4] ring-2 ring-[#4285f4]/20" />
                  <span className="text-sm font-medium text-slate-600">
                    Google only
                    <span className="ml-2 font-bold tabular-nums text-slate-800">
                      {data.trends.filter((t) => t.sources.includes('google') && !t.sources.includes('twitter')).length}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-800 ring-2 ring-slate-800/20" />
                  <span className="text-sm font-medium text-slate-600">
                    X only
                    <span className="ml-2 font-bold tabular-nums text-slate-800">
                      {data.trends.filter((t) => t.sources.includes('twitter') && !t.sources.includes('google')).length}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-[#4285f4] to-slate-800 ring-2 ring-slate-200" />
                  <span className="text-sm font-medium text-slate-600">
                    Both
                    <span className="ml-2 font-bold tabular-nums text-slate-800">
                      {data.trends.filter(
                        (t) => t.sources.includes('google') && t.sources.includes('twitter')
                      ).length}
                    </span>
                  </span>
                </div>
              </div>
              <div className="flex rounded-full overflow-hidden h-2.5 bg-slate-200 shadow-inner">
                {(() => {
                  const googleOnly = data.trends.filter(
                    (t) => t.sources.includes('google') && !t.sources.includes('twitter')
                  ).length;
                  const twitterOnly = data.trends.filter(
                    (t) => t.sources.includes('twitter') && !t.sources.includes('google')
                  ).length;
                  const both = data.trends.filter(
                    (t) => t.sources.includes('google') && t.sources.includes('twitter')
                  ).length;
                  const total = data.trends.length || 1;
                  return (
                    <>
                      <div
                        className="bg-[#4285f4] transition-all duration-500"
                        style={{ width: `${(googleOnly / total) * 100}%` }}
                      />
                      <div
                        className="bg-gradient-to-r from-[#4285f4] to-slate-600 transition-all duration-500"
                        style={{ width: `${(both / total) * 100}%` }}
                      />
                      <div
                        className="bg-slate-800 transition-all duration-500"
                        style={{ width: `${(twitterOnly / total) * 100}%` }}
                      />
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </div>

      {panelOpen && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 animate-fade-in"
            aria-hidden
            onClick={() => { setPanelOpen(false); setSelectedTrend(null); }}
          />

          <aside
            className="fixed top-0 right-0 h-full w-full sm:max-w-[440px] panel-surface z-50 animate-slide-in flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="panel-trend-title"
          >
            <div className="panel-accent shrink-0" />
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl border-b border-slate-100 px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Article explorer
                  </p>
                  {selectedTrend && (
                    <h2 id="panel-trend-title" className="text-xl font-bold text-slate-800 leading-snug break-words">
                      {selectedTrend.keyword}
                    </h2>
                  )}
                  {selectedTrend && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedTrend.sources.map((s) => (
                        <span key={s} className={`badge ${s === 'google' ? 'badge-google' : 'badge-twitter'}`}>
                          {s === 'google' ? 'Google' : 'X'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setPanelOpen(false); setSelectedTrend(null); }}
                  className="shrink-0 w-9 h-9 rounded-full bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300 flex items-center justify-center transition-colors focus:outline-none focus:ring-4 focus:ring-slate-100"
                  aria-label="Close panel"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-slate-500">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {filterLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="glass-subtle p-5 rounded-xl border border-slate-100 bg-white">
                      <div className="h-4 w-[75%] animate-shimmer rounded-md mb-4 bg-slate-200" />
                      <div className="h-3 w-[45%] animate-shimmer rounded-md bg-slate-200" />
                    </div>
                  ))}
                  <p className="text-xs font-semibold text-slate-400 text-center pt-2">
                    Matching articles…
                  </p>
                </div>
              ) : filteredArticles.length === 0 ? (
                <div className="text-center py-20 px-4">
                  <div className="mx-auto w-16 h-16 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-5">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </div>
                  <p className="text-base font-bold text-slate-800">No articles matched</p>
                  <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-xs mx-auto">
                    Try another topic or widen the sitemap window. Pre-matched items from the table may still apply.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 pb-2">
                    <span className="text-xs font-bold text-slate-500">
                      {filteredArticles.length} result{filteredArticles.length === 1 ? '' : 's'}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        filteredArticles[0]?.method === 'llm'
                          ? 'border-[#4285f4]/30 text-[#1a73e8] bg-[#4285f4]/10'
                          : 'border-slate-300 text-slate-500 bg-slate-50'
                      }`}
                    >
                      {filteredArticles[0]?.method === 'llm' ? 'AI ranked' : 'Keyword'}
                    </span>
                  </div>
                  {filteredArticles.map((article) => (
                    <a
                      key={article.url}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block glass-subtle p-5 rounded-2xl border border-slate-200 hover:border-[#4285f4]/40 hover:bg-white hover:shadow-md transition-all-smooth group bg-white/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="text-sm font-bold text-slate-800 group-hover:text-[#1a73e8] transition-colors leading-snug">
                          {article.title}
                        </h4>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5 group-hover:stroke-[#4285f4] transition-colors">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${
                              article.relevanceScore >= 0.7
                                ? 'bg-[#34a853]'
                                : article.relevanceScore >= 0.5
                                  ? 'bg-[#fbbc04]'
                                  : 'bg-slate-400'
                            }`}
                          />
                          <span className="tabular-nums text-slate-600">
                            {(article.relevanceScore * 100).toFixed(0)}% relevance
                          </span>
                          <InfoTooltip text="Relevance is scored 0-100%. AI ranked uses LLM semantic matching. Keyword uses title/tag overlap. Green (70%+) = strong match, Yellow (50-69%) = moderate, Gray (<50%) = weak." />
                        </span>
                        {article.publishedAt && (
                          <span className="text-slate-400">{formatTimeAgo(article.publishedAt)}</span>
                        )}
                      </div>
                    </a>
                  ))}
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  icon,
  color,
  delay,
  tooltip,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: 'blue' | 'purple' | 'amber' | 'green';
  delay: number;
  tooltip?: string;
}) {
  const colors = {
    blue: {
      text: 'text-[#1a73e8]',
      border: 'border-[#4285f4]/20',
      iconBg: 'bg-[#4285f4]/10',
      iconColor: 'text-[#1a73e8]'
    },
    purple: {
      text: 'text-slate-800',
      border: 'border-slate-300',
      iconBg: 'bg-slate-100',
      iconColor: 'text-slate-700'
    },
    amber: {
      text: 'text-[#f29900]',
      border: 'border-[#fbbc04]/30',
      iconBg: 'bg-[#fbbc04]/10',
      iconColor: 'text-[#f29900]'
    },
    green: {
      text: 'text-[#188038]',
      border: 'border-[#34a853]/30',
      iconBg: 'bg-[#34a853]/10',
      iconColor: 'text-[#188038]'
    },
  };

  const c = colors[color];

  return (
    <div
      className={`card-glass p-6 sm:p-7 border ${c.border} animate-fade-in-up bg-white xl:bg-white/70`}
      style={{ animationDelay: `${delay * 0.06}s` }}
    >
      <div className="flex items-start justify-between gap-3 mb-5">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em] leading-tight inline-flex items-center gap-1.5">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <div
          className={`w-10 h-10 rounded-2xl ${c.iconBg} flex items-center justify-center shrink-0 ${c.iconColor}`}
        >
          {icon}
        </div>
      </div>
      <div className={`text-3xl sm:text-4xl font-bold tabular-nums tracking-tight ${c.text}`}>
        {value}
      </div>
      {subtitle && (
        <p className="text-xs font-medium text-slate-500 mt-2.5 leading-snug">{subtitle}</p>
      )}
    </div>
  );
}
