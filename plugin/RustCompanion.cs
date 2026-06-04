using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Libraries;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("RustCompanion", "SlayStudios", "1.0.0")]
    [Description("Streams live server data to a companion web dashboard")]
    public class RustCompanion : RustPlugin
    {
        // ── Config ────────────────────────────────────────────────────────────
        private Configuration _cfg;

        private class Configuration
        {
            [JsonProperty("Dashboard URL (no trailing slash)")]
            public string DashboardUrl { get; set; } = "http://localhost:3000";

            [JsonProperty("Plugin Secret (must match PLUGIN_SECRET env var)")]
            public string PluginSecret { get; set; } = "changeme";

            [JsonProperty("Update interval (seconds)")]
            public float UpdateInterval { get; set; } = 2f;

            [JsonProperty("Send player positions")]
            public bool SendPositions { get; set; } = true;

            [JsonProperty("Batch stat flush interval (seconds)")]
            public float StatFlushInterval { get; set; } = 10f;

            [JsonProperty("Map Image URL (overrides auto-render if set)")]
            public string MapImageUrl { get; set; } = "";

            [JsonProperty("Seconds to wait for world.rendermap to finish")]
            public float MapRenderWaitSeconds { get; set; } = 20f;

            [JsonProperty("Max map image dimension (px) before upload")]
            public int MapMaxDimension { get; set; } = 2048;

            [JsonProperty("Map JPEG quality (1-100)")]
            public int MapJpegQuality { get; set; } = 80;
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { _cfg = Config.ReadObject<Configuration>(); }
            catch { _cfg = new Configuration(); }
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_cfg);

        protected override void LoadDefaultConfig() => _cfg = new Configuration();

        // ── Stat deltas (accumulated between flushes) ─────────────────────────
        private readonly Dictionary<string, StatDelta> _pendingDeltas = new();
        private readonly List<KillEntry> _pendingKills = new();

        private class StatDelta
        {
            public string SteamId;
            public string Name;
            public int Kills, Deaths, Headshots;
            public int Wood, Stone, MetalOre, SulfurOre;
            public int StructuresPlaced, RocketsFired, C4Thrown;
            public int NpcKills, HeliHits, BradleyHits;
            public int Playtime; // seconds since last flush
        }

        private class KillEntry
        {
            public string KillerId, VictimId, Weapon;
            public bool Headshot;
            public long Timestamp;
            public float X, Z; // victim death position (for map death markers)
        }

        // ── Lifecycle ─────────────────────────────────────────────────────────
        private int _mapUploadAttempt = 0;

        private void OnServerInitialized()
        {
            LoadConfig();
            timer.Every(_cfg.UpdateInterval, SendLiveUpdate);
            timer.Every(_cfg.StatFlushInterval, FlushStats);
            timer.Every(60f, AccumulatePlaytime);
            if (string.IsNullOrEmpty(_cfg.MapImageUrl))
                timer.Once(60f, TryUploadMap);
            else
                Puts($"[RustCompanion] Using configured map image URL.");
            Puts($"[RustCompanion] Streaming to {_cfg.DashboardUrl}");
        }

        [ConsoleCommand("ruststats.uploadmap")]
        private void CmdUploadMap(ConsoleSystem.Arg arg)
        {
            if (!arg.IsAdmin) return;
            _mapUploadAttempt = 0;
            TryUploadMap();
        }

        private void Unload()
        {
            FlushStats();
        }

        // ── Map image render + upload ─────────────────────────────────────────
        // Rust's built-in `world.rendermap` renders the *currently loaded* world
        // (procedural OR custom mapstr.gg maps) to map_<size>_<seed>.png in the
        // server root. The render is a tight crop of the playable area with no
        // ocean margin, so world coords map onto it linearly (see LiveMap.tsx).
        private void TryUploadMap()
        {
            _mapUploadAttempt++;
            Puts($"[RustCompanion] Map render attempt {_mapUploadAttempt}: running world.rendermap...");

            // Snapshot the newest existing map_*.png so we can detect the fresh one.
            var before = LatestMapWriteTime();

            // Trigger the render on the server (runs async inside the engine).
            ConsoleSystem.Run(ConsoleSystem.Option.Server.Quiet(), "world.rendermap");

            // Poll for a newer/larger render to appear, then upload it.
            timer.Once(_cfg.MapRenderWaitSeconds, () => PickAndUploadMap(before, 0));
        }

        private void PickAndUploadMap(DateTime before, int polls)
        {
            var file = FindFreshMapFile(before);
            if (file == null)
            {
                if (polls < 6) // keep polling ~ another 30s
                {
                    timer.Once(5f, () => PickAndUploadMap(before, polls + 1));
                    return;
                }
                Puts("[RustCompanion] No map render found on disk. " +
                     "Verify the server can write to its root dir, or set Map Image URL in config.");
                RetryRenderOrGiveUp();
                return;
            }

            try
            {
                var raw = System.IO.File.ReadAllBytes(file);
                if (raw.Length < 1024)
                {
                    Puts("[RustCompanion] Map render too small, retrying...");
                    RetryRenderOrGiveUp();
                    return;
                }

                // The raw render is ~5000px / 20MB+ — far over Vercel's 4.5MB
                // serverless body limit. Downscale + JPEG-encode in-engine so the
                // payload is < 1MB. Linear scaling keeps coords aligned.
                byte[] bytes = DownscaleToJpg(raw, _cfg.MapMaxDimension, _cfg.MapJpegQuality) ?? raw;

                var base64 = Convert.ToBase64String(bytes);
                Puts($"[RustCompanion] Map {raw.Length / 1024}KB -> {bytes.Length / 1024}KB (jpg) from {System.IO.Path.GetFileName(file)}, uploading...");

                var json = JsonConvert.SerializeObject(new { mapImage = base64 });
                var headers = new Dictionary<string, string>
                {
                    ["Content-Type"] = "application/json",
                    ["x-plugin-secret"] = _cfg.PluginSecret
                };
                webrequest.Enqueue(
                    _cfg.DashboardUrl + "/api/map/upload",
                    json,
                    (code, res2) =>
                    {
                        if (code == 200) Puts("[RustCompanion] Map uploaded OK!");
                        else { Puts($"[RustCompanion] Map upload failed: {code} {res2}"); RetryRenderOrGiveUp(); }
                    },
                    this, RequestMethod.POST, headers, 120f
                );
            }
            catch (Exception ex)
            {
                Puts($"[RustCompanion] Map read/upload error: {ex.Message}");
                RetryRenderOrGiveUp();
            }
        }

        private void RetryRenderOrGiveUp()
        {
            if (_mapUploadAttempt < 5)
                timer.Once(60f, TryUploadMap);
            else
                Puts("[RustCompanion] Map upload failed after 5 attempts. Run 'ruststats.uploadmap' manually.");
        }

        // world.rendermap writes to the server root (current working dir).
        private static IEnumerable<string> MapSearchDirs()
        {
            yield return ".";
            string root = null;
            try { root = Interface.Oxide?.RootDirectory; } catch { }
            if (!string.IsNullOrEmpty(root)) yield return root;
        }

        private static IEnumerable<string> MapFiles()
        {
            var seen = new HashSet<string>();
            foreach (var dir in MapSearchDirs())
            {
                string[] files;
                try { files = System.IO.Directory.GetFiles(dir, "map_*.png"); }
                catch { continue; }
                foreach (var f in files)
                {
                    var full = System.IO.Path.GetFullPath(f);
                    if (seen.Add(full)) yield return full;
                }
            }
        }

        private static DateTime LatestMapWriteTime()
        {
            var latest = DateTime.MinValue;
            foreach (var f in MapFiles())
            {
                try { var t = System.IO.File.GetLastWriteTimeUtc(f); if (t > latest) latest = t; }
                catch { }
            }
            return latest;
        }

        // Newest map_*.png written after `before` (i.e. the render we just triggered).
        private static string FindFreshMapFile(DateTime before)
        {
            string best = null;
            var bestTime = before;
            foreach (var f in MapFiles())
            {
                try
                {
                    var t = System.IO.File.GetLastWriteTimeUtc(f);
                    if (t > bestTime) { bestTime = t; best = f; }
                }
                catch { }
            }
            return best;
        }

        // Decode PNG bytes, nearest-neighbour downscale to maxDim, re-encode JPEG.
        // CPU-only (LoadImage/GetPixels32/EncodeToJPG) so it works on headless
        // dedicated servers (-batchmode -nographics) with no GPU. Returns null on
        // failure so the caller can fall back to the raw bytes.
        private byte[] DownscaleToJpg(byte[] pngBytes, int maxDim, int quality)
        {
            Texture2D src = null, scaled = null;
            try
            {
                quality = Mathf.Clamp(quality, 1, 100);
                src = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!src.LoadImage(pngBytes)) return null;

                int sw = src.width, sh = src.height;
                int biggest = Mathf.Max(sw, sh);
                if (maxDim <= 0 || biggest <= maxDim)
                    return src.EncodeToJPG(quality); // already small enough

                float scale = (float)maxDim / biggest;
                int tw = Mathf.Max(1, Mathf.RoundToInt(sw * scale));
                int th = Mathf.Max(1, Mathf.RoundToInt(sh * scale));

                var srcPx = src.GetPixels32();
                var dstPx = new Color32[tw * th];
                for (int y = 0; y < th; y++)
                {
                    int sy = (int)((long)y * sh / th);
                    int srcRow = sy * sw;
                    int dstRow = y * tw;
                    for (int x = 0; x < tw; x++)
                    {
                        int sx = (int)((long)x * sw / tw);
                        dstPx[dstRow + x] = srcPx[srcRow + sx];
                    }
                }

                scaled = new Texture2D(tw, th, TextureFormat.RGBA32, false);
                scaled.SetPixels32(dstPx);
                scaled.Apply(false);
                return scaled.EncodeToJPG(quality);
            }
            catch (Exception ex)
            {
                Puts($"[RustCompanion] Downscale failed ({ex.Message}), using raw render.");
                return null;
            }
            finally
            {
                if (src != null) UnityEngine.Object.DestroyImmediate(src);
                if (scaled != null) UnityEngine.Object.DestroyImmediate(scaled);
            }
        }

        // ── Monuments (static — gathered once, sent so the web map can label them
        //    and so marker alignment can be visually verified) ──────────────────
        private List<object> _monumentsCache;

        private List<object> GetMonuments()
        {
            if (_monumentsCache != null) return _monumentsCache;

            var list = new List<object>();
            var monuments = TerrainMeta.Path?.Monuments;
            if (monuments != null)
            {
                foreach (var m in monuments)
                {
                    if (m == null) continue;
                    string name = m.displayPhrase.english;
                    if (string.IsNullOrEmpty(name)) continue;
                    name = name.Trim();
                    var pos = m.transform.position;
                    list.Add(new { name, x = pos.x, z = pos.z });
                }
            }

            // Only cache once monuments have actually loaded.
            if (list.Count > 0) _monumentsCache = list;
            return list;
        }

        // ── Live update (positions + events) ─────────────────────────────────
        private void SendLiveUpdate()
        {
            var payload = new Dictionary<string, object>();

            // Server info
            payload["server"] = new
            {
                name = ConVar.Server.hostname,
                ip = ConVar.Server.ip,
                port = ConVar.Server.port,
                online = BasePlayer.activePlayerList.Count,
                maxPlayers = ConVar.Server.maxplayers,
                mapSeed = World.Seed,
                mapSize = (int)World.Size,
                // Empty => site serves our self-hosted render from /api/map.
                // A configured override (MapImageUrl) is used verbatim instead.
                mapUrl = _cfg.MapImageUrl ?? "",
                wipeDate = ((DateTimeOffset)SaveRestore.SaveCreatedTime).ToUnixTimeSeconds(),
                updatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                // Identifies the current map save; when it changes the dashboard
                // starts a new wipe (resets "Current Wipe" leaderboard).
                wipeSig = $"{World.Seed}_{(int)World.Size}_{((DateTimeOffset)SaveRestore.SaveCreatedTime).ToUnixTimeSeconds()}",
                monuments = GetMonuments()
            };

            // Player positions
            if (_cfg.SendPositions)
            {
                var players = new List<object>();
                foreach (var p in BasePlayer.activePlayerList)
                {
                    var pos = p.transform.position;
                    players.Add(new
                    {
                        steamId = p.UserIDString,
                        name = p.displayName,
                        x = pos.x,
                        y = pos.y,
                        z = pos.z,
                        health = Mathf.RoundToInt(p.health),
                        online = true,
                        teamId = p.currentTeam > 0 ? (int?)p.currentTeam : null
                    });
                }
                payload["players"] = players;
            }

            // Active events
            var events = new List<object>();
            foreach (var heli in BaseNetworkable.serverEntities.OfType<PatrolHelicopter>())
            {
                var pos = heli.transform.position;
                events.Add(new { type = "heli", x = pos.x, y = pos.y, z = pos.z, health = Mathf.RoundToInt(heli.health), label = "Patrol Heli" });
            }
            foreach (var brad in BaseNetworkable.serverEntities.OfType<BradleyAPC>())
            {
                var pos = brad.transform.position;
                events.Add(new { type = "bradley", x = pos.x, y = pos.y, z = pos.z, health = Mathf.RoundToInt(brad.health), label = "Bradley APC" });
            }
            foreach (var cargo in BaseNetworkable.serverEntities.OfType<CargoShip>())
            {
                var pos = cargo.transform.position;
                events.Add(new { type = "cargo", x = pos.x, y = pos.y, z = pos.z, label = "Cargo Ship" });
            }
            foreach (var chinook in BaseNetworkable.serverEntities.OfType<CH47Helicopter>())
            {
                var pos = chinook.transform.position;
                events.Add(new { type = "chinook", x = pos.x, y = pos.y, z = pos.z, label = "Chinook" });
            }
            payload["events"] = events;

            PostAsync("/api/plugin", payload);
        }

        // ── Stat flush ────────────────────────────────────────────────────────
        private void FlushStats()
        {
            if (_pendingDeltas.Count == 0 && _pendingKills.Count == 0) return;

            var payload = new Dictionary<string, object>();

            var deltas = new List<object>();
            foreach (var kv in _pendingDeltas)
            {
                var d = kv.Value;
                deltas.Add(new
                {
                    steamId = d.SteamId,
                    name = d.Name,
                    kills = d.Kills,
                    deaths = d.Deaths,
                    headshots = d.Headshots,
                    wood = d.Wood,
                    stone = d.Stone,
                    metalOre = d.MetalOre,
                    sulfurOre = d.SulfurOre,
                    structuresPlaced = d.StructuresPlaced,
                    rocketsFired = d.RocketsFired,
                    c4Thrown = d.C4Thrown,
                    npcKills = d.NpcKills,
                    heliHits = d.HeliHits,
                    bradleyHits = d.BradleyHits,
                    playtime = d.Playtime
                });
            }
            payload["statDeltas"] = deltas;

            // Project to camelCase keys so the web route reads them correctly
            // (Json.NET would otherwise serialize the class fields as PascalCase).
            var kills = new List<object>();
            foreach (var k in _pendingKills)
            {
                kills.Add(new
                {
                    killerId = k.KillerId,
                    victimId = k.VictimId,
                    weapon = k.Weapon,
                    headshot = k.Headshot,
                    timestamp = k.Timestamp,
                    x = k.X,
                    z = k.Z
                });
            }
            payload["kills"] = kills;

            _pendingDeltas.Clear();
            _pendingKills.Clear();

            PostAsync("/api/plugin", payload);
        }

        // ── Stat helper ───────────────────────────────────────────────────────
        private StatDelta GetOrAdd(BasePlayer player)
        {
            if (!_pendingDeltas.TryGetValue(player.UserIDString, out var d))
            {
                d = new StatDelta { SteamId = player.UserIDString, Name = player.displayName };
                _pendingDeltas[player.UserIDString] = d;
            }
            d.Name = player.displayName; // keep name fresh
            return d;
        }

        // ── Hooks: PvP ────────────────────────────────────────────────────────
        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            if (entity == null || info == null) return;

            var victim = entity as BasePlayer;
            var killer = info.InitiatorPlayer;

            if (victim != null && killer != null && killer != victim)
            {
                // Player killed by player
                GetOrAdd(killer).Kills++;
                GetOrAdd(victim).Deaths++;
                if (info.isHeadshot) GetOrAdd(killer).Headshots++;

                var deathPos = victim.transform.position;
                _pendingKills.Add(new KillEntry
                {
                    KillerId = killer.UserIDString,
                    VictimId = victim.UserIDString,
                    Weapon = info.Weapon?.ShortPrefabName ?? "",
                    Headshot = info.isHeadshot,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    X = deathPos.x,
                    Z = deathPos.z
                });
            }
            else if (victim != null && (killer == null || killer == victim))
            {
                // Death (suicide / fall / fire)
                GetOrAdd(victim).Deaths++;
            }
        }

        // ── Hooks: NPC / Events ───────────────────────────────────────────────
        private void OnEntityDeath(NPCPlayer npc, HitInfo info)
        {
            if (info?.InitiatorPlayer == null) return;
            GetOrAdd(info.InitiatorPlayer).NpcKills++;
        }

        private void OnEntityTakeDamage(PatrolHelicopter heli, HitInfo info)
        {
            if (info?.InitiatorPlayer == null) return;
            GetOrAdd(info.InitiatorPlayer).HeliHits++;
        }

        private void OnEntityTakeDamage(BradleyAPC brad, HitInfo info)
        {
            if (info?.InitiatorPlayer == null) return;
            GetOrAdd(info.InitiatorPlayer).BradleyHits++;
        }

        // ── Hooks: Gathering ─────────────────────────────────────────────────
        private void OnDispenserGather(ResourceDispenser dispenser, BaseEntity entity, Item item)
        {
            var player = entity as BasePlayer;
            if (player == null || item == null) return;
            AddGatherStat(GetOrAdd(player), item.info.shortname, item.amount);
        }

        private void OnCollectiblePickup(CollectibleEntity collectible, BasePlayer player)
        {
            if (collectible?.itemList == null || player == null) return;
            var d = GetOrAdd(player);
            foreach (var itemAmount in collectible.itemList)
                AddGatherStat(d, itemAmount.itemDef.shortname, (int)itemAmount.amount);
        }

        private static void AddGatherStat(StatDelta d, string shortname, int amount)
        {
            switch (shortname)
            {
                case "wood": d.Wood += amount; break;
                case "stones": d.Stone += amount; break;
                case "metal.ore": d.MetalOre += amount; break;
                case "sulfur.ore": d.SulfurOre += amount; break;
            }
        }

        // ── Hooks: Building ───────────────────────────────────────────────────
        private void OnEntityBuilt(Planner planner, GameObject go)
        {
            var player = planner?.GetOwnerPlayer();
            if (player == null) return;
            GetOrAdd(player).StructuresPlaced++;
        }

        // ── Hooks: Explosives ─────────────────────────────────────────────────
        private void OnExplosiveThrown(BasePlayer player, BaseEntity entity)
        {
            if (player == null || entity == null) return;
            var name = entity.ShortPrefabName;
            var d = GetOrAdd(player);
            if (name.Contains("c4")) d.C4Thrown++;
        }

        private void OnRocketLaunched(BasePlayer player, BaseEntity entity)
        {
            if (player == null) return;
            GetOrAdd(player).RocketsFired++;
        }

        // ── Hooks: Playtime ───────────────────────────────────────────────────
        private void OnPlayerConnected(BasePlayer player)
        {
            // Flush connection event so the player appears in the DB quickly
            PostAsync("/api/plugin", new { players = new[] { new { steamId = player.UserIDString, name = player.displayName, x = 0f, y = 0f, z = 0f, health = 100, online = true } } });
        }

        // Add 60s of playtime for every connected player, once per minute.
        // Accumulated into the stat delta and flushed like every other stat.
        private void AccumulatePlaytime()
        {
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p == null || !p.IsConnected) continue;
                GetOrAdd(p).Playtime += 60;
            }
        }

        // ── HTTP helper ───────────────────────────────────────────────────────
        private void PostAsync(string path, object payload)
        {
            try
            {
                var json = JsonConvert.SerializeObject(payload);
                var bytes = Encoding.UTF8.GetBytes(json);
                var headers = new Dictionary<string, string>
                {
                    ["Content-Type"] = "application/json",
                    ["x-plugin-secret"] = _cfg.PluginSecret
                };

                webrequest.Enqueue(
                    _cfg.DashboardUrl + path,
                    json,
                    (code, response) =>
                    {
                        if (code != 200)
                            Puts($"[RustCompanion] POST {path} returned {code}: {response}");
                    },
                    this,
                    RequestMethod.POST,
                    headers,
                    60f
                );
            }
            catch (Exception ex)
            {
                Puts($"[RustCompanion] PostAsync error: {ex.Message}");
            }
        }
    }
}
