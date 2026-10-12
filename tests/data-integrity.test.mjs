import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../public/vocabulary/manifest.json', import.meta.url), 'utf8'));
const words = manifest.chunks.flatMap(chunk => JSON.parse(readFileSync(new URL(`../public/vocabulary/${chunk.file}`, import.meta.url), 'utf8')));

describe('正式词库', () => {
  it('完整保留 PDF 的 7,803 行并生成连续 ID', () => {
    expect(words).toHaveLength(7803);
    expect(words[0].id).toBe('CET6-000001');
    expect(words.at(-1).id).toBe('CET6-007803');
    expect(new Set(words.map(word => word.id)).size).toBe(7803);
  });

  it('每个词都有六阶段所需字段和唯一选项', () => {
    for (const word of words) {
      expect(word.word).toBeTruthy();
      expect(word.meanings[0]).toBeTruthy();
      expect(word.intro.exampleSentence).toBeTruthy();
      expect(word.signingQuestion.requiredForm).toBe(word.word);
      for (const question of [word.meaningQuestion, word.collocationQuestion, word.reviewQuestion, word.contextQuestion]) {
        expect(question.options).toHaveLength(3);
        expect(new Set(question.options.map(value => value.toLowerCase())).size).toBe(3);
        expect(question.correctIndex).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
