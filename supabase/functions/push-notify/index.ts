// supabase/functions/push-notify/index.ts
// ============================================================
// PUSH NOTIFICATION TRIGGER
// ============================================================
// Processes the notifications table and sends FCM pushes.
// Run on a schedule (every 30 seconds) or triggered by
// database webhooks on notifications table INSERT.
//
// YOU NEED TO: Set your FCM_SERVER_KEY in Supabase secrets.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const fcmServerKey = Deno.env.get("FCM_SERVER_KEY")!; // Your Firebase Cloud Messaging server key

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const FCM_URL = "https://fcm.googleapis.com/fcm/send";

// ── Send a single FCM push ──
async function sendFCMPush(
  fcmToken: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<boolean> {
  try {
    const response = await fetch(FCM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `key=${fcmServerKey}`,
      },
      body: JSON.stringify({
        to: fcmToken,
        notification: {
          title,
          body,
          sound: "default",
          badge: 1,
        },
        data: {
          ...data,
          click_action: "FLUTTER_NOTIFICATION_CLICK", // for Flutter; adjust for React Native
        },
        priority: "high",
        // iOS specific
        apns: {
          payload: {
            aps: {
              sound: "default",
              badge: 1,
            },
          },
        },
      }),
    });

    const result = await response.json();

    if (result.success === 1) {
      return true;
    } else {
      console.warn("FCM send failed:", result);
      return false;
    }
  } catch (err) {
    console.error("FCM error:", err);
    return false;
  }
}

// ── Check if user has DND (do not disturb) active ──
function isDND(notificationPrefs: Record<string, unknown>): boolean {
  const dndStart = notificationPrefs?.dnd_start as string | null;
  const dndEnd = notificationPrefs?.dnd_end as string | null;

  if (!dndStart || !dndEnd) return false;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTime = currentHour * 60 + currentMin;

  const [startH, startM] = dndStart.split(":").map(Number);
  const [endH, endM] = dndEnd.split(":").map(Number);
  const startTime = startH * 60 + startM;
  const endTime = endH * 60 + endM;

  // Handle overnight DND (e.g., 22:00 - 07:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime <= endTime;
  }

  return currentTime >= startTime && currentTime <= endTime;
}

// ── Check notification preferences ──
function shouldSendPush(
  notificationType: string,
  prefs: Record<string, unknown>
): boolean {
  if (isDND(prefs)) return false;

  switch (notificationType) {
    case "nearby_game":
      return prefs?.nearby_games === true;
    case "friend_invite":
    case "friend_request":
    case "friend_accepted":
      return prefs?.friend_activity === true;
    case "still_going_ping":
      return prefs?.still_going_pings === true;
    case "rsvp_update":
    case "game_starting_soon":
    case "game_verified":
    case "game_full":
    case "game_ended":
      return true; // always send game-related notifications (user can disable all push at OS level)
    default:
      return true;
  }
}

// ── Process unsent notifications ──
async function processUnsentNotifications() {
  // Fetch up to 50 unsent notifications
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("is_pushed", false)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Error fetching notifications:", error);
    return { sent: 0, skipped: 0, failed: 0 };
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const notif of notifications || []) {
    // Get recipient's FCM token and preferences
    const { data: recipient } = await supabase
      .from("users")
      .select("fcm_token, notification_prefs")
      .eq("id", notif.recipient_id)
      .single();

    if (!recipient?.fcm_token) {
      // No token — mark as pushed (can't deliver) and skip
      await supabase
        .from("notifications")
        .update({ is_pushed: true })
        .eq("id", notif.id);
      skipped++;
      continue;
    }

    // Check preferences
    if (!shouldSendPush(notif.type, recipient.notification_prefs || {})) {
      await supabase
        .from("notifications")
        .update({ is_pushed: true })
        .eq("id", notif.id);
      skipped++;
      continue;
    }

    // Send FCM push
    const success = await sendFCMPush(
      recipient.fcm_token,
      notif.title,
      notif.body,
      {
        notification_id: notif.id,
        type: notif.type,
        reference_id: notif.reference_id,
        reference_type: notif.reference_type,
        ...(notif.data || {}),
      }
    );

    // Mark as pushed
    await supabase
      .from("notifications")
      .update({ is_pushed: true })
      .eq("id", notif.id);

    if (success) sent++;
    else failed++;
  }

  return { sent, skipped, failed };
}

