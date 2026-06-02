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

            [JsonProperty("Rust+ App Port (for map image)")]
            public int AppPort { get; set; } = 28082;

            [JsonProperty("Map Image URL (overrides auto-fetch if set)")]
            public string MapImageUrl { get; set; } = "";
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
        }

        // ── Lifecycle ─────────────────────────────────────────────────────────
        private int _mapUploadAttempt = 0;

        private void OnServerInitialized()
        {
            LoadConfig();
            timer.Every(_cfg.UpdateInterval, SendLiveUpdate);
            timer.Every(_cfg.StatFlushInterval, FlushStats);
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

        // ── Map image upload ──────────────────────────────────────────────────
        private void TryUploadMap()
        {
            _mapUploadAttempt++;
            Puts($"[RustCompanion] Map upload attempt {_mapUploadAttempt}...");
            System.Threading.Tasks.Task.Run(() =>
            {
                try
                {
                    var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(
                        $"http://localhost:{_cfg.AppPort}/map/api/v1/mapimageraw");
                    req.Timeout = 60000;
                    req.ReadWriteTimeout = 60000;

                    using (var resp = (System.Net.HttpWebResponse)req.GetResponse())
                    using (var stream = resp.GetResponseStream())
                    using (var ms = new System.IO.MemoryStream())
                    {
                        stream.CopyTo(ms);
                        var bytes = ms.ToArray();
                        if (bytes.Length < 100)
                        {
                            Puts("[RustCompanion] Map response too small, retrying in 60s...");
                            if (_mapUploadAttempt < 5) NextTick(() => timer.Once(60f, TryUploadMap));
                            return;
                        }

                        var base64 = Convert.ToBase64String(bytes);
                        Puts($"[RustCompanion] Map downloaded ({bytes.Length / 1024}KB), uploading...");

                        NextTick(() =>
                        {
                            var json = JsonConvert.SerializeObject(new { mapImage = base64 });
                            var headers = new Dictionary<string, string>
                            {
                                ["Content-Type"] = "application/json",
                                ["x-plugin-secret"] = _cfg.PluginSecret
                            };
                            webrequest.Enqueue(
                                _cfg.DashboardUrl + "/api/map/upload",
                                json,
                                (code, res2) => Puts(code == 200
                                    ? "[RustCompanion] Map uploaded OK!"
                                    : $"[RustCompanion] Map upload failed: {code} {res2}"),
                                this, RequestMethod.POST, headers, 120f
                            );
                        });
                    }
                }
                catch (Exception ex)
                {
                    Puts($"[RustCompanion] Map error (attempt {_mapUploadAttempt}): {ex.Message}");
                    if (_mapUploadAttempt < 5)
                        NextTick(() => timer.Once(60f, TryUploadMap));
                    else
                        Puts("[RustCompanion] Map upload failed after 5 attempts. Run 'ruststats.uploadmap' manually.");
                }
            });
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
                mapUrl = !string.IsNullOrEmpty(_cfg.MapImageUrl)
                    ? _cfg.MapImageUrl
                    : (!string.IsNullOrEmpty(ConVar.Server.levelurl)
                        ? ConVar.Server.levelurl.Replace(".map", ".png")
                        : $"https://rustmaps.com/img/maps/{World.Seed}_{(int)World.Size}_vegetation.png"),
                wipeDate = ((DateTimeOffset)SaveRestore.SaveCreatedTime).ToUnixTimeSeconds(),
                updatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
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
            payload["kills"] = _pendingKills;

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

                _pendingKills.Add(new KillEntry
                {
                    KillerId = killer.UserIDString,
                    VictimId = victim.UserIDString,
                    Weapon = info.Weapon?.ShortPrefabName ?? "",
                    Headshot = info.isHeadshot,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
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

        // Accumulate playtime when a player is online (called every StatFlushInterval)
        private void OnTick()
        {
            // We don't use OnTick for perf; playtime is approximated via flush interval
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
