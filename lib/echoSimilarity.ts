const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'i',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'so',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'with',
  'you',
  'your',
]);

export function wordsFromEchoTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function weightedWordTotal(words: Set<string>, documentFrequency: Map<string, number>) {
  return [...words].reduce((total, word) => {
    const frequency = documentFrequency.get(word) ?? 1;
    return total + 1 + 1 / frequency;
  }, 0);
}

export function buildTitleDocumentFrequency(titles: string[]) {
  const documentFrequency = new Map<string, number>();

  titles.forEach((title) => {
    const uniqueWords = new Set(wordsFromEchoTitle(title));

    uniqueWords.forEach((word) => {
      documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    });
  });

  return documentFrequency;
}

export function scoreEchoTitleSimilarity(
  sourceTitle: string,
  candidateTitle: string,
  documentFrequency: Map<string, number>
) {
  const sourceWords = new Set(wordsFromEchoTitle(sourceTitle));
  const candidateWords = new Set(wordsFromEchoTitle(candidateTitle));

  if (sourceWords.size === 0 || candidateWords.size === 0) return 0;

  let overlap = 0;

  sourceWords.forEach((word) => {
    if (!candidateWords.has(word)) return;

    const frequency = documentFrequency.get(word) ?? 1;
    overlap += 1 + 1 / frequency;
  });

  if (overlap === 0) return 0;

  const sourceTotal = weightedWordTotal(sourceWords, documentFrequency);
  const candidateTotal = weightedWordTotal(candidateWords, documentFrequency);

  return overlap / Math.max(sourceTotal, candidateTotal);
}
