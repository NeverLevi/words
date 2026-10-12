import type { VocabularyManifest, VocabularyWord } from './types';

export async function loadVocabulary(): Promise<{ manifest: VocabularyManifest; words: VocabularyWord[] }> {
  const manifest = await fetch('./vocabulary/manifest.json').then(response => {
    if (!response.ok) throw new Error('词库清单加载失败');
    return response.json() as Promise<VocabularyManifest>;
  });
  const chunks = await Promise.all(manifest.chunks.map(chunk => fetch(`./vocabulary/${chunk.file}`).then(response => {
    if (!response.ok) throw new Error(`词库分包 ${chunk.file} 加载失败`);
    return response.json() as Promise<VocabularyWord[]>;
  })));
  const words = chunks.flat();
  if (words.length !== manifest.totalWords) throw new Error(`词库数量不一致：${words.length}/${manifest.totalWords}`);
  return { manifest, words };
}
