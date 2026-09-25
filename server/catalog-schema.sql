CREATE TABLE IF NOT EXISTS catalog_revisions (
  id bigserial PRIMARY KEY,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready')),
  coverage jsonb NOT NULL,
  cursor jsonb NOT NULL,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_one_draft ON catalog_revisions(status) WHERE status='draft';
CREATE TABLE IF NOT EXISTS catalog_entries (
  revision bigint NOT NULL REFERENCES catalog_revisions(id),
  media text NOT NULL CHECK(media IN ('movie','tv')),
  tmdb_id bigint NOT NULL,
  year integer NOT NULL,
  release_date date NOT NULL,
  genres integer[] NOT NULL,
  countries text[] NOT NULL,
  score real,
  votes integer NOT NULL,
  popularity real NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(revision,media,tmdb_id)
);
CREATE INDEX IF NOT EXISTS catalog_browse ON catalog_entries(revision,media,year,popularity DESC,tmdb_id);
CREATE INDEX IF NOT EXISTS catalog_genres ON catalog_entries USING gin(genres);
CREATE INDEX IF NOT EXISTS catalog_countries ON catalog_entries USING gin(countries);
CREATE INDEX IF NOT EXISTS catalog_score ON catalog_entries(revision,media,score DESC,votes DESC);
CREATE INDEX IF NOT EXISTS catalog_recent ON catalog_entries(revision,media,release_date DESC,tmdb_id);
