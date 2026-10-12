import { useEffect, useMemo, useRef, useState } from 'react';
import { archiveFamiliar, getDueIds, initialState, isAcceptedSpelling, recordAttempt, restoreFamiliar, STAGES, startBatch, startDueQueue } from './engine';
import { loadVocabulary } from './data';
import { clearState, loadState, saveState } from './storage';
import type { AppState, Stage, VocabularyManifest, VocabularyWord } from './types';

type Page = 'home' | 'progress' | 'archive' | 'settings' | 'session';

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

function useGameData() {
  const [words, setWords] = useState<VocabularyWord[]>([]);
  const [manifest, setManifest] = useState<VocabularyManifest | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    loadVocabulary().then(async data => {
      setWords(data.words); setManifest(data.manifest);
      const saved = await loadState();
      setState(saved?.vocabularyVersion === data.manifest.version ? saved : initialState(data.manifest.version));
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  useEffect(() => { if (state) saveState(state).catch(reason => setError(String(reason))); }, [state]);
  return { words, manifest, state, setState, error };
}

export function App() {
  const { words, manifest, state, setState, error } = useGameData();
  const [page, setPage] = useState<Page>('home');
  const [toast, setToast] = useState<{ text: string; previous?: AppState } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const byId = useMemo(() => new Map(words.map(word => [word.id, word])), [words]);
  if (error) return <main className="center-state"><div className="error-card"><b>编辑部暂时停工</b><p>{error}</p></div></main>;
  if (!state || !manifest) return <main className="center-state"><div className="loader" /><p>正在整理 7,803 份稿件…</p></main>;

  const update = (recipe: (current: AppState) => AppState) => setState(current => current ? recipe(current) : current);
  const archive = (word: VocabularyWord) => {
    const previous = state;
    update(current => archiveFamiliar(current, word.id));
    setToast({ text: `${word.word} 已标熟归档`, previous });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };
  const startWork = () => {
    if (state.dueQueue.length || getDueIds(state).length) update(current => startDueQueue(current));
    else if (!state.currentBatch) update(current => startBatch(current, words));
    setPage('session');
  };

  const currentId = state.dueQueue[0] || state.currentBatch?.queue[0];
  return <div className="app-shell">
    <header className="brandbar"><button className="wordmark" onClick={() => setPage('home')}><span>六</span><strong>六级编辑部</strong></button><span className="edition">晚间版 · {manifest.totalWords.toLocaleString()} 词</span></header>
    <main className="page-wrap">
      {page === 'home' && <Home state={state} words={words} onStart={startWork} />}
      {page === 'progress' && <Progress state={state} total={manifest.totalWords} />}
      {page === 'archive' && <Archive state={state} byId={byId} onRestore={id => update(current => restoreFamiliar(current, id))} />}
      {page === 'settings' && <Settings state={state} manifest={manifest} onChange={update} onReset={async () => { await clearState(); setState(initialState(manifest.version)); setPage('home'); }} />}
      {page === 'session' && (currentId && byId.get(currentId)
        ? <Session state={state} word={byId.get(currentId)!} onState={update} onArchive={archive} onDone={() => setPage('home')} />
        : <EmptyDesk onHome={() => setPage('home')} />)}
    </main>
    {page !== 'session' && <nav className="bottom-nav">
      {([['home', '⌂', '首页'], ['progress', '◫', '进度'], ['archive', '▣', '档案'], ['settings', '⚙', '设置']] as const).map(([key, icon, label]) =>
        <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}><span>{icon}</span>{label}</button>)}
    </nav>}
    {toast && <div className="toast">{toast.text}{toast.previous && <button onClick={() => { setState(toast.previous!); setToast(null); }}>撤销</button>}</div>}
  </div>;
}

function Home({ state, words, onStart }: { state: AppState; words: VocabularyWord[]; onStart: () => void }) {
  const due = getDueIds(state);
  const progress = Object.values(state.progress);
  const completed = progress.filter(item => item.status === 'completed' || item.status === 'familiar_archived').length;
  const dueStages = ([4, 5, 6] as Stage[]).map(stage => ({ stage, count: progress.filter(item => item.currentStage === stage && item.status === 'waiting' && item.nextDueAt && new Date(item.nextDueAt) <= new Date()).length }));
  const current = state.currentBatch;
  const batchHandled = current ? current.wordIds.length - current.queue.length : 0;
  const buttonText = due.length || state.dueQueue.length ? `继续今日值班 · 待处理 ${Math.max(due.length, state.dueQueue.length)} 份` : current ? `继续第 ${current.number} 期稿件` : completed === words.length ? '所有稿件均已归档' : '开始新一期稿件';
  return <section className="home-page">
    <div className="hero-grid">
      <div><p className="kicker">THE CET-6 EDITORIAL DESK</p><h1>今天，也把词<br/><em>用起来。</em></h1><p className="lead">每个单词都是一份稿件。历经六个部门，最终正式刊发。</p></div>
      <div className="desk-card"><div className="desk-top"><span>今日待处理</span><strong>{Math.max(due.length, state.dueQueue.length)}</strong></div><div className="stage-mini">{dueStages.map(item => <div key={item.stage}><span>{STAGES[item.stage - 1]}</span><b>{item.count}</b></div>)}</div><p>{due.length ? '旧稿已到返审时间，请优先处理。' : '桌面清爽，可以继续当前稿件。'}</p></div>
    </div>
    <button className="primary hero-action" onClick={onStart} disabled={completed === words.length}>{buttonText}<span>→</span></button>
    <div className="overview-grid">
      <article><span className="section-number">01</span><p>当前一期</p><h3>{current ? `第 ${current.number} 期 · ${STAGES[current.stage - 1]}` : '等待开刊'}</h3><div className="progress-track"><i style={{ width: `${current ? batchHandled / current.wordIds.length * 100 : 0}%` }} /></div><small>{current ? `${batchHandled} / ${current.wordIds.length}` : `下一期 ${state.settings.batchSize} 词`}</small></article>
      <article><span className="section-number">02</span><p>总词库进度</p><h3>{completed.toLocaleString()} <small>/ {words.length.toLocaleString()}</small></h3><div className="progress-track red"><i style={{ width: `${completed / words.length * 100}%` }} /></div><small>{(completed / words.length * 100).toFixed(1)}% 已归档</small></article>
      <article className="manifest-note"><span className="section-number">03</span><p>值班准则</p><blockquote>不跳词，不分难度。每一次答错，只是再审一次。</blockquote></article>
    </div>
  </section>;
}

function Session({ state, word, onState, onArchive, onDone }: { state: AppState; word: VocabularyWord; onState: (fn: (state: AppState) => AppState) => void; onArchive: (word: VocabularyWord) => void; onDone: () => void }) {
  const progress = state.progress[word.id];
  const stage = progress.currentStage;
  const queue = state.dueQueue.length ? state.dueQueue : state.currentBatch?.queue || [];
  const total = state.dueQueue.length ? state.dueQueue.length : state.currentBatch?.wordIds.length || queue.length;
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const advance = (isCorrect: boolean, value = '', reveal = false) => {
    onState(current => recordAttempt(current, word.id, isCorrect, value, reveal));
    setFeedback({ ok: isCorrect, text: isCorrect ? `${STAGES[stage - 1]}通过，稿件已送往下一环节。` : '这次不对，已放回本轮队尾。' });
    setAnswer(''); setRevealed(false);
  };
  const select = (index: number, options: string[], correctIndex: number, explanation: string) => {
    const ok = index === correctIndex;
    setFeedback({ ok, text: ok ? explanation : `正确答案：${options[correctIndex]}。${explanation}` });
    window.setTimeout(() => advance(ok, options[index]), 650);
  };
  const pronounce = () => {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(word.word); utterance.lang = 'en-US'; speechSynthesis.speak(utterance);
  };
  useEffect(() => { setFeedback(null); setAnswer(''); setRevealed(false); if (state.settings.autoPronounce && stage === 1) pronounce(); }, [word.id, stage]);
  const finishLabel = queue.length === 1 ? '完成本轮' : '下一份稿件';
  return <section className="session-page">
    <header className="session-head"><button onClick={onDone}>← 暂离</button><div><b>{STAGES[stage - 1]}</b><span>{total - queue.length + 1} / {total}</span></div><button className="familiar" onClick={() => onArchive(word)}>✓ 标熟归档</button></header>
    <div className="session-progress"><i style={{ width: `${(total - queue.length + 1) / total * 100}%` }} /></div>
    <div className="paper-card">
      <div className="folio">稿件 {word.id.replace('CET6-', '№ ')}</div>
      {stage === 1 && <IntroCard word={word} onPronounce={pronounce} onSubmit={() => advance(true)} label={finishLabel} />}
      {stage === 2 && <ChoiceCard eyebrow="意义核验" title={word.meaningQuestion.prompt} options={word.meaningQuestion.options} onSelect={index => select(index, word.meaningQuestion.options, word.meaningQuestion.correctIndex, word.meaningQuestion.explanation)} />}
      {stage === 3 && <ChoiceCard eyebrow="搭配校样" title={word.collocationQuestion.prompt} subtitle={word.word} options={word.collocationQuestion.options} onSelect={index => select(index, word.collocationQuestion.options, word.collocationQuestion.correctIndex, word.collocationQuestion.explanation)} />}
      {stage === 4 && <ChoiceCard eyebrow="返审稿" title={word.word} subtitle="请选择准确释义" options={word.reviewQuestion.options} onSelect={index => select(index, word.reviewQuestion.options, word.reviewQuestion.correctIndex, `返审通过：${word.intro.primaryMeaning}`)} />}
      {stage === 5 && <ChoiceCard eyebrow="语境校样" title={word.contextQuestion.sentence} subtitle="选择最适合语境的词" options={word.contextQuestion.options} onSelect={index => select(index, word.contextQuestion.options, word.contextQuestion.correctIndex, `${word.contextQuestion.explanation} ${word.contextQuestion.translation}`)} />}
      {stage === 6 && <div className="signing"><p className="eyebrow">最终签发</p><h2>{word.signingQuestion.meaningPrompt}</h2><blockquote>{word.signingQuestion.sentence}</blockquote><label>请输入完整单词<input autoFocus value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && answer) advance(isAcceptedSpelling(answer, word.acceptedSpellings), answer, revealed); }} placeholder="在此拼写…" autoCapitalize="none" autoCorrect="off" /></label>{revealed && <div className="revealed">正确拼写：<b>{word.word}</b>（本次不能直接通过）</div>}<div className="sign-actions"><button className="secondary" disabled={revealed} onClick={() => { setRevealed(true); setFeedback({ ok: false, text: '答案已查看；稿件将回到队尾，稍后请重新默写。' }); window.setTimeout(() => advance(false, '', true), 1100); }}>查看答案</button><button className="primary" disabled={!answer || revealed} onClick={() => advance(isAcceptedSpelling(answer, word.acceptedSpellings), answer, false)}>确认签发</button></div></div>}
    </div>
    <div className={`feedback ${feedback ? (feedback.ok ? 'success' : 'failure') : ''}`}>{feedback ? feedback.text : '完成当前操作后，系统会立即保存进度。'}</div>
  </section>;
}

