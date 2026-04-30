-- ============================================================
-- PICKUP PULSE — Full PostgreSQL Schema for Supabase
-- ============================================================
-- Paste this entire file into Supabase SQL Editor and run it.
-- Enables Row Level Security on all tables.
-- ============================================================

-- 0. Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";  -- for geo queries (optional but recommended)

-- ============================================================
-- 1. USERS
-- ============================================================
-- Extends Supabase's built-in auth.users with app-specific data.
-- The id column references auth.users(id) so login is handled by Supabase Auth.

CREATE TABLE public.users (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username        TEXT UNIQUE NOT NULL CHECK (char_length(username) BETWEEN 2 AND 30),
    display_name    TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
    avatar_url      TEXT,
    bio             TEXT CHECK (char_length(bio) <= 200),

    -- Location & preferences
    home_lat        DOUBLE PRECISION,
    home_lng        DOUBLE PRECISION,
    preferred_sports TEXT[] DEFAULT '{}',           -- e.g. {'Basketball','Soccer'}
    notification_prefs JSONB DEFAULT '{
        "nearby_games": true,
        "friend_activity": true,
        "still_going_pings": true,
        "distance_radius_km": 8,
        "dnd_start": null,
        "dnd_end": null
    }'::jsonb,

    -- Trust & reputation
    trust_score     INTEGER DEFAULT 0 CHECK (trust_score >= 0),
    total_checkins  INTEGER DEFAULT 0 CHECK (total_checkins >= 0),
    total_games_posted INTEGER DEFAULT 0 CHECK (total_games_posted >= 0),
    total_rsvps     INTEGER DEFAULT 0 CHECK (total_rsvps >= 0),

    -- FCM push token
    fcm_token       TEXT,
    platform        TEXT CHECK (platform IN ('ios', 'android', 'web')),

    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    last_active_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_location ON public.users (home_lat, home_lng);
CREATE INDEX idx_users_preferred_sports ON public.users USING GIN (preferred_sports);
CREATE INDEX idx_users_last_active ON public.users (last_active_at DESC);

-- ============================================================
-- 2. LOCATIONS (Park / Court / Gym directory)
-- ============================================================

CREATE TABLE public.locations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    address         TEXT,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    sport_types     TEXT[] DEFAULT '{}',            -- sports available here
    amenities       TEXT[] DEFAULT '{}',            -- e.g. {'lights','indoor','water'}
    surface_type    TEXT,                           -- e.g. 'hardwood','grass','turf','sand'
    is_indoor       BOOLEAN DEFAULT false,
    hours_info      TEXT,                           -- freeform hours description
    photo_url       TEXT,
    submitted_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
    verified        BOOLEAN DEFAULT false,          -- admin-verified location
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_locations_coords ON public.locations (lat, lng);
CREATE INDEX idx_locations_sports ON public.locations USING GIN (sport_types);

-- ============================================================
-- 3. GAMES (the core feed posts)
-- ============================================================

CREATE TYPE game_status AS ENUM ('upcoming', 'live', 'check', 'ended', 'cancelled');

CREATE TABLE public.games (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    location_id     UUID REFERENCES public.locations(id) ON DELETE SET NULL,

    -- Game details
    sport           TEXT NOT NULL,
    location_name   TEXT NOT NULL,                  -- denormalized for fast reads
    location_lat    DOUBLE PRECISION NOT NULL,
    location_lng    DOUBLE PRECISION NOT NULL,
    skill_level     TEXT NOT NULL DEFAULT 'Any' CHECK (skill_level IN ('Any','Casual','Intermediate','Competitive')),
    note            TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 300),

    -- Player counts
    spots_needed    INTEGER NOT NULL DEFAULT 0 CHECK (spots_needed >= 0),
    total_players   INTEGER NOT NULL DEFAULT 1 CHECK (total_players >= 1),
    current_rsvps   INTEGER NOT NULL DEFAULT 0 CHECK (current_rsvps >= 0),

    -- Timing system
    game_start_time TIMESTAMPTZ NOT NULL,
    window_minutes  INTEGER NOT NULL DEFAULT 120 CHECK (window_minutes > 0),
    extended_minutes INTEGER NOT NULL DEFAULT 0 CHECK (extended_minutes >= 0),
    extend_reason   TEXT,
    still_going_sent_at   TIMESTAMPTZ,             -- when the "still going?" ping was sent
    still_going_response  TEXT CHECK (still_going_response IN ('yes', 'no', NULL)),
    still_going_responded_at TIMESTAMPTZ,

    -- Status & trust
    status          game_status NOT NULL DEFAULT 'upcoming',
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    checkin_count   INTEGER NOT NULL DEFAULT 0 CHECK (checkin_count >= 0),
    manual_end      BOOLEAN NOT NULL DEFAULT false,

    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    ended_at        TIMESTAMPTZ
);

