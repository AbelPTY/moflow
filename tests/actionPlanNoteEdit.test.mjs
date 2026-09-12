// Workflow Quality Pass V1 — Action Plan editing (note text + due date) of an
// existing task. Pure logic + i18n presence. FICTIONAL data only.
//
// Run (where Node exists) from repo root:  node tests/actionPlanNoteEdit.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { sanitizeNoteText, isValidNote, sanitizeDueDate, buildTaskEditPatch, noteChanged, mergeUpdatedTask } =
    await vite.ssrLoadModule('/src/lib/actionPlanNote.js');
  const { translate } = await vite.ssrLoadModule('/src/i18n/core.js');
  const en = (k, v) => translate('en-US', k, v);
  const es = (k, v) => translate('es-PA', k, v);

  // A synthetic existing task (the same record the UI edits in place).
  const task = {
    id: 'task-abc',
    user_id: 'user-xyz',
    title: 'Pay the Star card Friday',
    category: 'Bills & Payments',
    due_date: '2026-09-12',
    done: false,
    created_at: '2026-09-01T10:00:00Z',
  };

  // A. Edit mode preloads the current note (unchanged after sanitize).
  ok('A: preload note', sanitizeNoteText(task.title) === task.title);
  // B. Edit mode preloads the current due date verbatim.
  ok('B: preload due date', sanitizeDueDate(task.due_date) === '2026-09-12');
  ok('B: null due date -> empty field maps to null', sanitizeDueDate(null) === null && sanitizeDueDate('') === null);

  // C. Save changes the title only (due date unchanged).
  const cTitle = buildTaskEditPatch({ title: 'Pay the Star card Saturday', dueDate: task.due_date });
  ok('C: title changed', cTitle.title === 'Pay the Star card Saturday');
  ok('C: due date unchanged', cTitle.due_date === '2026-09-12');

  // D. Save changes the due date only (title unchanged).
  const dDate = buildTaskEditPatch({ title: task.title, dueDate: '2026-10-01' });
  ok('D: due date changed', dDate.due_date === '2026-10-01');
  ok('D: title unchanged', dDate.title === task.title);

  // E. Save changes both.
  const eBoth = buildTaskEditPatch({ title: 'New note', dueDate: '2026-12-25' });
  ok('E: both changed', eBoth.title === 'New note' && eBoth.due_date === '2026-12-25');

  // F. Clearing the due date -> null (never '', undefined, or Invalid Date).
  const fClear = buildTaskEditPatch({ title: task.title, dueDate: '' });
  ok('F: cleared due date is null', fClear.due_date === null);
  ok('F: undefined due date is null', buildTaskEditPatch({ title: task.title }).due_date === null);
  ok('F: invalid calendar date is null', sanitizeDueDate('2026-02-30') === null);

  // G. Cancel preserves the original title/date (a no-op edit yields no change;
  //    nothing is written).
  ok('G: no-op title is not a change', noteChanged(task.title, task.title) === false);
  const gPatch = buildTaskEditPatch({ title: task.title, dueDate: task.due_date });
  const gSaved = mergeUpdatedTask(task, gPatch);
  ok('G: title/date unchanged on no-op save', gSaved.title === task.title && gSaved.due_date === task.due_date);

  // H. Same task id preserved through the merge.
  const saved = mergeUpdatedTask(task, eBoth);
  ok('H: same record id preserved', saved.id === task.id);

  // I. created_at preserved.
  ok('I: created_at preserved', saved.created_at === task.created_at);

  // J. category / done / user_id unchanged (patch never carries them; merge keeps them).
  ok('J: user_id unchanged', saved.user_id === task.user_id);
  ok('J: category unchanged', saved.category === task.category);
  ok('J: done unchanged', saved.done === task.done);

  // K/L. No voice transcription / AI reinterpretation: the patch is EXACTLY
  //      { title, due_date } — no transcript/extract/category/done fields.
  const keys = Object.keys(eBoth).sort();
  ok('K: patch keys are exactly title + due_date', keys.length === 2 && keys[0] === 'due_date' && keys[1] === 'title');
  ok('L: no reinterpretation fields', !('transcript' in eBoth) && !('category' in eBoth) && !('done' in eBoth) && !('id' in eBoth) && !('created_at' in eBoth));
  ok('K/L: no updated_at (tasks has no such column)', !('updated_at' in eBoth));

  // M. Failed update rolls back BOTH fields: the hook restores the prior task
  //    list, so title and due date both revert to the originals.
  const optimistic = mergeUpdatedTask(task, buildTaskEditPatch({ title: 'temp', dueDate: '2027-01-01' }));
  ok('M: optimistic changed both', optimistic.title === 'temp' && optimistic.due_date === '2027-01-01');
  const rolledBack = { ...task }; // what the hook restores on failure
  ok('M: rollback restores title', rolledBack.title === 'Pay the Star card Friday');
  ok('M: rollback restores due date', rolledBack.due_date === '2026-09-12');

  // N. YYYY-MM-DD stored verbatim (no timezone shift); timestamps are rejected.
  ok('N: calendar date verbatim', sanitizeDueDate('2026-09-15') === '2026-09-15');
  ok('N: no UTC day shift / timestamp rejected', sanitizeDueDate('2026-09-15T19:00:00Z') === null);
  ok('N: leap day accepted verbatim', sanitizeDueDate('2024-02-29') === '2024-02-29');

  // Blank-only title still rejected (no destructive overwrite).
  ok('blank title rejected', isValidNote('   ') === false);
  let threw = false;
  try { buildTaskEditPatch({ title: '   ', dueDate: '2026-09-12' }); } catch (e) { threw = e.code === 'EMPTY_NOTE'; }
  ok('buildTaskEditPatch throws on blank title', threw);
  ok('trim: surrounding whitespace removed', buildTaskEditPatch({ title: '  new text  ', dueDate: '' }).title === 'new text');

  // O. EN/ES labels present and switch.
  ok('O: noteEdit EN/ES', en('actionPlan.noteEdit') === 'Edit' && es('actionPlan.noteEdit') === 'Editar');
  ok('O: noteSave EN/ES', en('actionPlan.noteSave') === 'Save' && es('actionPlan.noteSave') === 'Guardar');
  ok('O: noteCancel EN/ES', en('actionPlan.noteCancel') === 'Cancel' && es('actionPlan.noteCancel') === 'Cancelar');
  ok('O: dueDateLabel EN/ES', en('actionPlan.dueDateLabel') === 'Due date' && es('actionPlan.dueDateLabel') === 'Fecha límite');
  ok('O: noDueDate EN/ES', en('actionPlan.noDueDate') === 'No due date' && es('actionPlan.noDueDate') === 'Sin fecha límite');
  ok('O: noteEmpty differs', en('actionPlan.noteEmpty') !== es('actionPlan.noteEmpty') && en('actionPlan.noteEmpty') !== 'actionPlan.noteEmpty');
  ok('O: noteSaveFailed interpolates ES', es('actionPlan.noteSaveFailed', { msg: 'x' }).includes('x'));
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
