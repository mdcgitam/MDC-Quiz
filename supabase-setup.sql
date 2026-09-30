-- =====================================================================
--  MDC Quiz · secure Supabase setup
--  Run this ONCE in Supabase → SQL Editor → New query → Run.
--  It is safe to run again (e.g. to change the admin password).
--
--  BEFORE RUNNING: change the admin password on the line marked  <<< 1
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables (no direct access from the website; RLS on, no policies) ----------
create table if not exists public.quiz_settings (
  id int primary key default 1 check (id = 1),
  admin_pw_hash text not null
);
create table if not exists public.quiz_admin_sessions (
  token_hash text primary key,
  expires_at timestamptz not null
);
create table if not exists public.quiz_login_attempts (
  ip text not null,
  at timestamptz not null default now()
);
create table if not exists public.quiz_templates (
  id text primary key,
  title text not null,
  questions jsonb not null
);
create table if not exists public.quiz_rooms (
  code text primary key,
  title text not null,
  secs int not null check (secs between 5 and 300),
  questions jsonb not null,                -- [{q, o:[..], a, p}]  (a = correct index, never sent to players)
  status text not null default 'lobby' check (status in ('lobby','live','ended')),
  created_at timestamptz not null default now()
);
create table if not exists public.quiz_players (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.quiz_rooms(code) on delete cascade,
  token_hash text not null unique,         -- sha256 of the secret the player's device holds
  name text not null, email text not null, reg text not null, year text not null, dept text not null,
  score int not null default 0, ok int not null default 0, ms int not null default 0, done int not null default 0,
  answers jsonb not null default '[]',     -- [{c: choice, ok, g: gain, ms}]
  q_index int, q_started_at timestamptz,   -- server-side question timer
  joined_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  logins int not null default 1,
  unique (room_code, reg)
);
create index if not exists quiz_players_room_idx on public.quiz_players(room_code);
create index if not exists quiz_login_attempts_idx on public.quiz_login_attempts(ip, at);

