-- times are milliseconds since the epoch, days are Zurich days written YYYY-MM-DD, booleans 0 or 1
create table member (
  id                 integer primary key,
  first_name         text not null,
  last_name          text not null,
  gender             text not null check (gender in ('f', 'm')),
  council            text not null check (council in ('N', 'S')),
  canton             text not null,
  -- JSON
  party              text not null,
  photo_code         text,
  photo_hash         text,
  photo_sha1         text,
  photo_placeholder  integer not null default 0 check (photo_placeholder in (0, 1)),
  active             integer not null default 1 check (active in (0, 1)),
  updated_at         integer not null
) strict;

create table roster_import (
  id             integer primary key,
  started_at     integer not null,
  -- a running import renews this while it works; past it, the import is taken for dead
  lease_until    integer,
  -- set when the roster is published, before the photo sync that may follow
  finished_at    integer,
  status         text not null check (status in ('running', 'published', 'rejected', 'failed')),
  national       integer,
  states         integer,
  without_photo  integer,
  detail         text
) strict;

create table photo_placeholder (
  sha1     text primary key,
  seen_at  integer not null
) strict;

create table visitor (
  id            text primary key,
  token_hash    blob not null unique,
  created_at    integer not null,
  last_game_at  integer
) strict;

-- a forgotten visitor leaves their games behind as anonymous statistics
create table game (
  id           text primary key,
  visitor_id   text references visitor(id) on delete set null,
  council      text not null check (council in ('all', 'N', 'S')),
  language     text not null check (language in ('de', 'fr', 'it', 'rm')),
  total        integer not null,
  round_index  integer not null default 0,
  score        integer not null default 0,
  correct      integer not null default 0,
  replaced     integer not null default 0,
  unranked     text check (unranked in ('photo', 'fast', 'unstarted')),
  share_token  text unique,
  started_at   integer not null,
  finished_at  integer
) strict;

create index game_finished_ranked_idx on game (council, finished_at)
  where finished_at is not null and unranked is null;
create index game_visitor_idx on game (visitor_id);
create index game_unfinished_idx on game (started_at) where finished_at is null;
create index game_finished_idx on game (finished_at) where finished_at is not null;

-- one row per dealt round; a replaced round keeps its row with voided_at set
create table game_round (
  id                integer primary key,
  game_id           text not null references game(id) on delete cascade,
  round_index       integer not null,
  member_id         integer not null references member(id),
  -- JSON array of member ids
  option_ids        text not null,
  photo_token       text not null unique,
  photo_code        text not null,
  -- JSON
  crop              text not null,
  ready_at          integer,
  photo_served_at   integer,
  clock_started_at  integer,
  answered_at       integer,
  chosen_id         integer,
  correct           integer check (correct in (0, 1)),
  points            integer,
  voided_at         integer
) strict;

create unique index game_round_live_idx on game_round (game_id, round_index) where voided_at is null;
create index game_round_game_idx on game_round (game_id);

-- page views counted per day, never per person
create table page_view (
  day       text not null,
  page      text not null check (page in ('home', 'members', 'shared')),
  language  text not null,
  referrer  text not null default '',
  device    text not null check (device in ('mobile', 'desktop')),
  views     integer not null default 0,
  primary key (day, page, language, referrer, device)
) strict, without rowid;

-- one row per visitor and day: a hash salted with a random value kept in memory for that day only
create table visitor_day (
  day          text not null,
  fingerprint  blob not null,
  primary key (day, fingerprint)
) strict, without rowid;

-- games started per Zurich day, kept apart from the games, which are deleted when left unfinished
create table games_started_day (
  day      text primary key,
  started  integer not null
) strict, without rowid;
