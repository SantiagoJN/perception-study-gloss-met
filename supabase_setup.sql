-- Material constancy study schema.
-- 1. Run this file in a new Supabase project's SQL Editor.
-- 2. Import supabase_seeds/constancy_pairs.csv into constancy_pairs.
-- 3. Import supabase_seeds/constancy_reference_sets.csv into constancy_reference_sets.

create table if not exists public.constancy_pairs (
  pair_id text primary key,
  physical_type text not null check (physical_type in ('same_material', 'different_material')),
  provisional_level text not null check (provisional_level in ('easy', 'medium_easy', 'medium_hard', 'hard')),
  change_type text not null,
  image_path_a text not null,
  image_path_b text not null,
  material_a text not null,
  material_b text not null,
  group_id text not null,
  target_labels smallint not null default 10 check (target_labels > 0),
  completed_labels smallint not null default 0 check (completed_labels >= 0),
  reserved_labels smallint not null default 0 check (reserved_labels >= 0),
  active boolean not null default true
);

create table if not exists public.constancy_reference_sets (
  reference_id text primary key,
  source_pair_id text not null,
  provisional_level text not null check (provisional_level in ('easy', 'medium_easy', 'medium_hard', 'hard')),
  change_type text not null,
  reference_path text not null,
  correct_candidate_path text not null,
  distractor_path_1 text not null,
  distractor_path_2 text not null,
  distractor_path_3 text not null,
  target_labels smallint not null default 10 check (target_labels > 0),
  completed_labels smallint not null default 0 check (completed_labels >= 0),
  reserved_labels smallint not null default 0 check (reserved_labels >= 0),
  active boolean not null default true,
  check (
    correct_candidate_path <> distractor_path_1
    and correct_candidate_path <> distractor_path_2
    and correct_candidate_path <> distractor_path_3
    and distractor_path_1 <> distractor_path_2
    and distractor_path_1 <> distractor_path_3
    and distractor_path_2 <> distractor_path_3
  )
);

create table if not exists public.constancy_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id text not null,
  prolific_study_id text not null,
  prolific_session_id text not null unique,
  gender text not null check (gender in ('male', 'female', 'other', 'prefer_not_to_answer')),
  gender_other text check (gender_other is null or length(gender_other) <= 80),
  age smallint not null check (age between 18 and 100),
  computer_graphics_knowledge text not null check (computer_graphics_knowledge in ('none', 'basic', 'intermediate', 'professional')),
  design_modeling_experience text not null check (design_modeling_experience in ('none', 'basic', 'intermediate', 'professional')),
  artistic_experience text not null check (artistic_experience in ('none', 'basic', 'intermediate', 'professional')),
  status text not null default 'assigned' check (status in ('assigned', 'completed', 'expired')),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (participant_id, prolific_study_id)
);

create table if not exists public.constancy_pair_assignments (
  study_session_id uuid not null references public.constancy_sessions(id) on delete cascade,
  pair_id text not null references public.constancy_pairs(pair_id),
  trial_number smallint not null check (trial_number between 1 and 40),
  swap_ab boolean not null,
  completed boolean not null default false,
  primary key (study_session_id, pair_id),
  unique (study_session_id, trial_number)
);

create table if not exists public.constancy_reference_assignments (
  study_session_id uuid not null references public.constancy_sessions(id) on delete cascade,
  reference_id text not null references public.constancy_reference_sets(reference_id),
  trial_number smallint not null check (trial_number between 1 and 20),
  candidate_order jsonb not null check (
    jsonb_typeof(candidate_order) = 'array'
    and jsonb_array_length(candidate_order) = 4
  ),
  completed boolean not null default false,
  primary key (study_session_id, reference_id),
  unique (study_session_id, trial_number)
);

create table if not exists public.constancy_pair_responses (
  study_session_id uuid not null references public.constancy_sessions(id) on delete cascade,
  pair_id text not null references public.constancy_pairs(pair_id),
  same_material_likelihood smallint not null check (same_material_likelihood between 1 and 5),
  relative_glossiness smallint not null check (relative_glossiness between -1 and 1),
  relative_metallicness smallint not null check (relative_metallicness between -1 and 1),
  response_time_ms integer not null check (response_time_ms >= 0),
  created_at timestamptz not null default now(),
  primary key (study_session_id, pair_id)
);

