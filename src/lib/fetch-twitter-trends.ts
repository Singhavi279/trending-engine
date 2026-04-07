/**
 * Core Twitter/X Trends fetcher — reusable from merge route or standalone route.
 * Scrapes trending topics from trends24.in with getdaytrends.com fallback.
 */

import * as cheerio from 'cheerio';

export interface TwitterTrend {
  keyword: string;
  source: 'twitter';
  fetchedAt: string;
}

export interface TwitterTrendsResult {
  trends: TwitterTrend[];
  totalCount: number;
  source: 'twitter';
  fetchedAt: string;
}

export async function fetchTwitterTrends(): Promise<TwitterTrendsResult> {
  const maxTrends = parseInt(process.env.TWITTER_TRENDS_MAX || '20', 10);

  let trends = await fetchTrends24(maxTrends);

  if (trends.length === 0) {
    console.log('trends24.in failed, falling back to getdaytrends.com');
    trends = await fetchGetDayTrends(maxTrends);
  }

  return {
    trends,
    totalCount: trends.length,
    source: 'twitter',
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchTrends24(maxTrends: number): Promise<TwitterTrend[]> {
  try {
    await sleep(1000 + Math.random() * 2000);

    const url =
      process.env.TWITTER_TRENDS_URL || 'https://trends24.in/india/';

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      console.warn(`trends24.in returned ${response.status}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const trends: TwitterTrend[] = [];
    const now = new Date().toISOString();
    const seen = new Set<string>();

    $('.trend-card__list li').each((_i, el) => {
      const text = $(el).text().trim();
      if (text && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        trends.push({
          keyword: text,
          source: 'twitter',
          fetchedAt: now,
        });
      }
    });

    if (trends.length === 0) {
      $('ol.trend-card__list a, .trend-card li a').each((_i, el) => {
        const text = $(el).text().trim();
        if (text && !seen.has(text.toLowerCase())) {
          seen.add(text.toLowerCase());
          trends.push({ keyword: text, source: 'twitter', fetchedAt: now });
        }
      });
    }

    return trends.slice(0, maxTrends);
  } catch (error) {
    console.warn('trends24.in fetch error:', error);
    return [];
  }
}

async function fetchGetDayTrends(maxTrends: number): Promise<TwitterTrend[]> {
  try {
    await sleep(1000 + Math.random() * 2000);

    const url =
      process.env.TWITTER_TRENDS_FALLBACK ||
      'https://getdaytrends.com/india/';

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);
    const trends: TwitterTrend[] = [];
    const now = new Date().toISOString();
    const seen = new Set<string>();

    $('table.table tbody tr td a').each((_i, el) => {
      const text = $(el).text().trim();
      if (text && (text.startsWith('#') || text.length > 1)) {
        const clean = text.replace(/^#/, '').trim();
        if (clean.length < 2) return;
        if (!seen.has(clean.toLowerCase())) {
          seen.add(clean.toLowerCase());
          trends.push({ keyword: clean, source: 'twitter', fetchedAt: now });
        }
      }
    });

    return trends.slice(0, maxTrends);
  } catch (error) {
    console.warn('getdaytrends.com fetch error:', error);
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
