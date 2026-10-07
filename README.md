# MDC site and quiz platform

Static pages (`quiz.html`, `hackoween.html`; `index.html` just redirects to the quiz) backed by Supabase. The browser only calls the
`quiz_*` and `hw_*` database functions, never the tables directly.

## Hack-O-Ween scoreboard

One winner from three rounds: the HackerRank coding round (pasted in), the quiz round (read live from a quiz
room on this platform) and the logo round (points awarded by hand). Scoring follows
`docs/reference/hackoween-scoreboard.html`. Its logic is copied verbatim into `hackoween-core.js`.

### One-time setup

1. Supabase → SQL Editor → run `hackoween-setup.sql` (after `supabase-setup.sql`, which is already in place).
   It is safe to run again, and it does not touch the admin password or any quiz data.
2. Deploy `hackoween.html`, `hackoween-core.js`, the updated `quiz.html` and the `samples/` folder next to the
   existing files. The quiz join form now requires a HackerRank username, so deploy `quiz.html` at the same
   time as running the SQL. A player still on the old page gets a message asking them to refresh.

To run it locally, serve the folder (`python3 -m http.server 8000`) and open `http://localhost:8000/hackoween.html`.

### URLs

| What | URL | Login |
|---|---|---|
| Scoreboard admin (leaderboard, import, logo round, settings) | `/hackoween.html` | quiz admin password |
| Combined leaderboard for the projector | `/hackoween.html#display` (press F for fullscreen) | none |
| Live quiz leaderboard for the projector | `/quiz.html?board=ROOMCODE` | none |
| Quiz host dashboard | `/quiz.html` → Admin portal | quiz admin password |

### Rehearse tonight (about 10 minutes)

1. Open `/hackoween.html`, log in, then Leaderboard → **Add participants from a list** → choose `samples/participants.csv`.
2. Run `samples/quiz-rehearsal.sql` in the SQL Editor. On the Leaderboard tab, type `HWTST` as the quiz room code.
   One quiz player is not registered, so click **Add them as participants**.
3. Import results → Coding → paste `samples/hackerrank-paste.tsv` → set **Slowest time counted** to 120 → Review rows.
   Fix the two red rows: click the *Priya Sharma* suggestion for `priya_sha`, and choose *Create new participant*
   (or Skip) for `randomcoder99`. Type a score for someone in "not in this file" if you like. Then Import.
4. Open `/hackoween.html#display` in a second window. On the Logo round tab, type a name, press Enter, then press 1.
5. Try reveal mode, undo, and Settings → snapshots.
6. **Clean up before the event:** Settings → type RESET → *Erase participants and scores* (settings are kept),
   set the quiz room code to the real one, and run `delete from public.quiz_rooms where code = 'HWTST';`.

### Event-day checklist

1. **Before doors open:** Settings → *Quick setup* (40/40/20 or 40/50/10). Check that the coding round shows
   max 100 and speed penalty 10%. **Download backup**.
2. **Import participants:** Leaderboard → *Add participants from a list* (Name, Email, HackerRank username).
   Re-adding the same list is harmless: it only fills in missing fields.
3. **Projector:** open `/hackoween.html#display` on the projector laptop and press F.
4. **After the coding round:** select the whole HackerRank contest leaderboard table, including the header row
   (`HACKER RANK COUNTRY SCORE TIME`), copy it, then go to Import results → Coding → *paste rows*. In the mapping step,
   set **Slowest time counted** to the contest length in minutes (no limit means no speed penalty). Fix every red
   row, check the amber ones, then Import. If the paste lands in one column, paste it into Google Sheets first and
   copy it from there. **If the leaderboard has several pages, paste every page into the same box, one after
   another, and import once.** A second import replaces the first. Repeated header rows are ignored. Check that
   the row count matches the number of HackerRank participants.
   Re-importing replaces the whole coding round, and every import keeps a snapshot first.
5. **Quiz round:** create the room in the quiz admin as usual, then type its code on the Hack-O-Ween Leaderboard
   tab. Show `/quiz.html?board=CODE` (or the 📺 button on the quiz dashboard) while people answer. When it ends,
   check the scoreboard's quiz panel: every player should be *matched*. Add or fix anyone listed as not matched.
   **Download backup**.
6. **Logo round:** Logo round tab. Type a name or email, press Enter, then press 1 / 2 / 3 for +20 / +10 / −5
   (or type custom points and a note). Use *Undo last award* for a mistake. The screen pulses the person and
   shows the points.
7. **Reveal the winner:** Logo round tab → *Hide standings on the screen* → *Uncover next* until first place,
   or *Uncover all*. *Show normal standings* ends the reveal.
8. **Download backup** one last time.

### How it works

- **Data.** `hw_event` holds one JSON document: participants, coding scores, hand edits, logo awards, settings,
  checkpoint and reveal state. Every save sends the revision it started from. If another tab saved first, the
  page reloads the latest data, re-applies its change and saves again. `hw_snapshots` keeps the previous
  document before every import, participant list, delete, restore and reset.
- **Quiz round.** Read live from `quiz_players` of the linked room. Players are matched to participants by
  email, then HackerRank username, then a unique exact name. The quiz max defaults to the room's total possible
  points (1000 × question points). A hand edit on the leaderboard overrides a live quiz score, and clearing it
  hides the live score.
- **Derived, not stored.** The combined board (points, totals, ranks, movement) is recomputed from that data
  by `hackoween-core.js` on every screen, and every screen gets the same numbers from the same data. The public
  screen data (`hw_public`) leaves out emails, HackerRank usernames, notes and disqualified people.
- **Realtime.** Polling, as the quiz already does: the projector polls every 2 seconds, and the admin page every 3.

### Tests

```
node --test tests/                                   # scoring acceptance tests, no install needed
npm i --no-save jsdom @electric-sql/pglite && node --test tests/   # also runs the SQL and full UI tests
```

The SQL and UI tests run both SQL files in an in-memory Postgres (PGlite) and drive `hackoween.html` and
`quiz.html` in jsdom. Without those packages installed, they are skipped.
