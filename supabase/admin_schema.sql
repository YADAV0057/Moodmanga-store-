-- MoodManga Store — Admin auth schema
-- Run this AFTER schema.sql. Adds an admin allowlist and RLS policies so
-- only signed-in admin users can manage products/orders from the admin panel.

-- ---------------------------------------------------------------
-- 1. Admin allowlist
-- ---------------------------------------------------------------
-- Supabase Auth (auth.users) handles login/passwords. This table just marks
-- WHICH auth users are allowed to act as store admins. A person can only
-- become an admin by you manually inserting a row here — there is no public
-- "become an admin" signup flow.
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);

alter table admin_users enable row level security;

-- Admins can see the list of admins (handy for a "team" screen later),
-- but cannot grant themselves admin — that only happens via the SQL editor
-- or a service-role script, never from client code.
create policy "Admins can view admin list" on admin_users
  for select using (
    exists (select 1 from admin_users a where a.user_id = auth.uid())
  );

-- ---------------------------------------------------------------
-- 2. Helper used by every admin-facing policy below
-- ---------------------------------------------------------------
create or replace function is_admin()
returns boolean as $$
  select exists (select 1 from admin_users where user_id = auth.uid());
$$ language sql stable security definer;

-- ---------------------------------------------------------------
-- 3. store_products — allow admins full read/write
-- ---------------------------------------------------------------
-- (Public "can read active products" policy from schema.sql still applies
-- for the storefront; this adds admin-only access on top of it.)
create policy "Admins can view all products" on store_products
  for select using (is_admin());

create policy "Admins can insert products" on store_products
  for insert with check (is_admin());

create policy "Admins can update products" on store_products
  for update using (is_admin());

create policy "Admins can delete products" on store_products
  for delete using (is_admin());

-- ---------------------------------------------------------------
-- 4. store_orders / store_order_items — admins can read & update
-- ---------------------------------------------------------------
-- Order creation still only happens via the create-order edge function
-- (service role). Admins can view every order and update its status/tracking,
-- but cannot insert new orders directly from the admin panel.
create policy "Admins can view all orders" on store_orders
  for select using (is_admin());

create policy "Admins can update orders" on store_orders
  for update using (is_admin());

create policy "Admins can view all order items" on store_order_items
  for select using (is_admin());

-- ---------------------------------------------------------------
-- 5. Order status/tracking fields used by the admin panel
-- ---------------------------------------------------------------
alter table store_orders add column if not exists tracking_number text;
alter table store_orders add column if not exists tracking_carrier text;
alter table store_orders add column if not exists admin_notes text;

