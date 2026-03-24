/**
 * Trend ↔ article text matching: loose recall vs strict keyword rules.
 * Used by /api/llm/filter (recall + strict fallback) and detectCoverage.
 */

import { normalizeForComparison } from '@/lib/hindi-utils';
import { areSimilar } from '@/lib/dedup';

const STOPWORDS = new Set([
  'the',
  'and',
  'or',
  'for',
  'in',
  'on',
  'at',
  'to',
  'of',
  'a',
  'an',
  'is',
  'are',
  'was',
]);

export function significantTokens(trendNorm: string): string[] {
  return trendNorm
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Multi-word trend: full phrase or every significant token must appear in text */
export function strictMultiWordTextMatch(
  trendNorm: string,
  textNorm: string
): boolean {
  const sig = significantTokens(trendNorm);
  if (sig.length < 2) return true;
  if (textNorm.includes(trendNorm)) return true;
  return sig.every((w) => textNorm.includes(w));
}

/**
 * Loose recall for LLM candidate generation (partial word overlap OK).
 */
export function recallKeywordScore(
  trendNorm: string,
  titleNorm: string
): number {
  let score = 0;
  if (titleNorm.includes(trendNorm)) {
    score += 0.7;
  } else if (trendNorm.includes(titleNorm) && titleNorm.length > 2) {
    score += 0.5;
  }
  if (areSimilar(trendNorm, titleNorm, 0.6, 0.4)) {
    score += 0.3;
  }
  const trendWords = trendNorm.split(/\s+/);
  const matchingWords = trendWords.filter(
    (w) => w.length > 2 && titleNorm.includes(w)
  );
  score += (matchingWords.length / Math.max(trendWords.length, 1)) * 0.35;
  return Math.min(1, score);
}

export function recallFilterArticles(
  trend: string,
  articles: {
    url: string;
    title: string;
    keywords: string[];
    publishedAt: string;
  }[],
  maxCandidates: number
): typeof articles {
  const trendNorm = normalizeForComparison(trend);
  const scored = articles
    .map((a) => ({
      a,
      s: recallKeywordScore(trendNorm, normalizeForComparison(a.title)),
    }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, maxCandidates)
    .map((x) => x.a);
  return scored;
}

/**
 * Keyword-only path when LLM is off: strict for multi-word trends.
 */
export function keywordFilterStrict(
  trend: string,
  articles: {
    url: string;
    title: string;
    keywords: string[];
    publishedAt: string;
  }[]
): Array<{
  url: string;
  title: string;
  keywords: string[];
  publishedAt: string;
  relevanceScore: number;
  reason: string;
}> {
  const trendNorm = normalizeForComparison(trend);
  const sig = significantTokens(trendNorm);
  const multi = sig.length >= 2;
  const results: Array<{
    url: string;
    title: string;
    keywords: string[];
    publishedAt: string;
    relevanceScore: number;
    reason: string;
  }> = [];

  for (const article of articles) {
    const titleNorm = normalizeForComparison(article.title);
    let ok = false;
    let score = 0;

    if (multi) {
      if (!strictMultiWordTextMatch(trendNorm, titleNorm)) {
        let kwHit = false;
        for (const kw of article.keywords) {
          const kwNorm = normalizeForComparison(kw);
          if (strictMultiWordTextMatch(trendNorm, kwNorm)) {
            kwHit = true;
            break;
          }
        }
        if (!kwHit) continue;
      }
      ok = true;
      if (titleNorm.includes(trendNorm)) score = 0.95;
      else score = 0.75;
    } else {
      if (titleNorm.includes(trendNorm)) {
        ok = true;
        score = 0.85;
      } else if (trendNorm.includes(titleNorm) && titleNorm.length > 2) {
        ok = true;
        score = 0.55;
      } else if (areSimilar(trendNorm, titleNorm, 0.65, 0.45)) {
        ok = true;
        score = 0.5;
      } else {
        for (const kw of article.keywords) {
          const kwNorm = normalizeForComparison(kw);
          if (
            kwNorm.includes(trendNorm) ||
            trendNorm.includes(kwNorm) ||
            areSimilar(trendNorm, kwNorm, 0.65, 0.45)
          ) {
            ok = true;
            score = 0.45;
            break;
          }
        }
      }
    }

    if (ok) {
      results.push({
        ...article,
        relevanceScore: Math.min(1, score),
        reason: 'Keyword match (strict multi-word)',
      });
    }
  }

  return results;
}