create table if not exists public.constancy_reference_responses (
  study_session_id uuid not null references public.constancy_sessions(id) on delete cascade,
  reference_id text not null references public.constancy_reference_sets(reference_id),
  candidate_order jsonb not null check (jsonb_typeof(candidate_order) = 'array' and jsonb_array_length(candidate_order) = 4),
  selected_candidate_path text not null,
  selected_position smallint not null check (selected_position between 1 and 4),
  correct boolean not null,
  response_time_ms integer not null check (response_time_ms >= 0),
  created_at timestamptz not null default now(),
  primary key (study_session_id, reference_id)
);

create index if not exists constancy_pairs_coverage_idx
  on public.constancy_pairs (active, completed_labels, reserved_labels, target_labels);
create index if not exists constancy_reference_coverage_idx
  on public.constancy_reference_sets (active, completed_labels, reserved_labels, target_labels);

alter table public.constancy_pairs enable row level security;
alter table public.constancy_reference_sets enable row level security;
alter table public.constancy_sessions enable row level security;
alter table public.constancy_pair_assignments enable row level security;
alter table public.constancy_reference_assignments enable row level security;
alter table public.constancy_pair_responses enable row level security;
alter table public.constancy_reference_responses enable row level security;

revoke all on public.constancy_pairs from anon, authenticated;
revoke all on public.constancy_reference_sets from anon, authenticated;
revoke all on public.constancy_sessions from anon, authenticated;
revoke all on public.constancy_pair_assignments from anon, authenticated;
revoke all on public.constancy_reference_assignments from anon, authenticated;
revoke all on public.constancy_pair_responses from anon, authenticated;
revoke all on public.constancy_reference_responses from anon, authenticated;

