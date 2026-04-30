// supabase/functions/prediction-engine/index.ts
// ============================================================
// PREDICTION ENGINE
// ============================================================
// Run on a daily schedule (e.g., 3 AM).
// Analyzes check-in and game data from the last 4 weeks
// to generate "usually busy" predictions per location/day/hour.
// Writes results to the activity_stats table.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const LOOKBACK_WEEKS = 4;
const MIN_DATA_POINTS = 2; // need at least 2 occurrences to show a prediction

interface ActivityBucket {
  location_id: string;
  sport: string;
  day_of_week: number;
  hour_of_day: number;
  checkin_counts: number[];  // one per week
  player_counts: number[];
  game_counts: number[];
}

serve(async (req: Request) => {
  try {
    console.log("=== Prediction Engine Run ===", new Date().toISOString());

    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - LOOKBACK_WEEKS * 7 * 24 * 3600000);

    // ── Fetch all verified check-ins from the last 4 weeks ──
    const { data: checkins, error: checkinError } = await supabase
      .from("checkins")
      .select("location_id, is_verified, created_at")
      .eq("is_verified", true)
      .gte("created_at", fourWeeksAgo.toISOString());

    if (checkinError) throw checkinError;

    // ── Fetch all games from the last 4 weeks ──
    const { data: games, error: gameError } = await supabase
      .from("games")
      .select("location_id, sport, game_start_time, total_players, checkin_count")
      .gte("game_start_time", fourWeeksAgo.toISOString())
      .in("status", ["live", "ended"]);

    if (gameError) throw gameError;

    // ── Build activity buckets ──
    // Key: "locationId:sport:dayOfWeek:hourOfDay"
    const buckets = new Map<string, ActivityBucket>();

    function getOrCreateBucket(
      locationId: string, sport: string, dayOfWeek: number, hourOfDay: number
    ): ActivityBucket {
      const key = `${locationId}:${sport}:${dayOfWeek}:${hourOfDay}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          location_id: locationId,
          sport,
          day_of_week: dayOfWeek,
          hour_of_day: hourOfDay,
          checkin_counts: [],
          player_counts: [],
          game_counts: [],
        });
      }
      return buckets.get(key)!;
    }

    // Helper: figure out which "week index" a date falls into (0-3)
    function weekIndex(dateStr: string): number {
      const d = new Date(dateStr);
      const diff = now.getTime() - d.getTime();
      return Math.min(LOOKBACK_WEEKS - 1, Math.floor(diff / (7 * 24 * 3600000)));
    }

    // ── Process games into buckets ──
    for (const game of games || []) {
      if (!game.location_id) continue;

      const startDate = new Date(game.game_start_time);
      const dayOfWeek = startDate.getDay();
      const hourOfDay = startDate.getHours();
      const wi = weekIndex(game.game_start_time);

      const bucket = getOrCreateBucket(game.location_id, game.sport, dayOfWeek, hourOfDay);

      // Ensure arrays are long enough
      while (bucket.game_counts.length <= wi) bucket.game_counts.push(0);
      while (bucket.player_counts.length <= wi) bucket.player_counts.push(0);
      while (bucket.checkin_counts.length <= wi) bucket.checkin_counts.push(0);

      bucket.game_counts[wi]++;
      bucket.player_counts[wi] += game.total_players;
      bucket.checkin_counts[wi] += game.checkin_count;
    }

    // ── Also count raw check-ins (some may not be tied to games) ──
    for (const checkin of checkins || []) {
      if (!checkin.location_id) continue;

      const d = new Date(checkin.created_at);
      const dayOfWeek = d.getDay();
      const hourOfDay = d.getHours();
      // We don't know the sport from a raw check-in, so we skip sport-specific bucketing
      // The game-based analysis above handles sport-level granularity
    }

    // ── Calculate averages and confidence ──
    const upserts = [];

    for (const bucket of buckets.values()) {
      const weeksWithData = bucket.game_counts.filter(c => c > 0).length;

      // Skip if not enough data points
      if (weeksWithData < MIN_DATA_POINTS) continue;

      const avgCheckins = bucket.checkin_counts.reduce((a, b) => a + b, 0) / LOOKBACK_WEEKS;
      const avgPlayers = bucket.player_counts.reduce((a, b) => a + b, 0) / LOOKBACK_WEEKS;
      const totalGames = bucket.game_counts.reduce((a, b) => a + b, 0);

      // Confidence formula:
      // Base: how many weeks had data (0-100 scaled from min_data_points to lookback_weeks)
      // Boost: more check-ins = more confident
      // Cap at 95 (never fully certain)
      const dataCompleteness = Math.min(1, weeksWithData / LOOKBACK_WEEKS);
      const volumeBoost = Math.min(1, avgCheckins / 5); // 5+ avg check-ins = max volume confidence
      const confidence = Math.min(95, Math.round((dataCompleteness * 60 + volumeBoost * 35) + (totalGames > 4 ? 5 : 0)));

      upserts.push({
        location_id: bucket.location_id,
        sport: bucket.sport,
        day_of_week: bucket.day_of_week,
        hour_of_day: bucket.hour_of_day,
        avg_checkins: Math.round(avgCheckins * 10) / 10,
        avg_players: Math.round(avgPlayers * 10) / 10,
        total_games: totalGames,
        sample_weeks: weeksWithData,
        confidence,
        updated_at: now.toISOString(),
      });
    }

    // ── Upsert to activity_stats ──
    if (upserts.length > 0) {
      const { error: upsertError } = await supabase
        .from("activity_stats")
        .upsert(upserts, {
          onConflict: "location_id,sport,day_of_week,hour_of_day",
        });

      if (upsertError) throw upsertError;
    }

    console.log(`Processed ${buckets.size} buckets, upserted ${upserts.length} predictions.`);

    return new Response(JSON.stringify({
      success: true,
      buckets_processed: buckets.size,
      predictions_written: upserts.length,
      lookback_weeks: LOOKBACK_WEEKS,
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err) {
    console.error("Prediction engine error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