function IntroCard({ word, onPronounce, onSubmit, label }: { word: VocabularyWord; onPronounce: () => void; onSubmit: () => void; label: string }) {
  return <div className="intro-card"><p className="eyebrow">初次收稿</p><div className="word-title"><div><h2>{word.word}</h2><p>/{word.phonetic || '暂无音标'}/ · {word.partOfSpeech.join(' / ')}</p></div>{word.phonetic && <button className="sound" onClick={onPronounce}>♬ <span>发音</span></button>}</div><p className="meaning">{word.meanings[0]}</p><div className="copy-block"><span>常见搭配</span>{word.intro.collocations.map(item => <b key={item}>{item}</b>)}</div><blockquote>{word.intro.exampleSentence}<small>{word.intro.exampleTranslation}</small></blockquote><button className="primary full" onClick={onSubmit}>送审 · {label}</button></div>;
}

function ChoiceCard({ eyebrow, title, subtitle, options, onSelect }: { eyebrow: string; title: string; subtitle?: string; options: string[]; onSelect: (index: number) => void }) {
  return <div className="choice-card"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{subtitle && <p className="question-subtitle">{subtitle}</p>}<div className="options">{options.map((option, index) => <button key={`${option}-${index}`} onClick={() => onSelect(index)}><span>{String.fromCharCode(65 + index)}</span>{option}</button>)}</div></div>;
}

