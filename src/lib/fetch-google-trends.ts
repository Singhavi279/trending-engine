/**
 * Core Google Trends fetcher — reusable from merge route or standalone route.
 * Fetches Google Trends RSS for India and parses into structured keywords.
 */

export interface GoogleTrend {
  keyword: string;
  source: 'google';
  approxTraffic: string;
  fetchedAt: string;
}

export interface GoogleTrendsResult {
  trends: GoogleTrend[];
  totalCount: number;
  source: 'google';
  fetchedAt: string;
}

export async function fetchGoogleTrends(): Promise<GoogleTrendsResult> {
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
    throw new Error(`Google Trends fetch failed: ${response.status}`);
  }

  const xml = await response.text();
  const trends = parseGoogleTrendsRss(xml, maxTrends);

  return {
    trends,
    totalCount: trends.length,
    source: 'google',
    fetchedAt: new Date().toISOString(),
  };
}

function parseGoogleTrendsRss(xml: string, maxTrends: number): GoogleTrend[] {
  const trends: GoogleTrend[] = [];
  const now = new Date().toISOString();

  const items = xml.match(/<item>([\s\S]*?)<\/item>/g);
  if (!items) return trends;

  for (const item of items.slice(0, maxTrends)) {
    const titleMatch =
      item.match(/<title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/title>/) ||
      item.match(/<title>\s*(.*?)\s*<\/title>/);
    const keyword = titleMatch ? titleMatch[1].trim() : '';

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
