// Action Plan — note (task title) editing helpers.
//
// Pure, side-effect-free logic behind the "Edit note" flow. Editing a note is
// ONLY a text correction: it updates the SAME task row's `title` and nothing
// else. It never re-runs voice transcription or AI interpretation, never
// creates a second record, and never touches task metadata (category, due_date,
// done, id, created_at, user_id).
//
// The `tasks` table (see supabase/migrations/20260818000000_tasks.sql) has no
// `updated_at` column, so no such field is written; adding one is intentionally
// out of scope (a text-correction feature does not justify a migration).

// Trim surrounding whitespace only (interior spacing is the user's to keep).
export function sanitizeNoteText(text) {
  return String(text == null ? '' : text).trim();
}

// A note must have visible, non-whitespace content.
export function isValidNote(text) {
  return sanitizeNoteText(text).length > 0;
}

// Build the DB patch for a note edit. Returns ONLY { title } — proving the
// update cannot alter category/due_date/done/id/created_at/user_id and cannot
// re-trigger extraction (no transcript/extract fields are ever included).
// Throws on a blank-only note so a destructive empty overwrite is impossible.
export function buildTaskTitleUpdate(newTitle) {
  const title = sanitizeNoteText(newTitle);
  if (!title) {
    const err = new Error('EMPTY_NOTE');
    err.code = 'EMPTY_NOTE';
    throw err;
  }
  return { title };
}

// True when the edited text is a real change from the original (after trim).
// A no-op edit (or Cancel) needs no write.
export function noteChanged(original, edited) {
  return sanitizeNoteText(original) !== sanitizeNoteText(edited);
}

// Apply a successful patch to a task in local state. Preserves id, created_at,
// user_id and every other field; only the patched keys change.
export function mergeUpdatedTask(task, patch) {
  return { ...task, ...patch };
}
