import type { AppState, Stage, VocabularyWord, WordProgress } from './types';

export const STAGES = ['收稿', '核义', '配稿', '返审', '入文', '签发'] as const;
export const WAIT_HOURS: Partial<Record<Stage, number>> = { 4: 24, 5: 48, 6: 96 };

export function initialState(vocabularyVersion: string): AppState {
  return {
    schemaVersion: 1, vocabularyVersion, progress: {}, currentBatch: null, dueQueue: [], attempts: [],
    settings: { batchSize: 20, autoPronounce: false, sound: true }, batchesStarted: 0,
  };
}

export function makeProgress(wordId: string, batchId: string, now: Date): WordProgress {
  return {
    wordId, status: 'active', currentStage: 1, batchId, firstSeenAt: now.toISOString(),
    stageCompletedAt: {}, wrongCountByStage: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  };
}

export function shuffled<T>(items: T[], seed = Date.now()): T[] {
  const result = [...items];
  let value = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    const target = value % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function startBatch(state: AppState, words: VocabularyWord[], now = new Date()): AppState {
  if (state.currentBatch) return state;
  const ids = words.filter(word => !state.progress[word.id]).slice(0, state.settings.batchSize).map(word => word.id);
  if (!ids.length) return state;
  const number = state.batchesStarted + 1;
  const id = `batch-${String(number).padStart(4, '0')}`;
  const progress = { ...state.progress };
  for (const wordId of ids) progress[wordId] = makeProgress(wordId, id, now);
  return { ...state, progress, batchesStarted: number, currentBatch: { id, number, wordIds: ids, stage: 1, queue: [...ids], createdAt: now.toISOString() } };
}

export function getDueIds(state: AppState, now = new Date()): string[] {
  return Object.values(state.progress)
    .filter(item => item.status === 'waiting' && item.nextDueAt && new Date(item.nextDueAt) <= now)
    .sort((a, b) => new Date(a.nextDueAt!).getTime() - new Date(b.nextDueAt!).getTime() || a.wordId.localeCompare(b.wordId))
    .map(item => item.wordId);
}

export function startDueQueue(state: AppState, now = new Date()): AppState {
  if (state.dueQueue.length) return state;
  return { ...state, dueQueue: getDueIds(state, now) };
}

function setDue(progress: WordProgress, nextStage: Stage, now: Date): WordProgress {
  const hours = WAIT_HOURS[nextStage] || 0;
  return { ...progress, currentStage: nextStage, status: hours ? 'waiting' : 'active', nextDueAt: new Date(now.getTime() + hours * 3_600_000).toISOString() };
}

function moveBatch(state: AppState): AppState {
  const batch = state.currentBatch;
  if (!batch || batch.queue.length) return state;
  const eligible = batch.wordIds.filter(id => state.progress[id]?.status !== 'familiar_archived');
  if (batch.stage < 3 && eligible.length) {
    const stage = (batch.stage + 1) as 2 | 3;
    return { ...state, currentBatch: { ...batch, stage, queue: shuffled(eligible, batch.number * 101 + stage) } };
  }
  return { ...state, currentBatch: null };
}

export function completeCurrent(state: AppState, wordId: string, now = new Date()): AppState {
  const current = state.progress[wordId];
  if (!current || current.status === 'completed' || current.status === 'familiar_archived') return state;
  const stage = current.currentStage;
  let updated: WordProgress = { ...current, stageCompletedAt: { ...current.stageCompletedAt, [stage]: now.toISOString() } };
  if (stage < 6) updated = setDue(updated, (stage + 1) as Stage, now);
  else updated = { ...updated, status: 'completed', completedAt: now.toISOString(), nextDueAt: undefined };
  let next: AppState = {
    ...state,
    progress: { ...state.progress, [wordId]: updated },
    dueQueue: state.dueQueue.filter(id => id !== wordId),
    currentBatch: state.currentBatch ? { ...state.currentBatch, queue: state.currentBatch.queue.filter(id => id !== wordId) } : null,
  };
  return moveBatch(next);
}

export function recordAttempt(state: AppState, wordId: string, isCorrect: boolean, answer = '', revealedAnswer = false, now = new Date()): AppState {
  const item = state.progress[wordId];
  if (!item) return state;
  const progress = isCorrect ? state.progress : {
    ...state.progress,
    [wordId]: { ...item, wrongCountByStage: { ...item.wrongCountByStage, [item.currentStage]: item.wrongCountByStage[item.currentStage] + 1 } },
  };
  const attempt = { id: `${now.getTime()}-${wordId}`, wordId, stage: item.currentStage, answeredAt: now.toISOString(), isCorrect, answer, revealedAnswer };
  let next = { ...state, progress, attempts: [...state.attempts.slice(-4999), attempt] };
  if (isCorrect) return completeCurrent(next, wordId, now);
  if (next.currentBatch?.queue[0] === wordId) next = { ...next, currentBatch: { ...next.currentBatch, queue: [...next.currentBatch.queue.slice(1), wordId] } };
  if (next.dueQueue[0] === wordId) next = { ...next, dueQueue: [...next.dueQueue.slice(1), wordId] };
  return next;
}

export function archiveFamiliar(state: AppState, wordId: string, now = new Date()): AppState {
  const item = state.progress[wordId];
  if (!item) return state;
  const archived = { ...item, status: 'familiar_archived' as const, archivedFromStage: item.currentStage, archivedAt: now.toISOString(), nextDueAt: undefined };
  return moveBatch({
    ...state, progress: { ...state.progress, [wordId]: archived },
    dueQueue: state.dueQueue.filter(id => id !== wordId),
    currentBatch: state.currentBatch ? { ...state.currentBatch, queue: state.currentBatch.queue.filter(id => id !== wordId) } : null,
  });
}

export function restoreFamiliar(state: AppState, wordId: string, now = new Date()): AppState {
  const item = state.progress[wordId];
  if (!item || item.status !== 'familiar_archived') return state;
  const restored = { ...item, status: item.currentStage >= 4 ? 'waiting' as const : 'active' as const, nextDueAt: now.toISOString(), archivedAt: undefined };
  const dueQueue = state.dueQueue.includes(wordId) ? state.dueQueue : [wordId, ...state.dueQueue];
  return { ...state, progress: { ...state.progress, [wordId]: restored }, dueQueue };
}

export function normalizeSpelling(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/[’]/g, "'");
}

export function isAcceptedSpelling(value: string, accepted: string[]): boolean {
  const normalized = normalizeSpelling(value);
  return accepted.some(item => normalizeSpelling(item) === normalized);
}
