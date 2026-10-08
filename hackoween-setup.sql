-- =====================================================================
--  Hack-O-Ween scoreboard · Supabase migration
--  Run AFTER supabase-setup.sql, in Supabase → SQL Editor → New query → Run.
--  Safe to run again. It does not touch the admin password or any quiz data.
--
--  What it adds
--   · quiz_players.hr          HackerRank username, required when joining a quiz, unique per room
--   · hw_event                 the scoreboard's event data (participants, coding scores, logo awards,
--                              settings, reveal state) as one JSON document with a revision number
--   · hw_snapshots             a copy of the event data taken before every import / restore / reset
--   · hw_public()              read-only data for the projector screen (no emails, no login)
--   · hw_admin_get/save/snapshot   admin calls, protected by the quiz admin session
--   · hw_my(token)             a quiz player's own participant id, for their end screen
--   · quiz_room_board(code)    live quiz leaderboard for a projector (names and scores only)
--  The combined leaderboard itself is never stored: every screen derives it from this data
--  with hackoween-core.js. Quiz points are read live from quiz_players.
-- =====================================================================

-- ---------- HackerRank username on quiz players ----------
alter table public.quiz_players add column if not exists hr text not null default '';
alter table public.quiz_players add column if not exists gender text not null default '';
create unique index if not exists quiz_players_room_hr_idx on public.quiz_players (room_code, lower(hr)) where hr <> '';

-- ---------- event data ----------
create table if not exists public.hw_event (
  id int primary key default 1 check (id = 1),
  doc jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.hw_event (id) values (1) on conflict (id) do nothing;
create table if not exists public.hw_snapshots (
  id bigserial primary key,
  at timestamptz not null default now(),
  label text not null,
  doc jsonb not null
);
do $$ declare t text; begin
  foreach t in array array['hw_event','hw_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- helpers ----------
-- same as normName() in hackoween-core.js
create or replace function public._hw_norm(t text) returns text
language sql immutable as $$ select trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')) $$;

-- Live quiz round for the room linked in Settings (doc.config.quizRoom).
-- Each quiz player who has answered at least one question is matched to a participant by
-- email, then HackerRank username, then a unique exact name (the same order as the import).
-- If two players match one participant, the higher score counts and the other is listed as unmatched.
create or replace function public._hw_quiz(d jsonb, p_full boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_code text; r quiz_rooms; v_max numeric; res jsonb;
begin
  v_code := upper(trim(coalesce(d -> 'config' ->> 'quizRoom', '')));
  if v_code = '' then return null; end if;
  select * into r from quiz_rooms where code = v_code;
  if not found then return jsonb_build_object('room', v_code, 'missing', true); end if;
  select coalesce(sum(coalesce((q ->> 'p')::int, 1)), 0) * 1000 into v_max from jsonb_array_elements(r.questions) q;

  with ppl as (
    select key as pid, lower(trim(coalesce(value ->> 'email', ''))) as em,
           lower(trim(coalesce(value ->> 'ext', ''))) as hr, _hw_norm(value ->> 'name') as nm
    from jsonb_each(coalesce(d -> 'people', '{}'::jsonb))
  ), m as (
    select qp.id, qp.name, qp.email, qp.hr, qp.score, qp.ms, coalesce(
      (select pid from ppl where ppl.em <> '' and ppl.em = qp.email limit 1),
      (select pid from ppl where ppl.hr <> '' and ppl.hr = lower(qp.hr) limit 1),
      (select min(pid) from ppl where ppl.nm <> '' and ppl.nm = _hw_norm(qp.name) having count(*) = 1)) as pid
    from quiz_players qp where qp.room_code = r.code and qp.done > 0
  ), ranked as (
    select m.*, row_number() over (partition by pid order by score desc, ms asc) as rn from m
  )
  select jsonb_build_object(
    'room', r.code, 'title', r.title, 'status', r.status, 'max', v_max,
    'players', (select count(*) from m),
    'scores', coalesce(jsonb_object_agg(pid, jsonb_build_object('raw', score, 'time', round(ms / 1000.0, 1)))
                filter (where pid is not null and rn = 1), '{}'::jsonb))
    || case when p_full then jsonb_build_object(
      'unmatched', coalesce(jsonb_agg(jsonb_build_object('name', name, 'email', email, 'hr', hr, 'score', score) order by score desc)
                filter (where pid is null or rn > 1), '[]'::jsonb),
      'byPlayer', coalesce(jsonb_object_agg(id::text, pid) filter (where pid is not null and rn = 1), '{}'::jsonb))
    else '{}'::jsonb end
  into res from ranked;
  return res;
end $$;

-- ---------- public (projector screen and participant end screen) ----------
create or replace function public.hw_public() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e hw_event; d jsonb;
begin
  select * into e from hw_event where id = 1;
  d := coalesce(e.doc, '{}'::jsonb);
  -- no emails, usernames, notes or log; disqualified people are left out entirely
  d := (d - 'log') || jsonb_build_object(
    'people', (select coalesce(jsonb_object_agg(key, jsonb_build_object('id', key, 'name', value ->> 'name', 'dq', false)), '{}'::jsonb)
               from jsonb_each(coalesce(d -> 'people', '{}'::jsonb)) where not coalesce((value ->> 'dq')::boolean, false)),
    'bonus', (select coalesce(jsonb_agg(b - 'note'), '[]'::jsonb) from jsonb_array_elements(coalesce(d -> 'bonus', '[]'::jsonb)) b));
  return jsonb_build_object('rev', e.rev, 'doc', d, 'quiz', _hw_quiz(e.doc, false));
end $$;

create or replace function public.hw_my(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare p quiz_players; q jsonb;
begin
  select * into p from quiz_players where token_hash = _quiz_hash(p_token);
  if not found then return jsonb_build_object('pid', null); end if;
  q := _hw_quiz((select doc from hw_event where id = 1), true);
  return jsonb_build_object('pid', q -> 'byPlayer' ->> p.id::text);
end $$;

create or replace function public.quiz_room_board(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r quiz_rooms; n int;
begin
  select * into r from quiz_rooms where code = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('missing', true); end if;
  n := jsonb_array_length(r.questions);
  return jsonb_build_object('room', _quiz_room_json(r),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'score', score, 'ms', ms, 'done', done, 'fin', done >= n)
      order by score desc, ms asc, name) from quiz_players where room_code = r.code), '[]'::jsonb));
end $$;

-- ---------- admin ----------
create or replace function public.hw_admin_get(p_session text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e hw_event;
begin
  perform _quiz_admin(p_session);
  select * into e from hw_event where id = 1;
  return jsonb_build_object('rev', e.rev, 'doc', e.doc, 'quiz', _hw_quiz(e.doc, true),
    'snapshots', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'at', _quiz_ms(at), 'label', label) order by id desc)
      from (select * from hw_snapshots order by id desc limit 40) s), '[]'::jsonb));
