import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const pdfPath = process.env.CET6_PDF || '/workspace/attachments/79af4b49-3cb8-4da9-863c-fed27f0bd9e8/英语六级你还在背单词吗（新版）（7799词）乱序.pdf';
const jsonlPath = process.env.CET6_JSONL || '/workspace/attachments/8f0d87b3-e374-44a3-9eef-e541bfffdaad/六级 (1).jsonl';
const outDir = resolve('public/vocabulary');
mkdirSync(outDir, { recursive: true });

const clean = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
const key = value => clean(value).toLocaleLowerCase('en-US').replace(/[’]/g, "'");

function parsePdf() {
  const text = execFileSync('pdftotext', ['-raw', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const records = [];
  for (const pageText of text.split('\f')) {
    const lines = pageText.split(/\r?\n/).map(clean).filter(Boolean);
    const headers = lines.flatMap((line, index) => line === 'Word Meaning' ? [index] : []);
    if (headers.length < 2) continue;
    const wordLines = lines.slice(headers[0] + 1, headers[1]);
    const words = new Map();
    let pendingWordRank = null;
    for (const line of wordLines) {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (match) {
        pendingWordRank = null;
        words.set(Number(match[1]), match[2]);
      } else if (/^\d+$/.test(line)) {
        pendingWordRank = Number(line);
        words.set(pendingWordRank, '');
      } else if (pendingWordRank !== null) {
        words.set(pendingWordRank, clean(`${words.get(pendingWordRank)} ${line}`));
      }
    }
    const meaningLines = lines.slice(headers[1] + 1);
    const meanings = new Map();
    let current = null;
    for (const line of meaningLines) {
      if (/^英语六级|^共 7803|^扫码听单词|^纸上默写/.test(line)) break;
      const start = line.match(/^(\d+)(?:\s+(.*))?$/);
      if (start) {
        current = Number(start[1]);
        meanings.set(current, start[2] ? [start[2]] : []);
      } else if (current !== null) {
        meanings.get(current).push(line);
      }
    }
    for (const [rank, word] of words) {
      records.push({ rank, word: clean(word), meaning: clean((meanings.get(rank) || []).join(' ')) });
    }
  }
  records.sort((a, b) => a.rank - b.rank);
  return records;
}

function parseJsonl() {
  const map = new Map();
  let rows = 0;
  for (const line of readFileSync(jsonlPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows += 1;
    const record = JSON.parse(line);
    const head = record.headWord || record.content?.word?.wordHead;
    if (head && !map.has(key(head))) map.set(key(head), record);
  }
  return { map, rows };
}

const pdf = parsePdf();
const { map: dictionary, rows: jsonlRows } = parseJsonl();
const rankErrors = [];
for (let index = 0; index < pdf.length; index += 1) {
  if (pdf[index].rank !== index + 1) rankErrors.push({ expected: index + 1, actual: pdf[index].rank });
}
if (pdf.length !== 7803 || rankErrors.length) {
  const seen = new Set(pdf.map(item => item.rank));
  const missing = Array.from({ length: 7803 }, (_, index) => index + 1).filter(rank => !seen.has(rank));
  const duplicates = pdf.filter((item, index) => pdf.findIndex(candidate => candidate.rank === item.rank) !== index).map(item => item.rank);
  throw new Error(`PDF parsing failed: ${pdf.length} records, ${rankErrors.length} rank errors; missing=${missing.slice(0, 30)} duplicates=${duplicates.slice(0, 30)}`);
}

const entriesByPos = new Map();
const posOf = meaning => [...meaning.matchAll(/(?:^|\s)(adj|adv|pron|prep|conj|det|num|modal|aux|vi|vt|v|n)\./g)].map(match => match[1]);
for (const item of pdf) {
  const pos = posOf(item.meaning)[0] || 'word';
  if (!entriesByPos.has(pos)) entriesByPos.set(pos, []);
  entriesByPos.get(pos).push(item);
}
const choosePeers = (item, count = 2) => {
  const pos = posOf(item.meaning)[0] || 'word';
  const pool = entriesByPos.get(pos) || pdf;
  const at = pool.findIndex(entry => entry.rank === item.rank);
  const peers = [];
  for (let step = 1; peers.length < count && step < pool.length; step += 1) {
    const candidate = pool[(at + step * 37) % pool.length];
    if (key(candidate.word) !== key(item.word) && !peers.some(peer => key(peer.word) === key(candidate.word))) peers.push(candidate);
  }
  for (let step = 1; peers.length < count && step < pdf.length; step += 1) {
    const candidate = pdf[(item.rank + step * 53) % pdf.length];
    if (key(candidate.word) !== key(item.word) && !peers.some(peer => key(peer.word) === key(candidate.word))) peers.push(candidate);
  }
  return peers;
};
const firstChineseMeaning = meaning => clean(meaning.replace(/(?:^|\s)(?:adj|adv|pron|prep|conj|det|num|modal|aux|vi|vt|v|n)\.\s*/g, '').split(/[;；]/)[0]) || meaning;
const replaceWord = (sentence, word) => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sentence.replace(new RegExp(`\\b${escaped}\\b`, 'i'), '______');
};
const generatedCollocation = (word, pos) => {
  if (pos.includes('v')) return `${word} the situation`;
  if (pos.includes('adj')) return `a ${word} approach`;
  if (pos.includes('adv')) return `${word} different`;
  if (pos.includes('prep')) return `${word} the meeting`;
  return `the ${word}`;
};

let enrichedCount = 0;
let missingMeaning = 0;
let missingPos = 0;
let generatedExampleCount = 0;
const duplicateWords = new Map();
const words = pdf.map(item => {
  duplicateWords.set(key(item.word), (duplicateWords.get(key(item.word)) || 0) + 1);
  const source = dictionary.get(key(item.word));
  if (source) enrichedCount += 1;
  const content = source?.content?.word?.content || {};
  const sourceSentences = content.sentence?.sentences || [];
  const phrases = (content.phrase?.phrases || []).map(value => clean(value.pContent)).filter(Boolean);
  const synonyms = (content.syno?.synos || []).flatMap(group => group.hwds || []).map(value => clean(value.w)).filter(Boolean);
  const parts = [...new Set([...posOf(item.meaning), ...(content.trans || []).map(value => value.pos).filter(Boolean)])];
  if (!item.meaning) missingMeaning += 1;
  if (!parts.length) missingPos += 1;
  const pos = parts[0] || 'word';
  const peers = choosePeers(item, 2);
  const meaning = firstChineseMeaning(item.meaning);
  const peerMeanings = peers.map(peer => firstChineseMeaning(peer.meaning));
  const collocation = phrases.find(value => key(value).includes(key(item.word))) || generatedCollocation(item.word, pos);
  const peerCollocations = peers.map(peer => generatedCollocation(peer.word, posOf(peer.meaning)[0] || 'word'));
  const introSentence = clean(sourceSentences[0]?.sContent || `The editor used “${item.word}” while revising today's article.`);
  const introTranslation = clean(sourceSentences[0]?.sCn || `编辑在修改今天的文章时使用了“${item.word}”。`);
  if (!sourceSentences[0]?.sContent) generatedExampleCount += 1;
  let contextSentence = sourceSentences.slice(1).map(value => clean(value.sContent)).find(sentence => new RegExp(`\\b${item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sentence));
  let contextTranslation = sourceSentences.slice(1).find(value => clean(value.sContent) === contextSentence)?.sCn;
  if (contextSentence) contextSentence = replaceWord(contextSentence, item.word);
  else {
    contextSentence = `The editor needs a word meaning “${meaning}”: ______.`;
    contextTranslation = `编辑需要一个表示“${meaning}”的词。`;
  }
  const rotate = (values, offset) => {
    const result = [...values];
    for (let index = 0; index < offset % result.length; index += 1) result.push(result.shift());
    return result;
  };
  const distinct = (answer, alternatives, peersForLabels) => [answer, ...alternatives.map((value, index) => key(value) === key(answer) || alternatives.slice(0, index).some(previous => key(previous) === key(value)) ? `${value}（${peersForLabels[index].word}）` : value)];
  const meaningOptions = rotate(distinct(meaning, peerMeanings, peers), item.rank % 3);
  const collocationOptions = rotate(distinct(collocation, peerCollocations, peers), (item.rank + 1) % 3);
  const wordOptions = rotate([item.word, ...peers.map(peer => peer.word)], (item.rank + 2) % 3);
  return {
    id: `CET6-${String(item.rank).padStart(6, '0')}`,
    sourceOrder: item.rank,
    word: item.word,
    phonetic: clean(content.ukphone || content.usphone || content.phone || ''),
    partOfSpeech: parts.length ? parts : ['word'],
    meanings: [item.meaning],
    acceptedSpellings: [item.word],
    intro: { primaryMeaning: meaning, collocations: [...new Set([collocation, ...phrases.slice(0, 2)])], exampleSentence: introSentence, exampleTranslation: introTranslation },
    meaningQuestion: { prompt: `${item.word} 最准确的意思是：`, options: meaningOptions, correctIndex: meaningOptions.indexOf(meaning), explanation: `${item.word}：${meaning}` },
    collocationQuestion: { prompt: '选择最自然的搭配：', options: collocationOptions, correctIndex: collocationOptions.indexOf(collocation), explanation: `常见搭配：${collocation}` },
    reviewQuestion: { options: meaningOptions, correctIndex: meaningOptions.indexOf(meaning) },
    contextQuestion: { sentence: contextSentence, translation: clean(contextTranslation || ''), options: wordOptions, correctIndex: wordOptions.indexOf(item.word), explanation: `${item.word} 在这里表示“${meaning}”。` },
    signingQuestion: { meaningPrompt: `${parts.join('. ')}. ${meaning}`, sentence: contextSentence, requiredForm: item.word },
    enrichment: { matchedJsonl: Boolean(source), synonyms: synonyms.slice(0, 8) }
  };
});

const validationErrors = [];
for (const word of words) {
  if (!word.word || !word.meanings[0] || !word.partOfSpeech.length || !word.intro.exampleSentence) validationErrors.push(`${word.id}: missing required field`);
  for (const question of [word.meaningQuestion, word.collocationQuestion, word.reviewQuestion, word.contextQuestion]) {
    if (question.options.length !== 3 || new Set(question.options.map(key)).size !== 3 || question.correctIndex < 0) validationErrors.push(`${word.id}: invalid options`);
  }
}
if (validationErrors.length) throw new Error(`Validation failed:\n${validationErrors.slice(0, 20).join('\n')}`);

const chunks = [];
for (let start = 0; start < words.length; start += 500) {
  const chunk = words.slice(start, start + 500);
  const file = `words-${String(start + 1).padStart(4, '0')}-${String(start + chunk.length).padStart(4, '0')}.json`;
  writeFileSync(resolve(outDir, file), JSON.stringify(chunk));
  chunks.push({ file, start: start + 1, end: start + chunk.length, count: chunk.length });
}
const vocabularyHash = createHash('sha256').update(JSON.stringify(words)).digest('hex');
const manifest = { version: `2026.10.12-${vocabularyHash.slice(0, 12)}`, totalWords: words.length, chunks, sha256: vocabularyHash, generatedAt: new Date().toISOString() };
const report = {
  pdfSource: basename(pdfPath), jsonlSource: basename(jsonlPath), pdfDeclaredTotal: 7803, parsedPdfRows: pdf.length,
  successfulImports: words.length, explicitErrors: 0, jsonlRows, matchedJsonlWords: enrichedCount,
  pdfOnlyWords: words.length - enrichedCount, duplicateHeadwords: [...duplicateWords.values()].filter(count => count > 1).reduce((sum, count) => sum + count - 1, 0),
  missingMeaning, missingPartOfSpeech: missingPos, generatedIntroExamples: generatedExampleCount,
  validationErrors: validationErrors.length, reconciliation: `${words.length} successful + 0 errors = ${pdf.length} PDF rows`, vocabularySha256: vocabularyHash
};
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(resolve(outDir, 'import-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
