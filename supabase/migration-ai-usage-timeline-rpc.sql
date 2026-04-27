-- AI usage timeline aggregation as an RPC.
--
-- Previously getAiUsageTimeline pulled raw rows from ai_usage_log and counted
-- them in JS. PostgREST silently caps every SELECT at the project's max-rows
-- (default 1000), so once daily volume crossed that threshold the chart
-- returned the OLDEST 1000 rows in the window and dropped the most recent
-- ones — making the admin dashboard chart cut off ~6 days before "now".
--
-- Aggregating in SQL returns ~30 days × 3 providers = ~90 rows max,
-- comfortably under any cap, and is much faster (one indexed scan + group by
-- vs. round-tripping every row to the API server).
--
-- Re-runnable: `create or replace` makes this idempotent.

create or replace function get_ai_usage_timeline(days_param int)
returns table (
  day date,
  provider text,
  call_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    created_at::date as day,
    provider,
    count(*) as call_count
  from ai_usage_log
  where created_at >= now() - (days_param || ' days')::interval
  group by created_at::date, provider
  order by created_at::date asc, provider asc
$$;

-- Allow the service role to call it. Anon/authenticated don't need it —
-- only the admin dashboard hits this, via the API server using the service
-- key. security definer keeps it locked down regardless of caller RLS.
grant execute on function get_ai_usage_timeline(int) to service_role;