// ── NEARBY GAME NOTIFICATIONS ──
// Called separately when a new game is created.
// Finds users within radius who prefer that sport and notifies them.
async function notifyNearbyUsers(gameId: string) {
  // Fetch the game
  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();

  if (gameError || !game) return;

  // Fetch users with location data who prefer this sport
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, home_lat, home_lng, notification_prefs, preferred_sports")
    .not("home_lat", "is", null)
    .not("home_lng", "is", null)
    .neq("id", game.creator_id); // don't notify the creator

  if (usersError || !users) return;

  const toRad = (d: number) => d * (Math.PI / 180);
  function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  let notifiedCount = 0;

  for (const u of users) {
    // Check distance
    const dist = distKm(u.home_lat, u.home_lng, game.location_lat, game.location_lng);
    const userRadius = u.notification_prefs?.distance_radius_km || 8;
    if (dist > userRadius) continue;

    // Check sport preference (notify if they prefer this sport OR have no preferences set)
    const prefs: string[] = u.preferred_sports || [];
    if (prefs.length > 0 && !prefs.includes(game.sport)) continue;

    // Check if notifications enabled
    if (!shouldSendPush("nearby_game", u.notification_prefs || {})) continue;

    // Create notification
    await supabase.from("notifications").insert({
      recipient_id: u.id,
      sender_id: game.creator_id,
      type: "nearby_game",
      reference_id: game.id,
      reference_type: "game",
      title: `${game.sport} nearby! 🏀`,
      body: `${game.note.substring(0, 80)} — ${game.location_name}`,
      data: {
        sport: game.sport,
        location_name: game.location_name,
        spots_needed: game.spots_needed,
        distance_km: Math.round(dist * 10) / 10,
      },
    });

    notifiedCount++;
  }

  console.log(`Notified ${notifiedCount} nearby users about game ${gameId}`);
}

// ── FRIEND INVITE NOTIFICATION ──
async function notifyFriendInvite(
  senderId: string,
  recipientIds: string[],
  gameId: string,
  message?: string
) {
  // Fetch sender info
  const { data: sender } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", senderId)
    .single();

  // Fetch game info
  const { data: game } = await supabase
    .from("games")
    .select("sport, location_name, game_start_time")
    .eq("id", gameId)
    .single();

  if (!sender || !game) return;

  for (const recipientId of recipientIds) {
    await supabase.from("notifications").insert({
      recipient_id: recipientId,
      sender_id: senderId,
      type: "friend_invite",
      reference_id: gameId,
      reference_type: "game",
      title: `${sender.display_name} wants you to pull up 👀`,
      body: message || `${game.sport} at ${game.location_name}`,
      data: {
        sport: game.sport,
        location_name: game.location_name,
      },
    });
  }
}

// ── MAIN HANDLER ──
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "process";

    if (action === "process") {
      // Process unsent notifications queue
      const result = await processUnsentNotifications();
      return new Response(JSON.stringify({ success: true, ...result }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (action === "nearby") {
      // Trigger nearby notifications for a specific game
      const body = await req.json();
      if (!body.game_id) {
        return new Response(JSON.stringify({ error: "game_id required" }), { status: 400 });
      }
      await notifyNearbyUsers(body.game_id);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    if (action === "invite") {
      // Friend invite notification
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No auth" }), { status: 401 });
      }
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }

      const body = await req.json();
      if (!body.game_id || !body.recipient_ids?.length) {
        return new Response(JSON.stringify({ error: "game_id and recipient_ids required" }), { status: 400 });
      }

      await notifyFriendInvite(user.id, body.recipient_ids, body.game_id, body.message);
      return new Response(JSON.stringify({ success: true, notified: body.recipient_ids.length }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });

  } catch (err) {
    console.error("Push notify error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
