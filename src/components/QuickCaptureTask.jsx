import React, { useState, useRef, useEffect } from 'react';
import Icon from './AppIcon';
import { supabase } from '../lib/supabase';
import { authHeader } from '../lib/apiClient';

const MIC_SIZE = 56; // w-14 / h-14
const MARGIN = 8;
const POS_KEY = 'mic_fab_pos';

const clampPos = (x, y) => {
  const maxX = window.innerWidth - MIC_SIZE - MARGIN;
  const maxY = window.innerHeight - MIC_SIZE - MARGIN;
  return { x: Math.max(MARGIN, Math.min(x, maxX)), y: Math.max(MARGIN, Math.min(y, maxY)) };
};

// Global floating mic: capture a money to-do by voice (or text) from any tab,
// AI-sort it, and save straight to the Action Plan. Self-contained so it can be
// mounted app-wide without loading the whole task list on every page.

const SpeechRecognition =
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export default function QuickCaptureTask() {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState([]);
  const [saving, setSaving] = useState(false);
  const recognitionRef = useRef(null);

  // --- Draggable floating position ---
  // The mic can be dragged anywhere on screen; its spot is remembered per device.
  const [pos, setPos] = useState(() => {
    if (typeof window === 'undefined') return { x: 20, y: 200 };
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return clampPos(saved.x, saved.y);
    } catch { /* noop */ }
    return { x: window.innerWidth - MIC_SIZE - 20, y: window.innerHeight - MIC_SIZE - 160 };
  });
  const dragRef = useRef({ dragging: false, moved: false, startX: 0, startY: 0, originX: 0, originY: 0, pointerId: null });

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p.x, p.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (e) => {
    const d = dragRef.current;
    d.dragging = true;
    d.moved = false;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.originX = pos.x;
    d.originY = pos.y;
    d.pointerId = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setPos(clampPos(d.originX + dx, d.originY + dy));
  };
  const onPointerUp = (e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    d.dragging = false;
    try { e.currentTarget.releasePointerCapture(d.pointerId); } catch { /* noop */ }
    if (d.moved) {
      setPos((p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* noop */ } return p; });
    } else {
      setOpen(true);
    }
  };

  const stopRecording = () => { try { recognitionRef.current?.stop(); } catch { /* noop */ } setRecording(false); };
  const closeModal = () => { stopRecording(); setOpen(false); setTranscript(''); setExtracted([]); };

  const startRecording = () => {
    if (!SpeechRecognition) { alert('Voice input is not supported on this browser — type your note instead.'); return; }
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

  const save = async () => {
    if (extracted.length === 0) return;
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Must be logged in.');
      const rows = extracted
        .filter((t) => String(t.title || '').trim())
        .map((t) => ({ user_id: userId, title: t.title.trim(), category: t.category || 'Other', due_date: t.due_date || null }));
      const { error } = await supabase.from('tasks').insert(rows);
      if (error) throw error;
      const n = rows.length;
      closeModal();
      if (window.location.pathname === '/action-plan') window.location.reload();
      else alert(`Added ${n} task${n === 1 ? '' : 's'} to your Action Plan.`);
    } catch (e) {
      alert('Failed to save: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Quick voice to-do — drag to move"
        style={{ left: `${pos.x}px`, top: `${pos.y}px`, touchAction: 'none' }}
        className="fixed z-[60] w-14 h-14 rounded-full bg-purple-600 text-white shadow-lg flex items-center justify-center hover:bg-purple-700 transition-colors cursor-grab active:cursor-grabbing select-none touch-none"
      >
        <Icon name="Mic" size={22} />
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[1100] p-4" onClick={closeModal}>
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-foreground">Quick to-do</h3>
              <button onClick={closeModal} className="text-muted-foreground hover:text-muted-foreground"><Icon name="X" size={18} /></button>
            </div>

            <div className="flex items-start gap-3">
              <button
                onClick={recording ? stopRecording : startRecording}
                className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white transition-all ${recording ? 'bg-red-500 animate-pulse' : 'bg-primary hover:bg-primary/90'}`}
              >
                <Icon name={recording ? 'Square' : 'Mic'} size={20} />
              </button>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={3}
                placeholder={recording ? 'Listening…' : 'Speak or type a money to-do…'}
                className="flex-1 border border-border rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
            </div>

            {extracted.length === 0 ? (
              <div className="flex justify-end mt-3">
                <button
                  onClick={extract}
                  disabled={extracting || !transcript.trim()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-40"
                >
                  {extracting ? 'Sorting…' : 'Sort into tasks'}
                </button>
              </div>
            ) : (
              <div className="mt-3">
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {extracted.map((t) => (
                    <div key={t._id} className="flex items-center justify-between gap-2 bg-background rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                        <span className="text-[10px] text-muted-foreground">{t.category}{t.due_date ? ` · due ${t.due_date}` : ''}</span>
                      </div>
                      <button onClick={() => setExtracted((prev) => prev.filter((x) => x._id !== t._id))} className="text-muted-foreground hover:text-red-500 shrink-0"><Icon name="X" size={14} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => setExtracted([])} className="px-3 py-2 text-muted-foreground hover:bg-muted rounded-lg text-sm font-medium">Back</button>
                  <button onClick={save} disabled={saving} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                    {saving ? 'Saving…' : `Add ${extracted.length}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