end $$;

-- Saves the whole event document. p_rev must be the revision the browser last loaded, so two admin
-- tabs cannot silently overwrite each other (the browser reloads and re-applies its change instead).
-- With p_label, the previous document is kept as a snapshot first.
create or replace function public.hw_admin_save(p_session text, p_doc jsonb, p_rev bigint, p_label text default null) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare e hw_event;
begin
  perform _quiz_admin(p_session);
  if jsonb_typeof(p_doc) <> 'object' then raise exception 'The scoreboard data is not valid.'; end if;
  select * into e from hw_event where id = 1 for update;
  if e.rev <> p_rev then raise exception 'HW_STALE: The scoreboard changed in another tab.'; end if;
  if p_label is not null then
    insert into hw_snapshots(label, doc) values (left(p_label, 120), e.doc);
    delete from hw_snapshots where id not in (select id from hw_snapshots order by id desc limit 200);
  end if;
  update hw_event set doc = p_doc, rev = rev + 1, updated_at = now() where id = 1 returning rev into e.rev;
  return e.rev;
end $$;

create or replace function public.hw_admin_snapshot(p_session text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _quiz_admin(p_session);
  return (select doc from hw_snapshots where id = p_id);
end $$;

-- ---------- quiz_join: now also takes the HackerRank username and gender (both required) ----------
drop function if exists public.quiz_join(text,text,text,text,text,text,text);
drop function if exists public.quiz_join(text,text,text,text,text,text,text,text);
create or replace function public.quiz_join(p_code text, p_name text, p_email text, p_reg text,
  p_year text, p_dept text, p_token text, p_hr text default null, p_gender text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r quiz_rooms; p quiz_players; h text;
begin
  p_code  := upper(trim(coalesce(p_code, '')));
  p_name  := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  p_email := lower(trim(coalesce(p_email, '')));
  p_reg   := upper(regexp_replace(coalesce(p_reg, ''), '\s', '', 'g'));
  p_hr    := regexp_replace(coalesce(p_hr, ''), '^\s*@?|\s+$', '', 'g');
  -- every registration field is mandatory (checked here too, not just in the browser)
  if length(p_name) < 2 or length(p_name) > 40 then raise exception 'Please enter your full name.'; end if;
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(p_email) > 120 then raise exception 'Please enter a valid mail ID.'; end if;
  if p_reg !~ '^[A-Z0-9]{5,20}$' then raise exception 'Please enter a valid registration number (5–20 letters/digits).'; end if;
  if p_year is null or p_year not in ('1st Year','2nd Year','3rd Year','4th Year') then raise exception 'Please select your year.'; end if;
  if p_dept is null or p_dept not in ('CSE-AIML','Core','CS','DS') then raise exception 'Please select your department.'; end if;
  if p_hr !~ '^[A-Za-z0-9_.-]{2,40}$' then raise exception 'Please enter your HackerRank username (letters, digits, _ . -). Refresh the page if you don''t see the box.'; end if;
  if p_gender is null or p_gender not in ('Male','Female','Other','Prefer not to say') then raise exception 'Please select your gender. Refresh the page if you don''t see the box.'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'Invalid device token.'; end if;

  select * into r from quiz_rooms where code = p_code;
  if not found then raise exception 'Hmm, can''t find that room. Double-check the code?'; end if;
  if r.status = 'ended' then raise exception 'That quiz has already finished.'; end if;

  if exists (select 1 from quiz_players where room_code = p_code and lower(hr) = lower(p_hr) and reg <> p_reg) then
    raise exception 'That HackerRank username has already joined this room. Check the spelling, or ask the host.';
  end if;
  h := _quiz_hash(p_token);
  select * into p from quiz_players where token_hash = h;
  if found then
    if p.room_code <> p_code or p.reg <> p_reg then raise exception 'DEVICE_MISMATCH'; end if;
    update quiz_players set email = p_email, year = p_year, dept = p_dept, hr = p_hr, gender = p_gender, last_at = now(), logins = logins + 1
      where id = p.id returning * into p;
  else
    begin
      insert into quiz_players(room_code, token_hash, name, email, reg, year, dept, hr, gender)
        values (p_code, h, p_name, p_email, p_reg, p_year, p_dept, p_hr, p_gender) returning * into p;
    exception when unique_violation then
      raise exception 'This registration number has already joined this room. Use the device you joined with, or ask the host.';
    end;
  end if;
  return jsonb_build_object('room', _quiz_room_json(r), 'me', _quiz_player_json(p));
end $$;

-- ---------- admin dashboard: same as before, plus each player's HackerRank username ----------
create or replace function public.quiz_admin_dashboard(p_session text, p_code text, p_questions boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r quiz_rooms; n int;
begin
  perform _quiz_admin(p_session);
  select * into r from quiz_rooms where code = p_code;
  if not found then raise exception 'Room % not found.', p_code; end if;
  n := jsonb_array_length(r.questions);
  return jsonb_build_object(
    'room', _quiz_room_json(r) || case when p_questions then jsonb_build_object('qs', r.questions) else '{}'::jsonb end,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'email', email, 'reg', reg, 'year', year, 'dept', dept, 'hr', hr, 'gender', gender,
        'score', score, 'ok', ok, 'ms', ms, 'done', done, 'fin', done >= n,
        'ans', (select coalesce(jsonb_agg((x ->> 'c')::int), '[]') from jsonb_array_elements(answers) x),
        'joined', _quiz_ms(joined_at), 'last', _quiz_ms(last_at), 'logins', logins) order by joined_at)
      from quiz_players where room_code = p_code), '[]'::jsonb));
end $$;

-- ---------- permissions ----------
revoke execute on function public._hw_norm(text), public._hw_quiz(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.quiz_join(text,text,text,text,text,text,text,text,text), public.hw_public(), public.hw_my(text),
  public.quiz_room_board(text), public.hw_admin_get(text), public.hw_admin_save(text,jsonb,bigint,text),
  public.hw_admin_snapshot(text,bigint) to anon;

notify pgrst, 'reload schema';
