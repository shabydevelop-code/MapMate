-- MapMate Tactical Upgrade Path v9.6.1
-- Run this if you have an existing database from v3.x

-- 1. Add missing tactical columns
ALTER TABLE locations ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS f_lat DOUBLE PRECISION;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS f_lng DOUBLE PRECISION;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS f_rad DOUBLE PRECISION;

-- 2. Ensure PostGIS is active
CREATE EXTENSION IF NOT EXISTS postgis;

-- 3. Update the RPC function (refer to supabase_setup.sql for the full function body)
-- The function 'get_users_in_zone' should be updated to return the 'color' column.
