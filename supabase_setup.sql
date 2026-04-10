-- 1. Enable PostGIS extension for geospatial math
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Create the telemetry table
CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    device_type TEXT,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create a spatial index for lightning-fast proximity queries
CREATE INDEX IF NOT EXISTS locations_geo_idx ON locations USING GIST (location);

-- 4. Create the proximity discovery function
-- This will be called via supabase.rpc('get_nearby_users', { ... })
CREATE OR REPLACE FUNCTION get_nearby_users(
    user_lat FLOAT, 
    user_lng FLOAT, 
    radius_meters FLOAT, 
    requesting_user_id TEXT
)
RETURNS TABLE (
    id TEXT,
    name TEXT,
    lat FLOAT,
    lng FLOAT,
    last_seen TIMESTAMP WITH TIME ZONE
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.id,
        l.name,
        ST_Y(l.location::geometry) as lat,
        ST_X(l.location::geometry) as lng,
        l.last_seen
    FROM locations l
    WHERE 
        l.id != requesting_user_id -- Skip self
        -- Find users within X meters
        AND ST_DWithin(
            l.location, 
            ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, 
            radius_meters
        )
        -- Only show users active in the last 1 minute
        AND l.last_seen > NOW() - INTERVAL '1 minute'
    ORDER BY l.last_seen DESC;
END;
$$;
