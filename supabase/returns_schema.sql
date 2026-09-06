-- MoodManga Store — Returns schema
-- Run this AFTER schema.sql and supabase/admin_schema.sql.
--
-- Adds a return-request flow so customers actually have a way to request a
-- return — the storefront footer already promises "7-day returns" but
-- nothing backed that promise before this file.
--
-- Customers never write to store_return_requests directly (no anon INSERT
-- policy): the request-return edge function validates the order/email/
-- window server-side with the service role key, same pattern as
-- create-order. Admins can read and update requests from the admin panel.

-- ---------------------------------------------------------------
-- 1. store_settings.return_window_days
-- ---------------------------------------------------------------
-- store_settings already exists live with free_shipping_threshold_inr /
-- standard_shipping_inr; this file is the first place either has been
-- checked into the repo, so it creates the table if missing (fresh
-- environments) and just adds the new column on top of it (existing ones).
create table if not exists store_settings (
  id boolean primary key default true,
  free_shipping_threshold_inr numeric(10,2) not null default 999,
  standard_shipping_inr numeric(10,2) not null default 49,
  updated_at timestamptz not null default now(),
  constraint store_settings_singleton check (id = true)
);

alter table store_settings add column if not exists return_window_days integer not null default 7;

alter table store_settings enable row level security;

create policy "Admins can read settings" on store_settings
  for select using (is_admin());

create policy "Admins can write settings" on store_settings
  for all using (is_admin());

-- ---------------------------------------------------------------
-- 2. store_return_requests
-- ---------------------------------------------------------------
create table if not exists store_return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references store_orders(id) on delete cascade,
  cashfree_order_id text not null,
  customer_email text not null,
  reason text not null,
  note text,
  status text not null default 'requested', -- requested | approved | rejected | picked_up | refunded
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One open request per order — resubmitting after a rejection is an
  -- admin-assisted edge case (change status back), not a customer self-serve
  -- retry, to avoid the same order spamming new requests.
  constraint one_request_per_order unique (order_id)
);

create index if not exists idx_return_requests_status on store_return_requests(status);

alter table store_return_requests enable row level security;

create policy "Admins can view all return requests" on store_return_requests
  for select using (is_admin());

create policy "Admins can update return requests" on store_return_requests
  for update using (is_admin());

-- No insert/delete policies for anon or authenticated: all inserts happen
-- via the request-return edge function using the service role key, which
-- bypasses RLS entirely — this table intentionally has no public-facing
-- write path of its own.
