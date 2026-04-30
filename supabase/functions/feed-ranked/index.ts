// supabase/functions/feed-ranked/index.ts
// ============================================================
// FEED RANKING ALGORITHM
// ============================================================
// Returns a ranked feed of active games for a specific user.
// Factors: proximity, check-in count, verified status,
// friend involvement, sport preference match, recency.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ── Haversine distance in kilometers ──
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => d * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Scoring weights ──
const WEIGHTS = {
  PROXIMITY:       30,  // max points from being close
  CHECKINS:        20,  // max points from check-in count
  VERIFIED:        15,  // bonus for verified games
  FRIEND_INVOLVED: 15,  // bonus if a friend is RSVP'd or created it
  SPORT_MATCH:     10,  // bonus if matches user's preferred sports
  RECENCY:         10,  // bonus for recently posted
  PHASE_BOOST:      0,  // live games get sorted first regardless
};

const MAX_FEED_DISTANCE_KM = 25;

interface RankedGame {
  id: string;
  score: number;
  distance_km: number;
  phase: string;
  [key: string]: unknown;
}

serve(async (req: Request) => {
  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth token" }), { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    // ── Parse query params ──
    const url = new URL(req.url);
    const userLat = parseFloat(url.searchParams.get("lat") || "0");
    const userLng = parseFloat(url.searchParams.get("lng") || "0");
    const sportFilter = url.searchParams.get("sport") || "All";
    const limit = parseInt(url.searchParams.get("limit") || "50");

    if (!userLat || !userLng) {
      return new Response(JSON.stringify({ error: "lat and lng required" }), { status: 400 });
    }

    // ── Fetch user profile (for preferences) ──
    const { data: userProfile } = await supabase
      .from("users")
      .select("preferred_sports")
      .eq("id", user.id)
      .single();

    const preferredSports: string[] = userProfile?.preferred_sports || [];

    // ── Fetch user's friends ──
    const { data: friendships } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq("status", "accepted");

    const friendIds = new Set<string>();
    for (const f of friendships || []) {
      if (f.requester_id === user.id) friendIds.add(f.addressee_id);
      else friendIds.add(f.requester_id);
    }

    // ── Fetch active games ──
    let query = supabase
      .from("games")
      .select("*, rsvps(user_id)")
      .in("status", ["upcoming", "live", "check"]);

    if (sportFilter !== "All") {
      query = query.eq("sport", sportFilter);
    }

    const { data: games, error: gamesError } = await query;
    if (gamesError) throw gamesError;

    // ── Score each game ──
    const now = Date.now();
    const scored: RankedGame[] = [];

    for (const game of games || []) {
      const distance = haversineKm(userLat, userLng, game.location_lat, game.location_lng);

      // Skip games beyond max distance
      if (distance > MAX_FEED_DISTANCE_KM) continue;

      let score = 0;

      // 1. PROXIMITY (closer = higher score, inverse linear)
      const proximityScore = Math.max(0, 1 - (distance / MAX_FEED_DISTANCE_KM));
      score += proximityScore * WEIGHTS.PROXIMITY;

      // 2. CHECK-IN COUNT (logarithmic scaling, caps at ~10 check-ins)
      const checkinScore = Math.min(1, Math.log10(game.checkin_count + 1) / Math.log10(11));
      score += checkinScore * WEIGHTS.CHECKINS;

      // 3. VERIFIED BONUS
      if (game.is_verified) {
        score += WEIGHTS.VERIFIED;
      }

      // 4. FRIEND INVOLVEMENT
      const rsvpUserIds = (game.rsvps || []).map((r: { user_id: string }) => r.user_id);
      const friendInvolved = friendIds.has(game.creator_id) || rsvpUserIds.some((id: string) => friendIds.has(id));
      if (friendInvolved) {
        score += WEIGHTS.FRIEND_INVOLVED;
      }

      // 5. SPORT PREFERENCE MATCH
      if (preferredSports.includes(game.sport)) {
        score += WEIGHTS.SPORT_MATCH;
      }

      // 6. RECENCY (posted in last 30 min gets full points, decays over 4 hours)
      const ageMinutes = (now - new Date(game.created_at).getTime()) / 60000;
      const recencyScore = Math.max(0, 1 - (ageMinutes / 240));
      score += recencyScore * WEIGHTS.RECENCY;

      // Determine phase for client-side sorting
      let phase = game.status;
      if (game.status === "upcoming" && new Date(game.game_start_time).getTime() <= now) {
        phase = "live"; // server might not have caught up yet
      }

      scored.push({
        ...game,
        score: Math.round(score * 10) / 10,
        distance_km: Math.round(distance * 10) / 10,
        phase,
        friend_involved: friendInvolved,
        rsvps: undefined, // don't leak full RSVP list
        rsvp_count: rsvpUserIds.length,
      });
    }

    // ── Sort: live/check first, then by score descending ──
    scored.sort((a, b) => {
      const phaseOrder: Record<string, number> = { live: 0, check: 1, upcoming: 2 };
      const pa = phaseOrder[a.phase] ?? 3;
      const pb = phaseOrder[b.phase] ?? 3;
      if (pa !== pb) return pa - pb;
      return b.score - a.score;
    });

    // ── Limit results ──
    const feed = scored.slice(0, limit);

    return new Response(JSON.stringify({
      feed,
      total: feed.length,
      max_distance_km: MAX_FEED_DISTANCE_KM,
      filters: { sport: sportFilter },
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err) {
    console.error("Feed ranking error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
