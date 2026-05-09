DROP POLICY IF EXISTS storage_lead_documents_public_select ON storage.objects;
DROP POLICY IF EXISTS storage_lead_documents_owner_insert ON storage.objects;
DROP POLICY IF EXISTS storage_lead_documents_owner_update ON storage.objects;
DROP POLICY IF EXISTS storage_lead_documents_owner_delete ON storage.objects;

CREATE POLICY storage_lead_documents_public_select
  ON storage.objects
  FOR SELECT
  TO authenticated, anon
  USING (bucket = 'lead-documents');

CREATE POLICY storage_lead_documents_owner_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket = 'lead-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY storage_lead_documents_owner_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket = 'lead-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  )
  WITH CHECK (
    bucket = 'lead-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY storage_lead_documents_owner_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket = 'lead-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

GRANT USAGE ON SCHEMA storage TO authenticated, anon;
GRANT SELECT ON storage.objects TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