function Progress({ state, total }: { state: AppState; total: number }) {
  const items = Object.values(state.progress);
  const counts = ([1, 2, 3, 4, 5, 6] as Stage[]).map(stage => items.filter(item => item.currentStage === stage && !['completed', 'familiar_archived'].includes(item.status)).length);
  const completed = items.filter(item => item.status === 'completed').length;
  const familiar = items.filter(item => item.status === 'familiar_archived').length;
  const done = completed + familiar;
  return <section className="standard-page"><p className="kicker">PRODUCTION REPORT</p><h1>编辑进度</h1><div className="big-stat"><strong>{done.toLocaleString()}</strong><span>/ {total.toLocaleString()} 已归档</span><div className="progress-track red"><i style={{ width: `${done / total * 100}%` }} /></div></div><div className="report-grid"><article><span>未处理</span><b>{(total - items.length).toLocaleString()}</b></article>{counts.map((count, index) => <article key={index}><span>{STAGES[index]}</span><b>{count.toLocaleString()}</b></article>)}<article><span>流程完成</span><b>{completed}</b></article><article><span>手动标熟</span><b>{familiar}</b></article></div>{state.currentBatch && <div className="batch-note"><b>当前第 {state.currentBatch.number} 期</b><span>{STAGES[state.currentBatch.stage - 1]} · 余 {state.currentBatch.queue.length} 份</span></div>}</section>;
}

