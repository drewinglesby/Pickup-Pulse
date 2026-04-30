// supabase/functions/game-lifecycle/index.ts
// ============================================================
// GAME LIFECYCLE MANAGER
// ============================================================
// Run this on a schedule (every 60 seconds via Supabase cron)
// or invoke manually. Handles:
//   - upcoming → live (when game_start_time is reached)
//   - live → check (when window expires, sends "still going?" ping)
//   - check → ended (if no response within 5 minutes)
//   - check → live (if extended)
//   - cancelled cleanup
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface Game {
  id: string;
  creator_id: string;
  status: string;
  game_start_time: string;
  window_minutes: number;
  extended_minutes: number;
  still_going_sent_at: string | null;
  still_going_response: string | null;
  still_going_responded_at: string | null;
  manual_end: boolean;
  location_name: string;
  sport: string;
}

// ── Send a notification (writes to notifications table + triggers FCM separately) ──
async function createNotification(
  recipientId: string,
  senderId: string | null,
  type: string,
  referenceId: string,
  referenceType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
) {
  await supabase.from("notifications").insert({
    recipient_id: recipientId,
    sender_id: senderId,
    type,
    reference_id: referenceId,
    reference_type: referenceType,
    title,
    body,
    data,
  });
}

// ── PHASE: upcoming → live ──
async function transitionUpcomingToLive() {
  const now = new Date().toISOString();

  const { data: games, error } = await supabase
    .from("games")
    .select("id, creator_id, location_name, sport")
    .eq("status", "upcoming")
    .lte("game_start_time", now);

  if (error) {
    console.error("Error fetching upcoming games:", error);
    return;
  }

  for (const game of games || []) {
    const { error: updateError } = await supabase
      .from("games")
      .update({ status: "live" })
      .eq("id", game.id);

    if (!updateError) {
      console.log(`Game ${game.id} → LIVE`);

      // Notify creator
      await createNotification(
        game.creator_id,
        null,
        "game_starting_soon",
        game.id,
        "game",
        "Your game is live! 🟢",
        `${game.sport} at ${game.location_name} is now active on the feed.`
      );
    }
  }
}

// ── PHASE: live → check (window expired, send "still going?" ping) ──
async function transitionLiveToCheck() {
  const now = new Date();

  // Fetch all live games that haven't been sent a "still going?" yet
  const { data: games, error } = await supabase
    .from("games")
    .select("*")
    .eq("status", "live")
    .is("still_going_sent_at", null)
    .eq("manual_end", false);

  if (error) {
    console.error("Error fetching live games:", error);
    return;
  }

  for (const game of (games as Game[]) || []) {
    const startTime = new Date(game.game_start_time);
    const totalWindow = game.window_minutes + game.extended_minutes;
    const windowEnd = new Date(startTime.getTime() + totalWindow * 60000);

    if (now >= windowEnd) {
      // Window expired → transition to "check" and send ping
      const { error: updateError } = await supabase
        .from("games")
        .update({
          status: "check",
          still_going_sent_at: now.toISOString(),
        })
        .eq("id", game.id);

      if (!updateError) {
        console.log(`Game ${game.id} → CHECK (still going?)`);

        await createNotification(
          game.creator_id,
          null,
          "still_going_ping",
          game.id,
          "game",
          "⏰ Still going?",
          `Your ${game.sport} game at ${game.location_name} hit the ${totalWindow}-minute mark. Extend or end it?`,
          { action: "still_going_prompt" }
        );
      }
    }
  }

  // Also handle games that WERE extended and have now hit the extended window
  const { data: extendedGames, error: extError } = await supabase
    .from("games")
    .select("*")
    .eq("status", "live")
    .eq("still_going_response", "yes")
    .eq("manual_end", false);

  if (extError) {
    console.error("Error fetching extended games:", extError);
    return;
  }

  for (const game of (extendedGames as Game[]) || []) {
    const startTime = new Date(game.game_start_time);
    const totalWindow = game.window_minutes + game.extended_minutes;
    const windowEnd = new Date(startTime.getTime() + totalWindow * 60000);

    if (now >= windowEnd) {
      // Extended window also expired → auto-end
      const { error: updateError } = await supabase
        .from("games")
        .update({
          status: "ended",
          ended_at: now.toISOString(),
        })
        .eq("id", game.id);

      if (!updateError) {
        console.log(`Game ${game.id} → ENDED (extended window expired)`);
      }
    }
  }
}

// ── PHASE: check → ended (no response within 5 minutes) ──
async function autoCloseUnresponsive() {
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);

  const { data: games, error } = await supabase
    .from("games")
    .select("id")
    .eq("status", "check")
    .is("still_going_response", null)
    .lte("still_going_sent_at", fiveMinutesAgo.toISOString());

  if (error) {
    console.error("Error fetching unresponsive games:", error);
    return;
  }

  for (const game of games || []) {
    const { error: updateError } = await supabase
      .from("games")
      .update({
        status: "ended",
        still_going_response: "no",
        ended_at: now.toISOString(),
      })
      .eq("id", game.id);

    if (!updateError) {
      console.log(`Game ${game.id} → ENDED (no response to still-going ping)`);
    }
  }
}

// ── PHASE: handle manual ends ──
async function processManualEnds() {
  const now = new Date().toISOString();

  const { data: games, error } = await supabase
    .from("games")
    .select("id")
    .eq("manual_end", true)
    .neq("status", "ended");

  if (error) {
    console.error("Error fetching manual end games:", error);
    return;
  }

  for (const game of games || []) {
    await supabase
      .from("games")
      .update({ status: "ended", ended_at: now })
      .eq("id", game.id);

    console.log(`Game ${game.id} → ENDED (manual)`);
  }
}

// ── Clean up very old ended games (optional: archive after 7 days) ──
async function cleanupOldGames() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();

  // We don't delete — just log. In production you might archive to a separate table.
  const { count } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("status", "ended")
    .lte("ended_at", sevenDaysAgo);

  if (count && count > 0) {
    console.log(`${count} ended games older than 7 days could be archived.`);
  }
}

// ── MAIN HANDLER ──
serve(async (req: Request) => {
  try {
    console.log("=== Game Lifecycle Run ===", new Date().toISOString());

    await processManualEnds();
    await transitionUpcomingToLive();
    await transitionLiveToCheck();
    await autoCloseUnresponsive();
    await cleanupOldGames();

    return new Response(JSON.stringify({ success: true, timestamp: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("Lifecycle error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
