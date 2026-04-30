import { useState, useEffect } from "react";

const SPORTS = ["All", "Basketball", "Soccer", "Football", "Volleyball", "Tennis", "Softball"];
const SPORT_ICONS = { Basketball: "🏀", Soccer: "⚽", Football: "🏈", Volleyball: "🏐", Tennis: "🎾", Softball: "🥎" };
const SKILL_LEVELS = ["Any", "Casual", "Intermediate", "Competitive"];
const PARKS = [
  { name: "Highland Park Courts", lat: 44.5705, lng: -123.2680 },
  { name: "Dixon Rec Center", lat: 44.5633, lng: -123.2794 },
  { name: "OSU Intramural Fields", lat: 44.5590, lng: -123.2810 },
  { name: "McAlexander Fieldhouse", lat: 44.5612, lng: -123.2756 },
  { name: "Sunset Park", lat: 44.5820, lng: -123.2590 },
  { name: "Riverfront Fields", lat: 44.5672, lng: -123.2615 },
  { name: "Willamette Park", lat: 44.5540, lng: -123.2640 },
  { name: "Pioneer Park", lat: 44.5660, lng: -123.2520 },
];

const EXTEND_REASONS = [
  "Game's still competitive 🔥",
  "Waiting on next game",
  "New players just showed up",
  "Running it back"
];

const now = Date.now();
const HOUR = 3600000;
const MIN = 60000;

// Status: "upcoming" (before game time), "live" (game time started, within window), "check" (still going ping), "ended"
function getGamePhase(game) {
  const n = Date.now();
  if (game.manualEnd) return "ended";
  if (game.gameStartTime > n) return "upcoming";
  const elapsed = n - game.gameStartTime;
  const window = game.windowMinutes * MIN;
  if (elapsed < window) return "live";
  if (elapsed < window + 5 * MIN && !game.stillGoingResponse) return "check"; // 5 min to respond
  if (game.stillGoingResponse === "yes") {
    const extendedEnd = window + game.extendedMinutes * MIN;
    if (elapsed < extendedEnd) return "live";
  }
  return "ended";
}

function minsUntil(timestamp) {
  const diff = Math.max(0, Math.floor((timestamp - Date.now()) / MIN));
  if (diff < 60) return `${diff}m`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ${diff % 60}m`;
  return `${Math.floor(diff / 1440)}d ${Math.floor((diff % 1440) / 60)}h`;
}

function minsLeftInWindow(game) {
  const elapsed = (Date.now() - game.gameStartTime) / MIN;
  let total = game.windowMinutes;
  if (game.stillGoingResponse === "yes") total = game.windowMinutes + game.extendedMinutes;
  return Math.max(0, Math.floor(total - elapsed));
}

function formatGameTime(game) {
  if (game.isNow) return "Now";
  const d = new Date(game.gameStartTime);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${timeStr}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${timeStr}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${timeStr}`;
}

const MOCK_GAMES = [
  { id: 1, sport: "Basketball", location: "Highland Park Courts", isNow: true, gameStartTime: now - 15 * MIN, windowMinutes: 120, extendedMinutes: 0, spotsNeeded: 3, totalPlayers: 7, skillLevel: "Intermediate", user: "Marcus T.", note: "Running 5s, need 3 more. Got next game ready.", createdAt: now - 20 * MIN, verified: true, checkins: 6, stillGoingResponse: null, manualEnd: false },
  { id: 2, sport: "Soccer", location: "Riverfront Fields", isNow: false, gameStartTime: now + 3.5 * HOUR, windowMinutes: 120, extendedMinutes: 0, spotsNeeded: 6, totalPlayers: 14, skillLevel: "Any", user: "Sofia R.", note: "Pickup 7v7 tonight. Bringing pinnies. All levels welcome.", createdAt: now - 2 * HOUR, verified: false, checkins: 1, stillGoingResponse: null, manualEnd: false },
  { id: 3, sport: "Basketball", location: "Dixon Rec Center", isNow: true, gameStartTime: now - 45 * MIN, windowMinutes: 120, extendedMinutes: 0, spotsNeeded: 0, totalPlayers: 12, skillLevel: "Competitive", user: "Jaylen W.", note: "Courts are packed. 3 teams deep waiting for next.", createdAt: now - 50 * MIN, verified: true, checkins: 9, stillGoingResponse: null, manualEnd: false },
  { id: 4, sport: "Football", location: "OSU Intramural Fields", isNow: false, gameStartTime: now + 1.5 * HOUR, windowMinutes: 120, extendedMinutes: 0, spotsNeeded: 8, totalPlayers: 6, skillLevel: "Casual", user: "Chris M.", note: "Flag football. Just trying to get a game going before dark.", createdAt: now - 40 * MIN, verified: false, checkins: 2, stillGoingResponse: null, manualEnd: false },
  { id: 5, sport: "Volleyball", location: "Willamette Park", isNow: true, gameStartTime: now - 90 * MIN, windowMinutes: 120, extendedMinutes: 60, spotsNeeded: 2, totalPlayers: 10, skillLevel: "Intermediate", user: "Priya K.", note: "Sand volleyball, we play here every Wednesday. Come through.", createdAt: now - 3 * HOUR, verified: true, checkins: 7, stillGoingResponse: "yes", manualEnd: false, extendReason: "Game's still competitive 🔥" },
  { id: 6, sport: "Tennis", location: "Pioneer Park", isNow: true, gameStartTime: now - 30 * MIN, windowMinutes: 120, extendedMinutes: 0, spotsNeeded: 1, totalPlayers: 3, skillLevel: "Competitive", user: "Daniel O.", note: "Looking for a 4th for doubles. Courts 3 & 4 open.", createdAt: now - 35 * MIN, verified: false, checkins: 1, stillGoingResponse: null, manualEnd: false },
  { id: 7, sport: "Basketball", location: "Sunset Park", isNow: false, gameStartTime: now + 26 * HOUR, windowMinutes: 120, extendedMinutes: 0, spotsNeeded: 5, totalPlayers: 5, skillLevel: "Any", user: "Andre L.", note: "Got a squad of 5, who wants to run tomorrow? Lights on till 10.", createdAt: now - 15 * MIN, verified: false, checkins: 3, stillGoingResponse: null, manualEnd: false },
];

