# learn-sd · exercise

Assumes startup already passed auth and read progress. Usage: `/learn-sd exercise`.

1. **Pick the topic.** From `docs/system-design-plan-detailed.md`, take the current `plan_week`'s Exercise (e.g. Week 1 → URL shortener, Week 2 → rate limiter, Week 3 → pastebin, Week 4 → distributed key-value store). Confirm the topic with the user; let them override.

2. **Timed cold attempt.** Tell the user this is a 45-minute interview-style attempt and note the start time. They write their design here in chat or in a scratch file. Do **not** help, hint, or answer questions about the problem during the attempt — only clarify the format. Collect their attempt when they say done (or at 45 min).

3. **Grade against the notebook.** Query the canonical approach:
   `notebooklm ask "Give the reference solution and the commonly-missed points for designing <topic>, structured as: requirements, capacity estimates, API, data model, high-level design, deep dive, bottlenecks & trade-offs." --notebook 173bf885-0641-4c53-b965-f2e910b68768`
   Produce a **gap analysis** comparing their attempt to the reference, section by section using that same template. Be specific about what they missed.

4. **Write the deliverable.** Create `docs/exercises/<plan_week>-<topic>.md` containing: the topic, date, their attempt (verbatim), and the gap analysis. Then commit:
   `git add docs/exercises/<plan_week>-<topic>.md && git commit -m "docs(exercise): week <plan_week> <topic> attempt + gap analysis"`

5. **Update progress.** Add `<topic>` to `exercises_done`; append clearly-missed items to `weak_concepts`; add a dated `## Log` line. These weak concepts now weight future quizzes and tutoring.
