-- SQL Migration: Upgrading for Zone Intelligence
-- Add fence support to the locations table
ALTER TABLE locations 
ADD COLUMN IF NOT EXISTS fence_lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS fence_lng DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS fence_radius DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS device_type TEXT;

-- RPC: Get users specifically inside a requester's active zone
CREATE OR REPLACE FUNCTION get_users_in_zone(req_user_id TEXT)
RETURNS TABLE (id TEXT, name TEXT, device_type TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, distance_m DOUBLE PRECISION) AS $$
DECLARE
    f_lat DOUBLE PRECISION;
    f_lng DOUBLE PRECISION;
    f_rad DOUBLE PRECISION;
BEGIN
    -- 1. Grab the requester's fence data
    SELECT fence_lat, fence_lng, fence_radius INTO f_lat, f_lng, f_rad 
    FROM locations WHERE locations.id = req_user_id;

    -- 2. If no fence, return nothing
    IF f_lat IS NULL OR f_rad IS NULL THEN
        RETURN;
    END IF;

    -- 3. Find allies within that radius
    RETURN QUERY
    SELECT 
        l.id, l.name, l.device_type,
        ST_Y(l.location::geometry) as lat, 
        ST_X(l.location::geometry) as lng,
        ST_Distance(l.location, ST_SetSRID(ST_Point(f_lng, f_lat), 4326)::geography) as distance_m
    FROM locations l
    WHERE 
        l.id != req_user_id -- Don't include yourself
        AND ST_DWithin(l.location, ST_SetSRID(ST_Point(f_lng, f_lat), 4326)::geography, f_rad)
        AND l.last_seen > NOW() - INTERVAL '1 minute'; -- Only active users
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
