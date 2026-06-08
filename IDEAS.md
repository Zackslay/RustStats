# SlayStudios / AP PvE — Server Ideas & Roadmap

Tracking file for unique-server features. Status: ⬜ todo · 🔨 in progress · ✅ done

The server's edge is the **live web dashboard** (real-time map, leaderboards, profiles,
economy). Prioritize features that exploit web↔game integration — others can't easily copy them.

---

## 🔨 Adding next (current focus)
- ✅ **Community tech tree** — `/tech` page: server-wide goal nodes + live progress + perks (dashboard-driven; perks applied by admin on unlock for now).
- ✅ **Death heatmap** — `/api/heatmap` + Deaths Heat toggle on the map (binned cells from kill_log).
- ✅ **Activity heatmaps** — throttled position sampling into heat_grid; Activity toggle on the map.
- ✅ **Player timeline on profiles** — "Joined" date + existing badge/milestone system.
- ✅ **Roaming merchant NPC** — `ApMerchant.cs`: invulnerable passive trader, relocates every 30 min, shown on the live map ($ event marker); `/trade` nearby gives a daily RP bonus + opens the shop; `/merchant` reports its grid.
- ✅ **Base vending district** — `RustCompanion` relays broadcasting player vending machines → `/api/shops` → Shops toggle on the map ($ markers, name on hover).

## ⏭️ Secondary next up
- ✅ **"Hold the monument" wave defense** — `ApSiege.cs`: escalating NPC waves (scaling count/health/damage) at a random monument; clear all waves → reward vault + RP/Economics for defenders. Live-map "siege" event (orange pulsing `!`).
- ✅ **Dynamic commodity prices** — ApAuction reports each sale (`OnApMarketSale`) → RustCompanion buffers/relays → `market_trades` table → `/market` page: live RP/unit price, 7-day change, volume, and a sparkline per commodity.
- ✅ **Starter questline / tutorial** — `ApQuests.cs`: ordered new-player funnel (gather wood → gather stone → hunt an animal → kill 3 scientists → place a TC) with per-step ServerRewards RP + a final bonus; CUI progress panel via `/quests`; per-player progress persisted to `oxide/data/ApQuests.json`; welcome nudge on connect.
- ✅ **Physically scaling bosses (server-side)** — `ApBoss.ApplyPhysicalScale()`: drives the boss's real in-world size from its tier `MarkerScale` (× a config multiplier). Prefers `EntityScaleManager.API_ScaleEntity` (reliable client replication + collider resize for humanoid NPCs); falls back to `transform.localScale` + `SendNetworkUpdateImmediate`. Toggle: "Apply physical (in-world) boss scaling". Bigger marker == bigger boss.
- ✅ **Brainstorm 50 brand-new PvE ideas** — 50 fresh, non-duplicate ideas added below in "## 💡 Fresh PvE ideas (batch 1)" (8 categories; backlog only, not built).

## 🌅 Future idea list
- ⬜ **Faction / territory war (living world)** — NPC factions hold monuments; players tip the balance; territory shaded on the live map.
- ⬜ **Treasure hunts** — clue drops point to buried loot at a grid; announced live.
- ⬜ **Meteor showers** — timed sulfur/metal node rain in a region, flagged on the map.
- ⬜ **Escort missions** — protect an NPC convoy A→B; route + progress on the map.
- ⬜ **Activity masteries** — Mining/Hunting/Building mastery levels with perks.
- ⬜ **Daily streaks** — escalating daily rewards (web-claimable).
- ⬜ **Danger zones** — map regions tiered easy→hardcore (better loot deeper); shaded on the live map.
- ⬜ **"Wipe Wrapped"** — Spotify-Wrapped-style personal wipe recap (shareable).
- ⬜ **Crafting commissions** — players post resource requests + RP bounty; others fulfill.
- ⬜ **First-24h boost** — accelerated early progression for new players.
- ⬜ **Random world modifiers** — rotating buffs ("Double Gather Hour", "Boss Frenzy") with dashboard countdowns.

---

## 💡 Full brainstorm catalog (parking lot)

