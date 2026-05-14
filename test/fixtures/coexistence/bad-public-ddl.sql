-- bad-public-ddl.sql — coexistence fixture for COEXIST-02 test.
-- This file MUST NOT be added to the real migrations/ directory; it lives
-- under test/fixtures/coexistence/ so the test can copy it into a temp dir
-- and run check #2 against it.

ALTER TABLE public.issues ADD COLUMN clarity_pack_owned text;
