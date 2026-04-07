/**
 * LLM Filter API — Recall (loose keyword) → LLM intent verification, or strict keyword when LLM off.
 */

import { NextResponse } from 'next/server';
import {
  recallFilterArticles,
  keywordFilterStrict,
} from '@/lib/article-match';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TREND_LEN = 400;
const MAX_ARTICLES_IN_REQUEST = 2000;
const MAX_TITLE_CHARS = 500;
const MAX_URL_CHARS = 2048;
const MAX_KEYWORD_LEN = 200;
const RECALL_MAX_CANDIDATES = 40;
function getIntentMinScore(): number {
  return parseFloat(process.env.LLM_INTENT_MIN_SCORE || '0.5');
}

interface FilterRequest {
  trend: string;
  articles: {
    url: string;
    title: string;
    keywords: string[];
    publishedAt: string;
  }[];
}

interface ScoredArticle {
  url: string;
  title: string;
  keywords: string[];
  publishedAt: string;
  relevanceScore: number;
  reason: string;
  method: 'llm' | 'keyword';
}

function normalizeIncomingArticles(
  raw: unknown
): FilterRequest['articles'] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: FilterRequest['articles'] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    let keywords: string[] = [];
    if (Array.isArray(o.keywords)) {
      keywords = o.keywords.filter((k): k is string => typeof k === 'string');
    } else if (typeof o.keywords === 'string') {
      keywords = o.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    }
    const publishedAt =
      typeof o.publishedAt === 'string'
        ? o.publishedAt
        : o.publishedAt != null
          ? String(o.publishedAt)
          : '';
    if (url && title) {
      out.push({ url, title, keywords, publishedAt });
    }
  }
  return out.length > 0 ? out : null;
}

function sanitizeArticles(
  articles: FilterRequest['articles']
): FilterRequest['articles'] {
  return articles.map((a) => ({
    url: a.url.slice(0, MAX_URL_CHARS),
    title: a.title.slice(0, MAX_TITLE_CHARS),
    keywords: a.keywords
      .filter((k) => k.length <= MAX_KEYWORD_LEN)
      .slice(0, 40),
    publishedAt: a.publishedAt.slice(0, 64),
  }));
}

const INTENT_SYSTEM = `You verify whether a news headline is about the SAME real-world topic as a trending search query (Google Trends style).

Rules:
- Multi-word trends are often a specific entity (e.g. "Mumbai Indians" = IPL cricket team). Headlines only about Mumbai city, crime, politics, transport, or generic "Mumbai" news WITHOUT the team/IPL/cricket context must get same_intent false.
- Do not mark a match just because a city or country name overlaps (e.g. "India" vs unrelated India news).
- Hindi and English may be mixed; judge semantic intent, not literal substring overlap alone.
- Respond ONLY with valid JSON: {"same_intent": true or false, "relevance_score": 0.0 to 1.0, "reason": "short justification"}`;

async function llmIntentVerifyBatch(
  trend: string,
  articles: FilterRequest['articles']
): Promise<ScoredArticle[]> {
  const baseUrl = (
    process.env.LLM_BASE_URL || 'http://localhost:11434/v1'
  ).replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'llama3.2';

  const results: ScoredArticle[] = [];
  const batchSize = 5;

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async (article) => {
        try {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.NVIDIA_API_KEY || 'ollama'}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: INTENT_SYSTEM },
                {
                  role: 'user',
                  content: `Trending query: ${trend}\nHeadline: ${article.title}\nArticle keywords (if any): ${article.keywords.join(', ') || 'none'}`,
                },
              ],
              temperature: 0.1,
              max_tokens: 200,
            }),
            signal: AbortSignal.timeout(12000),
          });

          if (!response.ok) throw new Error(`LLM returned ${response.status}`);

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('Invalid LLM response format');

          const parsed = JSON.parse(jsonMatch[0]) as {
            same_intent?: boolean;
            relevance_score?: number;
            reason?: string;
          };

          const minScore = getIntentMinScore();
          if (parsed.same_intent === false) return null;

          const score = Math.min(
            1,
            Math.max(0, Number(parsed.relevance_score) || 0)
          );
          if (score < minScore) return null;

          return {
            ...article,
            relevanceScore: score,
            reason: parsed.reason || 'Intent verified',
            method: 'llm' as const,
          };
        } catch {
          return null;
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }
  }

  return results;
}

export async function POST(request: Request) {
  try {
    const lenHeader = request.headers.get('content-length');
    if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const body = parsed as Record<string, unknown>;
    const trendRaw = body.trend;
    const articlesRaw = body.articles;

    if (typeof trendRaw !== 'string' || !trendRaw.trim()) {
      return NextResponse.json(
        { error: 'Missing or invalid trend' },
        { status: 400 }
      );
    }
    const trend = trendRaw.trim().slice(0, MAX_TREND_LEN);

    const normalized = normalizeIncomingArticles(articlesRaw);
    if (!normalized) {
      return NextResponse.json(
        { error: 'Missing or empty articles' },
        { status: 400 }
      );
    }
    if (normalized.length > MAX_ARTICLES_IN_REQUEST) {
      return NextResponse.json(
        { error: `At most ${MAX_ARTICLES_IN_REQUEST} articles allowed` },
        { status: 400 }
      );
    }

    const articles = sanitizeArticles(normalized);
    const llmEnabled = process.env.LLM_RERANK_ENABLED === 'true';

    let results: ScoredArticle[];

    if (llmEnabled) {
      const candidates = recallFilterArticles(
        trend,
        articles,
        RECALL_MAX_CANDIDATES
      );
      if (candidates.length === 0) {
        results = [];
      } else {
        const verified = await llmIntentVerifyBatch(trend, candidates);
        results = verified
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, 20);
      }
    } else {
      const strict = keywordFilterStrict(trend, articles);
      results = strict.map((r) => ({
        ...r,
        method: 'keyword' as const,
      }));
      const MIN_KW = 0.28;
      results = results
        .filter((r) => r.relevanceScore >= MIN_KW)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 20);
    }

    return NextResponse.json({
      trend,
      articles: results,
      totalMatches: results.length,
      method: results[0]?.method || 'keyword',
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('LLM Filter API error:', error);
    return NextResponse.json(
      { error: 'Failed to filter articles', details: String(error) },
      { status: 500 }
    );
  }
}
