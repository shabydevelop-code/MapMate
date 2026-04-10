-- MapMate: Tactical Tracker - Clean Architecture v3.6.1
-- Requirement: PostGIS extension must be enabled (CREATE EXTENSION IF NOT EXISTS postgis;)

-- 1. Locations Table (Discrete Operator Tracking)
CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    device_type TEXT,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    fence_location GEOGRAPHY(POINT, 4326),
    fence_radius DOUBLE PRECISION,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Message Ledger (Secure Comms)
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tactical RPC: Get users specifically inside a requester's active zone
DROP FUNCTION IF EXISTS get_users_in_zone(text);
CREATE OR REPLACE FUNCTION get_users_in_zone(req_user_id TEXT)
RETURNS TABLE (id TEXT, name TEXT, device_type TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, distance_m DOUBLE PRECISION) AS $$
DECLARE
    f_loc GEOGRAPHY(POINT, 4326);
    f_rad DOUBLE PRECISION;
BEGIN
    -- 1. Identify the requester's active zone parameters
    SELECT fence_location, fence_radius INTO f_loc, f_rad 
    FROM locations WHERE id = req_user_id;

    -- 2. Return empty if the requester is not in Tactical Zoom
    IF f_loc IS NULL OR f_rad IS NULL THEN
        RETURN;
    END IF;

    -- 3. Discover all active allies within the tactical radius
    RETURN QUERY
    SELECT 
        l.id, l.name, l.device_type,
        ST_Y(l.location::geometry) as lat, 
        ST_X(l.location::geometry) as lng,
        ST_Distance(l.location, f_loc) as distance_m
    FROM locations l
    WHERE l.id != req_user_id
    AND ST_DWithin(l.location, f_loc, f_rad)
    AND l.last_seen > NOW() - INTERVAL '1 minute'
    ORDER BY distance_m ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
