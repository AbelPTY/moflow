import React, { useState, useRef, useMemo } from 'react';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import Icon from '../../components/AppIcon';
import useTasks from '../../hooks/useTasks';
import { authHeader } from '../../lib/apiClient';

const CATEGORY_ORDER = ['Bills & Payments', 'Savings & Goals', 'Admin & Calls', 'Errands & Shopping', 'Other'];
const CATEGORY_STYLE = {
  'Bills & Payments': 'bg-red-50 text-red-700 border-red-100',
  'Savings & Goals': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  'Admin & Calls': 'bg-blue-50 text-blue-700 border-blue-100',
  'Errands & Shopping': 'bg-amber-50 text-amber-700 border-amber-100',
  'Other': 'bg-background text-muted-foreground border-border',
};

const SpeechRecognition =
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

const ActionPlan = () => {
  const { tasks, loading, addTasks, toggleDone, deleteTask } = useTasks();

  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState([]);
  const recognitionRef = useRef(null);

  const startRecording = () => {
    if (!SpeechRecognition) {
      alert('Voice input is not supported on this browser — type your note in the box instead.');
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'es-419';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + ' ';
      setTranscript(text.trim());
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  };

  const stopRecording = () => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setRecording(false);
  };

  const extract = async () => {
    if (!transcript.trim()) return;
    setExtracting(true);
    try {
      const resp = await fetch('/api/voiceToTasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ text: transcript, today: new Date().toISOString().split('T')[0] }),
      });
      if (!resp.ok) throw new Error(resp.statusText || 'extract failed');
      const arr = await resp.json();
      setExtracted(Array.isArray(arr) ? arr.map((t, i) => ({ ...t, _id: i })) : []);
    } catch (e) {
      alert('Could not turn that into tasks — try again or type it out.\n\n' + (e?.message || e));
    } finally {
      setExtracting(false);
    }
  };

  const removeExtracted = (id) => setExtracted((prev) => prev.filter((t) => t._id !== id));

  const saveExtracted = async () => {
    try {
      await addTasks(extracted);
      setExtracted([]);
      setTranscript('');
    } catch (e) {
      alert('Failed to save tasks: ' + (e?.message || e));
    }
  };

  const grouped = useMemo(() => {
    const g = {};
    CATEGORY_ORDER.forEach((c) => { g[c] = []; });
    (tasks || []).forEach((t) => { (g[t.category] || (g['Other'])).push(t); });
    return g;
  }, [tasks]);

  const openCount = (tasks || []).filter((t) => !t.done).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Action Plan</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Speak your money to-dos — we'll turn them into a sorted checklist. {openCount > 0 && `${openCount} open.`}
          </p>
        </div>

        {/* CAPTURE */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6">
          <div className="flex items-start gap-3">
            <button
              onClick={recording ? stopRecording : startRecording}
              className={`shrink-0 w-14 h-14 rounded-full flex items-center justify-center text-white transition-all ${recording ? 'bg-red-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-700'}`}
              title={recording ? 'Stop' : 'Start talking'}
            >
              <Icon name={recording ? 'Square' : 'Mic'} size={22} />
            </button>
            <div className="flex-1">
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={recording ? 'Listening…' : 'Tap the mic and talk, or type here — e.g. "pay the Star card Friday, call BG about the fee, move $200 to savings."'}
                rows={3}
                className="w-full border border-border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={extract}
                  disabled={extracting || !transcript.trim()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-40"
                >
                  {extracting ? 'Sorting…' : 'Sort into tasks'}
                </button>
              </div>
            </div>
          </div>

          {/* REVIEW EXTRACTED */}
          {extracted.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Review — {extracted.length} found</p>
              <div className="space-y-2">
                {extracted.map((t) => (
                  <div key={t._id} className="flex items-center justify-between gap-3 bg-background rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${CATEGORY_STYLE[t.category] || CATEGORY_STYLE.Other}`}>{t.category}</span>
                        {t.due_date && <span className="text-[11px] text-muted-foreground">due {t.due_date}</span>}
                      </div>
                    </div>
                    <button onClick={() => removeExtracted(t._id)} className="text-muted-foreground hover:text-red-500 shrink-0"><Icon name="X" size={16} /></button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setExtracted([])} className="px-3 py-2 text-muted-foreground hover:bg-muted rounded-lg text-sm font-medium">Discard</button>
                <button onClick={saveExtracted} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700">Add {extracted.length} to my list</button>
              </div>
            </div>
          )}
        </div>

        {/* CHECKLIST */}
        {loading ? (
          <div className="bg-card p-8 rounded-xl border border-border text-center text-muted-foreground text-sm">Loading tasks…</div>
        ) : (tasks || []).length === 0 ? (
          <div className="bg-card p-8 rounded-xl border border-border text-center text-muted-foreground text-sm italic">No tasks yet — speak or type a note above to get started.</div>
        ) : (
          <div className="space-y-5">
            {CATEGORY_ORDER.filter((c) => grouped[c] && grouped[c].length > 0).map((cat) => (
              <div key={cat} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b ${CATEGORY_STYLE[cat] || CATEGORY_STYLE.Other}`}>{cat}</div>
                <div className="divide-y divide-border">
                  {grouped[cat].map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-4 py-3 group">
                      <button
                        onClick={() => toggleDone(t.id, !t.done)}
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${t.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border hover:border-emerald-500 bg-card'}`}
                      >
                        {t.done && <Icon name="Check" size={12} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${t.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{t.title}</p>
                        {t.due_date && <p className={`text-[11px] ${t.done ? 'text-muted-foreground' : 'text-muted-foreground'}`}>due {t.due_date}</p>}
                      </div>
                      <button onClick={() => deleteTask(t.id)} className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><Icon name="Trash2" size={15} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-4">
          Voice uses your browser's speech recognition (works best in Chrome; type if it's unsupported). Reminders for these tasks are coming next.
        </p>
      </div>
    </div>
  );
};

export default ActionPlan;
