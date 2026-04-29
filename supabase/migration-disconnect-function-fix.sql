-- Migration: Fix disconnect_calendar_connection's event-deletion scope
-- Run this in the Supabase SQL Editor.
--
-- Problem the original function had: step 1 soft-deleted every event
-- that had a sync_mapping for the disconnected connection. That set
-- includes BOTH inbound mirrors (events the user created in Apple/
-- Google/Outlook, mirrored into Housemait — fine to remove) AND
-- Housemait-originated events that we'd merely pushed outward (events
-- the user created IN Housemait, where the mapping is just so we can
-- update/delete the external copy later — must NOT be removed). On
-- disconnect, those Housemait-originated events were getting
-- soft-deleted along with the inbound ones, costing the user data on
-- the Housemait side as well as the external side.
--
-- The fix: scope step 1 to events whose `subscription_id` belongs to a
-- subscription on one of the disconnected connections — same filter
-- step 3 already uses to break the FK link. That cleanly identifies
-- inbound mirrors (subscription_id NOT NULL) and leaves
-- Housemait-originated events (subscription_id IS NULL) untouched.
--
-- The other steps (delete sync_mappings, break subscription_id link,
-- delete subscriptions, delete connection) are unchanged — they were
-- already correct.

CREATE OR REPLACE FUNCTION public.disconnect_calendar_connection(
  p_user_id  uuid,
  p_provider text
)
RETURNS TABLE(
  removed_connections    integer,
  events_deleted         bigint,
  mappings_deleted       bigint,
  subscriptions_deleted  bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5min'
AS $$
DECLARE
  v_conn_ids        uuid[];
  v_events_deleted  bigint  := 0;
  v_mappings_deleted bigint := 0;
  v_subs_deleted    bigint  := 0;
  v_conns_deleted   integer := 0;
BEGIN
  -- Find all matching connections for this user + provider.
  SELECT array_agg(id) INTO v_conn_ids
  FROM calendar_connections
  WHERE user_id = p_user_id AND provider = p_provider;

  IF v_conn_ids IS NULL OR array_length(v_conn_ids, 1) = 0 THEN
    RETURN QUERY SELECT 0, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- 1. Soft-delete inbound-mirrored events (events that originated in
  --    the external calendar and were pulled into Housemait). Filter
  --    by subscription_id, NOT by sync_mappings — sync_mappings exist
  --    for outbound Housemait-originated events too, and those must
  --    survive disconnect (the user's own Housemait data).
  WITH updated AS (
    UPDATE calendar_events
       SET deleted_at = now()
     WHERE subscription_id IN (
             SELECT id FROM calendar_subscriptions
              WHERE connection_id = ANY(v_conn_ids)
           )
       AND deleted_at IS NULL
    RETURNING id
  )
  SELECT count(*) INTO v_events_deleted FROM updated;

  -- 2. Remove sync_mappings (the primary thing blocking cascade).
  WITH deleted AS (
    DELETE FROM calendar_sync_mappings
     WHERE connection_id = ANY(v_conn_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_mappings_deleted FROM deleted;

  -- 3. Break the subscription_id → subscriptions link on any events that
  --    still point at these subs (only matters if step 1's soft-delete
  --    didn't catch them — e.g. legacy events whose subscription_id was
  --    already cleared but mapping survived).
  UPDATE calendar_events
     SET subscription_id = NULL
   WHERE subscription_id IN (
           SELECT id FROM calendar_subscriptions
            WHERE connection_id = ANY(v_conn_ids)
         );

  -- 4. Delete subscriptions (fast now — nothing to cascade to).
  WITH deleted AS (
    DELETE FROM calendar_subscriptions
     WHERE connection_id = ANY(v_conn_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_subs_deleted FROM deleted;

  -- 5. Delete the connection rows themselves.
  WITH deleted AS (
    DELETE FROM calendar_connections
     WHERE id = ANY(v_conn_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_conns_deleted FROM deleted;

  RETURN QUERY SELECT v_conns_deleted, v_events_deleted, v_mappings_deleted, v_subs_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.disconnect_calendar_connection(uuid, text) TO service_role;
