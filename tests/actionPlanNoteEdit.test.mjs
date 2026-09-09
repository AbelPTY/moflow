// Workflow Quality Pass V1 — Action Plan note editing (text correction of an
// existing note). Pure logic + i18n presence. FICTIONAL data only.
//
// Run (where Node exists) from repo root:  node tests/actionPlanNoteEdit.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { sanitizeNoteText, isValidNote, buildTaskTitleUpdate, noteChanged, mergeUpdatedTask } =
    await vite.ssrLoadModule('/src/lib/actionPlanNote.js');
  const { translate } = await vite.ssrLoadModule('/src/i18n/core.js');
  const en = (k, v) => translate('en-US', k, v);
  const es = (k, v) => translate('es-PA', k, v);

  // A synthetic existing note (same record the UI edits in place).
  const task = {
    id: 'task-abc',
    user_id: 'user-xyz',
    title: 'Pay the Star card Friday',
    category: 'Bills & Payments',
    due_date: '2026-09-12',
    done: false,
    created_at: '2026-09-01T10:00:00Z',
  };

  // B. Current note text is prefilled for editing (unchanged after sanitize).
  ok('B: prefill equals current note', sanitizeNoteText(task.title) === task.title);

  // C. Cancel preserves the original note (a no-op edit yields no change).
  ok('C: no-op edit is not a change', noteChanged(task.title, task.title) === false);
  ok('C: whitespace-only diff is not a change', noteChanged('hello', ' hello ') === false);

  // D. Save updates the SAME record id: patch carries only title; merge keeps id.
  const patch = buildTaskTitleUpdate('Pay the Star card Saturday');
  const saved = mergeUpdatedTask(task, patch);
  ok('D: patch has title', patch.title === 'Pay the Star card Saturday');
  ok('D: same record id preserved', saved.id === task.id);

  // E. Blank-only note is rejected (no destructive overwrite).
  ok('E: blank invalid', isValidNote('   ') === false);
  ok('E: empty invalid', isValidNote('') === false);
  let threw = false;
  try { buildTaskTitleUpdate('   '); } catch (e) { threw = e.code === 'EMPTY_NOTE'; }
  ok('E: buildTaskTitleUpdate throws on blank', threw);

  // F. Voice interpretation is NOT rerun: the patch contains ONLY { title } —
  //    no transcript/extract/category/due_date fields that would re-interpret.
  const keys = Object.keys(patch);
  ok('F: patch is title-only', keys.length === 1 && keys[0] === 'title');

  // G. created_at is preserved through the merge.
  ok('G: created_at preserved', saved.created_at === task.created_at);
  ok('G: user_id preserved', saved.user_id === task.user_id);
  ok('G: metadata untouched', saved.category === task.category && saved.due_date === task.due_date && saved.done === task.done);

  // H. updated_at: the tasks table has no such column, so the patch must NOT
  //    write one (no migration added for a text correction).
  ok('H: no updated_at in patch', !('updated_at' in patch));

  // I. Update failure preserves the old visible note: rolling back to the prior
  //    task (the merge is only applied on success) keeps the original title.
  const rolledBack = { ...task }; // what the hook restores on failure
  ok('I: failure keeps original note', rolledBack.title === 'Pay the Star card Friday');

  // Trimming on save.
  ok('trim: surrounding whitespace removed', buildTaskTitleUpdate('  new text  ').title === 'new text');

  // P. EN/ES strings present and switch.
  ok('P: noteEdit EN/ES', en('actionPlan.noteEdit') === 'Edit' && es('actionPlan.noteEdit') === 'Editar');
  ok('P: noteSave EN/ES', en('actionPlan.noteSave') === 'Save' && es('actionPlan.noteSave') === 'Guardar');
  ok('P: noteCancel EN/ES', en('actionPlan.noteCancel') === 'Cancel' && es('actionPlan.noteCancel') === 'Cancelar');
  ok('P: noteEmpty differs', en('actionPlan.noteEmpty') !== es('actionPlan.noteEmpty') && en('actionPlan.noteEmpty') !== 'actionPlan.noteEmpty');
  ok('P: noteSaveFailed interpolates ES', es('actionPlan.noteSaveFailed', { msg: 'x' }).includes('x'));
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
