-- Defense-in-depth tenant isolation. Application queries still must filter by
-- organizationId. FORCE RLS is required because the app role owns these tables.

CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.current_org_id', true)
$$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.current_user_id', true)
$$;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.bypass_rls', true) = 'on'
$$;

-- Direct organizationId tables
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Membership";
CREATE POLICY tenant_isolation ON "Membership"
  USING (
    app_bypass_rls()
    OR "organizationId" = app_current_org_id()
    OR "userId" = app_current_user_id()
  )
  WITH CHECK (
    app_bypass_rls()
    OR "organizationId" = app_current_org_id()
  );

ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invitation";
CREATE POLICY tenant_isolation ON "Invitation"
  USING (app_bypass_rls() OR "organizationId" = app_current_org_id())
  WITH CHECK (app_bypass_rls() OR "organizationId" = app_current_org_id());

ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Project";
CREATE POLICY tenant_isolation ON "Project"
  USING (app_bypass_rls() OR "organizationId" = app_current_org_id())
  WITH CHECK (app_bypass_rls() OR "organizationId" = app_current_org_id());

ALTER TABLE "ActivityLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ActivityLog";
CREATE POLICY tenant_isolation ON "ActivityLog"
  USING (app_bypass_rls() OR "organizationId" = app_current_org_id())
  WITH CHECK (app_bypass_rls() OR "organizationId" = app_current_org_id());

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Notification";
CREATE POLICY tenant_isolation ON "Notification"
  USING (app_bypass_rls() OR "organizationId" = app_current_org_id())
  WITH CHECK (app_bypass_rls() OR "organizationId" = app_current_org_id());

-- Nested: Board → Project
ALTER TABLE "Board" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Board" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Board";
CREATE POLICY tenant_isolation ON "Board"
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p.id = "Board"."projectId"
        AND p."organizationId" = app_current_org_id()
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p.id = "Board"."projectId"
        AND p."organizationId" = app_current_org_id()
    )
  );

ALTER TABLE "Column" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Column" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Column";
CREATE POLICY tenant_isolation ON "Column"
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Board" b
      JOIN "Project" p ON p.id = b."projectId"
      WHERE b.id = "Column"."boardId"
        AND p."organizationId" = app_current_org_id()
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Board" b
      JOIN "Project" p ON p.id = b."projectId"
      WHERE b.id = "Column"."boardId"
        AND p."organizationId" = app_current_org_id()
    )
  );

ALTER TABLE "Card" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Card" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Card";
CREATE POLICY tenant_isolation ON "Card"
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Column" c
      JOIN "Board" b ON b.id = c."boardId"
      JOIN "Project" p ON p.id = b."projectId"
      WHERE c.id = "Card"."columnId"
        AND p."organizationId" = app_current_org_id()
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Column" c
      JOIN "Board" b ON b.id = c."boardId"
      JOIN "Project" p ON p.id = b."projectId"
      WHERE c.id = "Card"."columnId"
        AND p."organizationId" = app_current_org_id()
    )
  );

ALTER TABLE "Comment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Comment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Comment";
CREATE POLICY tenant_isolation ON "Comment"
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Card" card
      JOIN "Column" c ON c.id = card."columnId"
      JOIN "Board" b ON b.id = c."boardId"
      JOIN "Project" p ON p.id = b."projectId"
      WHERE card.id = "Comment"."cardId"
        AND p."organizationId" = app_current_org_id()
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Card" card
      JOIN "Column" c ON c.id = card."columnId"
      JOIN "Board" b ON b.id = c."boardId"
      JOIN "Project" p ON p.id = b."projectId"
      WHERE card.id = "Comment"."cardId"
        AND p."organizationId" = app_current_org_id()
    )
  );

ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Attachment";
CREATE POLICY tenant_isolation ON "Attachment"
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Card" card
      JOIN "Column" c ON c.id = card."columnId"
      JOIN "Board" b ON b.id = c."boardId"
      JOIN "Project" p ON p.id = b."projectId"
      WHERE card.id = "Attachment"."cardId"
        AND p."organizationId" = app_current_org_id()
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "Card" card
      JOIN "Column" c ON c.id = card."columnId"
      JOIN "Board" b ON b.id = c."boardId"
      JOIN "Project" p ON p.id = b."projectId"
      WHERE card.id = "Attachment"."cardId"
        AND p."organizationId" = app_current_org_id()
    )
  );
