# Pickup Pulse — Initial Onboarding

You're joining a solo-developer project called Pickup Pulse, a real-time pickup sports app ("Waze for pickup basketball"). Before doing anything else, read the full README.md in the project root and skim every file in `database/`, `supabase-functions/`, and `frontend/`. Do not write code yet.

## Your first task: produce a deployment plan, not code

I want to deploy this app to a TestFlight beta over the next several weeks. The codebase is roughly 80% written but 0% deployed. Before we touch anything, I need you to:

1. **Audit what exists.** For each file in `supabase-functions/` and `database/`, give me a one-line summary of what it does and flag anything that looks incomplete, broken, or that references something that doesn't exist (e.g., a function calling a table column that isn't in the schema, or env vars that aren't documented).

2. **Identify the dependency graph.** Which functions depend on which tables? Which functions call other functions? If `game-lifecycle` runs and a check-in doesn't exist yet, what breaks?

3. **Produce an ordered deployment plan** with these phases, and tell me what *I* (the human) need to do versus what *you* can do:
   - Phase 1: Supabase project + schema + edge functions + cron
   - Phase 2: Firebase project + FCM keys + secrets wiring
   - Phase 3: End-to-end smoke test (one fake user, one fake game, one fake check-in, one push notification — all working before we touch the frontend)
   - Phase 4: React Native scaffold and the first screen that talks to a real backend
   - We'll plan Phases 5+ (full RN rebuild, device integration, polish) after Phase 4 ships

4. **Flag risks and decisions I need to make before we start.** Specifically:
   - Expo vs bare React Native?
   - Which maps library?
   - How strict does GPS anti-spoofing need to be for v1? (Android mock-location is trivial to fake; "trusted badge" credibility depends on this.)
   - Anything else you spot.

## Constraints and preferences

- **I'm a CS student, not a senior engineer.** Explain trade-offs when you propose something. If there are two reasonable ways to do a thing, tell me both and recommend one with reasoning. Don't just pick silently.
- **I learn by understanding why, not by copy-paste.** When you write code or commands, a one-sentence "here's what this does" is more useful to me than verbose comments inside the code.
- **Small steps, verified.** I'd rather deploy one function and confirm it works than deploy seven and debug a tangle. Default to the smallest shippable unit.
- **Don't rewrite working code unless we agree it needs rewriting.** If something in the existing files is questionable but functional, flag it for later — don't refactor on first contact.
- **Ask before destructive actions.** Schema changes, deleting files, force-pushes, dropping tables — confirm first.
- **When you don't know something, say so.** Don't guess at Supabase or FCM behavior. Check the docs or tell me you need to.

## What I'd like from you right now

Just the audit and the deployment plan. No code. No file edits. When the plan looks right to me, I'll tell you to start Phase 1.
