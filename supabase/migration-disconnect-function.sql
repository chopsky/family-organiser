-- Migration: Atomic calendar disconnect + supporting index
-- Run this in the Supabase SQL Editor.
--
-- Context: Disconnecting a calendar connection with tens of thousands of
-- linked sync_mappings / events keeps hitting the default ~8s Postgres
-- statement_timeout, across multiple cascade points (mappings cascade,
-- subscription SET NULL cascade on events, etc.). Chasing each cascade
-- individually via batched Node-side queries still hits slow SELECTs
-- when calendar_events.subscription_id has no index.
--
-- This migration:
--   1. Adds the missing index so subscription_id filters are fast.
--   2. Moves the whole disconnect into a single SECURITY DEFINER function
--      with a raised statement_timeout, so it runs atomically server-side
--      without Node round-trips and can't be killed by HTTP timeouts.

-- Speed up any WHERE subscription_id = ... / IN (...) lookups
CREATE INDEX IF NOT EXISTS idx_calendar_events_subscription
  ON calendar_events(subscription_id)
  WHERE subscription_id IS NOT NULL;

-- Raise the timeout for this one function so a large cascade can finish.
-- 5 min is plenty of headroom; typical disconnect should complete in
-- seconds once the index is in place.
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

  -- 1. Soft-delete events that were synced from these connections.
  WITH updated AS (
    UPDATE calendar_events
       SET deleted_at = now()
     WHERE id IN (
             SELECT event_id FROM calendar_sync_mappings
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
  --    still point at these subs, so the subsequent DELETE isn't forced
  --    to do a giant cascading SET NULL on all of them at once.
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

-- Allow the service role (what the backend uses) to call the function.
GRANT EXECUTE ON FUNCTION public.disconnect_calendar_connection(uuid, text) TO service_role;
