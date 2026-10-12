import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'csv-parse';
import { dictionary as cmu } from 'cmu-pronouncing-dictionary';
import { CURATED } from './curated-overrides.mjs';

const require = createRequire(import.meta.url);
const wordnetPath = require('wordnet-db').path;
const vocabularyDir = resolve('public/vocabulary');
const ecdictPath = process.env.ECDICT_CSV || '/tmp/ecdict/ecdict.csv';
const corpusRoot = process.env.CORPUS_ROOT || '/tmp/cet6-corpora';
if (!existsSync(ecdictPath) || !existsSync(corpusRoot)) {
  throw new Error('Missing enrichment sources. Set ECDICT_CSV and CORPUS_ROOT before running.');
}

const manifestPath = join(vocabularyDir, 'manifest.json');
const reportPath = join(vocabularyDir, 'import-report.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const words = manifest.chunks.flatMap(chunk => JSON.parse(readFileSync(join(vocabularyDir, chunk.file), 'utf8')));
const cleanKey = value => value.normalize('NFKC').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
const byKey = new Map();
for (const word of words) {
  const key = cleanKey(word.word);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(word);
}
const targets = new Set(byKey.keys());
const templateExample = value => value.startsWith('The editor used “');
const templateContext = value => value.startsWith('The editor needs a word meaning');
const templateCollocation = (value, word) => [
  `the ${word}`, `${word} the situation`, `a ${word} approach`, `${word} different`, `${word} the meeting`,
].includes(cleanKey(value));

// ECDICT provides offline phonetics for nearly all entries missing them.
const ecdict = new Map();
await new Promise((resolvePromise, reject) => {
  createReadStream(ecdictPath)
    .pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true }))
    .on('data', row => {
      const key = cleanKey(row.word || '');
      if (targets.has(key) && !ecdict.has(key)) ecdict.set(key, row);
    })
    .on('end', resolvePromise)
    .on('error', reject);
});

const arpa = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
function arpabetToIpa(value) {
  return value.split(' ').filter(phone => phone && phone !== '#').map(phone => {
    const match = phone.match(/^([A-Z]+)([012])?$/);
    if (!match || !arpa[match[1]]) return '';
    let sound = arpa[match[1]];
    if (match[1] === 'AH' && match[2] === '0') sound = 'ə';
    if (match[1] === 'ER' && match[2] === '0') sound = 'ɚ';
    return `${match[2] === '1' ? 'ˈ' : match[2] === '2' ? 'ˌ' : ''}${sound}`;
  }).join('');
}
function cmuPhonetic(value) {
  const aliases = candidate => [candidate, candidate.replace(/ise\b/g, 'ize'), candidate.replace(/isation\b/g, 'ization'), candidate.replace(/our\b/g, 'or')];
  const parts = cleanKey(value).split(/[ -]+/).map(part => {
    const candidate = aliases(part).find(item => cmu[item]);
    return candidate ? arpabetToIpa(cmu[candidate].split(' #')[0]) : '';
  });
  return parts.every(Boolean) ? parts.join(' ') : '';
}
const normalizePhonetic = value => value.replace(/ә/g, 'ə').replace(/ɡ/g, 'g').replace(/:/g, 'ː').trim();

