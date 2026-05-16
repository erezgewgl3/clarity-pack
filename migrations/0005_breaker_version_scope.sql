-- 0005_breaker_version_scope.sql
-- Plan 03-07 -- version-scope the durable circuit breaker.
-- isCircuitOpenDurable counted ALL editor_agent_failures rows, so a fresh
-- post-fix install was silently DOA on pre-fix failure history (the
-- 2026-05-16 re-drill had to hand-delete 518+482 stale rows). recordFailure
-- now stamps the plugin version; isCircuitOpenDurable counts only
-- current-version rows. Additive: pre-fix rows keep NULL and are excluded.
ALTER TABLE plugin_clarity_pack_cdd6bda4bd.editor_agent_failures
  ADD COLUMN IF NOT EXISTS plugin_version text;

COMMENT ON COLUMN plugin_clarity_pack_cdd6bda4bd.editor_agent_failures.plugin_version IS
  'Clarity Pack plugin version that recorded this failure. NULL = pre-0.3.0 rows.';
