/**
 * Trend Deduplication Engine
 * 
 * Merges duplicate trends across Google & Twitter using:
 * 1. Exact match after normalization
 * 2. Hindi↔English transliteration matching
 * 3. Levenshtein fuzzy matching
 * 4. Bigram Jaccard similarity
 * 5. Substring containment
 * 6. Common Hindi↔English name mapping
 */

import {
  normalizeForComparison,
  findCommonMapping,
  containsHindi,
  transliterate,
} from './hindi-utils';

export interface RawTrend {
  keyword: string;
  source: 'google' | 'twitter';
  fetchedAt: string;
}

export interface UniqueTrend {
  keyword: string;           // Original (display) keyword
  normalizedKeyword: string; // Normalized for matching
  sources: ('google' | 'twitter')[];
  googleCount: number;
  twitterCount: number;
  originalKeywords: string[]; // All original variants that were merged
}

// ─── Levenshtein Distance ──────────────────────────────────────────
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,     // deletion
        dp[i][j - 1] + 1,     // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Normalized Levenshtein similarity (0 = completely different, 1 = identical)
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// ─── Bigram Jaccard Similarity ─────────────────────────────────────
function getBigrams(text: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.add(text.substring(i, i + 2));
  }
  return bigrams;
}

export function bigramJaccard(a: string, b: string): number {
  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Token Overlap (word-level) ────────────────────────────────────
function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(t => t.length > 1));
  const tokensB = new Set(b.split(/\s+/).filter(t => t.length > 1));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }

  const minSize = Math.min(tokensA.size, tokensB.size);
  return overlap / minSize;
}

// ─── Composite Similarity Check ────────────────────────────────────
export function areSimilar(
  a: string,
  b: string,
  levenshteinThreshold = 0.7,
  jaccardThreshold = 0.5
): boolean {
  // 1. Exact match
  if (a === b) return true;

  // 2. Substring containment (one contains the other)
  if (a.includes(b) || b.includes(a)) return true;

  // 3. Common mapping check (Hindi↔English known terms)
  const mappingA = findCommonMapping(a);
  const mappingB = findCommonMapping(b);
  if (mappingA && mappingB && mappingA === mappingB) return true;

  // 4. Token overlap ≥ 80%
  if (tokenOverlap(a, b) >= 0.8) return true;

  // 5. Levenshtein similarity
  if (levenshteinSimilarity(a, b) >= levenshteinThreshold) return true;

  // 6. Bigram Jaccard
  if (bigramJaccard(a, b) >= jaccardThreshold) return true;

  return false;
}

// ─── Cross-language Similarity ─────────────────────────────────────
function crossLanguageSimilar(rawA: string, rawB: string): boolean {
  const normA = normalizeForComparison(rawA);
  const normB = normalizeForComparison(rawB);

  // After normalization (which includes transliteration), compare
  if (areSimilar(normA, normB)) return true;

  // Also try direct transliteration comparison if one side is Hindi
  if (containsHindi(rawA) && !containsHindi(rawB)) {
    const transA = transliterate(rawA).toLowerCase().trim();
    const cleanB = rawB.toLowerCase().replace(/#/g, '').trim();
    if (areSimilar(transA, cleanB, 0.6, 0.4)) return true;
  }
  if (containsHindi(rawB) && !containsHindi(rawA)) {
    const transB = transliterate(rawB).toLowerCase().trim();
    const cleanA = rawA.toLowerCase().replace(/#/g, '').trim();
    if (areSimilar(transB, cleanA, 0.6, 0.4)) return true;
  }

  return false;
}

// ─── Main Deduplication Pipeline ───────────────────────────────────
export function deduplicateTrends(trends: RawTrend[]): UniqueTrend[] {
  const unique: UniqueTrend[] = [];

  for (const trend of trends) {
    const normalized = normalizeForComparison(trend.keyword);
    let merged = false;

    for (const existing of unique) {
      // Check similarity using normalized forms
      if (
        areSimilar(normalized, existing.normalizedKeyword) ||
        crossLanguageSimilar(trend.keyword, existing.keyword)
      ) {
        // Merge into existing
        if (!existing.sources.includes(trend.source)) {
          existing.sources.push(trend.source);
        }
        if (trend.source === 'google') existing.googleCount++;
        else existing.twitterCount++;
        existing.originalKeywords.push(trend.keyword);
        merged = true;
        break;
      }

      // Also check against all original keywords in the cluster
      for (const origKeyword of existing.originalKeywords) {
        if (crossLanguageSimilar(trend.keyword, origKeyword)) {
          if (!existing.sources.includes(trend.source)) {
            existing.sources.push(trend.source);
          }
          if (trend.source === 'google') existing.googleCount++;
          else existing.twitterCount++;
          existing.originalKeywords.push(trend.keyword);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }

    if (!merged) {
      unique.push({
        keyword: trend.keyword,
        normalizedKeyword: normalized,
        sources: [trend.source],
        googleCount: trend.source === 'google' ? 1 : 0,
        twitterCount: trend.source === 'twitter' ? 1 : 0,
        originalKeywords: [trend.keyword],
      });
    }
  }

  return unique;
}
