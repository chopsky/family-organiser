-- Receipts: persist every scanned receipt so the Receipts page can show a
-- history (merchant, total, how many items matched the grocery list) and let
-- the household reconcile the remaining lines later. Previously scanning a
-- receipt was fire-and-forget; this gives it a home.
--
-- A receipt has many receipt_items (the extracted lines). matched_count is the
-- number of lines auto-matched (or later reconciled) against the shopping list;
-- status is 'matched' when every line is reconciled, else 'review'. The image
-- itself is NOT stored - only the extracted data - so there's no R2/object
-- cleanup to do on delete (receipt_items cascade away with the parent).

CREATE TABLE IF NOT EXISTS receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  merchant      TEXT,                       -- store_name from the scan (nullable)
  purchased_on  DATE,                        -- receipt date if the scan found one
  total_text    TEXT,                        -- raw total as printed, e.g. "£68.40"
  item_count    INTEGER NOT NULL DEFAULT 0,  -- number of extracted lines
  matched_count INTEGER NOT NULL DEFAULT 0,  -- lines matched to the shopping list
  status        TEXT NOT NULL DEFAULT 'review',  -- 'matched' | 'review'
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipts_household ON receipts (household_id, created_at DESC);

CREATE TABLE IF NOT EXISTS receipt_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id            UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  household_id          UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,       -- normalised_name
  original_text         TEXT,                -- raw receipt line
  price_text            TEXT,                -- raw price as printed, e.g. "£2.40"
  matched               BOOLEAN NOT NULL DEFAULT false,
  matched_list_item_id  UUID,                -- shopping list item it satisfied, if any
  matched_list_item_name TEXT,
  confidence            NUMERIC,             -- match confidence 0-1 (null if manual)
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items (receipt_id);
