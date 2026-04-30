// supabase/functions/rsvp/index.ts
// ============================================================
// RSVP HANDLER
// ============================================================
// "I'm In" (live games) and "I'm Down" (upcoming games).
// Handles: create RSVP, cancel RSVP, check capacity,
// auto-waitlist when full, notify game creator.
// Spot counts update in real-time via database triggers.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    const { game_id, action } = body; // action: "join" | "cancel"

    if (!game_id || !action) {
      return new Response(JSON.stringify({ error: "game_id and action required" }), { status: 400 });
    }

    if (!["join", "cancel"].includes(action)) {
      return new Response(JSON.stringify({ error: "Action must be 'join' or 'cancel'" }), { status: 400 });
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

    // ── Validate game status ──
    if (!["upcoming", "live", "check"].includes(game.status)) {
      return new Response(JSON.stringify({
        error: "Cannot RSVP to a game that has ended",
        game_status: game.status,
      }), { status: 400 });
    }

    // ── Can't RSVP to own game ──
    if (game.creator_id === user.id) {
      return new Response(JSON.stringify({
        error: "You're already in this game — you created it",
      }), { status: 400 });
    }

    // ── Check existing RSVP ──
    const { data: existingRsvp } = await supabase
      .from("rsvps")
      .select("*")
      .eq("user_id", user.id)
      .eq("game_id", game_id)
      .single();

    // ── JOIN ──
    if (action === "join") {
      // Already RSVP'd?
      if (existingRsvp) {
        if (existingRsvp.status === "confirmed") {
          return new Response(JSON.stringify({
            error: "You're already in this game",
            rsvp_id: existingRsvp.id,
          }), { status: 409 });
        }

        // Re-confirm a cancelled RSVP
        if (existingRsvp.status === "cancelled") {
          // Check capacity first
          const { count: confirmedCount } = await supabase
            .from("rsvps")
            .select("id", { count: "exact", head: true })
            .eq("game_id", game_id)
            .eq("status", "confirmed");

          const totalCapacity = game.total_players + game.spots_needed; // original total needed
          const spotsOpen = game.spots_needed - (confirmedCount || 0);

          if (spotsOpen <= 0) {
            // Waitlist instead
            await supabase
              .from("rsvps")
              .update({ status: "waitlisted" })
              .eq("id", existingRsvp.id);

            return new Response(JSON.stringify({
              success: true,
              status: "waitlisted",
              message: "Game is full. You've been added to the waitlist.",
            }), { status: 200 });
          }

          await supabase
            .from("rsvps")
            .update({ status: "confirmed" })
            .eq("id", existingRsvp.id);

          return new Response(JSON.stringify({
            success: true,
            status: "confirmed",
            message: "You're back in!",
          }), { status: 200 });
        }
      }

      // New RSVP — check capacity
      const { count: confirmedCount } = await supabase
        .from("rsvps")
        .select("id", { count: "exact", head: true })
        .eq("game_id", game_id)
        .eq("status", "confirmed");

      const spotsOpen = game.spots_needed - (confirmedCount || 0);

      if (spotsOpen <= 0) {
        // Waitlist
        const { data: rsvp, error: insertError } = await supabase
          .from("rsvps")
          .insert({
            user_id: user.id,
            game_id: game_id,
            status: "waitlisted",
          })
          .select()
          .single();

        if (insertError) throw insertError;

        return new Response(JSON.stringify({
          success: true,
          status: "waitlisted",
          rsvp_id: rsvp.id,
          message: "Game is full. You're on the waitlist — we'll notify you if a spot opens.",
        }), { status: 200 });
      }

      // Confirmed RSVP
      const { data: rsvp, error: insertError } = await supabase
        .from("rsvps")
        .insert({
          user_id: user.id,
          game_id: game_id,
          status: "confirmed",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // ── Notify game creator ──
      const { data: rsvpUser } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const newSpotsOpen = spotsOpen - 1;

      await supabase.from("notifications").insert({
        recipient_id: game.creator_id,
        sender_id: user.id,
        type: "rsvp_update",
        reference_id: game_id,
        reference_type: "game",
        title: `${rsvpUser?.display_name || "Someone"} is in! 🙌`,
        body: newSpotsOpen > 0
          ? `${newSpotsOpen} spot${newSpotsOpen > 1 ? "s" : ""} left for ${game.sport} at ${game.location_name}`
          : `Your ${game.sport} game at ${game.location_name} is now full! 🔥`,
        data: {
          spots_remaining: newSpotsOpen,
          rsvp_user_id: user.id,
        },
      });

      // If game is now full, notify all RSVPed users
      if (newSpotsOpen === 0) {
        const { data: allRsvps } = await supabase
          .from("rsvps")
          .select("user_id")
          .eq("game_id", game_id)
          .eq("status", "confirmed");

        for (const r of allRsvps || []) {
          if (r.user_id !== user.id && r.user_id !== game.creator_id) {
            await supabase.from("notifications").insert({
              recipient_id: r.user_id,
              sender_id: null,
              type: "game_full",
              reference_id: game_id,
              reference_type: "game",
              title: "Game is full! 🔥",
              body: `All spots filled for ${game.sport} at ${game.location_name}. See you there.`,
            });
          }
        }
      }

      return new Response(JSON.stringify({
        success: true,
        status: "confirmed",
        rsvp_id: rsvp.id,
        spots_remaining: newSpotsOpen,
        message: game.status === "live"
          ? "You're in! Head over now."
          : `You're down! Game starts at ${new Date(game.game_start_time).toLocaleTimeString()}.`,
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ── CANCEL ──
    if (action === "cancel") {
      if (!existingRsvp) {
        return new Response(JSON.stringify({
          error: "No RSVP found to cancel",
        }), { status: 404 });
      }

      if (existingRsvp.status === "cancelled") {
        return new Response(JSON.stringify({
          error: "RSVP already cancelled",
        }), { status: 400 });
      }

      const wasConfirmed = existingRsvp.status === "confirmed";

      await supabase
        .from("rsvps")
        .update({ status: "cancelled" })
        .eq("id", existingRsvp.id);

      // If they were confirmed, check if someone on waitlist can be promoted
      if (wasConfirmed) {
        const { data: nextWaitlisted } = await supabase
          .from("rsvps")
          .select("id, user_id")
          .eq("game_id", game_id)
          .eq("status", "waitlisted")
          .order("created_at", { ascending: true })
          .limit(1)
          .single();

        if (nextWaitlisted) {
          // Promote from waitlist
          await supabase
            .from("rsvps")
            .update({ status: "confirmed" })
            .eq("id", nextWaitlisted.id);

          // Notify the promoted user
          await supabase.from("notifications").insert({
            recipient_id: nextWaitlisted.user_id,
            sender_id: null,
            type: "rsvp_update",
            reference_id: game_id,
            reference_type: "game",
            title: "A spot opened up! 🎉",
            body: `You've been moved off the waitlist for ${game.sport} at ${game.location_name}.`,
          });
        }

        // Notify creator that someone dropped
        const { data: cancelUser } = await supabase
          .from("users")
          .select("display_name")
          .eq("id", user.id)
          .single();

        await supabase.from("notifications").insert({
          recipient_id: game.creator_id,
          sender_id: user.id,
          type: "rsvp_update",
          reference_id: game_id,
          reference_type: "game",
          title: `${cancelUser?.display_name || "Someone"} dropped out`,
          body: nextWaitlisted
            ? "A waitlisted player was auto-promoted to fill the spot."
            : `A spot opened up for ${game.sport} at ${game.location_name}.`,
        });
      }

      return new Response(JSON.stringify({
        success: true,
        status: "cancelled",
        message: "RSVP cancelled.",
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

  } catch (err) {
    console.error("RSVP error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
