export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type WordStatus = 'unseen' | 'active' | 'waiting' | 'completed' | 'familiar_archived';

export interface VocabularyWord {
  id: string;
  sourceOrder: number;
  word: string;
  phonetic: string;
  partOfSpeech: string[];
  meanings: string[];
  acceptedSpellings: string[];
  intro: { primaryMeaning: string; collocations: string[]; exampleSentence: string; exampleTranslation: string };
  meaningQuestion: Question & { prompt: string; explanation: string };
  collocationQuestion: Question & { prompt: string; explanation: string };
  reviewQuestion: Question;
  contextQuestion: Question & { sentence: string; translation: string; explanation: string };
  signingQuestion: { meaningPrompt: string; sentence: string; requiredForm: string };
  enrichment: { matchedJsonl: boolean; synonyms: string[] };
}

export interface Question { options: string[]; correctIndex: number }

export interface WordProgress {
  wordId: string;
  status: WordStatus;
  currentStage: Stage;
  batchId?: string;
  firstSeenAt?: string;
  nextDueAt?: string;
  stageCompletedAt: Partial<Record<Stage, string>>;
  wrongCountByStage: Record<Stage, number>;
  archivedFromStage?: Stage;
  archivedAt?: string;
  completedAt?: string;
}

export interface Batch {
  id: string;
  number: number;
  wordIds: string[];
  stage: 1 | 2 | 3;
  queue: string[];
  createdAt: string;
}

export interface AttemptRecord {
  id: string;
  wordId: string;
  stage: Stage;
  answeredAt: string;
  isCorrect: boolean;
  answer?: string;
  revealedAnswer: boolean;
}

export interface AppState {
  schemaVersion: 1;
  vocabularyVersion: string;
  progress: Record<string, WordProgress>;
  currentBatch: Batch | null;
  dueQueue: string[];
  attempts: AttemptRecord[];
  settings: { batchSize: 10 | 20 | 30 | 50; autoPronounce: boolean; sound: boolean };
  batchesStarted: number;
}

export interface VocabularyManifest {
  version: string;
  totalWords: number;
  sha256: string;
  chunks: { file: string; start: number; end: number; count: number }[];
}