do $$ declare t text; begin
  foreach t in array array['quiz_settings','quiz_admin_sessions','quiz_login_attempts','quiz_templates','quiz_rooms','quiz_players'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- admin password ----------
do $$
declare pw text := 'MDC26';   -- <<< 1  put a strong password here (12+ characters)
begin
  if pw = 'MDC26' or length(pw) < 12 then
    raise exception 'Edit the SQL: set a real admin password (12+ characters) on the line marked <<< 1';
  end if;
  insert into public.quiz_settings(id, admin_pw_hash) values (1, extensions.crypt(pw, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set admin_pw_hash = excluded.admin_pw_hash;
  delete from public.quiz_admin_sessions;     -- changing the password logs every admin out
end $$;

-- ---------- built-in quiz ----------
insert into public.quiz_templates(id, title, questions) values
('default', 'Time Complexity Quiz', $Q$[{"q":"What does time complexity measure?","o":["Amount of memory used","Number of lines in a program","How running time grows with input size","Size of the source code"],"a":2,"p":1},{"q":"What is the time complexity of this code?\nfor(int i = 0; i < n; i++) cout << i;","o":["O(1)","O(log n)","O(n)","O(n²)"],"a":2,"p":1},{"q":"Which notation represents an upper bound on an algorithm's growth?","o":["Ω","Θ","O","Σ"],"a":2,"p":1},{"q":"What is the time complexity of accessing arr[5] in an array?","o":["O(1)","O(n)","O(log n)","O(n²)"],"a":0,"p":1},{"q":"What is the time complexity of binary search on a sorted array?","o":["O(n)","O(log n)","O(n log n)","O(1)"],"a":1,"p":1},{"q":"Which grows faster as n becomes very large?","o":["O(log n)","O(n)","O(n²)","O(1)"],"a":2,"p":1},{"q":"What is the time complexity of this code?\nfor(int i = 0; i < n; i++) for(int j = 0; j < n; j++) cout << i + j;","o":["O(n)","O(log n)","O(n²)","O(2n)"],"a":2,"p":1},{"q":"What is the complexity of the following code?\nfor(int i = 0; i < n; i++) cout << i;\nfor(int j = 0; j < n; j++) cout << j;","o":["O(n²)","O(2n²)","O(n)","O(log n)"],"a":2,"p":2},{"q":"What is the time complexity?\nfor(int i = 1; i < n; i *= 2) cout << i;","o":["O(n)","O(log n)","O(n log n)","O(2ⁿ)"],"a":1,"p":2},{"q":"What is the time complexity?\nfor(int i = 0; i < n; i++) for(int j = i; j < n; j++) cout << i << j;","o":["O(n)","O(log n)","O(n²)","O(n³)"],"a":2,"p":2},{"q":"Which is the correct order from fastest-growing efficiency to slowest-growing efficiency?","o":["O(n²) → O(n) → O(log n) → O(1)","O(1) → O(log n) → O(n) → O(n²)","O(log n) → O(1) → O(n²) → O(n)","O(n) → O(1) → O(log n) → O(n²)"],"a":1,"p":2},{"q":"What is the time complexity of merge sort?","o":["O(n)","O(n²)","O(log n)","O(n log n)"],"a":3,"p":2},{"q":"Consider:\nfor(int i = 0; i < n; i++) { for(int j = 1; j < n; j *= 2) cout << i << j; }\nWhat is the complexity?","o":["O(n)","O(log n)","O(n log n)","O(n²)"],"a":2,"p":2},{"q":"If an algorithm performs 3n² + 5n + 10 operations, what is its Big-O complexity?","o":["O(n)","O(n²)","O(3n²)","O(n³)"],"a":1,"p":2},{"q":"What is the time complexity?\nint i = n;\nwhile(i > 1) { i = i / 2; }","o":["O(n)","O(n²)","O(log n)","O(√n)"],"a":2,"p":3},{"q":"What is the complexity of the following code?\nfor(int i = 1; i <= n; i *= 2) { for(int j = 0; j < n; j++) cout << i + j; }","o":["O(n)","O(log n)","O(n log n)","O(n²)"],"a":2,"p":3},{"q":"What is the time complexity?\nfor(int i = 0; i < n; i++) { int j = i; while(j > 0) { j /= 2; } }","o":["O(n)","O(log n)","O(n log n)","O(n²)"],"a":2,"p":3},{"q":"Which complexity is associated with generating all subsets of a set containing n elements?","o":["O(n)","O(n²)","O(n log n)","O(2ⁿ)"],"a":3,"p":3},{"q":"What is the time complexity?\nfor(int i = 0; i < n; i++) { for(int j = 1; j <= i; j++) { for(int k = 1; k <= j; k++) cout << k; } }","o":["O(n²)","O(n³)","O(n log n)","O(2ⁿ)"],"a":1,"p":3},{"q":"An algorithm has the recurrence T(n) = 2T(n/2) + O(n). What is its time complexity?","o":["O(n)","O(log n)","O(n log n)","O(n²)"],"a":2,"p":3}]$Q$::jsonb)
on conflict (id) do update set title = excluded.title, questions = excluded.questions;

-- ---------- helpers (not callable from the website) ----------
create or replace function public._quiz_hash(t text) returns text
language sql immutable set search_path = public, extensions
as $$ select encode(extensions.digest(t, 'sha256'), 'hex') $$;

create or replace function public._quiz_admin(s text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if s is null or not exists (select 1 from quiz_admin_sessions where token_hash = _quiz_hash(s) and expires_at > now()) then
    raise exception 'ADMIN_SESSION: Admin session expired. Please log in again.';
  end if;
end $$;

create or replace function public._quiz_player_json(p public.quiz_players) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('name', p.name, 'reg', p.reg, 'year', p.year, 'dept', p.dept,
    'score', p.score, 'ok', p.ok, 'ms', p.ms, 'done', p.done)
$$;

create or replace function public._quiz_room_json(r public.quiz_rooms) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('code', r.code, 'title', r.title, 'secs', r.secs, 'status', r.status,
    'total', jsonb_array_length(r.questions))
$$;

create or replace function public._quiz_ms(t timestamptz) returns bigint
language sql immutable as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- ---------- player API ----------
create or replace function public.quiz_join(p_code text, p_name text, p_email text, p_reg text,
  p_year text, p_dept text, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r quiz_rooms; p quiz_players; h text;
begin
  p_code  := upper(trim(coalesce(p_code, '')));
  p_name  := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  p_email := lower(trim(coalesce(p_email, '')));
  p_reg   := upper(regexp_replace(coalesce(p_reg, ''), '\s', '', 'g'));
  -- every registration field is mandatory (checked here too, not just in the browser)
  if length(p_name) < 2 or length(p_name) > 40 then raise exception 'Please enter your full name.'; end if;
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(p_email) > 120 then raise exception 'Please enter a valid mail ID.'; end if;
  if p_reg !~ '^[A-Z0-9]{5,20}$' then raise exception 'Please enter a valid registration number (5–20 letters/digits).'; end if;
  if p_year is null or p_year not in ('1st Year','2nd Year','3rd Year','4th Year') then raise exception 'Please select your year.'; end if;
  if p_dept is null or p_dept not in ('CSE-AIML','Core','CS','DS') then raise exception 'Please select your department.'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'Invalid device token.'; end if;

  select * into r from quiz_rooms where code = p_code;
  if not found then raise exception 'Hmm, can''t find that room. Double-check the code?'; end if;
  if r.status = 'ended' then raise exception 'That quiz has already finished.'; end if;

  h := _quiz_hash(p_token);
  select * into p from quiz_players where token_hash = h;
  if found then
    if p.room_code <> p_code or p.reg <> p_reg then raise exception 'DEVICE_MISMATCH'; end if;
    update quiz_players set email = p_email, year = p_year, dept = p_dept, last_at = now(), logins = logins + 1
      where id = p.id returning * into p;
  else
    begin
      insert into quiz_players(room_code, token_hash, name, email, reg, year, dept)
        values (p_code, h, p_name, p_email, p_reg, p_year, p_dept) returning * into p;
    exception when unique_violation then
      raise exception 'This registration number has already joined this room. Use the device you joined with, or ask the host.';
    end;
  end if;
  return jsonb_build_object('room', _quiz_room_json(r), 'me', _quiz_player_json(p));
end $$;

create or replace function public.quiz_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p quiz_players; r quiz_rooms;
begin
  select * into p from quiz_players where token_hash = _quiz_hash(p_token);
  if not found then return jsonb_build_object('removed', true); end if;
  select * into r from quiz_rooms where code = p.room_code;
  -- heartbeat for the admin's "online" dot, written at most every 20s to keep load low
  update quiz_players set last_at = now() where id = p.id and last_at < now() - interval '20 seconds';
  return jsonb_build_object('status', r.status, 'total', jsonb_array_length(r.questions), 'me', _quiz_player_json(p));
end $$;

create or replace function public.quiz_question(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p quiz_players; r quiz_rooms; q jsonb; left_ms int;
begin
  select * into p from quiz_players where token_hash = _quiz_hash(p_token) for update;
  if not found then return jsonb_build_object('removed', true); end if;
  select * into r from quiz_rooms where code = p.room_code;
  if r.status <> 'live' or p.done >= jsonb_array_length(r.questions) then
    return jsonb_build_object('status', r.status, 'me', _quiz_player_json(p));
  end if;
  -- the timer starts the first time a question is served; reloading the page does not reset it
  if p.q_index is distinct from p.done or p.q_started_at is null then
    update quiz_players set q_index = p.done, q_started_at = now(), last_at = now() where id = p.id returning * into p;
  end if;
  q := r.questions -> p.done;
  left_ms := r.secs * 1000 - (_quiz_ms(now()) - _quiz_ms(p.q_started_at));
  return jsonb_build_object('status', r.status, 'index', p.done, 'q', q -> 'q', 'o', q -> 'o', 'p', q -> 'p',
    'secs', r.secs, 'left_ms', left_ms, 'me', _quiz_player_json(p));
end $$;

create or replace function public.quiz_answer(p_token text, p_index int, p_choice int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p quiz_players; r quiz_rooms; q jsonb; a int; pts int; lim int; el bigint; spent int; good boolean; gain int; prev jsonb;
begin
  select * into p from quiz_players where token_hash = _quiz_hash(p_token) for update;
  if not found then return jsonb_build_object('removed', true); end if;
  select * into r from quiz_rooms where code = p.room_code;

  -- a retried request for an answer that was already saved just gets the saved result back
  if p_index < p.done then
    prev := p.answers -> p_index;
    return jsonb_build_object('answer', (r.questions -> p_index ->> 'a')::int, 'ok', prev -> 'ok', 'gain', prev -> 'g',
      'status', r.status, 'me', _quiz_player_json(p));
  end if;
  if r.status <> 'live' then return jsonb_build_object('status', r.status, 'me', _quiz_player_json(p)); end if;
  if p_index <> p.done or p.q_index is distinct from p_index or p.q_started_at is null then
    raise exception 'That question is not open. Please reload.';
  end if;

  q := r.questions -> p_index; a := (q ->> 'a')::int; pts := coalesce((q ->> 'p')::int, 1);
  lim := r.secs * 1000;
  el := _quiz_ms(now()) - _quiz_ms(p.q_started_at);
  if el > lim + 3000 or p_choice is null or p_choice < 0 or p_choice >= jsonb_array_length(q -> 'o') then
    p_choice := -1;                          -- too late (3s network grace) or no answer
  end if;
  spent := least(el, lim);
  good := p_choice = a;
  gain := case when good then pts * (500 + round(500.0 * (lim - spent) / lim))::int else 0 end;

  update quiz_players set score = score + gain, ok = ok + good::int, ms = ms + spent, done = done + 1,
    answers = answers || jsonb_build_array(jsonb_build_object('c', p_choice, 'ok', good, 'g', gain, 'ms', spent)),
    q_index = null, q_started_at = null, last_at = now()
    where id = p.id returning * into p;
  return jsonb_build_object('answer', a, 'ok', good, 'gain', gain, 'status', r.status, 'me', _quiz_player_json(p));
end $$;

create or replace function public.quiz_leaderboard(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare me quiz_players; n int;
begin
  select * into me from quiz_players where token_hash = _quiz_hash(p_token);
  if not found then return '[]'::jsonb; end if;
  select jsonb_array_length(questions) into n from quiz_rooms where code = me.room_code;
  return coalesce((select jsonb_agg(jsonb_build_object('name', name, 'score', score, 'ms', ms, 'fin', done >= n, 'me', id = me.id)
    order by score desc, ms asc) from quiz_players where room_code = me.room_code), '[]'::jsonb);
end $$;

-- ---------- admin API (every call needs a session from quiz_admin_login) ----------
create or replace function public.quiz_admin_login(p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare h text; v_ip text; t text;
begin
  v_ip := coalesce(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), 'unknown');
  delete from quiz_login_attempts where at < now() - interval '15 minutes';
  if (select count(*) from quiz_login_attempts where ip = v_ip) >= 10 then
    return jsonb_build_object('error', 'Too many wrong passwords. Try again in 15 minutes.');
  end if;
  select admin_pw_hash into h from quiz_settings where id = 1;
  if h is null or p_password is null or extensions.crypt(p_password, h) <> h then
    insert into quiz_login_attempts(ip) values (v_ip);
    return jsonb_build_object('error', 'That password isn''t right, try again.');
  end if;
  delete from quiz_admin_sessions where expires_at < now();
  t := encode(extensions.gen_random_bytes(32), 'hex');
  insert into quiz_admin_sessions values (_quiz_hash(t), now() + interval '12 hours');
  return jsonb_build_object('session', t);
end $$;

create or replace function public.quiz_admin_logout(p_session text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from quiz_admin_sessions where token_hash = _quiz_hash(p_session)
$$;

create or replace function public.quiz_admin_create_room(p_session text, p_secs int, p_title text default null, p_questions jsonb default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare qs jsonb; ttl text; c text; q jsonb;
begin
  perform _quiz_admin(p_session);
  if p_questions is null then
    select questions, title into qs, ttl from quiz_templates where id = 'default';
  else
    qs := p_questions; ttl := coalesce(nullif(trim(p_title), ''), 'Quiz');
  end if;
  if jsonb_typeof(qs) <> 'array' or jsonb_array_length(qs) = 0 then raise exception 'The quiz has no questions.'; end if;
  for q in select * from jsonb_array_elements(qs) loop
    if jsonb_typeof(q -> 'o') <> 'array' or jsonb_array_length(q -> 'o') < 2
       or (q ->> 'a')::int not between 0 and jsonb_array_length(q -> 'o') - 1 then
      raise exception 'Each question needs 2+ options and a valid correct_answer';
    end if;
  end loop;
  loop
    c := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 5));
    exit when not exists (select 1 from quiz_rooms where code = c);
  end loop;
  insert into quiz_rooms(code, title, secs, questions) values (c, ttl, greatest(5, least(300, coalesce(p_secs, 25))), qs);
  return c;
end $$;

create or replace function public.quiz_admin_set_status(p_session text, p_code text, p_status text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _quiz_admin(p_session);
  update quiz_rooms set status = p_status where code = p_code;
end $$;

create or replace function public.quiz_admin_kick(p_session text, p_code text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _quiz_admin(p_session);
  delete from quiz_players where id = p_id and room_code = p_code;
end $$;

-- room summary + every player's full record (for the dashboard); p_questions=true also returns the answer key (for Excel)
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
        'id', id, 'name', name, 'email', email, 'reg', reg, 'year', year, 'dept', dept,
        'score', score, 'ok', ok, 'ms', ms, 'done', done, 'fin', done >= n,
        'ans', (select coalesce(jsonb_agg((x ->> 'c')::int), '[]') from jsonb_array_elements(answers) x),
        'joined', _quiz_ms(joined_at), 'last', _quiz_ms(last_at), 'logins', logins) order by joined_at)
      from quiz_players where room_code = p_code), '[]'::jsonb));
end $$;

-- ---------- permissions: the website may only call the quiz_* functions above ----------
revoke execute on function public._quiz_hash(text), public._quiz_admin(text), public._quiz_player_json(public.quiz_players),
  public._quiz_room_json(public.quiz_rooms), public._quiz_ms(timestamptz) from public, anon, authenticated;
grant execute on function public.quiz_join(text,text,text,text,text,text,text), public.quiz_state(text), public.quiz_question(text),
  public.quiz_answer(text,int,int), public.quiz_leaderboard(text), public.quiz_admin_login(text), public.quiz_admin_logout(text),
  public.quiz_admin_create_room(text,int,text,jsonb), public.quiz_admin_set_status(text,text,text),
  public.quiz_admin_kick(text,text,uuid), public.quiz_admin_dashboard(text,text,boolean) to anon;

-- ---------- lock the old open "docs" table ----------
-- The previous version stored everything (including participants' emails) in public.docs, readable and
-- writable by anyone with the site's key. This keeps the data but removes public access to it.
do $$ begin
  if to_regclass('public.docs') is not null then
    alter table public.docs enable row level security;
    revoke all on public.docs from anon, authenticated;
  end if;
end $$;

-- make the new functions visible to the website immediately
notify pgrst, 'reload schema';
