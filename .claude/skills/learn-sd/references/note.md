# learn-sd · note

Capture study notes. They land in **two places**: the git-tracked repo file
`docs/system-design-notes.md` (fast, greppable, versioned) and the NotebookLM
notebook as a note (so future `ask`/quizzes can ground on them). Assumes startup
already passed auth and read progress.

Usage:
- `/learn-sd note "<text>"` — save a freeform note.
- `/learn-sd note` — no text: ask the user what to capture, then proceed.
- `/learn-sd note list` — show recent notes (read `docs/system-design-notes.md`, list the last ~10 headings; do not query NotebookLM).

## Save flow (`note "<text>"` / `note`)

1. **Compose.** Build the note from the text:
   - **Title** — derive a short title (≤ 8 words) from the text; if ambiguous, ask the user for one.
   - **Body** — the note text, lightly cleaned up (keep the user's wording; don't invent content).
   - **Metadata** — today's date, current `plan_week`, `active_impl`, a `source` tag (`manual` here; other modes pass their own — see Auto-capture), and optional topic tags you infer from the text.

2. **Append to the repo file.** Append this block to `docs/system-design-notes.md` (create the file with an `# Study notes` H1 if missing). Newest entries go at the **bottom** (chronological, clean diffs):

   ```markdown
   ## <YYYY-MM-DD> · <title>
   _week <plan_week> · <active_impl> · source: <source> · tags: <t1, t2>_

   <body>
   ```

3. **Push to NotebookLM (ask first).** Confirm with the user, then:
   `notebooklm note create "<body>" -t "<YYYY-MM-DD> · <title>" --notebook 173bf885-0641-4c53-b965-f2e910b68768 --json`
   **Do not trust the command's `created`/`id` fields** — this CLI is known to print `"created": false` / `"id": null` even when the note was actually created. **Always verify with `notebooklm note list --notebook 173bf885-0641-4c53-b965-f2e910b68768 --json` and match by title**, then take the id from the list. **Never blindly re-run `note create` on a reported failure** — that produces duplicates; check the list first and only retry if the title is truly absent. If the list confirms 0 matches, report the failure verbatim, keep the repo entry, and say the push failed — never fabricate success. On confirmed success, append ` · nb: <note-id>` to the metadata line of the repo entry so the two stay linked; if a retry created a duplicate, `notebooklm note delete <id>` the extra.

4. **Confirm.** Tell the user where it landed (repo path + whether it reached NotebookLM). If the note exposed a gap, offer to add the topic to `weak_concepts` in the progress file.

## Auto-capture (invoked from other modes)

`ask`, `exercise`, and the `this-week` quiz offer to save a takeaway as a note.
When the user accepts, run the same save flow with:
- **Body** = the distilled takeaway (2–5 sentences), not the raw transcript.
- **source** = `ask` / `exercise:<topic>` / `quiz` as appropriate.
- Title derived from the topic.

Keep it one note per takeaway; don't dump whole answers.