CREATE INDEX idx_games_status ON public.games (status) WHERE status != 'ended';
CREATE INDEX idx_games_sport ON public.games (sport);
CREATE INDEX idx_games_creator ON public.games (creator_id);
CREATE INDEX idx_games_start_time ON public.games (game_start_time);
CREATE INDEX idx_games_location_coords ON public.games (location_lat, location_lng);
CREATE INDEX idx_games_created_at ON public.games (created_at DESC);

-- Constraint: one active game per user at a time
CREATE UNIQUE INDEX idx_one_active_game_per_user
    ON public.games (creator_id)
    WHERE status IN ('upcoming', 'live', 'check');

-- ============================================================
-- 4. CHECK-INS (GPS verifications)
-- ============================================================

CREATE TABLE public.checkins (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    game_id         UUID REFERENCES public.games(id) ON DELETE CASCADE,
    location_id     UUID REFERENCES public.locations(id) ON DELETE SET NULL,

    -- GPS data
    user_lat        DOUBLE PRECISION NOT NULL,
    user_lng        DOUBLE PRECISION NOT NULL,
    location_lat    DOUBLE PRECISION NOT NULL,
    location_lng    DOUBLE PRECISION NOT NULL,
    distance_meters DOUBLE PRECISION NOT NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT false,  -- within 150m threshold

    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_checkins_user ON public.checkins (user_id);
CREATE INDEX idx_checkins_game ON public.checkins (game_id);
CREATE INDEX idx_checkins_location ON public.checkins (location_id);
CREATE INDEX idx_checkins_created ON public.checkins (created_at DESC);

-- Prevent duplicate check-ins: one per user per game
CREATE UNIQUE INDEX idx_one_checkin_per_user_per_game
    ON public.checkins (user_id, game_id);

-- ============================================================
-- 5. FRIENDSHIPS
-- ============================================================

CREATE TYPE friendship_status AS ENUM ('pending', 'accepted', 'blocked');

CREATE TABLE public.friendships (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    addressee_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status          friendship_status NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,

    -- Prevent duplicate friendships and self-friending
    CONSTRAINT no_self_friendship CHECK (requester_id != addressee_id),
    CONSTRAINT unique_friendship UNIQUE (
        LEAST(requester_id, addressee_id),
        GREATEST(requester_id, addressee_id)
    )
);

CREATE INDEX idx_friendships_requester ON public.friendships (requester_id);
CREATE INDEX idx_friendships_addressee ON public.friendships (addressee_id);
CREATE INDEX idx_friendships_status ON public.friendships (status);

-- ============================================================
-- 6. RSVPs ("I'm In" / "I'm Down")
-- ============================================================

CREATE TYPE rsvp_status AS ENUM ('confirmed', 'cancelled', 'waitlisted');

CREATE TABLE public.rsvps (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    game_id         UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    status          rsvp_status NOT NULL DEFAULT 'confirmed',
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,

    -- One RSVP per user per game
    CONSTRAINT unique_rsvp UNIQUE (user_id, game_id)
);

CREATE INDEX idx_rsvps_game ON public.rsvps (game_id);
CREATE INDEX idx_rsvps_user ON public.rsvps (user_id);
CREATE INDEX idx_rsvps_status ON public.rsvps (status) WHERE status = 'confirmed';

-- ============================================================
-- 7. NOTIFICATIONS
-- ============================================================

CREATE TYPE notification_type AS ENUM (
    'nearby_game',
    'friend_invite',
    'friend_request',
    'friend_accepted',
    'still_going_ping',
    'rsvp_update',
    'game_starting_soon',
    'game_verified',
    'game_full',
    'game_ended'
);

CREATE TABLE public.notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    sender_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    type            notification_type NOT NULL,
    reference_id    UUID,                           -- game_id, friendship_id, etc.
    reference_type  TEXT,                           -- 'game', 'friendship', 'rsvp'
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    data            JSONB DEFAULT '{}'::jsonb,       -- extra payload for the client
    is_read         BOOLEAN NOT NULL DEFAULT false,
    is_pushed       BOOLEAN NOT NULL DEFAULT false,  -- was FCM push sent?
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_notifications_recipient ON public.notifications (recipient_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_created ON public.notifications (created_at DESC);

-- ============================================================
-- 8. REPORTS (abuse prevention)
-- ============================================================

CREATE TYPE report_status AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');
CREATE TYPE report_reason AS ENUM (
    'fake_game',
    'spam',
    'harassment',
    'inappropriate_content',
    'fake_checkin',
    'wrong_location',
    'other'
);

CREATE TABLE public.reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    reported_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reported_game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
    reason          report_reason NOT NULL,
    description     TEXT CHECK (char_length(description) <= 500),
    status          report_status NOT NULL DEFAULT 'pending',
    resolved_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,

    -- Must report either a user or a game
    CONSTRAINT report_has_target CHECK (
        reported_user_id IS NOT NULL OR reported_game_id IS NOT NULL
    )
);

CREATE INDEX idx_reports_status ON public.reports (status) WHERE status = 'pending';
CREATE INDEX idx_reports_reporter ON public.reports (reporter_id);

-- ============================================================
-- 9. CHECKIN HISTORY (for prediction engine)
-- ============================================================
-- Aggregated hourly activity per location for trend analysis.
-- Populated by a scheduled function that rolls up checkin data.

CREATE TABLE public.activity_stats (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id     UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    sport           TEXT NOT NULL,
    day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday
    hour_of_day     INTEGER NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
    avg_checkins    DOUBLE PRECISION DEFAULT 0,
    avg_players     DOUBLE PRECISION DEFAULT 0,
    total_games     INTEGER DEFAULT 0,
    sample_weeks    INTEGER DEFAULT 0,              -- how many weeks of data
    confidence      DOUBLE PRECISION DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
    updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,

    CONSTRAINT unique_stat_slot UNIQUE (location_id, sport, day_of_week, hour_of_day)
);

CREATE INDEX idx_activity_stats_location ON public.activity_stats (location_id);
CREATE INDEX idx_activity_stats_sport ON public.activity_stats (sport);

-- ============================================================
-- 10. TRIGGERS & FUNCTIONS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_games_updated_at
    BEFORE UPDATE ON public.games
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_friendships_updated_at
    BEFORE UPDATE ON public.friendships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_rsvps_updated_at
    BEFORE UPDATE ON public.rsvps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Increment user stats on game creation
CREATE OR REPLACE FUNCTION increment_user_game_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.users
    SET total_games_posted = total_games_posted + 1
    WHERE id = NEW.creator_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_increment_game_count
    AFTER INSERT ON public.games
    FOR EACH ROW EXECUTE FUNCTION increment_user_game_count();

-- Update game checkin_count and is_verified on new checkin
CREATE OR REPLACE FUNCTION on_checkin_created()
RETURNS TRIGGER AS $$
DECLARE
    unique_verified_count INTEGER;
BEGIN
    -- Only process verified check-ins
    IF NEW.is_verified = true AND NEW.game_id IS NOT NULL THEN
        -- Count unique verified check-ins for this game
        SELECT COUNT(DISTINCT user_id) INTO unique_verified_count
        FROM public.checkins
        WHERE game_id = NEW.game_id AND is_verified = true;

        -- Update game
        UPDATE public.games
        SET checkin_count = unique_verified_count,
            is_verified = CASE WHEN unique_verified_count >= 3 THEN true ELSE is_verified END
        WHERE id = NEW.game_id;

        -- Update user trust score
        UPDATE public.users
        SET total_checkins = total_checkins + 1,
            trust_score = trust_score + 1
        WHERE id = NEW.user_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_on_checkin
    AFTER INSERT ON public.checkins
    FOR EACH ROW EXECUTE FUNCTION on_checkin_created();

-- Update spots on RSVP changes
CREATE OR REPLACE FUNCTION on_rsvp_change()
RETURNS TRIGGER AS $$
DECLARE
    confirmed_count INTEGER;
    game_record RECORD;
BEGIN
    -- Get the game_id from either NEW or OLD
    SELECT * INTO game_record FROM public.games
    WHERE id = COALESCE(NEW.game_id, OLD.game_id);

    IF game_record IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

    -- Count confirmed RSVPs
    SELECT COUNT(*) INTO confirmed_count
    FROM public.rsvps
    WHERE game_id = game_record.id AND status = 'confirmed';

    -- Update game's current_rsvps and spots_needed
    UPDATE public.games
    SET current_rsvps = confirmed_count,
        spots_needed = GREATEST(0, total_players - (SELECT total_players FROM public.games WHERE id = game_record.id) + spots_needed - confirmed_count)
    WHERE id = game_record.id;

    -- Update user stats
    IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
        UPDATE public.users SET total_rsvps = total_rsvps + 1 WHERE id = NEW.user_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rsvp_insert
    AFTER INSERT ON public.rsvps
    FOR EACH ROW EXECUTE FUNCTION on_rsvp_change();

CREATE TRIGGER trg_rsvp_update
    AFTER UPDATE ON public.rsvps
    FOR EACH ROW EXECUTE FUNCTION on_rsvp_change();

CREATE TRIGGER trg_rsvp_delete
    AFTER DELETE ON public.rsvps
    FOR EACH ROW EXECUTE FUNCTION on_rsvp_change();

-- ============================================================
-- 11. ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_stats ENABLE ROW LEVEL SECURITY;

-- Users: read all, update own
CREATE POLICY users_select ON public.users FOR SELECT USING (true);
CREATE POLICY users_insert ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY users_update ON public.users FOR UPDATE USING (auth.uid() = id);

-- Locations: read all, insert authenticated
CREATE POLICY locations_select ON public.locations FOR SELECT USING (true);
CREATE POLICY locations_insert ON public.locations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Games: read all active, insert/update own
CREATE POLICY games_select ON public.games FOR SELECT USING (true);
CREATE POLICY games_insert ON public.games FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY games_update ON public.games FOR UPDATE USING (auth.uid() = creator_id);

-- Check-ins: read all, insert own
CREATE POLICY checkins_select ON public.checkins FOR SELECT USING (true);
CREATE POLICY checkins_insert ON public.checkins FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Friendships: read own, insert own, update if involved
CREATE POLICY friendships_select ON public.friendships FOR SELECT
    USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE POLICY friendships_insert ON public.friendships FOR INSERT
    WITH CHECK (auth.uid() = requester_id);
CREATE POLICY friendships_update ON public.friendships FOR UPDATE
    USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- RSVPs: read game RSVPs, insert/update own
CREATE POLICY rsvps_select ON public.rsvps FOR SELECT USING (true);
CREATE POLICY rsvps_insert ON public.rsvps FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY rsvps_update ON public.rsvps FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY rsvps_delete ON public.rsvps FOR DELETE USING (auth.uid() = user_id);

-- Notifications: read own only
CREATE POLICY notifications_select ON public.notifications FOR SELECT
    USING (auth.uid() = recipient_id);
CREATE POLICY notifications_update ON public.notifications FOR UPDATE
    USING (auth.uid() = recipient_id);

-- Reports: insert own, read own
CREATE POLICY reports_insert ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY reports_select ON public.reports FOR SELECT USING (auth.uid() = reporter_id);

-- Activity stats: read all
CREATE POLICY activity_stats_select ON public.activity_stats FOR SELECT USING (true);

-- ============================================================
-- 12. REALTIME SUBSCRIPTIONS
-- ============================================================
-- Enable realtime on the tables clients need to watch live.

ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rsvps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.checkins;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ============================================================
-- 13. SEED DATA — Corvallis Locations
-- ============================================================

INSERT INTO public.locations (name, address, lat, lng, sport_types, amenities, surface_type, is_indoor, verified) VALUES
    ('Highland Park Courts', 'Highland Dr, Corvallis, OR', 44.5705, -123.2680, '{"Basketball"}', '{"outdoor","lights"}', 'asphalt', false, true),
    ('Dixon Rec Center', '420 SW 26th St, Corvallis, OR', 44.5633, -123.2794, '{"Basketball","Volleyball"}', '{"indoor","water","locker_rooms"}', 'hardwood', true, true),
    ('OSU Intramural Fields', 'SW Western Blvd, Corvallis, OR', 44.5590, -123.2810, '{"Football","Soccer","Softball"}', '{"outdoor","lights","parking"}', 'grass', false, true),
    ('McAlexander Fieldhouse', 'SW 26th St, Corvallis, OR', 44.5612, -123.2756, '{"Basketball","Volleyball"}', '{"indoor"}', 'hardwood', true, true),
    ('Sunset Park', 'NW Sunset Dr, Corvallis, OR', 44.5820, -123.2590, '{"Basketball"}', '{"outdoor","lights"}', 'asphalt', false, true),
    ('Riverfront Fields', 'NW 1st St, Corvallis, OR', 44.5672, -123.2615, '{"Soccer","Football"}', '{"outdoor","parking"}', 'grass', false, true),
    ('Willamette Park', 'SE Goodnight Ave, Corvallis, OR', 44.5540, -123.2640, '{"Volleyball","Tennis"}', '{"outdoor","sand_courts"}', 'sand', false, true),
    ('Pioneer Park', 'NE Baker St, Corvallis, OR', 44.5660, -123.2520, '{"Tennis","Basketball"}', '{"outdoor","lights"}', 'asphalt', false, true);

-- ============================================================
-- DONE. Your database is ready.
-- ============================================================
