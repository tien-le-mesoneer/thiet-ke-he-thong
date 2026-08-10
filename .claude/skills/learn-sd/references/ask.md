# learn-sd · ask

Assumes startup already passed auth and read progress. Usage: `/learn-sd ask "<question>"`.

1. **Query grounded.** Run:
   `notebooklm ask "<question>" --notebook 173bf885-0641-4c53-b965-f2e910b68768 --json`
   Use `--json` to capture the answer plus source references. If the call errors, report the CLI error verbatim; do NOT fabricate a grounded answer. Only answer from general knowledge if the user explicitly opts in, and label it clearly as ungrounded.

2. **Relay + cite.** Give the answer and name the notebook sources it drew on.

3. **Tie back to the repo.** Locate where the concept lives in the active implementation using `codegraph_search`/`codegraph_context` under `apps/<active_impl>/`, and point the user at the concrete file/flow (e.g. isolation levels → `apps/deliveroo-node/src/modules/orders/service.ts`, the `placeOrder` transaction). If it maps to an open acceptance concept, say so.

4. **Offer follow-ups (ask first).**
   - **Save a takeaway as a note.** Offer to capture the answer's key point as a study note. If the user agrees, run the `note` auto-capture flow (`references/note.md`) with a distilled 2–5 sentence takeaway and `source: ask` — this writes both the repo file and the NotebookLM note.
   - If the question exposed a gap, offer to add the topic to `weak_concepts` in the progress file.
