/**
 * Hindi ↔ English Transliteration & Detection Utilities
 * 
 * Provides robust Devanagari → Roman transliteration for cross-language
 * deduplication between Hindi articles and English/Hinglish trends.
 */

// Devanagari vowels → Roman
const VOWEL_MAP: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
  'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'an',
  'अः': 'ah',
};

// Devanagari consonants → Roman
const CONSONANT_MAP: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'w': 'w',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gya',
  'ड़': 'da', 'ढ़': 'dha', 'फ़': 'f', 'ज़': 'z', 'ऩ': 'na',
};

// Devanagari matra (vowel signs) → Roman
const MATRA_MAP: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ं': 'n', 'ः': 'h', 'ँ': 'n',
  '्': '', // Halant (virama) — suppresses inherent 'a'
};

// Devanagari numerals → Arabic
const NUMERAL_MAP: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

// Common Hindi ↔ English name mappings (high-frequency editorial terms)
const COMMON_MAPPINGS: Record<string, string[]> = {
  'modi': ['मोदी', 'मोदि'],
  'india': ['भारत', 'इंडिया', 'हिंदुस्तान', 'इण्डिया'],
  'pakistan': ['पाकिस्तान'],
  'cricket': ['क्रिकेट'],
  'ipl': ['आईपीएल'],
  'bjp': ['भाजपा', 'बीजेपी'],
  'congress': ['कांग्रेस', 'कॉन्ग्रेस'],
  'delhi': ['दिल्ली'],
  'mumbai': ['मुंबई', 'मुम्बई'],
  'election': ['चुनाव'],
  'budget': ['बजट'],
  'supreme court': ['सुप्रीम कोर्ट'],
  'weather': ['मौसम'],
  'earthquake': ['भूकंप', 'भूकम्प'],
  'rain': ['बारिश', 'बरसात'],
  'film': ['फिल्म', 'फ़िल्म'],
  'bollywood': ['बॉलीवुड'],
  'world cup': ['वर्ल्ड कप', 'विश्व कप'],
  'china': ['चीन'],
  'america': ['अमेरिका', 'अमरीका'],
  'trump': ['ट्रंप', 'ट्रम्प'],
  'ukraine': ['यूक्रेन'],
  'russia': ['रूस', 'रशिया'],
  'war': ['युद्ध', 'जंग'],
  'army': ['सेना'],
  'police': ['पुलिस'],
  'coronavirus': ['कोरोना', 'कोरोनावायरस'],
  'hospital': ['अस्पताल'],
  'school': ['स्कूल'],
  'university': ['विश्वविद्यालय', 'यूनिवर्सिटी'],
  'accident': ['हादसा', 'दुर्घटना'],
  'fire': ['आग'],
  'flood': ['बाढ़'],
  'stock market': ['शेयर बाजार', 'स्टॉक मार्केट'],
  'gold': ['सोना', 'गोल्ड'],
  'petrol': ['पेट्रोल'],
  'diesel': ['डीजल'],
  'tax': ['टैक्स', 'कर'],
  'railway': ['रेलवे', 'रेल'],
  'train': ['ट्रेन'],
  'flight': ['फ्लाइट', 'उड़ान'],
};

/**
 * Check if a Unicode character falls in the Devanagari range
 */
export function isDevanagari(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x0900 && code <= 0x097F;
}

/**
 * Check if a string contains any Hindi (Devanagari) characters
 */
export function containsHindi(text: string): boolean {
  return Array.from(text).some(isDevanagari);
}

/**
 * Transliterate Devanagari text to romanized form
 * Handles consonants, vowels, matras, conjuncts, and numerals
 */