const MOCK_FRIENDS = [
  { id: "f1", name: "Jaylen W.", sport: "Basketball", status: "At Dixon Rec Center", online: true, avatar: "JW" },
  { id: "f2", name: "Sofia R.", sport: "Soccer", status: "Looking for a game", online: true, avatar: "SR" },
  { id: "f3", name: "Andre L.", sport: "Basketball", status: "Posted a game for tomorrow", online: true, avatar: "AL" },
  { id: "f4", name: "Priya K.", sport: "Volleyball", status: "Last seen 2h ago", online: false, avatar: "PK" },
  { id: "f5", name: "Chris M.", sport: "Football", status: "Last seen 4h ago", online: false, avatar: "CM" },
  { id: "f6", name: "Daniel O.", sport: "Tennis", status: "At Pioneer Park", online: true, avatar: "DO" },
];

const BUSY_PREDICTIONS = [
  { location: "Highland Park Courts", sport: "Basketball", pattern: "Usually busy", detail: "Tues/Thurs 5–8 PM", confidence: 87 },
  { location: "Dixon Rec Center", sport: "Basketball", pattern: "Peak hours", detail: "Mon–Fri 4–7 PM", confidence: 94 },
  { location: "Riverfront Fields", sport: "Soccer", pattern: "Active evenings", detail: "Wed/Fri 6–8 PM", confidence: 72 },
  { location: "Willamette Park", sport: "Volleyball", pattern: "Weekly regulars", detail: "Wed 5–7 PM", confidence: 81 },
];

function StatusDot({ phase }) {
  const colors = { upcoming: "#3b82f6", live: "#22c55e", check: "#f59e0b", ended: "#555" };
  const c = colors[phase] || "#555";
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: c, marginRight: 6, flexShrink: 0,
      boxShadow: phase === "live" ? `0 0 6px ${c}` : "none",
      animation: phase === "live" ? "pulse 2s infinite" : phase === "check" ? "pulse 0.8s infinite" : "none"
    }} />
  );
}

function PhaseLabel({ phase, game }) {
  if (phase === "upcoming") return <span style={{ color: "#3b82f6" }}>Starts in {minsUntil(game.gameStartTime)}</span>;
  if (phase === "live") return <span style={{ color: "#22c55e" }}>Live · {minsLeftInWindow(game)}m left</span>;
  if (phase === "check") return <span style={{ color: "#f59e0b", fontWeight: 600 }}>Still going?</span>;
  return <span style={{ color: "#555" }}>Ended</span>;
}

function TimerBar({ game, phase }) {
  if (phase === "upcoming") {
    // Show time until start
    const totalWait = game.gameStartTime - game.createdAt;
    const elapsed = Date.now() - game.createdAt;
    const pct = Math.min(100, (elapsed / totalWait) * 100);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingLeft: 54 }}>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: "#1a1a1a", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: "#3b82f6", transition: "width 1s" }} />
        </div>
        <span style={{ fontSize: 11, color: "#3b82f6", whiteSpace: "nowrap", fontWeight: 500 }}>
          {minsUntil(game.gameStartTime)} to start
        </span>
      </div>
    );
  }
  if (phase === "live" || phase === "check") {
    const left = minsLeftInWindow(game);
    const total = game.stillGoingResponse === "yes" ? game.windowMinutes + game.extendedMinutes : game.windowMinutes;
    const pct = (left / total) * 100;
    const color = left <= 15 ? "#ef4444" : left <= 40 ? "#f59e0b" : "#22c55e";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingLeft: 54 }}>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: "#1a1a1a", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: color, transition: "width 1s" }} />
        </div>
        <span style={{ fontSize: 11, color: "#555", whiteSpace: "nowrap" }}>
          {left}m left{game.stillGoingResponse === "yes" ? " (ext)" : ""}
        </span>
      </div>
    );
  }
  return null;
}

