CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY) STRICT;
CREATE TABLE IF NOT EXISTS catalog_records (
 id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK(category IN ('mix','entity','event')),
 name TEXT NOT NULL, normalized_name TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 verification TEXT NOT NULL CHECK(verification IN ('proposed','source-confirmed','curator-confirmed')),
 review_state TEXT NOT NULL CHECK(review_state IN ('ready','review')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS records_name ON catalog_records(normalized_name,id);
CREATE TABLE IF NOT EXISTS mixes (
 record_id TEXT PRIMARY KEY REFERENCES catalog_records(id) ON DELETE CASCADE, title TEXT NOT NULL,
 description TEXT, duration_ms INTEGER, recorded_value TEXT, recorded_precision TEXT, uploaded_value TEXT, uploaded_precision TEXT,
 location TEXT, venue TEXT, file_url TEXT, stream_url TEXT, bpm_min REAL, bpm_max REAL, loudness_lufs REAL
) STRICT;
CREATE TABLE IF NOT EXISTS entities (
 record_id TEXT PRIMARY KEY REFERENCES catalog_records(id) ON DELETE CASCADE, display_name TEXT NOT NULL, profile TEXT, country TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS entity_roles (
 record_id TEXT NOT NULL REFERENCES entities(record_id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('artist','crew','label')),
 PRIMARY KEY(record_id,role)
) STRICT;
CREATE TABLE IF NOT EXISTS artist_details (record_id TEXT PRIMARY KEY REFERENCES entities(record_id) ON DELETE CASCADE, real_name TEXT) STRICT;
CREATE TABLE IF NOT EXISTS crew_details (record_id TEXT PRIMARY KEY REFERENCES entities(record_id) ON DELETE CASCADE) STRICT;
CREATE TABLE IF NOT EXISTS label_details (record_id TEXT PRIMARY KEY REFERENCES entities(record_id) ON DELETE CASCADE, contact_info TEXT) STRICT;
CREATE TABLE IF NOT EXISTS events (
 record_id TEXT PRIMARY KEY REFERENCES catalog_records(id) ON DELETE CASCADE, name TEXT NOT NULL,
 date_value TEXT, date_precision TEXT, end_value TEXT, end_precision TEXT, venue TEXT, location TEXT, country TEXT, description TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS entity_aliases (
 record_id TEXT NOT NULL REFERENCES entities(record_id) ON DELETE CASCADE, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
 position INTEGER NOT NULL, PRIMARY KEY(record_id,normalized_name)
) STRICT;
CREATE INDEX IF NOT EXISTS aliases_name ON entity_aliases(normalized_name,record_id);
CREATE TABLE IF NOT EXISTS record_texts (
 record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE, field TEXT NOT NULL, value TEXT NOT NULL,
 normalized_value TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(record_id,field,normalized_value)
) STRICT;
CREATE TABLE IF NOT EXISTS record_links (
 record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE, field TEXT NOT NULL,
 target_id TEXT NOT NULL REFERENCES catalog_records(id), position INTEGER NOT NULL, PRIMARY KEY(record_id,field,target_id)
) STRICT;
CREATE INDEX IF NOT EXISTS links_target ON record_links(target_id,field);
CREATE TABLE IF NOT EXISTS entity_relationships (
 record_id TEXT NOT NULL REFERENCES entities(record_id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES entities(record_id),
 relation TEXT NOT NULL CHECK(relation IN ('member-of','member','parent-label','sub-label','alias-of')), position INTEGER NOT NULL,
 PRIMARY KEY(record_id,relation,target_id)
) STRICT;
CREATE TABLE IF NOT EXISTS provider_identities (
 provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL,
 record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
 PRIMARY KEY(provider,resource_type,external_id), UNIQUE(provider,resource_type,external_id,record_id)
) STRICT;
CREATE TABLE IF NOT EXISTS provider_sources (
 record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE, provider TEXT NOT NULL, resource_type TEXT NOT NULL,
 external_id TEXT, url TEXT NOT NULL, PRIMARY KEY(provider,resource_type,url),
 FOREIGN KEY(provider,resource_type,external_id,record_id) REFERENCES provider_identities(provider,resource_type,external_id,record_id)
) STRICT;
CREATE TABLE IF NOT EXISTS media_assets (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
 field TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, source TEXT, source_url TEXT,
 width INTEGER, height INTEGER, analyzed_at TEXT, UNIQUE(record_id,field,position)
) STRICT;
CREATE TABLE IF NOT EXISTS field_claims (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
 field TEXT NOT NULL, value_json TEXT NOT NULL, provider TEXT NOT NULL, source_url TEXT NOT NULL, resource_json TEXT,
 observed_at TEXT NOT NULL, evidence TEXT NOT NULL, match_state TEXT NOT NULL, reason TEXT NOT NULL, confidence REAL NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('selected','corroborated','pending','rejected')), record_revision INTEGER, excerpt TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS claims_record ON field_claims(record_id,disposition);
CREATE TABLE IF NOT EXISTS selected_evidence (
 record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE, field TEXT NOT NULL,
 claim_id TEXT NOT NULL REFERENCES field_claims(id), PRIMARY KEY(record_id,field)
) STRICT;
CREATE TABLE IF NOT EXISTS review_decisions (
 id INTEGER PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES field_claims(id), decision TEXT NOT NULL,
 actor TEXT NOT NULL, decided_at TEXT NOT NULL, record_revision INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS legacy_aliases (legacy_id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES catalog_records(id)) STRICT;
CREATE TABLE IF NOT EXISTS enrichment_runs (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES catalog_records(id), state TEXT NOT NULL,
 created_at TEXT NOT NULL, completed_at TEXT, report_json TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS curator_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS migration_batches (batch_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, result_json TEXT NOT NULL) STRICT;
INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