export function transliterate(text: string): string {
  let result = '';
  const chars = Array.from(text);

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const nextChar = chars[i + 1];

    // Check two-char conjuncts first (e.g., क्ष, त्र, ज्ञ)
    if (nextChar) {
      const twoChar = char + nextChar;
      if (CONSONANT_MAP[twoChar]) {
        result += CONSONANT_MAP[twoChar];
        i++; // skip next
        // Check if followed by matra or halant
        if (chars[i + 1] && MATRA_MAP[chars[i + 1]] !== undefined) {
          result += MATRA_MAP[chars[i + 1]];
          i++;
        } else if (chars[i + 1] && !isDevanagari(chars[i + 1])) {
          // no inherent 'a' before non-devanagari
        } else if (!chars[i + 1] || (!MATRA_MAP[chars[i + 1]] && isDevanagari(chars[i + 1]))) {
          // Add inherent 'a' if no matra follows
        }
        continue;
      }
    }

    // Check numeral
    if (NUMERAL_MAP[char]) {
      result += NUMERAL_MAP[char];
      continue;
    }

    // Check matra
    if (MATRA_MAP[char] !== undefined) {
      result += MATRA_MAP[char];
      continue;
    }

    // Check vowel (standalone)
    if (VOWEL_MAP[char]) {
      result += VOWEL_MAP[char];
      continue;
    }

    // Check consonant
    if (CONSONANT_MAP[char]) {
      result += CONSONANT_MAP[char];
      // Add inherent 'a' unless followed by a matra or halant
      if (nextChar && MATRA_MAP[nextChar] !== undefined) {
        // Matra will be handled in next iteration
      } else {
        result += 'a';
      }
      continue;
    }

    // Pass through non-Devanagari characters (spaces, punctuation, Latin, etc.)
    result += char;
  }

  return result;
}

/**
 * Try to find a known English equivalent for Hindi text
 * Returns null if no common mapping found
 *
 * Important: do NOT use naive substring match on Hindi (e.g. "भारत" inside "भारतीय"),
 * or trends like "भारतीय स्टेट बैंक" incorrectly map to `india` and every "India" headline matches.
 */
export function findCommonMapping(text: string): string | null {
  const normalized = text.trim().toLowerCase();
  const hindiNormalized = text.trim();

  if (COMMON_MAPPINGS[normalized]) {
    return normalized;
  }

  for (const [english, hindiVariants] of Object.entries(COMMON_MAPPINGS)) {
    for (const hindi of hindiVariants) {
      if (hindiNormalized === hindi || normalized === hindi) {
        return english;
      }
    }
  }

  // Hindi: match only full whitespace-separated tokens (never substring inside a longer word)
  if (containsHindi(hindiNormalized)) {
    const tokens = hindiNormalized.split(/[\s\u200c\u200d,;]+/).filter(Boolean);
    for (const [english, hindiVariants] of Object.entries(COMMON_MAPPINGS)) {
      for (const hindi of hindiVariants) {
        if (tokens.some((t) => t === hindi)) {
          return english;
        }
      }
    }
    return null;
  }

  // Latin-only: English keys as whole words or phrases
  const words = normalized.split(/[\s,;/]+/).filter(Boolean);
  for (const englishKey of Object.keys(COMMON_MAPPINGS)) {
    if (!englishKey.includes(' ') && words.includes(englishKey)) {
      return englishKey;
    }
  }
  for (const englishKey of Object.keys(COMMON_MAPPINGS)) {
    if (!englishKey.includes(' ')) continue;
    const idx = normalized.indexOf(englishKey);
    if (idx >= 0) {
      const before = idx === 0 || /[\s,;]/.test(normalized[idx - 1]);
      const after =
        idx + englishKey.length === normalized.length ||
        /[\s,;]/.test(normalized[idx + englishKey.length]);
      if (before && after) return englishKey;
    }
  }

  return null;
}

/**
 * Normalize text for comparison: transliterate Hindi, lowercase, strip noise
 */
export function normalizeForComparison(text: string): string {
  let normalized = text.trim().toLowerCase();

  // Strip hashtags
  normalized = normalized.replace(/#/g, '');

  // Strip common noise characters
  normalized = normalized.replace(/[_\-–—]/g, ' ');

  // If contains Hindi, transliterate
  if (containsHindi(normalized)) {
    normalized = transliterate(normalized).toLowerCase();
  }

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}
