// supabase/functions/still-going/index.ts
// ============================================================
// "STILL GOING?" RESPONSE HANDLER
// ============================================================
// Called when a game creator responds to the still-going prompt.
// Two actions: "extend" (with reason) or "end".
// Extension adds 60 minutes, requires a reason from preset list.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const EXTEND_MINUTES = 60;
const VALID_REASONS = [
  "Game's still competitive 🔥",
  "Waiting on next game",
  "New players just showed up",
  "Running it back",
];

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

    // ── Parse request ──
    const body = await req.json();
    const { game_id, action, reason } = body;

    if (!game_id || !action) {
      return new Response(JSON.stringify({ error: "Missing game_id or action" }), { status: 400 });
    }

    if (!["extend", "end"].includes(action)) {
      return new Response(JSON.stringify({ error: "Action must be 'extend' or 'end'" }), { status: 400 });
    }

    // ── Fetch game ──
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("*")
      .eq("id", game_id)
      .single();

    if (gameError || !game) {
      return new Response(JSON.stringify({ error: "Game not found" }), { status: 404 });
    }

    // ── Verify ownership ──
    if (game.creator_id !== user.id) {
      return new Response(JSON.stringify({ error: "Only the game creator can respond" }), { status: 403 });
    }

    // ── Verify game is in "check" status ──
    if (game.status !== "check") {
      return new Response(JSON.stringify({
        error: "Game is not awaiting a still-going response",
        current_status: game.status,
      }), { status: 400 });
    }

    // ── Check that the still-going ping was sent ──
    if (!game.still_going_sent_at) {
      return new Response(JSON.stringify({ error: "No still-going ping was sent for this game" }), { status: 400 });
    }

    // ── Check 5-minute response window ──
    const pingSentAt = new Date(game.still_going_sent_at);
    const now = new Date();
    const minutesSincePing = (now.getTime() - pingSentAt.getTime()) / 60000;

    if (minutesSincePing > 5) {
      // Too late — auto-end the game
      await supabase
        .from("games")
        .update({
          status: "ended",
          still_going_response: "no",
          still_going_responded_at: now.toISOString(),
          ended_at: now.toISOString(),
        })
        .eq("id", game_id);

      return new Response(JSON.stringify({
        success: false,
        message: "Response window expired (5 minutes). Game has been ended.",
      }), { status: 200 });
    }

    // ── EXTEND ──
    if (action === "extend") {
      if (!reason || !VALID_REASONS.includes(reason)) {
        return new Response(JSON.stringify({
          error: "Valid reason required to extend",
          valid_reasons: VALID_REASONS,
        }), { status: 400 });
      }

      // Check if already extended once (prevent infinite extensions)
      if (game.extended_minutes > 0) {
        return new Response(JSON.stringify({
          error: "Game has already been extended once. Maximum 1 extension per game.",
        }), { status: 400 });
      }

      const { error: updateError } = await supabase
        .from("games")
        .update({
          status: "live",
          still_going_response: "yes",
          still_going_responded_at: now.toISOString(),
          extended_minutes: EXTEND_MINUTES,
          extend_reason: reason,
        })
        .eq("id", game_id);

      if (updateError) throw updateError;

      // Notify RSVPed users that the game is still going
      const { data: rsvps } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("game_id", game_id)
        .eq("status", "confirmed");

      for (const rsvp of rsvps || []) {
        if (rsvp.user_id !== user.id) {
          await supabase.from("notifications").insert({
            recipient_id: rsvp.user_id,
            sender_id: user.id,
            type: "rsvp_update",
            reference_id: game_id,
            reference_type: "game",
            title: "Game extended! 🔥",
            body: `${game.sport} at ${game.location_name} is still going. +${EXTEND_MINUTES} min.`,
            data: { reason },
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        action: "extended",
        extended_minutes: EXTEND_MINUTES,
        reason,
        new_status: "live",
        message: `Game extended by ${EXTEND_MINUTES} minutes. Reason: ${reason}`,
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ── END ──
    if (action === "end") {
      const { error: updateError } = await supabase
        .from("games")
        .update({
          status: "ended",
          still_going_response: "no",
          still_going_responded_at: now.toISOString(),
          ended_at: now.toISOString(),
        })
        .eq("id", game_id);

      if (updateError) throw updateError;

      return new Response(JSON.stringify({
        success: true,
        action: "ended",
        new_status: "ended",
        message: "Game ended. Thanks for keeping the feed accurate!",
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

  } catch (err) {
    console.error("Still-going error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