create or replace function public.claim_constancy_session(
  p_participant_id text,
  p_study_id text,
  p_prolific_session_id text,
  p_demographics jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_pair_ids text[];
  v_reference_ids text[];
  v_pairs jsonb;
  v_references jsonb;
begin
  if coalesce(length(trim(p_participant_id)), 0) = 0
     or coalesce(length(trim(p_study_id)), 0) = 0
     or coalesce(length(trim(p_prolific_session_id)), 0) = 0 then
    raise exception 'Missing study identifiers';
  end if;
  if jsonb_typeof(p_demographics) <> 'object'
     or coalesce(p_demographics->>'gender', '') not in ('male', 'female', 'other', 'prefer_not_to_answer')
     or (p_demographics->>'gender' = 'other' and coalesce(length(trim(p_demographics->>'gender_other')), 0) = 0)
     or coalesce(p_demographics->>'age', '') !~ '^[0-9]+$'
     or coalesce(p_demographics->>'computer_graphics_knowledge', '') not in ('none', 'basic', 'intermediate', 'professional')
     or coalesce(p_demographics->>'design_modeling_experience', '') not in ('none', 'basic', 'intermediate', 'professional')
     or coalesce(p_demographics->>'artistic_experience', '') not in ('none', 'basic', 'intermediate', 'professional') then
    raise exception 'Invalid demographics';
  end if;
  if (p_demographics->>'age')::integer not between 18 and 100 then
    raise exception 'Invalid demographics';
  end if;

  -- Release reservations from sessions abandoned for more than six hours.
  with stale as materialized (
    select id from public.constancy_sessions
    where status = 'assigned' and assigned_at < now() - interval '6 hours'
    for update skip locked
  ), released as (
    update public.constancy_pairs as pair
    set reserved_labels = greatest(0, pair.reserved_labels - counts.n)::smallint
    from (
      select assignment.pair_id, count(*)::integer as n
      from public.constancy_pair_assignments as assignment
      join stale on stale.id = assignment.study_session_id
      group by assignment.pair_id
    ) as counts
    where pair.pair_id = counts.pair_id
  )
  update public.constancy_reference_sets as reference
  set reserved_labels = greatest(0, reference.reserved_labels - counts.n)::smallint
  from (
    select assignment.reference_id, count(*)::integer as n
    from public.constancy_reference_assignments as assignment
    join stale on stale.id = assignment.study_session_id
    group by assignment.reference_id
  ) as counts
  where reference.reference_id = counts.reference_id;

  update public.constancy_sessions
  set status = 'expired'
  where status = 'assigned' and assigned_at < now() - interval '6 hours';

  select id into v_session_id
  from public.constancy_sessions
  where (
    prolific_session_id = p_prolific_session_id
    or (participant_id = p_participant_id and prolific_study_id = p_study_id)
  ) and status <> 'expired'
  order by assigned_at desc
  limit 1;

  if v_session_id is null then
    -- An abandoned session may have the same unique Prolific identifiers.
    -- Remove it before issuing a fresh assignment.
    delete from public.constancy_sessions
    where status = 'expired'
      and (
        prolific_session_id = p_prolific_session_id
        or (participant_id = p_participant_id and prolific_study_id = p_study_id)
      );

    insert into public.constancy_sessions (
      participant_id, prolific_study_id, prolific_session_id,
      gender, gender_other, age, computer_graphics_knowledge,
      design_modeling_experience, artistic_experience
    ) values (
      p_participant_id, p_study_id, p_prolific_session_id,
      p_demographics->>'gender', nullif(trim(p_demographics->>'gender_other'), ''),
      (p_demographics->>'age')::smallint,
      p_demographics->>'computer_graphics_knowledge',
      p_demographics->>'design_modeling_experience',
      p_demographics->>'artistic_experience'
    ) returning id into v_session_id;

    select array_agg(candidate.pair_id order by candidate.coverage, candidate.tie_break)
      into v_pair_ids
    from (
      select pair_id, completed_labels + reserved_labels as coverage, random() as tie_break
      from public.constancy_pairs
      where active and completed_labels + reserved_labels < target_labels
      order by coverage, tie_break
      for update skip locked
      limit 40
    ) as candidate;
    if coalesce(array_length(v_pair_ids, 1), 0) <> 40 then
      raise exception 'Not enough pair trials remain for a complete session';
    end if;

    insert into public.constancy_pair_assignments (study_session_id, pair_id, trial_number, swap_ab)
    select v_session_id, item.pair_id, item.ordinality::smallint, random() < 0.5
    from unnest(v_pair_ids) with ordinality as item(pair_id, ordinality);
    update public.constancy_pairs set reserved_labels = reserved_labels + 1 where pair_id = any(v_pair_ids);

    select array_agg(candidate.reference_id order by candidate.coverage, candidate.tie_break)
      into v_reference_ids
    from (
      select reference_id, completed_labels + reserved_labels as coverage, random() as tie_break
      from public.constancy_reference_sets
      where active and completed_labels + reserved_labels < target_labels
      order by coverage, tie_break
      for update skip locked
      limit 20
    ) as candidate;
    if coalesce(array_length(v_reference_ids, 1), 0) <> 20 then
      raise exception 'Not enough reference trials remain for a complete session';
    end if;

    insert into public.constancy_reference_assignments (
      study_session_id, reference_id, trial_number, candidate_order
    )
    select
      v_session_id,
      item.reference_id,
      item.ordinality::smallint,
      (
        select jsonb_agg(candidate.path order by random())
        from (values
          (reference.correct_candidate_path),
          (reference.distractor_path_1),
          (reference.distractor_path_2),
          (reference.distractor_path_3)
        ) as candidate(path)
      )
    from unnest(v_reference_ids) with ordinality as item(reference_id, ordinality)
    join public.constancy_reference_sets as reference
      on reference.reference_id = item.reference_id;
    update public.constancy_reference_sets set reserved_labels = reserved_labels + 1 where reference_id = any(v_reference_ids);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'pair_id', pair.pair_id,
    'trial_number', assignment.trial_number,
    'swap_ab', assignment.swap_ab,
    'image_path_a', pair.image_path_a,
    'image_path_b', pair.image_path_b
  ) order by assignment.trial_number), '[]'::jsonb)
  into v_pairs
  from public.constancy_pair_assignments as assignment
  join public.constancy_pairs as pair on pair.pair_id = assignment.pair_id
  where assignment.study_session_id = v_session_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'reference_id', reference.reference_id,
    'trial_number', assignment.trial_number,
    'reference_path', reference.reference_path,
    'candidate_order', assignment.candidate_order
  ) order by assignment.trial_number), '[]'::jsonb)
  into v_references
  from public.constancy_reference_assignments as assignment
  join public.constancy_reference_sets as reference on reference.reference_id = assignment.reference_id
  where assignment.study_session_id = v_session_id;

  return jsonb_build_object(
    'study_session_id', v_session_id,
    'pair_trials', v_pairs,
    'reference_trials', v_references
  );
