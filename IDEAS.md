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
- ⬜ **Starter questline / tutorial** — funnels new players into shop/market/bosses.
- ⬜ **Physically scaling bosses (server-side)** — drive real in-world entity scale from per-tier `MarkerScale` so bigger map marker == bigger boss. Animals/simple entities scale cleanly via `transform.localScale` + network update (the "giant chicken" trick); humanoid Scientists are finicky (rig/anim/hitbox). Route: spawn a scalable creature boss (giant bear/boar) OR integrate EntityScaleManager (WhiteThunder), scaling the collider too so it stays hittable. Works on Oxide today (not Carbon-specific).
- ⬜ **Brainstorm 50 brand-new PvE ideas** — generate 50 creative PvE features NOT already listed anywhere in this file (check both the catalog and every section first to avoid repeats). Focus on things that make this server unlike the others. Append them as a new section ("## 💡 Fresh PvE ideas (batch 1)") — these are a backlog to pick from, do NOT build them, just write them down.

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
