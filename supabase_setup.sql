-- MapMate: Tactical Tracker - Clean Architecture v9.6.1
-- Requirement: PostGIS extension must be enabled (CREATE EXTENSION IF NOT EXISTS postgis;)

DROP TABLE IF EXISTS locations CASCADE;
DROP TABLE IF EXISTS messages CASCADE;

-- 1. Locations Table (Discrete Operator Tracking)
CREATE TABLE locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    device_type TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    color TEXT,
    location GEOGRAPHY(POINT, 4326),
    -- Tactical Zone Parameters (Focus Point & Radius)
    f_lat DOUBLE PRECISION,
    f_lng DOUBLE PRECISION,
    f_rad DOUBLE PRECISION,
    fence_location GEOGRAPHY(POINT, 4326),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger to keep Geography point in sync with Lat/Lng for PostGIS distance queries
CREATE OR REPLACE FUNCTION sync_geography_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
        NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
    END IF;
    IF NEW.f_lat IS NOT NULL AND NEW.f_lng IS NOT NULL THEN
        NEW.fence_location := ST_SetSRID(ST_MakePoint(NEW.f_lng, NEW.f_lat), 4326)::geography;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_location
BEFORE INSERT OR UPDATE ON locations
FOR EACH ROW EXECUTE FUNCTION sync_geography_location();

-- 2. Message Ledger (Secure Comms)
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tactical RPC: Get users specifically inside a requester's active zone
DROP FUNCTION IF EXISTS get_users_in_zone(text);
CREATE OR REPLACE FUNCTION get_users_in_zone(req_user_id TEXT)
RETURNS TABLE (
    id TEXT, 
    name TEXT, 
    device_type TEXT, 
    lat DOUBLE PRECISION, 
    lng DOUBLE PRECISION, 
    color TEXT,
    age_secs DOUBLE PRECISION,
    distance_m DOUBLE PRECISION
) AS $$
DECLARE
    f_loc GEOGRAPHY(POINT, 4326);
    f_rad DOUBLE PRECISION;
BEGIN
    -- 1. Identify the requester's active zone parameters
    SELECT fence_location, f_rad INTO f_loc, f_rad 
    FROM locations WHERE locations.id = req_user_id;

    -- 2. Return empty if the requester is not in Tactical Zoom
    IF f_loc IS NULL OR f_rad IS NULL THEN
        RETURN;
    END IF;

    -- 3. Discover all active allies within the tactical radius
    RETURN QUERY
    SELECT 
        l.id, l.name, l.device_type,
        l.lat, l.lng, l.color,
        EXTRACT(EPOCH FROM (NOW() - l.last_seen)) as age_secs,
        ST_Distance(l.location, f_loc) as distance_m
    FROM locations l
    WHERE l.id != req_user_id
    AND ST_DWithin(l.location, f_loc, f_rad)
    AND l.last_seen > NOW() - INTERVAL '5 minutes'
    ORDER BY distance_m ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
