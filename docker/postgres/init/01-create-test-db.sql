-- Runs once, when the local Postgres volume is first created (Decision 34).
-- The DEV database (jdsheets_dev) is created by POSTGRES_DB; this adds the TEST database.
CREATE DATABASE jdsheets_test OWNER jdsheets;
