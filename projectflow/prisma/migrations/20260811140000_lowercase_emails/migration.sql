-- Fail closed if case-insensitive email collisions exist, then lowercase User + Invitation emails.

DO $$
DECLARE
  collisions TEXT;
BEGIN
  SELECT string_agg(e, ', ')
  INTO collisions
  FROM (
    SELECT lower(email) AS e
    FROM "User"
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) dupes;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot lowercase User.email: colliding emails: %', collisions;
  END IF;
END $$;

UPDATE "User"
SET email = lower(email)
WHERE email <> lower(email);

UPDATE "Invitation"
SET email = lower(email)
WHERE email <> lower(email);