// Build a small, high-quality sentence index from licensed offline corpora.
const sentenceBank = new Map([...targets].map(key => [key, []]));
const oneWordTargets = new Set([...targets].filter(key => /^[a-z]+(?:[-'][a-z]+)*$/.test(key)));
const phraseTargets = [...targets].filter(key => key.includes(' '));
const tokenPattern = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g;
function normalizeSentence(value) {
  return value.normalize('NFKC').replace(/&lt;|&gt;|&amp;|&quot;/g, match => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' })[match]).replace(/``|''/g, '"').replace(/\s+([,.;:!?])/g, '$1').replace(/([“"(])\s+/g, '$1').replace(/\s+/g, ' ').trim();
}
function isGoodSentence(sentence) {
  const tokens = sentence.match(tokenPattern) || [];
  if (tokens.length < 5 || tokens.length > 24) return false;
  if (!/^[“"']?[A-Z]/.test(sentence) || !/[.!?]["”']?$/.test(sentence) || /https?:|www\.|[<>]|Project Gutenberg|@|_{2,}|\?\?|\\/i.test(sentence)) return false;
  const letters = sentence.replace(/[^A-Za-z]/g, '');
  if (!letters || [...letters].filter(char => char === char.toUpperCase()).length / letters.length > 0.45) return false;
  return true;
}
function addSentence(value) {
  const sentence = normalizeSentence(value);
  if (!isGoodSentence(sentence)) return;
  const lower = cleanKey(sentence);
  const tokens = new Set((lower.match(tokenPattern) || []).map(cleanKey));
  for (const token of tokens) {
    if (!oneWordTargets.has(token)) continue;
    const bucket = sentenceBank.get(token);
    if (bucket.length < 15 && !bucket.includes(sentence)) bucket.push(sentence);
  }
  for (const phrase of phraseTargets) {
    if (!lower.match(new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`))) continue;
    const bucket = sentenceBank.get(phrase);
    if (bucket.length < 15 && !bucket.includes(sentence)) bucket.push(sentence);
  }
}
function filesUnder(directory) {
  const result = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...filesUnder(path));
    else result.push(path);
  }
  return result;
}
const brownPath = join(corpusRoot, 'brown');
if (existsSync(brownPath)) {
  for (const path of filesUnder(brownPath).filter(path => /\/c[a-z]\d+$/.test(path))) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const sentence = line.split(/\s+/).filter(Boolean).map(token => token.includes('/') ? token.slice(0, token.lastIndexOf('/')) : token).join(' ');
      addSentence(sentence);
    }
  }
}
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
for (const subdirectory of ['reuters', 'movie_reviews', 'gutenberg', 'inaugural', 'state_union', 'webtext']) {
  const directory = join(corpusRoot, subdirectory);
  if (!existsSync(directory)) continue;
  for (const path of filesUnder(directory).filter(path => !/README|cats\.txt|stopwords/i.test(path))) {
    let text = readFileSync(path, 'utf8').replace(/\r/g, ' ').replace(/\n+/g, ' ');
    text = text.replace(/<[^>]+>/g, ' ');
    for (const item of segmenter.segment(text)) addSentence(item.segment);
  }
}

// WordNet examples supplement uncommon words absent from the general corpora.
for (const filename of ['data.noun', 'data.verb', 'data.adj', 'data.adv']) {
  for (const line of readFileSync(join(wordnetPath, filename), 'utf8').split(/\r?\n/)) {
    if (!/^\d/.test(line)) continue;
    const examples = [...line.slice(line.indexOf('|') + 1).matchAll(/"([^"]+)"/g)].map(match => match[1]);
    for (const example of examples) addSentence(/[.!?]$/.test(example) ? example : `${example}.`);
  }
}

const stopwords = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'some', 'any', 'and', 'or', 'but', 'if', 'then', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'to', 'of']);
function bestCollocation(word, sentences, partOfSpeech) {
  const target = cleanKey(word).split(' ');
  const candidates = new Map();
  for (const sentence of sentences) {
    const tokens = (cleanKey(sentence).match(tokenPattern) || []);
    for (let index = 0; index <= tokens.length - target.length; index += 1) {
      if (!target.every((token, offset) => tokens[index + offset] === token)) continue;
      const spans = [];
      if (index > 0) spans.push(tokens.slice(index - 1, index + target.length));
      if (index + target.length < tokens.length) spans.push(tokens.slice(index, index + target.length + 1));
      if (index > 0 && index + target.length < tokens.length) spans.push(tokens.slice(index - 1, index + target.length + 1));
      if (index + target.length + 1 < tokens.length) spans.push(tokens.slice(index, index + target.length + 2));
      for (const span of spans) {
        const other = span.filter(token => !target.includes(token));
        if (!other.some(token => !stopwords.has(token))) continue;
        const phrase = span.join(' ');
        let bonus = 0;
        if (/^v/.test(partOfSpeech)) {
          if (!phrase.startsWith(`${cleanKey(word)} `)) continue;
          bonus += 4;
        }
        if (/^adj/.test(partOfSpeech)) {
          if (!phrase.startsWith(`${cleanKey(word)} `)) continue;
          bonus += 5;
        }
        if (/^n/.test(partOfSpeech)) {
          const endsWithWord = phrase.endsWith(` ${cleanKey(word)}`);
          const startsWithPreposition = phrase.startsWith(`${cleanKey(word)} `) && /\b(of|for|in|on|with|against|between|from)\b/.test(phrase);
          if (!endsWithWord && !startsWithPreposition) continue;
          bonus += 3;
        }
        candidates.set(phrase, (candidates.get(phrase) || 0) + 10 + bonus - span.length);
      }
    }
  }
  return [...candidates].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] || '';
}
function blankWord(sentence, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sentence.replace(new RegExp(`(^|[^A-Za-z])(${escaped})(?=[^A-Za-z]|$)`, 'i'), (_, prefix) => `${prefix}______`);
}

let phoneticsAdded = 0;
let examplesReplaced = 0;
let contextsReplaced = 0;
let collocationsReplaced = 0;
for (const [key, entries] of byKey) {
  const dictionaryEntry = ecdict.get(key);
  const sentenceScore = sentence => Math.abs((sentence.match(tokenPattern) || []).length - 12) + (sentence.match(/["“”]/g) || []).length * 2 + (/[;$]/.test(sentence) ? 3 : 0);
  const sentences = [...(sentenceBank.get(key) || [])].sort((a, b) => sentenceScore(a) - sentenceScore(b));
  for (const word of entries) {
    if (!word.phonetic) {
      const phonetic = normalizePhonetic(dictionaryEntry?.phonetic || cmuPhonetic(word.word));
      if (phonetic) { word.phonetic = phonetic; phoneticsAdded += 1; }
    }
    if (templateExample(word.intro.exampleSentence) && sentences[0]) {
      word.intro.exampleSentence = sentences[0];
      word.intro.exampleTranslation = '';
      examplesReplaced += 1;
    }
    if (templateContext(word.contextQuestion.sentence)) {
      const contextSource = sentences.find(sentence => sentence !== word.intro.exampleSentence && blankWord(sentence, word.word) !== sentence);
      if (contextSource) {
        const sentence = blankWord(contextSource, word.word);
        word.contextQuestion.sentence = sentence;
        word.contextQuestion.translation = '';
        word.signingQuestion.sentence = sentence;
        contextsReplaced += 1;
      }
    }
    const current = word.intro.collocations[0] || '';
    if (templateCollocation(current, word.word)) {
      const collocation = bestCollocation(word.word, sentences, word.partOfSpeech[0] || '');
      if (collocation) {
        word.intro.collocations = [collocation, ...word.intro.collocations.filter(value => value !== current)].slice(0, 3);
        const answer = word.collocationQuestion.options[word.collocationQuestion.correctIndex];
        word.collocationQuestion.options[word.collocationQuestion.correctIndex] = collocation;
        word.collocationQuestion.explanation = `常见搭配：${collocation}`;
        if (answer !== current) word.collocationQuestion.explanation += `（已替换旧数据 ${answer}）`;
        collocationsReplaced += 1;
      }
    }
  }
}

// A reviewed override set covers modern terms, specialist derivatives and British spellings
// that are poorly represented in the historical corpora.
let curatedEntriesApplied = 0;
for (const [key, override] of Object.entries(CURATED)) {
  for (const word of byKey.get(key) || []) {
    if (override.phonetic) word.phonetic = override.phonetic;
    if (override.example) {
      word.intro.exampleSentence = override.example;
      word.intro.exampleTranslation = '';
    }
    if (override.context) {
      word.contextQuestion.sentence = override.context;
      word.contextQuestion.translation = '';
      word.signingQuestion.sentence = override.context;
    }
    if (override.collocation) {
      const previous = word.intro.collocations[0];
      word.intro.collocations = [override.collocation, ...word.intro.collocations.filter(value => value !== previous)].slice(0, 3);
      word.collocationQuestion.options[word.collocationQuestion.correctIndex] = override.collocation;
      word.collocationQuestion.explanation = `常见搭配：${override.collocation}`;
    }
    curatedEntriesApplied += 1;
  }
}

function englishDefinition(key, word) {
  const raw = (ecdict.get(key)?.definition || '').replace(/\\n/g, '; ').replace(/^[a-z]+\.\s*/i, '').split(';')[0].trim();
  return raw || `the idea expressed by “${word.intro.primaryMeaning}”`;
}
function fallbackCollocation(word) {
  const value = cleanKey(word.word);
  const pos = word.partOfSpeech[0] || '';
  if (/^v/.test(pos)) return `${value} effectively`;
  if (/^adj/.test(pos)) return `highly ${value}`;
  if (/^adv/.test(pos)) return `${value} different`;
  if (/(er|or|ist|ian|ee)$/.test(value)) return `experienced ${value}`;
  if (/(tion|sion|ment|ness|ity|ism|ance|ence|ship|cy)$/.test(value)) return `${value} of`;
  return `${value} in practice`;
}
let definitionFallbacks = 0;
for (const [key, entries] of byKey) {
  for (const word of entries) {
    const definition = englishDefinition(key, word);
    const pos = word.partOfSpeech[0] || '';
    if (templateExample(word.intro.exampleSentence)) {
      if (/^v/.test(pos)) word.intro.exampleSentence = `To ${word.word} is to ${definition}.`;
      else if (/^adj/.test(pos)) word.intro.exampleSentence = `${word.word[0].toUpperCase()}${word.word.slice(1)} describes something that is ${definition}.`;
      else word.intro.exampleSentence = `${word.word[0].toUpperCase()}${word.word.slice(1)} refers to ${definition}.`;
      word.intro.exampleTranslation = '';
      definitionFallbacks += 1;
    }
    if (templateContext(word.contextQuestion.sentence)) {
      let sentence;
      if (/^v/.test(pos)) sentence = `To ______ means to ${definition}.`;
      else if (/^adj/.test(pos)) sentence = `Something described as ______ is ${definition}.`;
      else sentence = `The term ______ refers to ${definition}.`;
      word.contextQuestion.sentence = sentence;
      word.contextQuestion.translation = '';
      word.signingQuestion.sentence = sentence;
      definitionFallbacks += 1;
    }
    if (templateCollocation(word.intro.collocations[0] || '', word.word)) {
      const collocation = fallbackCollocation(word);
      word.intro.collocations[0] = collocation;
      word.collocationQuestion.options[word.collocationQuestion.correctIndex] = collocation;
      word.collocationQuestion.explanation = `常见搭配：${collocation}`;
      definitionFallbacks += 1;
    }
  }
}

const unresolved = {
  noPhonetic: words.filter(word => !word.phonetic).map(word => word.id),
  templateExample: words.filter(word => templateExample(word.intro.exampleSentence)).map(word => word.id),
  templateContext: words.filter(word => templateContext(word.contextQuestion.sentence)).map(word => word.id),
  templateCollocation: words.filter(word => templateCollocation(word.intro.collocations[0] || '', word.word)).map(word => word.id),
};
const vocabularyHash = createHash('sha256').update(JSON.stringify(words)).digest('hex');
for (const chunk of manifest.chunks) {
  writeFileSync(join(vocabularyDir, chunk.file), JSON.stringify(words.slice(chunk.start - 1, chunk.end)));
}
manifest.version = `2026.10.12-${vocabularyHash.slice(0, 12)}`;
manifest.sha256 = vocabularyHash;
manifest.generatedAt = new Date().toISOString();
report.enrichment = {
  sources: ['ECDICT', 'Princeton WordNet 3.1', 'CMU Pronouncing Dictionary', 'NLTK Brown', 'NLTK Reuters', 'NLTK Gutenberg', 'NLTK Movie Reviews', 'NLTK Inaugural', 'NLTK State of the Union', 'NLTK WebText'],
  phoneticsAdded, examplesReplaced, contextsReplaced, collocationsReplaced, curatedEntriesApplied, definitionFallbacks,
  unresolvedCounts: Object.fromEntries(Object.entries(unresolved).map(([name, ids]) => [name, ids.length])),
  unresolved,
};
report.vocabularySha256 = vocabularyHash;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.enrichment, null, 2));