function glowIntensity(checkins) {
  if (checkins >= 8) return "0 0 0 2px rgba(255,107,53,.35), 0 0 20px rgba(255,107,53,.15)";
  if (checkins >= 5) return "0 0 0 1.5px rgba(255,107,53,.25), 0 0 12px rgba(255,107,53,.08)";
  if (checkins >= 3) return "0 0 0 1px rgba(255,107,53,.15)";
  return "none";
}

// ── CHECK-IN MODAL ──
function CheckInModal({ onClose, onCheckIn, parks }) {
  const [locStatus, setLocStatus] = useState("idle");
  const [selectedPark, setSelectedPark] = useState(null);

  function handleVerify() {
    if (!selectedPark) return;
    setLocStatus("loading");
    setTimeout(() => {
      setLocStatus("success");
      setTimeout(() => onCheckIn(selectedPark), 1000);
    }, 1500);
  }

  function handleSimulateFar() {
    if (!selectedPark) return;
    setLocStatus("loading");
    setTimeout(() => setLocStatus("tooFar"), 1500);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .2s ease" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "#141414", borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", animation: "slideUp .3s ease" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#333", margin: "0 auto 20px" }} />
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>📍 Check In</h2>
        <p style={{ fontSize: 13, color: "#666", margin: "0 0 20px" }}>Verify you're at the court to earn a trusted badge</p>
        <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>Where are you?</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0 20px", maxHeight: 200, overflowY: "auto" }}>
          {parks.map(p => (
            <button key={p.name} onClick={() => { setSelectedPark(p.name); setLocStatus("idle"); }} style={{
              padding: "12px 14px", borderRadius: 12, textAlign: "left",
              background: selectedPark === p.name ? "rgba(255,107,53,.08)" : "#0e0e0e",
              border: selectedPark === p.name ? "1.5px solid #ff6b35" : "1.5px solid #1e1e1e",
              color: selectedPark === p.name ? "#ff6b35" : "#aaa",
              fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "all .15s"
            }}>{p.name}</button>
          ))}
        </div>
        {locStatus === "loading" && <div style={{ textAlign: "center", padding: "16px 0" }}><div style={{ fontSize: 28, animation: "pulse 1s infinite" }}>📡</div><p style={{ color: "#888", fontSize: 14, marginTop: 8 }}>Verifying location...</p></div>}
        {locStatus === "success" && <div style={{ textAlign: "center", padding: "16px 0", animation: "popIn .3s" }}><div style={{ fontSize: 40 }}>✅</div><p style={{ color: "#22c55e", fontSize: 15, fontWeight: 600, marginTop: 8 }}>Checked in at {selectedPark}!</p></div>}
        {locStatus === "tooFar" && <div style={{ textAlign: "center", padding: "16px 0", animation: "popIn .3s" }}><div style={{ fontSize: 40 }}>❌</div><p style={{ color: "#ef4444", fontSize: 15, fontWeight: 600, marginTop: 8 }}>Too far from {selectedPark}</p><p style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Must be within 150m</p></div>}
        {locStatus === "idle" && selectedPark && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={handleVerify} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: "linear-gradient(135deg, #ff6b35, #e85d26)", color: "#fff", border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Verify My Location</button>
            <button onClick={handleSimulateFar} style={{ width: "100%", padding: "12px 0", borderRadius: 12, background: "#0e0e0e", color: "#555", border: "1px solid #1e1e1e", fontSize: 13, cursor: "pointer" }}>Demo: Simulate Too Far</button>
          </div>
        )}
        {locStatus === "tooFar" && <button onClick={() => setLocStatus("idle")} style={{ width: "100%", padding: "14px 0", borderRadius: 12, marginTop: 8, background: "#1a1a1a", color: "#aaa", border: "1px solid #252525", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Try Again</button>}
      </div>
    </div>
  );
}

// ── STILL GOING MODAL ──
function StillGoingModal({ game, onExtend, onEnd, onClose }) {
  const [selectedReason, setSelectedReason] = useState(null);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn .2s" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "90%", maxWidth: 380, background: "#141414", borderRadius: 20, padding: "28px 24px", animation: "popIn .3s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⏰</div>
          <h2 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 4px" }}>Still going at {game.location.split(" ")[0]}?</h2>
          <p style={{ fontSize: 13, color: "#666", margin: 0 }}>Your 2hr window is up. Keep it live?</p>
        </div>

        <p style={{ fontSize: 12, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Quick reason to extend</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {EXTEND_REASONS.map(r => (
            <button key={r} onClick={() => setSelectedReason(r)} style={{
              padding: "11px 14px", borderRadius: 10, textAlign: "left",
              background: selectedReason === r ? "rgba(255,107,53,.08)" : "#0e0e0e",
              border: selectedReason === r ? "1.5px solid #ff6b35" : "1.5px solid #1e1e1e",
              color: selectedReason === r ? "#ff6b35" : "#aaa",
              fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "all .15s"
            }}>{r}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onEnd} style={{
            flex: 1, padding: "12px 0", borderRadius: 12,
            background: "#1a1a1a", color: "#888", border: "1px solid #252525",
            fontSize: 14, fontWeight: 600, cursor: "pointer"
          }}>It's Over</button>
          <button onClick={() => selectedReason && onExtend(selectedReason)} style={{
            flex: 1, padding: "12px 0", borderRadius: 12,
            background: selectedReason ? "linear-gradient(135deg, #ff6b35, #e85d26)" : "#1a1a1a",
            color: selectedReason ? "#fff" : "#555",
            border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer"
          }}>+60 Min</button>
        </div>
      </div>
    </div>
  );
}

// ── INVITE MODAL ──
function InviteModal({ onClose, friends }) {
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  function toggleFriend(id) { setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); }
  function handleSend() { if (selected.length === 0) return; setSent(true); setTimeout(onClose, 1500); }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .2s" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "#141414", borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", animation: "slideUp .3s ease" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#333", margin: "0 auto 20px" }} />
        {sent ? (
          <div style={{ textAlign: "center", padding: "40px 0", animation: "popIn .3s" }}>
            <div style={{ fontSize: 48 }}>🏀</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "12px 0 4px" }}>Invite Sent!</h2>
            <p style={{ color: "#666", fontSize: 14 }}>{selected.length} friend{selected.length > 1 ? "s" : ""} notified</p>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 16px" }}>Invite Friends</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", marginBottom: 16 }}>
              {friends.map(f => (
                <button key={f.id} onClick={() => toggleFriend(f.id)} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12,
                  background: selected.includes(f.id) ? "rgba(255,107,53,.08)" : "#0e0e0e",
                  border: selected.includes(f.id) ? "1.5px solid #ff6b35" : "1.5px solid #1e1e1e",
                  cursor: "pointer", textAlign: "left"
                }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: selected.includes(f.id) ? "rgba(255,107,53,.15)" : "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: selected.includes(f.id) ? "#ff6b35" : "#666", position: "relative" }}>
                    {f.avatar}
                    {f.online && <span style={{ position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: "50%", background: "#22c55e", border: "2px solid #0e0e0e" }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: selected.includes(f.id) ? "#f0f0f0" : "#aaa" }}>{f.name}</div>
                    <div style={{ fontSize: 12, color: "#555", marginTop: 1 }}>{f.status}</div>
                  </div>
                  <div style={{ width: 22, height: 22, borderRadius: 6, border: selected.includes(f.id) ? "2px solid #ff6b35" : "2px solid #333", background: selected.includes(f.id) ? "#ff6b35" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {selected.includes(f.id) && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
                  </div>
                </button>
              ))}
            </div>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Tryna run? Pull up..." rows={2} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "#0e0e0e", border: "1.5px solid #1e1e1e", color: "#f0f0f0", fontSize: 14, marginBottom: 14, outline: "none", resize: "none" }} />
            <button onClick={handleSend} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: selected.length > 0 ? "linear-gradient(135deg, #ff6b35, #e85d26)" : "#1a1a1a", color: selected.length > 0 ? "#fff" : "#555", border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
              {selected.length > 0 ? `Send to ${selected.length} Friend${selected.length > 1 ? "s" : ""}` : "Select Friends"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── MAIN APP ──
export default function PickupPulse() {
  const [tab, setTab] = useState("feed");
  const [sportFilter, setSportFilter] = useState("All");
  const [games, setGames] = useState(MOCK_GAMES);
  const [showPostSuccess, setShowPostSuccess] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [checkedInAt, setCheckedInAt] = useState(null);
  const [stillGoingGame, setStillGoingGame] = useState(null);
  const [tick, setTick] = useState(0);
  const [notificationsOn, setNotificationsOn] = useState(true);

  const [postSport, setPostSport] = useState("Basketball");
  const [postLocation, setPostLocation] = useState(PARKS[0].name);
  const [postWhen, setPostWhen] = useState("now"); // now | today | tomorrow | day2
  const [postCustomTime, setPostCustomTime] = useState("18:00");
  const [postSpots, setPostSpots] = useState(3);
  const [postSkill, setPostSkill] = useState("Any");
  const [postNote, setPostNote] = useState("");
  const [postPlayers, setPostPlayers] = useState(2);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
      // Auto-cleanup ended games
      setGames(g => g.filter(game => getGamePhase(game) !== "ended"));
      // Check for "still going?" prompts on user's own games
      setGames(g => {
        const checkGame = g.find(game => game.user === "You" && getGamePhase(game) === "check" && !game.stillGoingResponse);
        if (checkGame && !stillGoingGame) setStillGoingGame(checkGame);
        return g;
      });
    }, 10000);
    return () => clearInterval(interval);
  }, [stillGoingGame]);

  const activeGames = games.filter(g => getGamePhase(g) !== "ended");
  const filtered = sportFilter === "All" ? activeGames : activeGames.filter(g => g.sport === sportFilter);
  // Sort: live first, then upcoming by start time
  const sorted = [...filtered].sort((a, b) => {
    const pa = getGamePhase(a), pb = getGamePhase(b);
    const order = { live: 0, check: 1, upcoming: 2 };
    if (order[pa] !== order[pb]) return (order[pa] ?? 3) - (order[pb] ?? 3);
    return a.gameStartTime - b.gameStartTime;
  });

  function handlePost() {
    if (!postNote.trim()) return;
    let startTime;
    if (postWhen === "now") {
      startTime = Date.now();
    } else {
      const [h, m] = postCustomTime.split(":").map(Number);
      const d = new Date();
      if (postWhen === "tomorrow") d.setDate(d.getDate() + 1);
      if (postWhen === "day2") d.setDate(d.getDate() + 2);
      d.setHours(h, m, 0, 0);
      startTime = d.getTime();
    }
    const newGame = {
      id: Date.now(), sport: postSport, location: postLocation, isNow: postWhen === "now",
      gameStartTime: startTime, windowMinutes: 120, extendedMinutes: 0,
      spotsNeeded: postSpots, totalPlayers: postPlayers, skillLevel: postSkill,
      user: "You", note: postNote, createdAt: Date.now(),
      verified: checkedInAt === postLocation, checkins: checkedInAt === postLocation ? 1 : 0,
      stillGoingResponse: null, manualEnd: false,
    };
    setGames([newGame, ...games]);
    setShowPostSuccess(true);
    setTimeout(() => { setShowPostSuccess(false); setTab("feed"); }, 1400);
    setPostNote(""); setPostSpots(3); setPostPlayers(2);
  }

  function handleCheckIn(parkName) {
    setCheckedInAt(parkName);
    setShowCheckIn(false);
    setGames(g => g.map(game =>
      game.location === parkName ? { ...game, checkins: game.checkins + 1, verified: game.checkins + 1 >= 3 || game.verified } : game
    ));
  }

  function handleExtend(reason) {
    if (!stillGoingGame) return;
    setGames(g => g.map(game =>
      game.id === stillGoingGame.id ? { ...game, stillGoingResponse: "yes", extendedMinutes: 60, extendReason: reason } : game
    ));
    setStillGoingGame(null);
  }

  function handleEndGame() {
    if (!stillGoingGame) return;
    setGames(g => g.map(game =>
      game.id === stillGoingGame.id ? { ...game, manualEnd: true } : game
    ));
    setStillGoingGame(null);
  }

  function handleManualEnd(gameId) {
    setGames(g => g.map(game => game.id === gameId ? { ...game, manualEnd: true } : game));
  }

  const liveCount = activeGames.filter(g => getGamePhase(g) === "live").length;

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", minHeight: "100vh", background: "#0a0a0a", color: "#f0f0f0", fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes slideUp { from{transform:translateY(30px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes popIn { 0%{transform:scale(.8);opacity:0} 100%{transform:scale(1);opacity:1} }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { width: 0; }
        input, textarea, select { font-family: 'DM Sans', sans-serif; }
      `}</style>

      {/* HEADER */}
      <div style={{ padding: "20px 20px 0", background: "linear-gradient(180deg, #141414 0%, #0a0a0a 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Mono', monospace", fontWeight: 700, letterSpacing: -1, background: "linear-gradient(135deg, #ff6b35 0%, #f7c948 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>PICKUP PULSE</h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#666", letterSpacing: 1, textTransform: "uppercase" }}>Live games near you</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {checkedInAt && (
              <div style={{ background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.2)", borderRadius: 10, padding: "5px 10px", fontSize: 11, color: "#22c55e", fontWeight: 600, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {checkedInAt.split(" ")[0]}</div>
            )}
            <div style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 12, padding: "6px 12px", fontSize: 12, color: "#22c55e", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
              {liveCount} Live
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "16px 0 14px", scrollbarWidth: "none" }}>
          {SPORTS.map(s => (
            <button key={s} onClick={() => setSportFilter(s)} style={{ flexShrink: 0, padding: "7px 16px", borderRadius: 20, border: sportFilter === s ? "1.5px solid #ff6b35" : "1.5px solid #2a2a2a", background: sportFilter === s ? "rgba(255,107,53,.12)" : "#141414", color: sportFilter === s ? "#ff6b35" : "#888", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {s !== "All" && <span style={{ marginRight: 4 }}>{SPORT_ICONS[s]}</span>}{s}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ padding: "0 16px 100px", minHeight: "60vh" }}>

        {/* FEED */}
        {tab === "feed" && (
          <div style={{ animation: "fadeIn .3s ease" }}>
            {sorted.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#555" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏟️</div>
                <p style={{ fontSize: 15 }}>No active games{sportFilter !== "All" ? ` for ${sportFilter}` : ""}.</p>
                <p style={{ fontSize: 13, color: "#444" }}>Post one up to 2 days out.</p>
              </div>
            )}
            {sorted.map((game, i) => {
              const phase = getGamePhase(game);
              return (
                <div key={game.id} onClick={() => setExpandedCard(expandedCard === game.id ? null : game.id)} style={{
                  background: "#141414", borderRadius: 16, padding: 16, marginBottom: 12,
                  animation: `slideUp .4s ease ${i * 0.06}s both`, cursor: "pointer",
                  transition: "all .25s",
                  border: expandedCard === game.id ? "1px solid #ff6b35" : game.checkins >= 5 ? "1px solid rgba(255,107,53,.3)" : "1px solid #1e1e1e",
                  boxShadow: glowIntensity(game.checkins),
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: "rgba(255,107,53,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{SPORT_ICONS[game.sport]}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{game.location}</div>
                        <div style={{ fontSize: 12, color: "#777", marginTop: 2, display: "flex", alignItems: "center" }}>
                          <StatusDot phase={phase} />
                          <PhaseLabel phase={phase} game={game} />
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, marginLeft: 8 }}>
                      {game.spotsNeeded > 0 ? (
                        <div style={{ background: "rgba(255,107,53,.1)", color: "#ff6b35", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8, whiteSpace: "nowrap" }}>Need {game.spotsNeeded}</div>
                      ) : (
                        <div style={{ background: "rgba(239,68,68,.1)", color: "#ef4444", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8, whiteSpace: "nowrap" }}>Full</div>
                      )}
                      {phase === "upcoming" && (
                        <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 500 }}>{formatGameTime(game)}</div>
                      )}
                    </div>
                  </div>

                  <p style={{ margin: "12px 0 0", fontSize: 14, color: "#ccc", lineHeight: 1.5, paddingLeft: 54 }}>"{game.note}"</p>

                  {game.extendReason && (
                    <div style={{ marginTop: 8, paddingLeft: 54, fontSize: 12, color: "#f59e0b", fontStyle: "italic" }}>Extended: {game.extendReason}</div>
                  )}

                  <div style={{ display: "flex", gap: 6, marginTop: 10, paddingLeft: 54, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#1a1a1a", color: "#888", border: "1px solid #252525" }}>{game.sport}</span>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#1a1a1a", color: "#888", border: "1px solid #252525" }}>{game.skillLevel}</span>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#1a1a1a", color: "#888", border: "1px solid #252525" }}>{game.totalPlayers} players</span>
                    {game.verified && <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "rgba(34,197,94,.08)", color: "#22c55e", border: "1px solid rgba(34,197,94,.2)" }}>✓ Verified</span>}
                    {game.checkins >= 3 && <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "rgba(99,102,241,.08)", color: "#818cf8", border: "1px solid rgba(99,102,241,.2)" }}>🔥 {game.checkins} check-ins</span>}
                  </div>

                  <TimerBar game={game} phase={phase} />

                  {expandedCard === game.id && (
                    <div style={{ marginTop: 12, paddingTop: 12, paddingLeft: 54, borderTop: "1px solid #1e1e1e", display: "flex", gap: 10, animation: "popIn .2s ease", flexWrap: "wrap" }}>
                      {phase === "live" && game.spotsNeeded > 0 && (
                        <button onClick={e => e.stopPropagation()} style={{ flex: 1, minWidth: 100, padding: "10px 0", borderRadius: 10, background: "linear-gradient(135deg, #ff6b35, #e85d26)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>I'm In</button>
                      )}
                      {phase === "upcoming" && game.spotsNeeded > 0 && (
                        <button onClick={e => e.stopPropagation()} style={{ flex: 1, minWidth: 100, padding: "10px 0", borderRadius: 10, background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>I'm Down</button>
                      )}
                      <button onClick={e => { e.stopPropagation(); setShowInvite(true); }} style={{ flex: 1, minWidth: 100, padding: "10px 0", borderRadius: 10, background: "#1a1a1a", color: "#aaa", border: "1px solid #2a2a2a", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Invite Crew</button>
                      {game.user === "You" && phase === "live" && (
                        <button onClick={e => { e.stopPropagation(); handleManualEnd(game.id); }} style={{ flex: 1, minWidth: 100, padding: "10px 0", borderRadius: 10, background: "#1a1a1a", color: "#ef4444", border: "1px solid rgba(239,68,68,.2)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>End Game</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TRENDS */}
        {tab === "trends" && (
          <div style={{ animation: "fadeIn .3s ease" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "4px 0 6px" }}>Predicted Activity</h2>
            <p style={{ fontSize: 13, color: "#555", margin: "0 0 18px" }}>Based on community check-ins over time</p>
            {BUSY_PREDICTIONS.map((p, i) => (
              <div key={i} style={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 14, padding: 16, marginBottom: 10, animation: `slideUp .4s ease ${i * 0.08}s both` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.location}</div>
                    <div style={{ fontSize: 12, color: "#777", marginTop: 3 }}>{SPORT_ICONS[p.sport]} {p.sport}</div>
                  </div>
                  <div style={{ background: "rgba(247,201,72,.08)", color: "#f7c948", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8 }}>{p.confidence}% sure</div>
                </div>
                <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "#0e0e0e", border: "1px solid #1a1a1a" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f7c948" }}>{p.pattern}</div>
                  <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>{p.detail}</div>
                </div>
                <div style={{ display: "flex", gap: 3, marginTop: 12 }}>
                  {["M","T","W","T","F","S","S"].map((d, j) => {
                    const h = [30, 65, 85, 70, 80, 50, 35][j] * (p.confidence / 100);
                    return (
                      <div key={j} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ height: 40, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                          <div style={{ width: "100%", maxWidth: 28, height: `${h}%`, borderRadius: 4, background: h > 60 ? "rgba(255,107,53,.6)" : h > 40 ? "rgba(255,107,53,.3)" : "rgba(255,107,53,.12)" }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>{d}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* FRIENDS */}
        {tab === "friends" && (
          <div style={{ animation: "fadeIn .3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 18px" }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Your Crew</h2>
                <p style={{ fontSize: 13, color: "#555", margin: "2px 0 0" }}>{MOCK_FRIENDS.filter(f => f.online).length} active now</p>
              </div>
              <button onClick={() => setShowInvite(true)} style={{ padding: "8px 16px", borderRadius: 10, background: "linear-gradient(135deg, #ff6b35, #e85d26)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Invite</button>
            </div>
            {MOCK_FRIENDS.filter(f => f.online).map((f, i) => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#141414", border: "1px solid #1e1e1e", borderRadius: 14, marginBottom: 8, animation: `slideUp .4s ease ${i * 0.06}s both` }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,107,53,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#ff6b35", position: "relative" }}>
                  {f.avatar}
                  <span style={{ position: "absolute", bottom: -2, right: -2, width: 12, height: 12, borderRadius: "50%", background: "#22c55e", border: "2.5px solid #141414" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: "#22c55e", marginTop: 2 }}>{f.status}</div>
                </div>
                <div style={{ fontSize: 12, color: "#555", background: "#1a1a1a", padding: "4px 10px", borderRadius: 8, border: "1px solid #252525" }}>{SPORT_ICONS[f.sport]}</div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#444", margin: "16px 0 10px", textTransform: "uppercase", letterSpacing: 1 }}>Offline</div>
            {MOCK_FRIENDS.filter(f => !f.online).map((f, i) => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#111", border: "1px solid #181818", borderRadius: 14, marginBottom: 8, opacity: 0.6, animation: `slideUp .4s ease ${i * 0.06 + 0.2}s both` }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#555" }}>{f.avatar}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#888" }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: "#444", marginTop: 2 }}>{f.status}</div>
                </div>
                <div style={{ fontSize: 12, color: "#444", background: "#151515", padding: "4px 10px", borderRadius: 8 }}>{SPORT_ICONS[f.sport]}</div>
              </div>
            ))}
          </div>
        )}

        {/* POST */}
        {tab === "post" && (
          <div style={{ animation: "fadeIn .3s ease" }}>
            {showPostSuccess ? (
              <div style={{ textAlign: "center", padding: "80px 20px", animation: "popIn .3s" }}>
                <div style={{ fontSize: 56 }}>🔥</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: "16px 0 6px" }}>Posted!</h2>
                <p style={{ color: "#888", fontSize: 14 }}>2hr window starts {postWhen === "now" ? "now" : "at game time"}.</p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 18px" }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Post a Game</h2>
                  <span style={{ fontSize: 12, color: "#555" }}>Up to 2 days out</span>
                </div>

                <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>Sport</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 18px" }}>
                  {SPORTS.filter(s => s !== "All").map(s => (
                    <button key={s} onClick={() => setPostSport(s)} style={{ padding: "8px 14px", borderRadius: 10, border: postSport === s ? "1.5px solid #ff6b35" : "1.5px solid #252525", background: postSport === s ? "rgba(255,107,53,.1)" : "#141414", color: postSport === s ? "#ff6b35" : "#888", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{SPORT_ICONS[s]} {s}</button>
                  ))}
                </div>

                <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>Location</label>
                <select value={postLocation} onChange={e => setPostLocation(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "#141414", border: "1.5px solid #252525", color: "#f0f0f0", fontSize: 14, margin: "8px 0 18px", outline: "none" }}>
                  {PARKS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>

                <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>When</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "8px 0 12px" }}>
                  {[
                    { id: "now", label: "🟢 Right Now" },
                    { id: "today", label: "📅 Later Today" },
                    { id: "tomorrow", label: "📅 Tomorrow" },
                    { id: "day2", label: "📅 In 2 Days" },
                  ].map(t => (
                    <button key={t.id} onClick={() => setPostWhen(t.id)} style={{
                      padding: "10px 0", borderRadius: 10,
                      border: postWhen === t.id ? "1.5px solid #ff6b35" : "1.5px solid #252525",
                      background: postWhen === t.id ? "rgba(255,107,53,.1)" : "#141414",
                      color: postWhen === t.id ? "#ff6b35" : "#888",
                      fontSize: 13, fontWeight: 600, cursor: "pointer"
                    }}>{t.label}</button>
                  ))}
                </div>
                {postWhen !== "now" && (
                  <div style={{ marginBottom: 18 }}>
                    <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>Game Time</label>
                    <input type="time" value={postCustomTime} onChange={e => setPostCustomTime(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "#141414", border: "1.5px solid #252525", color: "#f0f0f0", fontSize: 14, marginTop: 8, outline: "none" }} />
                  </div>
                )}

                <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>Have</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                      <button onClick={() => setPostPlayers(Math.max(1, postPlayers - 1))} style={{ width: 36, height: 36, borderRadius: 10, background: "#141414", border: "1.5px solid #252525", color: "#888", fontSize: 18, cursor: "pointer" }}>−</button>
                      <span style={{ fontSize: 20, fontWeight: 700, minWidth: 24, textAlign: "center" }}>{postPlayers}</span>
                      <button onClick={() => setPostPlayers(postPlayers + 1)} style={{ width: 36, height: 36, borderRadius: 10, background: "#141414", border: "1.5px solid #252525", color: "#888", fontSize: 18, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>Need</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                      <button onClick={() => setPostSpots(Math.max(0, postSpots - 1))} style={{ width: 36, height: 36, borderRadius: 10, background: "#141414", border: "1.5px solid #252525", color: "#888", fontSize: 18, cursor: "pointer" }}>−</button>
                      <span style={{ fontSize: 20, fontWeight: 700, minWidth: 24, textAlign: "center" }}>{postSpots}</span>
                      <button onClick={() => setPostSpots(postSpots + 1)} style={{ width: 36, height: 36, borderRadius: 10, background: "#141414", border: "1.5px solid #252525", color: "#888", fontSize: 18, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                </div>

                <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>Skill Level</label>
                <div style={{ display: "flex", gap: 8, margin: "8px 0 18px", flexWrap: "wrap" }}>
                  {SKILL_LEVELS.map(s => (
                    <button key={s} onClick={() => setPostSkill(s)} style={{ padding: "8px 14px", borderRadius: 10, border: postSkill === s ? "1.5px solid #ff6b35" : "1.5px solid #252525", background: postSkill === s ? "rgba(255,107,53,.1)" : "#141414", color: postSkill === s ? "#ff6b35" : "#888", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{s}</button>
                  ))}
                </div>

                <label style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>What's the move?</label>
                <textarea value={postNote} onChange={e => setPostNote(e.target.value)} placeholder="Running 5s at Highland, need 3 more..." rows={3} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "#141414", border: "1.5px solid #252525", color: "#f0f0f0", fontSize: 14, margin: "8px 0 20px", outline: "none", resize: "none", lineHeight: 1.5 }} />

                {checkedInAt === postLocation && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "8px 12px", borderRadius: 10, background: "rgba(34,197,94,.06)", border: "1px solid rgba(34,197,94,.15)" }}>
                    <span>✅</span>
                    <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>Checked in — post will be verified</span>
                  </div>
                )}

                <button onClick={handlePost} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: postNote.trim() ? "linear-gradient(135deg, #ff6b35, #e85d26)" : "#1a1a1a", color: postNote.trim() ? "#fff" : "#555", border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Post Game 🔥</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 420, background: "rgba(10,10,10,.92)", backdropFilter: "blur(20px)", borderTop: "1px solid #1a1a1a", display: "flex", justifyContent: "space-around", padding: "10px 0 28px" }}>
        {[
          { id: "feed", icon: "📡", label: "Feed" },
          { id: "trends", icon: "📊", label: "Trends" },
          { id: "post", icon: "➕", label: "Post" },
          { id: "friends", icon: "👥", label: "Crew" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: tab === t.id ? "#ff6b35" : "#555" }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* CHECK-IN FAB */}
      <button onClick={() => setShowCheckIn(true)} style={{ position: "fixed", bottom: 90, right: "calc(50% - 190px)", width: 52, height: 52, borderRadius: 16, background: checkedInAt ? "rgba(34,197,94,.15)" : "linear-gradient(135deg, #ff6b35, #e85d26)", border: checkedInAt ? "1.5px solid rgba(34,197,94,.3)" : "none", color: "#fff", fontSize: 22, cursor: "pointer", boxShadow: checkedInAt ? "none" : "0 4px 20px rgba(255,107,53,.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>📍</button>

      {showCheckIn && <CheckInModal onClose={() => setShowCheckIn(false)} onCheckIn={handleCheckIn} parks={PARKS} />}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} friends={MOCK_FRIENDS} />}
      {stillGoingGame && <StillGoingModal game={stillGoingGame} onExtend={handleExtend} onEnd={handleEndGame} onClose={() => setStillGoingGame(null)} />}
    </div>
  );
}