end;
$$;

create or replace function public.submit_constancy_session(
  p_study_session_id uuid,
  p_participant_id text,
  p_pair_responses jsonb,
  p_reference_responses jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_pair_count integer;
  v_reference_count integer;
begin
  select status into v_status
  from public.constancy_sessions
  where id = p_study_session_id and participant_id = p_participant_id
  for update;
  if v_status is null then raise exception 'Invalid study session'; end if;
  if v_status = 'completed' then return true; end if;
  if v_status <> 'assigned'
     or jsonb_typeof(p_pair_responses) <> 'array'
     or jsonb_array_length(p_pair_responses) <> 40
     or jsonb_typeof(p_reference_responses) <> 'array'
     or jsonb_array_length(p_reference_responses) <> 20 then
    raise exception 'Incomplete or inactive study session';
  end if;

  insert into public.constancy_pair_responses (
    study_session_id, pair_id, same_material_likelihood,
    relative_glossiness, relative_metallicness, response_time_ms
  )
  select p_study_session_id, response.pair_id, response.same_material_likelihood,
    response.relative_glossiness, response.relative_metallicness, response.response_time_ms
  from jsonb_to_recordset(p_pair_responses) as response(
    pair_id text,
    same_material_likelihood smallint,
    relative_glossiness smallint,
    relative_metallicness smallint,
    response_time_ms integer
  )
  join public.constancy_pair_assignments as assignment
    on assignment.study_session_id = p_study_session_id and assignment.pair_id = response.pair_id
  on conflict (study_session_id, pair_id) do nothing;
  get diagnostics v_pair_count = row_count;
  if v_pair_count <> 40 then raise exception 'Pair responses do not match the assignment'; end if;

  insert into public.constancy_reference_responses (
    study_session_id, reference_id, candidate_order, selected_candidate_path,
    selected_position, correct, response_time_ms
  )
  select
    p_study_session_id,
    response.reference_id,
    response.candidate_order,
    response.selected_candidate_path,
    (
      select candidate.ordinality::smallint
      from jsonb_array_elements_text(response.candidate_order)
        with ordinality as candidate(path, ordinality)
      where candidate.path = response.selected_candidate_path
      limit 1
    ),
    response.selected_candidate_path = reference.correct_candidate_path,
    response.response_time_ms
  from jsonb_to_recordset(p_reference_responses) as response(
    reference_id text,
    candidate_order jsonb,
    selected_candidate_path text,
    response_time_ms integer
  )
  join public.constancy_reference_assignments as assignment
    on assignment.study_session_id = p_study_session_id and assignment.reference_id = response.reference_id
  join public.constancy_reference_sets as reference on reference.reference_id = response.reference_id
  where jsonb_typeof(response.candidate_order) = 'array'
    and jsonb_array_length(response.candidate_order) = 4
    and response.candidate_order = assignment.candidate_order
    and assignment.candidate_order @> jsonb_build_array(response.selected_candidate_path)
  on conflict (study_session_id, reference_id) do nothing;
  get diagnostics v_reference_count = row_count;
  if v_reference_count <> 20 then raise exception 'Reference responses do not match the assignment'; end if;

  update public.constancy_pairs as pair
  set reserved_labels = greatest(0, pair.reserved_labels - 1),
      completed_labels = pair.completed_labels + 1
  where pair.pair_id in (
    select pair_id from public.constancy_pair_assignments where study_session_id = p_study_session_id
  );
  update public.constancy_reference_sets as reference
  set reserved_labels = greatest(0, reference.reserved_labels - 1),
      completed_labels = reference.completed_labels + 1
  where reference.reference_id in (
    select reference_id from public.constancy_reference_assignments where study_session_id = p_study_session_id
  );
  update public.constancy_pair_assignments set completed = true where study_session_id = p_study_session_id;
  update public.constancy_reference_assignments set completed = true where study_session_id = p_study_session_id;
  update public.constancy_sessions set status = 'completed', completed_at = now() where id = p_study_session_id;
  return true;
end;
$$;

revoke execute on function public.claim_constancy_session(text, text, text, jsonb) from public;
revoke execute on function public.submit_constancy_session(uuid, text, jsonb, jsonb) from public;
grant execute on function public.claim_constancy_session(text, text, text, jsonb) to anon;
grant execute on function public.submit_constancy_session(uuid, text, jsonb, jsonb) to anon;
