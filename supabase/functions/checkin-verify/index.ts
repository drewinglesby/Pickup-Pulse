// supabase/functions/checkin-verify/index.ts
// ============================================================
// GPS CHECK-IN VERIFICATION
// ============================================================
// Called when a user attempts to check in at a location.
// Server-side Haversine distance calculation with 150m threshold.
// Prevents spoofing by doing the math on the server, not the client.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const CHECKIN_RADIUS_METERS = 150;
const COOLDOWN_MINUTES = 10; // minimum time between check-ins at same location
const MAX_CHECKINS_PER_HOUR = 5; // rate limit

// ── Haversine formula: distance between two GPS coordinates in meters ──
function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg: number) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ── Detect impossible check-ins (teleportation) ──
async function detectImpossibleCheckin(
  userId: string,
  userLat: number,
  userLng: number
): Promise<{ suspicious: boolean; reason?: string }> {
  // Get user's most recent check-in
  const { data: lastCheckin } = await supabase
    .from("checkins")
    .select("user_lat, user_lng, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastCheckin) return { suspicious: false };

  const timeDiffMs = Date.now() - new Date(lastCheckin.created_at).getTime();
  const timeDiffMinutes = timeDiffMs / 60000;
  const distance = haversineDistance(
    lastCheckin.user_lat, lastCheckin.user_lng,
    userLat, userLng
  );

  // If they moved more than 5km in less than 2 minutes, that's suspicious
  // (even driving, 5km in 2 minutes = 150 km/h in a straight line)
  if (distance > 5000 && timeDiffMinutes < 2) {
    return {
      suspicious: true,
      reason: `Moved ${Math.round(distance)}m in ${Math.round(timeDiffMinutes)} minutes`
    };
  }

  return { suspicious: false };
}

// ── Rate limiting ──
async function checkRateLimit(userId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

  const { count } = await supabase
    .from("checkins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);

  return (count || 0) < MAX_CHECKINS_PER_HOUR;
}

// ── Cooldown check (prevent spamming same location) ──
async function checkCooldown(userId: string, locationId: string): Promise<boolean> {
  const cooldownTime = new Date(Date.now() - COOLDOWN_MINUTES * 60000).toISOString();

  const { data } = await supabase
    .from("checkins")
    .select("id")
    .eq("user_id", userId)
    .eq("location_id", locationId)
    .gte("created_at", cooldownTime)
    .limit(1);

  return !data || data.length === 0;
}

serve(async (req: Request) => {
  try {
    // ── Auth check ──
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

    // ── Parse request ──
    const body = await req.json();
    const {
      user_lat,
      user_lng,
      location_id,
      game_id,  // optional — check into a specific game
    } = body;

    if (!user_lat || !user_lng || !location_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: user_lat, user_lng, location_id" }), { status: 400 });
    }

    // ── Get location from database ──
    const { data: location, error: locError } = await supabase
      .from("locations")
      .select("id, name, lat, lng")
      .eq("id", location_id)
      .single();

    if (locError || !location) {
      return new Response(JSON.stringify({ error: "Location not found" }), { status: 404 });
    }

    // ── Rate limit check ──
    const withinRateLimit = await checkRateLimit(user.id);
    if (!withinRateLimit) {
      return new Response(JSON.stringify({
        error: "Rate limit exceeded",
        message: `Maximum ${MAX_CHECKINS_PER_HOUR} check-ins per hour.`
      }), { status: 429 });
    }

    // ── Cooldown check ──
    const passedCooldown = await checkCooldown(user.id, location_id);
    if (!passedCooldown) {
      return new Response(JSON.stringify({
        error: "Cooldown active",
        message: `Wait ${COOLDOWN_MINUTES} minutes between check-ins at the same location.`
      }), { status: 429 });
    }

    // ── Calculate distance ──
    const distance = haversineDistance(
      user_lat, user_lng,
      location.lat, location.lng
    );

    const isVerified = distance <= CHECKIN_RADIUS_METERS;

    // ── Impossible check-in detection ──
    const teleportCheck = await detectImpossibleCheckin(user.id, user_lat, user_lng);
    if (teleportCheck.suspicious) {
      console.warn(`Suspicious checkin by ${user.id}: ${teleportCheck.reason}`);

      // Still record it but flag as unverified
      await supabase.from("checkins").insert({
        user_id: user.id,
        game_id: game_id || null,
        location_id: location.id,
        user_lat,
        user_lng,
        location_lat: location.lat,
        location_lng: location.lng,
        distance_meters: Math.round(distance),
        is_verified: false,  // forced unverified due to suspicious activity
      });

      return new Response(JSON.stringify({
        success: false,
        verified: false,
        distance_meters: Math.round(distance),
        reason: "Location could not be verified. Please try again.",
      }), { status: 200 });
    }

    // ── Record check-in ──
    const { data: checkin, error: insertError } = await supabase
      .from("checkins")
      .insert({
        user_id: user.id,
        game_id: game_id || null,
        location_id: location.id,
        user_lat,
        user_lng,
        location_lat: location.lat,
        location_lng: location.lng,
        distance_meters: Math.round(distance),
        is_verified: isVerified,
      })
      .select()
      .single();

    if (insertError) {
      // Could be unique constraint violation (already checked in to this game)
      if (insertError.code === "23505") {
        return new Response(JSON.stringify({
          error: "Already checked in",
          message: "You've already checked in to this game."
        }), { status: 409 });
      }
      throw insertError;
    }

    // ── Build response ──
    const response: Record<string, unknown> = {
      success: true,
      verified: isVerified,
      distance_meters: Math.round(distance),
      threshold_meters: CHECKIN_RADIUS_METERS,
      checkin_id: checkin.id,
    };

    if (!isVerified) {
      response.message = `You're ${Math.round(distance)}m away. Need to be within ${CHECKIN_RADIUS_METERS}m.`;
    } else {
      response.message = `Checked in at ${location.name}! ✅`;
    }

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err) {
    console.error("Checkin error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
