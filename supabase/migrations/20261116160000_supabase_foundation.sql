-- Milestone 02. Apply only to a Supabase project after review.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_locale text not null default 'it' check (length(preferred_locale) between 2 and 35),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pipes (
  id text not null default gen_random_uuid()::text check (length(id) > 0),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  brand text not null,
  model text not null,
  shape text,
  material text,
  filter text,
  status text,
  acquired_on date,
  price numeric check (price is null or (price >= 0 and price < 'Infinity'::numeric)),
  notes text,
  legacy_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.tobaccos (
  id text not null default gen_random_uuid()::text check (length(id) > 0),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  brand text not null,
  name text not null,
  blend_type text,
  notes text,
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.cigars (
  id text not null default gen_random_uuid()::text check (length(id) > 0),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  brand text not null,
  name text not null,
  vitola text,
  notes text,
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.smoking_sessions (
  id text not null default gen_random_uuid()::text check (length(id) > 0),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('pipe', 'cigar')),
  pipe_id text,
  tobacco_id text,
  cigar_id text,
  started_at timestamptz not null default now(),
  ended_at timestamptz check (ended_at >= started_at),
  rating smallint check (rating between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, pipe_id) references public.pipes(user_id, id) on delete restrict,
  foreign key (user_id, tobacco_id) references public.tobaccos(user_id, id) on delete restrict,
  foreign key (user_id, cigar_id) references public.cigars(user_id, id) on delete restrict,
  check ((kind = 'pipe' and pipe_id is not null and cigar_id is null)
      or (kind = 'cigar' and cigar_id is not null and pipe_id is null and tobacco_id is null))
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  bucket_id text not null default 'journal-photos' check (bucket_id = 'journal-photos'),
  object_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 3145728),
  pipe_id text,
  tobacco_id text,
  cigar_id text,
  smoking_session_id text,
  alt_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path),
  check (split_part(object_path, '/', 1) = user_id::text and length(split_part(object_path, '/', 2)) > 0),
  check (num_nonnulls(pipe_id, tobacco_id, cigar_id, smoking_session_id) = 1),
  foreign key (user_id, pipe_id) references public.pipes(user_id, id) on delete cascade,
  foreign key (user_id, tobacco_id) references public.tobaccos(user_id, id) on delete cascade,
  foreign key (user_id, cigar_id) references public.cigars(user_id, id) on delete cascade,
  foreign key (user_id, smoking_session_id) references public.smoking_sessions(user_id, id) on delete cascade
);

create function public.tj_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.tj_set_updated_at() from public;

create trigger set_updated_at before update on public.profiles
for each row execute function public.tj_set_updated_at();
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
create policy own_rows on public.profiles for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create trigger set_updated_at before update on public.pipes
for each row execute function public.tj_set_updated_at();
alter table public.pipes enable row level security;
alter table public.pipes force row level security;
revoke all on public.pipes from public, anon, authenticated;
grant select, insert, update, delete on public.pipes to authenticated;
create policy own_rows on public.pipes for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create trigger set_updated_at before update on public.tobaccos
for each row execute function public.tj_set_updated_at();
alter table public.tobaccos enable row level security;
alter table public.tobaccos force row level security;
revoke all on public.tobaccos from public, anon, authenticated;
grant select, insert, update, delete on public.tobaccos to authenticated;
create policy own_rows on public.tobaccos for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create trigger set_updated_at before update on public.cigars
for each row execute function public.tj_set_updated_at();
alter table public.cigars enable row level security;
alter table public.cigars force row level security;
revoke all on public.cigars from public, anon, authenticated;
grant select, insert, update, delete on public.cigars to authenticated;
create policy own_rows on public.cigars for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create trigger set_updated_at before update on public.smoking_sessions
for each row execute function public.tj_set_updated_at();
alter table public.smoking_sessions enable row level security;
alter table public.smoking_sessions force row level security;
revoke all on public.smoking_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.smoking_sessions to authenticated;
create policy own_rows on public.smoking_sessions for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create trigger set_updated_at before update on public.media
for each row execute function public.tj_set_updated_at();
alter table public.media enable row level security;
alter table public.media force row level security;
revoke all on public.media from public, anon, authenticated;
grant select, insert, update, delete on public.media to authenticated;
create policy own_rows on public.media for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create index smoking_sessions_pipe_id_idx on public.smoking_sessions(user_id, pipe_id);
create index smoking_sessions_tobacco_id_idx on public.smoking_sessions(user_id, tobacco_id);
create index smoking_sessions_cigar_id_idx on public.smoking_sessions(user_id, cigar_id);
create index media_pipe_id_idx on public.media(user_id, pipe_id);
create index media_tobacco_id_idx on public.media(user_id, tobacco_id);
create index media_cigar_id_idx on public.media(user_id, cigar_id);
create index media_smoking_session_id_idx on public.media(user_id, smoking_session_id);

-- Fail on an existing bucket ID rather than silently altering its configuration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-photos', 'journal-photos', false, 3145728,
        array['image/jpeg', 'image/png', 'image/webp']);

-- Supabase manages storage.objects grants and RLS. Do not alter its schema.
create policy tj_photos_select on storage.objects for select to authenticated
using (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tj_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tj_photos_update on storage.objects for update to authenticated
using (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tj_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
