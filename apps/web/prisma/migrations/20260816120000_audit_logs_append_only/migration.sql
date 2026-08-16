-- DATA-08 · make CLAUDE.md rule 6 true rather than intended.
--
-- `audit_logs` is append-only by convention. The integration tests prove the
-- application only ever appends, and that a correction leaves the original row
-- byte-identical — but nothing stopped an UPDATE typed into a database console,
-- and "the ledger was never rewritten" is worth much more when it is enforced
-- than when it is asserted.
--
-- Applied before the platform holds real member data, deliberately: a guarantee
-- that has been in place since the first row is provable, one added later covers
-- only the rows after it.
--
-- NOTE FOR ANYONE REGENERATING THE BASELINE: Prisma cannot model triggers.
-- `prisma migrate diff` will not see this, and a future `--from-empty` baseline
-- would drop it silently. schema.prisma carries a comment above model AuditLog
-- pointing here.

CREATE OR REPLACE FUNCTION hasnahena_audit_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- UPDATE is never allowed, under any circumstances. A correction appends a new
  -- row; that is the entire point of the table.
  --
  -- DELETE is allowed only inside a transaction that has explicitly opted in.
  -- That escape hatch exists for exactly one caller: `pnpm db:clear`, which
  -- resets a test environment and is how the fake data gets removed before
  -- go-live. Without it this trigger would break the cutover it is meant to
  -- protect. It is a session-local setting, so it cannot leak to another
  -- connection, and it has to be written on purpose — which is what makes a
  -- deliberate purge distinguishable from an accident or an injected statement.
  IF TG_OP = 'DELETE'
     AND current_setting('hasnahena.allow_audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted on row %', TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation',
          HINT = 'Corrections append a new row. See CLAUDE.md rule 6. A deliberate reset must SET LOCAL hasnahena.allow_audit_purge = ''on''.';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION hasnahena_audit_logs_append_only();

-- TRUNCATE is deliberately NOT covered. It fires a TRUNCATE trigger, not
-- BEFORE DELETE, so this does not block it — which is what keeps the Go
-- integration suite working, since it truncates every table between tests. A
-- TRUNCATE requires table ownership; the application role does not have a reason
-- to hold it, and that is the control that matters there.
