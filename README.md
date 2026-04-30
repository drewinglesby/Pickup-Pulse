# Pickup Pulse 🏀📡

**Waze for pickup sports.** A real-time, crowdsourced app that helps athletes find and organize pickup games at local parks and courts.

## What It Does

- **Live Feed** — See active and upcoming games near you, filtered by sport, ranked by proximity, trust, and friend activity
- **GPS Check-In** — Verify you're actually at the court (150m radius, server-side validation) to earn a trusted badge
- **Smart Timing** — Post games up to 2 days out. 2-hour live window starts at game time. "Still going?" ping at expiry with one-tap extend or end
- **Trust System** — Games with 3+ verified check-ins get a verified badge. More check-ins = brighter glow on the feed. Anti-spoofing and rate limiting built in
- **Crew/Friends** — Add friends, invite them to games, see who's active and where
- **Predictions** — The app learns when parks are usually busy based on historical check-in data and surfaces "usually busy Tues/Thurs 5-8 PM" style predictions
- **Push Notifications** — Get pinged when a game pops up near you, a friend invites you, or your game window is expiring. Fully configurable with sport filters, distance radius, and DND hours

## Project Structure

```
pickup-pulse/
├── README.md
├── database/
│   └── pickup-pulse-schema.sql      # Full PostgreSQL schema (paste into Supabase SQL editor)
├── supabase-functions/
│   ├── game-lifecycle.ts            # Phase transitions: upcoming → live → check → ended
│   ├── checkin-verify.ts            # GPS verification with Haversine, anti-spoof, rate limiting
│   ├── still-going.ts              # Extend/end handler for the still-going prompt
│   ├── feed-ranked.ts              # Feed ranking algorithm (proximity, trust, friends, sport match)
│   ├── prediction-engine.ts        # Trend analysis from 4 weeks of check-in data
│   ├── push-notify.ts              # FCM push notification triggers and delivery
│   └── rsvp.ts                     # I'm In / I'm Down with capacity, waitlist, auto-promotion
└── frontend/
    └── pickup-pulse.jsx            # Interactive React prototype (runs in any React environment)
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend (prototype) | React (JSX), inline CSS, Google Fonts |
| Frontend (production) | React Native (planned) |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth (Google, Apple, email) |
| Server Functions | Supabase Edge Functions (TypeScript/Deno) |
| Real-time | Supabase Realtime subscriptions |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| GPS | Device native + server-side Haversine verification |

## Database Schema

9 tables with full foreign keys, indexes, constraints, triggers, and Row Level Security:

- **users** — Profiles, preferences, trust scores, FCM tokens
- **locations** — Park/court/gym directory with coordinates and amenities
- **games** — The core feed posts with full timing system
- **checkins** — GPS verifications with distance auditing
- **friendships** — Bidirectional with pending/accepted/blocked states
- **rsvps** — Join/cancel with capacity management and waitlisting
- **notifications** — Full notification log with push delivery tracking
- **reports** — Abuse reporting with reason categories
- **activity_stats** — Aggregated hourly activity data for predictions

## Key Design Decisions

**1-hour expiry → changed to 2-hour window.** Games live for 2 hours from their start time. At expiry, the poster gets a "still going?" prompt. They pick a reason to extend (+60 min) or end it. No response in 5 minutes = auto-close. This keeps the feed fresh without killing games that are still running.

**2-day advance posting.** Users can schedule games up to 2 days out. The post appears on the feed immediately as "upcoming" with a countdown. The 2-hour live window starts when game time hits.

**Server-side GPS verification.** The distance check happens on the server, not the client, to prevent coordinate spoofing. Includes teleportation detection (flags impossible movement speeds) and rate limiting.

**One active post per user.** Enforced at the database level with a partial unique index. Prevents spam flooding.

**Feed ranking is multi-factor.** Proximity (30%), check-in count (20%), verified status (15%), friend involvement (15%), sport match (10%), recency (10%). Live games always sort above upcoming.

## Current Status

- [x] UI/UX prototype (fully interactive)
- [x] Database schema with RLS and triggers
- [x] Game lifecycle manager
- [x] GPS check-in verification
- [x] Still-going handler
- [x] Feed ranking algorithm
- [x] Prediction engine
- [x] Push notification logic
- [x] RSVP system with waitlist
- [ ] Supabase project setup and deployment
- [ ] Firebase project setup (FCM)
- [ ] React Native rebuild of frontend
- [ ] Auth screens (Google/Apple sign-in)
- [ ] Real GPS integration
- [ ] Wire frontend to backend APIs
- [ ] Notification handling on device
- [ ] Profile/settings screens
- [ ] Friend request flow
- [ ] Navigation stack
- [ ] Error handling and offline mode
- [ ] App store submission

## Getting Started (for developers)

### Run the prototype locally
```bash
# In any React project (Vite, Next.js, CRA)
# Copy pickup-pulse.jsx into your components folder
# Import and render it as the main component
```

### Set up the backend
1. Create a [Supabase](https://supabase.com) project
2. Paste `database/pickup-pulse-schema.sql` into the SQL editor and run
3. Deploy each function in `supabase-functions/` as a Supabase Edge Function
4. Create a [Firebase](https://firebase.google.com) project and get your FCM server key
5. Add `FCM_SERVER_KEY` to your Supabase function secrets
6. Set up cron: `game-lifecycle` every 60s, `prediction-engine` daily at 3 AM

## Launch Strategy

Target: **Oregon State University, Corvallis, OR**
- Hyper-local launch at one campus with high pickup basketball density
- Seed the feed manually for 2-3 weeks to build initial activity
- Corvallis parks pre-loaded in the database
- Scale outward once the flywheel catches

## License

MIT
