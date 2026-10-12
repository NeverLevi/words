import { describe, expect, it } from 'vitest';
import { archiveFamiliar, completeCurrent, getDueIds, initialState, isAcceptedSpelling, recordAttempt, restoreFamiliar, startBatch } from './engine';
import type { VocabularyWord } from './types';

const words = Array.from({ length: 30 }, (_, index) => ({ id: `CET6-${String(index + 1).padStart(6, '0')}`, sourceOrder: index + 1 } as VocabularyWord));
const start = new Date('2026-10-12T00:00:00.000Z');

describe('六阶段流程引擎', () => {
  it('按设置开启一期，当前批次不受之后的设置修改影响', () => {
    const state = startBatch(initialState('v1'), words, start);
    expect(state.currentBatch?.wordIds).toHaveLength(20);
    const changed = { ...state, settings: { ...state.settings, batchSize: 10 as const } };
    expect(changed.currentBatch?.wordIds).toHaveLength(20);
  });

  it('前三阶段锁步推进，配稿后固定等待 24 小时', () => {
    let state = startBatch({ ...initialState('v1'), settings: { batchSize: 10, autoPronounce: false, sound: true } }, words, start);
    for (const id of [...state.currentBatch!.queue]) state = completeCurrent(state, id, start);
    expect(state.currentBatch?.stage).toBe(2);
    for (const id of [...state.currentBatch!.queue]) state = completeCurrent(state, id, start);
    expect(state.currentBatch?.stage).toBe(3);
    for (const id of [...state.currentBatch!.queue]) state = completeCurrent(state, id, start);
    expect(state.currentBatch).toBeNull();
    expect(state.progress[words[0].id].currentStage).toBe(4);
    expect(state.progress[words[0].id].nextDueAt).toBe('2026-10-13T00:00:00.000Z');
    expect(getDueIds(state, new Date('2026-10-12T23:59:59.000Z'))).toHaveLength(0);
    expect(getDueIds(state, new Date('2026-10-13T00:00:00.000Z'))).toHaveLength(10);
  });

  it('答错只增加统计并排到本阶段队尾', () => {
    let state = startBatch({ ...initialState('v1'), settings: { batchSize: 10, autoPronounce: false, sound: true } }, words, start);
    const id = state.currentBatch!.queue[0];
    state = recordAttempt(state, id, false, '错误', false, start);
    expect(state.progress[id].currentStage).toBe(1);
    expect(state.progress[id].wrongCountByStage[1]).toBe(1);
    expect(state.currentBatch?.queue.at(-1)).toBe(id);
  });

  it('标熟立即退出并能恢复到原阶段', () => {
    let state = startBatch(initialState('v1'), words, start);
    const id = state.currentBatch!.queue[0];
    state = archiveFamiliar(state, id, start);
    expect(state.progress[id].status).toBe('familiar_archived');
    expect(state.currentBatch?.queue).not.toContain(id);
    state = restoreFamiliar(state, id, new Date('2026-10-14T00:00:00.000Z'));
    expect(state.progress[id].currentStage).toBe(1);
    expect(state.dueQueue[0]).toBe(id);
  });

  it('签发拼写忽略首尾空格与大小写并保留连字符', () => {
    expect(isAcceptedSpelling('  X-RAY ', ['X-ray'])).toBe(true);
    expect(isAcceptedSpelling('xray', ['X-ray'])).toBe(false);
  });
});