function Archive({ state, byId, onRestore }: { state: AppState; byId: Map<string, VocabularyWord>; onRestore: (id: string) => void }) {
  const [tab, setTab] = useState<'completed' | 'familiar_archived'>('completed');
  const [query, setQuery] = useState('');
  const records = Object.values(state.progress).filter(item => item.status === tab).filter(item => byId.get(item.wordId)?.word.toLowerCase().includes(query.toLowerCase()));
  return <section className="standard-page"><p className="kicker">THE ARCHIVE</p><h1>刊发档案</h1><div className="tabs"><button className={tab === 'completed' ? 'active' : ''} onClick={() => setTab('completed')}>已刊发</button><button className={tab === 'familiar_archived' ? 'active' : ''} onClick={() => setTab('familiar_archived')}>手动标熟</button></div><input className="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索英文单词" />{records.length ? <div className="archive-list">{records.map(item => { const word = byId.get(item.wordId)!; return <article key={item.wordId}><div><h3>{word.word}</h3><p>{word.meanings[0]}</p><small>{item.wordId} · {formatDate(item.completedAt || item.archivedAt)}</small></div>{tab === 'familiar_archived' && <button onClick={() => onRestore(item.wordId)}>恢复学习</button>}</article>; })}</div> : <div className="empty-list">这只档案柜还是空的。</div>}</section>;
}

function Settings({ state, manifest, onChange, onReset }: { state: AppState; manifest: VocabularyManifest; onChange: (fn: (state: AppState) => AppState) => void; onReset: () => void }) {
  const importRef = useRef<HTMLInputElement>(null);
  const exportProgress = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), vocabularyVersion: manifest.version, state }, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `六级编辑部-进度-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(anchor.href);
  };
  const importProgress = async (file?: File) => {
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (data.vocabularyVersion !== manifest.version || data.state?.schemaVersion !== 1) return window.alert('导入失败：词库版本或进度格式不匹配。');
    onChange(() => data.state); window.alert('进度导入成功。');
  };
  return <section className="standard-page"><p className="kicker">DESK PREFERENCES</p><h1>编辑部设置</h1><div className="settings-list"><label><div><b>每期新词数量</b><span>只影响下一期，当前批次保持不变</span></div><select value={state.settings.batchSize} onChange={event => onChange(current => ({ ...current, settings: { ...current.settings, batchSize: Number(event.target.value) as 10 | 20 | 30 | 50 } }))}>{[10, 20, 30, 50].map(value => <option key={value}>{value}</option>)}</select></label><label><div><b>自动播放发音</b><span>进入收稿页时朗读英文</span></div><input type="checkbox" checked={state.settings.autoPronounce} onChange={event => onChange(current => ({ ...current, settings: { ...current.settings, autoPronounce: event.target.checked } }))} /></label><label><div><b>音效</b><span>保留盖章与操作反馈音效开关</span></div><input type="checkbox" checked={state.settings.sound} onChange={event => onChange(current => ({ ...current, settings: { ...current.settings, sound: event.target.checked } }))} /></label></div><div className="data-actions"><h2>进度保险箱</h2><p>词库版本：{manifest.version}</p><button className="secondary" onClick={exportProgress}>导出学习进度</button><button className="secondary" onClick={() => importRef.current?.click()}>导入学习进度</button><input ref={importRef} hidden type="file" accept="application/json" onChange={event => importProgress(event.target.files?.[0])} /><button className="danger" onClick={() => { if (window.confirm('确定要重置全部学习进度吗？此操作无法撤销，请先导出备份。') && window.confirm('再次确认：删除所有批次、答题和归档记录？')) onReset(); }}>重置全部进度</button></div></section>;
}

function EmptyDesk({ onHome }: { onHome: () => void }) {
  return <section className="empty-desk"><div className="stamp">清稿</div><h1>本轮稿件处理完毕</h1><p>该等待的稿件已经进入定时流程，编辑部会在到期后提醒你。</p><button className="primary" onClick={onHome}>返回首页</button></section>;
}
