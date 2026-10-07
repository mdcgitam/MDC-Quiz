-- Rehearsal quiz results: a finished quiz room HWTST with 9 players, using the built-in quiz.
-- Run in Supabase → SQL Editor after supabase-setup.sql and hackoween-setup.sql.
-- Then type HWTST as the quiz room code on the Hack-O-Ween Leaderboard tab.
--  · 8 players match the sample participants (Kiran Das joined with a different email,
--    so he is matched by HackerRank username)
--  · 1 player (Guest Player) is not on the participant list, to try "Add them as participants"
--  · Divya, Sneha, Arjun and Harsh did not play the quiz
-- Remove it afterwards with:  delete from public.quiz_rooms where code = 'HWTST';
delete from public.quiz_rooms where code = 'HWTST';
insert into public.quiz_rooms (code, title, secs, questions, status)
  select 'HWTST', 'Hack-O-Ween rehearsal quiz', 25, questions, 'ended' from public.quiz_templates where id = 'default';
insert into public.quiz_players (room_code, token_hash, name, email, reg, year, dept, hr, score, ok, ms, done)
select 'HWTST', md5(random()::text || r.reg), r.name, r.email, r.reg, '2nd Year', 'CS', r.hr, r.score, r.ok, r.ms,
       (select jsonb_array_length(questions) from public.quiz_rooms where code = 'HWTST')
from (values
  ('Akash Karri',         'akash.karri@example.edu',  'HWREG001', 'akarri4',      30210, 17, 212000),
  ('Srinivas Katragadda', 'srinivas.k@example.edu',   'HWREG002', 'skatrag1',     33480, 19, 188500),
  ('Priya Sharma',        'priya.sharma@example.edu', 'HWREG003', 'priya_sh',     27120, 16, 240300),
  ('Rahul Verma',         'rahul.verma@example.edu',  'HWREG004', 'rahulv_codes', 21905, 13, 301000),
  ('Ananya Reddy',        'ananya.reddy@example.edu', 'HWREG005', 'ananya_r',     24300, 15, 260750),
  ('Kiran Das',           'kiran.d@example.edu',      'HWREG006', 'kirandas',     18760, 12, 330100),
  ('Meera Iyer',          'meera.iyer@example.edu',   'HWREG007', 'meera_iyer',   29950, 17, 205400),
  ('Vikram Rao',          'vikram.rao@example.edu',   'HWREG008', 'vikramrao7',   12040,  8, 402000),
  ('Guest Player',        'guest@example.org',        'HWREG009', 'guest_hacker', 15500, 10, 350000)
) as r(name, email, reg, hr, score, ok, ms);
