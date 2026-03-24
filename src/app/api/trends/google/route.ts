/**
 * Google Trends API — Fetches trending topics from India RSS feed
 * Returns structured trend keywords with source attribution
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface GoogleTrend {
  keyword: string;
  source: 'google';
  approxTraffic: string;
  fetchedAt: string;
}

export async function GET() {
  try {
    const feedUrl =
      process.env.GOOGLE_TRENDS_URL ||
      'https://trends.google.com/trending/rss?geo=IN';
    const maxTrends = parseInt(process.env.GOOGLE_TRENDS_MAX || '20', 10);

    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'TrendingEngine/1.0 (Times Internet Editorial)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Google Trends fetch failed: ${response.status}` },
        { status: 502 }
      );
    }

    const xml = await response.text();
    const trends = parseGoogleTrendsRss(xml, maxTrends);

    return NextResponse.json({
      trends,
      totalCount: trends.length,
      source: 'google',
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Google Trends API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Google Trends', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Parse Google Trends RSS XML
 */
function parseGoogleTrendsRss(xml: string, maxTrends: number): GoogleTrend[] {
  const trends: GoogleTrend[] = [];
  const now = new Date().toISOString();

  // Match each <item> block
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g);
  if (!items) return trends;

  for (const item of items.slice(0, maxTrends)) {
    // Extract <title>
    const titleMatch =
      item.match(/<title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/title>/) ||
      item.match(/<title>\s*(.*?)\s*<\/title>/);
    const keyword = titleMatch ? titleMatch[1].trim() : '';

    // Extract approximate traffic if available
    const trafficMatch = item.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/);
    const approxTraffic = trafficMatch ? trafficMatch[1].trim() : '';

    if (keyword) {
      trends.push({
        keyword,
        source: 'google',
        approxTraffic,
        fetchedAt: now,
      });
    }
  }

  return trends;
}