### Dashboard / web↔game (the moat)
- Web-claimable daily rewards (log in on site → claim in game)
- Bounty board (post RP bounties on targets/objectives from the site)
- Server-wide community goals (live progress bar → unlock event)
- Achievements & titles from tracked stats (badges on profiles, chat tags)
- Live world-boss health bar on the map
- Fantasy/predictions (pick the wipe's top player → win RP)
- Event ticker + countdown timers (next boss/horde/modifier)
- PWA / mobile companion + push alerts for boss spawns
- Discord stats bot (`!stats <name>`), auto-clip big moments to Discord
- OBS overlay (browser source) for streamers; viewer-funded care packages
- Player journey/timeline; "find my body" + death recap

### PvE combat content
- Tiered roaming bosses (DONE: ApBoss) + raid boss with mechanics (enrage, shields, adds)
- Monument clears / dungeons → reward chest
- Horde / Blood Moon nights (scheduled NPC surge)
- Convoy / armored events tuned for co-op
- Raidable abandoned bases (NPC-guarded loot)
- "Hold the monument" wave defense

### Progression & identity
- One themed skill tree (avoid plugin conflicts) + prestige
- Quests / daily-weekly missions on our stat tracking
- Jobs/professions (Miner/Hunter/Builder)
- Reputation/karma for helping newbies; mentor matchmaking
- Returning-player catch-up bonus

### Economy & sinks
- Player market (DONE: ApAuction) + auction bidding/buyout
- Vendor shop (ShopController, market button DONE)
- Dynamic commodity prices; rotating black-market stock
- RP casino (wheel/slots/coinflip); bank interest; daily lottery/raffle
- Cosmetics (animated tags, name colors, kill effects)
- Real estate / plot rent; base vending district

### Exploration & collectibles
- Hidden relics/shrines (dashboard "X/N found")
- Lore journals → unlock story + rewards
- Cartographer rewards (reveal % of map)
- Landmark photo spots + community gallery

### Activities / mini-games (dashboard leaderboards)
- PvE Colosseum/Arena (ranked wave-clear times)
- Race courses (minicopter/boat/car)
- Hunting/Fishing derbies; parkour courses

### World state / dynamic
- Random world modifiers; day/night gameplay; danger zones
- Wipe "seasons" (world escalates over the wipe)
- Weather/disaster events (radiation storms, fog)

### Community / social
- Clan leaderboards + clan PvE raids
- Hall of Fame / wipe archive
- Build-of-the-week (submit + vote on dashboard)
- Player government/mayor; guild halls / town centers

### QoL
- Loadout/kit favorites; shared XP / co-op revives; death recap

---

## 💡 Fresh PvE ideas (batch 1)

50 brand-new ideas (none duplicate the sections above). Backlog only — pick from these later; not built.

### PvE combat & enemies
1. ⬜ **Boss weak-points** — bosses spawn destructible armor plates; break them (segmented health bar on the dashboard) for bonus loot.
2. ⬜ **Adaptive difficulty** — NPC strength scales to the number of nearby players (solo-fair, group-hard).
3. ⬜ **Elite named NPCs** — rare modifier scientists (Regenerator / Bomber / Sprinter) with a guaranteed rare drop; announced.
4. ⬜ **Boss summoner adds** — bosses periodically spawn minion waves you must clear or get overwhelmed.
5. ⬜ **Tameable guard animals** — capture/feed a bear or wolf to defend your base from NPC raids.
6. ⬜ **NPC base raids** — periodic NPC squads assault player TCs (PvE raid pressure, no PvP); optional RP "raid insurance".
7. ⬜ **Underwater PvE wrecks** — diver NPCs guarding a sealed sunken vault.
8. ⬜ **Cave dungeon instances** — a sealed cave with a locked-door puzzle and a boss at the end.
9. ⬜ **Juggernaut patrol** — a lone heavy minigun NPC that drops a high-tier crate.
10. ⬜ **Radiation mutants** — irradiated animals in hot zones with toxic attacks and unique drops.

### Exploration & discovery
11. ⬜ **Metal-detector caches** — a detector item pings buried loot; dig to retrieve (new loop).
12. ⬜ **Wandering lore NPCs** — talk to them for chained map clues to the next treasure.
13. ⬜ **Shared team waypoints** — labeled pins visible both in-game and on the dashboard.
14. ⬜ **Message-in-a-bottle** — leave notes at coordinates others find; top-rated notes earn RP.
15. ⬜ **Constellation beacons** — align night beacons to match a sky pattern to unlock a cache.

### Economy & sinks
16. ⬜ **Commodity futures** — bet RP on item-price moves tracked by `/market` (web mini-game).
17. ⬜ **Item insurance** — pay RP to insure an item; refunded if you die to NPCs that wipe.
18. ⬜ **Public stockpile** — donate to a shared vault that funds server events; donors get perks.
19. ⬜ **Bank heist event** — a vault fills with RP over time; crack it (NPC-guarded) for the pot.
20. ⬜ **Pawn-shop sink** — sell junk for RP on a daily diminishing-returns curve (anti-flood).
21. ⬜ **Event crowdfunding** — the community pools RP to trigger a custom event ("fund a Heli night").

### Progression & identity
22. ⬜ **Auto playstyle tags** — the dashboard infers Sniper / Brawler / Farmer from your stats and badges you.
23. ⬜ **Stat-gated class loadouts** — unlock kit presets by how you play (enough animal kills → Hunter kit).
24. ⬜ **Title duels** — challenge a stat-title holder; whoever leads the stat by wipe-end keeps the title.
25. ⬜ **Legacy perks** — tiny permanent cross-wipe account bonuses (e.g. +1 starting bandage).
26. ⬜ **Rival matchmaking** — paired with a similar-stat player; weekly head-to-head scorecard on the site.

### Live events & world state
27. ⬜ **Earthquake** — a terrain hazard opens new resource fissures at a grid (dashboard-flagged).
28. ⬜ **Airdrop bidding war** — players bid RP for a head start on a contested supply drop.
29. ⬜ **Eclipse** — minutes of darkness; NPCs buffed, gather doubled (risk/reward).
30. ⬜ **Migrating herds** — large animal herds roam a dashboard-shown route (hunting goldmine).
31. ⬜ **Wildfire spread** — fire propagates across a biome; extinguish it for a community reward.
32. ⬜ **Power-grid puzzle** — restore power to a dark monument to unlock its loot server-wide.

### Community & social
33. ⬜ **Auto server newspaper** — a weekly dashboard recap (biggest kills, richest, drama).
34. ⬜ **Co-op build contracts** — post a build job; contributors split an RP cut.
35. ⬜ **Funded town vendor** — a community shop whose stock improves as players donate.
36. ⬜ **"What spawns next" poll** — a web vote picks the next boss/event to spawn in-game.
37. ⬜ **Anonymous gift drops** — send RP/items to a random new player; kindness leaderboard.
38. ⬜ **Server mascot** — a community-named roaming safe-zone animal; feeding it grants a server buff.

### QoL & dashboard tools
39. ⬜ **Upkeep tracker** — your TC upkeep/decay timer on the site with low-resource alerts.
40. ⬜ **Rescue beacon** — drop a beacon when stuck; players/admins see it on the live map.
41. ⬜ **Loot-table browser** — a searchable "what drops from X" reference on the dashboard.
42. ⬜ **Gather analytics** — personal resources/hour graphs and best-biome breakdown.
43. ⬜ **Boss-run scheduler** — a web tool to schedule a co-op boss run; pings the sign-ups.

### Signature / "not like the others"
44. ⬜ **Escaping world boss** — each time it survives its timer it grows stronger/bigger (ties into ApBoss scaling); tracked live on the dashboard.
45. ⬜ **Pity timer** — a guaranteed rare drop after N unlucky boss kills, tracked on your profile.
46. ⬜ **Server doom clock** — failed events advance a clock; at zero a global hard event fires (shared stakes).
47. ⬜ **NPC faction reputation** — befriend or anger factions; reputation shifts their vendor prices and aggression.
48. ⬜ **Death echoes** — replay-ghost markers of past notable kills/deaths on the map, each with its story.
49. ⬜ **PvE control points** — clear and hold a monument to claim it for your team, earning passive RP.
50. ⬜ **Cross-wipe meta-campaign** — each wipe is a "chapter" with a server objective; progress unlocks permanent dashboard lore/perks.
