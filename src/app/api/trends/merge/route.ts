/**
 * Merge API — The Brain
 *
 * Orchestrates: fetch all sources → deduplicate → score → rank → respond
 * This is the single endpoint the dashboard calls.
 */

import { NextResponse } from 'next/server';
import { deduplicateTrends, type RawTrend } from '@/lib/dedup';
import { rankTrends, type Article } from '@/lib/scoring';
import { getInternalAppBaseUrl } from '@/lib/internal-base-url';
import { fetchJson } from '@/lib/fetch-json-internal';
import {
  appendTrendSnapshot,
  loadTrendHistory,
  type TrendHistorySnapshot,
} from '@/lib/trend-history-store';

export const dynamic = 'force-dynamic';

type SitemapPayload = { articles?: Article[] };
type TrendsPayload = {
  trends?: { keyword: string; fetchedAt: string }[];
};

export async function GET(request: Request) {
  try {
    const base = getInternalAppBaseUrl(request);
    const topN = parseInt(process.env.TOP_N || '10', 10);
    const maxArticlesOut = parseInt(
      process.env.MERGE_MAX_ARTICLES || '2000',
      10
    );

    const [sitemapResult, googleResult, twitterResult] = await Promise.all([
      fetchJson<SitemapPayload>(`${base}/api/sitemap`),
      fetchJson<TrendsPayload>(`${base}/api/trends/google`),
      fetchJson<TrendsPayload>(`${base}/api/trends/twitter`),
    ]);

    let sitemapError: string | null = null;
    let articles: Article[] = [];
    if (sitemapResult.ok) {
      if (Array.isArray(sitemapResult.data.articles)) {
        articles = sitemapResult.data.articles;
      } else {
        sitemapError = 'Sitemap response missing articles array';
      }
    } else {
      sitemapError = sitemapResult.error;
    }

    let googleError: string | null = null;
    let googleTrends: RawTrend[] = [];
    if (googleResult.ok) {
      if (Array.isArray(googleResult.data.trends)) {
        googleTrends = googleResult.data.trends.map(
          (t: { keyword: string; fetchedAt: string }) => ({
            keyword: t.keyword,
            source: 'google' as const,
            fetchedAt: t.fetchedAt,
          })
        );
      } else {
        googleError = 'Google response missing trends array';
      }
    } else {
      googleError = googleResult.error;
    }

    let twitterError: string | null = null;
    let twitterTrends: RawTrend[] = [];
    if (twitterResult.ok) {
      if (Array.isArray(twitterResult.data.trends)) {
        twitterTrends = twitterResult.data.trends.map(
          (t: { keyword: string; fetchedAt: string }) => ({
            keyword: t.keyword,
            source: 'twitter' as const,
            fetchedAt: t.fetchedAt,
          })
        );
      } else {
        twitterError = 'Twitter response missing trends array';
      }
    } else {
      twitterError = twitterResult.error;
    }

    const allTrends: RawTrend[] = [...googleTrends, ...twitterTrends];
    const uniqueTrends = deduplicateTrends(allTrends);
    const rankedTrends = rankTrends(uniqueTrends, articles, topN);

    const history: TrendHistorySnapshot[] = await loadTrendHistory();
    const lastSnapshot =
      history.length > 0 ? history[history.length - 1] : null;

    const trendsWithVelocity = rankedTrends.map((trend) => {
      if (!lastSnapshot) return { ...trend, velocity: 'new' as const };

      const prevTrend = (
        lastSnapshot.trends as Array<{
          normalizedKeyword?: string;
          rank?: number;
        }>
      ).find((t) => t.normalizedKeyword === trend.normalizedKeyword);

      if (!prevTrend || typeof prevTrend.rank !== 'number') {
        return { ...trend, velocity: 'new' as const };
      }

      const velocity = prevTrend.rank - trend.rank;
      return { ...trend, velocity };
    });

    const newSnapshot: TrendHistorySnapshot = {
      timestamp: new Date().toISOString(),
      trends: trendsWithVelocity,
    };
    await appendTrendSnapshot(newSnapshot, history);

    const totalGoogle = googleTrends.length;
    const totalTwitter = twitterTrends.length;
    const coveredCount = rankedTrends.filter((t) => t.isCovered).length;

    const articlesForClient = articles.slice(0, maxArticlesOut);

    return NextResponse.json({
      trends: trendsWithVelocity,
      articles: articlesForClient,
      stats: {
        totalGoogleTrends: totalGoogle,
        totalTwitterTrends: totalTwitter,
        totalRawTrends: allTrends.length,
        uniqueAfterDedup: uniqueTrends.length,
        articlesScanned: articles.length,
        coveragePercent:
          rankedTrends.length > 0
            ? Math.round((coveredCount / rankedTrends.length) * 100)
            : 0,
        coveredCount,
        uncoveredCount: rankedTrends.length - coveredCount,
      },
      errors: {
        sitemap: sitemapError,
        google: googleError,
        twitter: twitterError,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Merge API error:', error);
    return NextResponse.json(
      { error: 'Failed to merge trends', details: String(error) },
      { status: 500 }
    );
  }
}
