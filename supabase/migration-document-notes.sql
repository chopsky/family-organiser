-- Notes in Documents
-- A note is a `documents` row with kind='note' and body text, and no file.
-- Files keep kind='file' (the default), so existing rows are unaffected.

alter table documents add column if not exists kind text not null default 'file';
alter table documents add column if not exists body text;

-- Notes have no file, so the file columns must be nullable.
alter table documents alter column file_path drop not null;
alter table documents alter column file_size drop not null;
alter table documents alter column mime_type drop not null;

-- Constrain kind to the known values.
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check check (kind in ('file', 'note'));

-- Listing notes within a household/folder.
create index if not exists idx_documents_kind on documents (household_id, kind);
