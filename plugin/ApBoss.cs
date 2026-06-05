using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Oxide.Core;
using Oxide.Core.Libraries;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApBoss", "SlayStudios", "1.0.0")]
    [Description("Timed roaming boss event (NpcSpawn) with loot + Economics/ServerRewards rewards and dashboard boss-kill tracking")]
    public class ApBoss : RustPlugin
    {
        [PluginReference] private Plugin NpcSpawn, Economics, ServerRewards;

        // ── Config ────────────────────────────────────────────────────────────
        private Configuration _cfg;

        private class LootItem
        {
            [JsonProperty("Item shortname")] public string ShortName { get; set; } = "rifle.ak";
            [JsonProperty("Amount")] public int Amount { get; set; } = 1;
            [JsonProperty("Skin ID")] public ulong SkinID { get; set; } = 0;
        }

        private class Configuration
        {
            [JsonProperty("Spawn interval (minutes)")] public float SpawnIntervalMinutes { get; set; } = 75f;
            [JsonProperty("First spawn delay (minutes)")] public float FirstSpawnDelayMinutes { get; set; } = 10f;
            [JsonProperty("Despawn after (minutes, if not killed)")] public float DespawnMinutes { get; set; } = 20f;

            [JsonProperty("Boss display name")] public string BossName { get; set; } = "AP Warlord";
            [JsonProperty("Boss health")] public float Health { get; set; } = 5000f;
            [JsonProperty("Damage scale")] public float DamageScale { get; set; } = 1.5f;
            [JsonProperty("Roam range")] public float RoamRange { get; set; } = 60f;
            [JsonProperty("Chase range")] public float ChaseRange { get; set; } = 175f;
            [JsonProperty("Sense range")] public float SenseRange { get; set; } = 175f;
            [JsonProperty("Speed")] public float Speed { get; set; } = 7.5f;
            [JsonProperty("Kit name (optional, overrides default gear if set)")] public string Kit { get; set; } = "";

            [JsonProperty("Chat prefix")] public string ChatPrefix { get; set; } = "<color=#dc2626>[BOSS]</color>";
            [JsonProperty("Announce spawn")] public bool AnnounceSpawn { get; set; } = true;
            [JsonProperty("Announce kill")] public bool AnnounceKill { get; set; } = true;
            [JsonProperty("Discord webhook URL (optional)")] public string DiscordWebhook { get; set; } = "";

            [JsonProperty("Economics reward (to killer)")] public double EconomicsReward { get; set; } = 1000;
            [JsonProperty("ServerRewards points (to killer)")] public int ServerRewardsPoints { get; set; } = 500;

            [JsonProperty("Loot crate prefab")] public string LootCratePrefab { get; set; } =
                "assets/prefabs/deployable/chinookcrate/codelockedhackablecrate.prefab";
            [JsonProperty("Bonus loot items (added to the crate)")] public List<LootItem> BonusLoot { get; set; } = new()
            {
                new LootItem { ShortName = "rifle.ak", Amount = 1 },
                new LootItem { ShortName = "explosive.timed", Amount = 4 },
                new LootItem { ShortName = "scrap", Amount = 500 },
            };

            [JsonProperty("Report boss kills to dashboard (RustCompanion)")] public bool ReportToDashboard { get; set; } = true;
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

        // ── State ─────────────────────────────────────────────────────────────
        private ScientistNPC _boss;
        private ulong _bossNetId;
        private Timer _despawnTimer;

        private void OnServerInitialized()
        {
            LoadConfig();
            if (NpcSpawn == null)
            {
                PrintError("NpcSpawn is not loaded — install NpcSpawn.cs. ApBoss is disabled until then.");
                return;
            }
            timer.Once(_cfg.FirstSpawnDelayMinutes * 60f, () =>
            {
                TrySpawnBoss();
                timer.Every(_cfg.SpawnIntervalMinutes * 60f, () => TrySpawnBoss());
            });
            Puts($"[ApBoss] Ready. Boss spawns every {_cfg.SpawnIntervalMinutes} min.");
        }

        private void Unload() => RemoveBoss(false);

        // ── Commands ──────────────────────────────────────────────────────────
        [ChatCommand("apboss")]
        private void CmdApBoss(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin) { player.ChatMessage("You don't have permission."); return; }
            var sub = args.Length > 0 ? args[0].ToLower() : "";
            if (sub == "spawn") { TrySpawnBoss(true); }
            else if (sub == "despawn") { RemoveBoss(false); player.ChatMessage("[ApBoss] Boss removed."); }
            else if (sub == "where" && Alive(_boss)) { player.ChatMessage($"[ApBoss] Boss at {GridFromPos(_boss.transform.position)}"); }
            else player.ChatMessage("Usage: /apboss spawn | despawn | where");
        }

        // ── Spawning ──────────────────────────────────────────────────────────
        private void TrySpawnBoss(bool force = false)
        {
            if (NpcSpawn == null) return;
            if (Alive(_boss))
            {
                if (!force) return; // one boss at a time
                RemoveBoss(false);
            }

            var pos = FindSpawnPosition();
            if (pos == Vector3.zero)
            {
                Puts("[ApBoss] Could not find a valid spawn position, will retry next cycle.");
                return;
            }

            var npc = NpcSpawn.Call("SpawnNpc", pos, BuildBossConfig()) as ScientistNPC;
            if (npc == null)
            {
                PrintError("[ApBoss] NpcSpawn returned null — check NpcSpawn config/version.");
                return;
            }

            _boss = npc;
            _bossNetId = npc.net.ID.Value;

            string grid = GridFromPos(pos);
            if (_cfg.AnnounceSpawn)
            {
                Broadcast($"💀 <color=#dc2626>{_cfg.BossName}</color> has appeared at <color=#fbbf24>{grid}</color>! Hunt it down for rewards.");
                SendDiscord($"💀 **{_cfg.BossName}** has spawned at **{grid}**.");
            }

            _despawnTimer?.Destroy();
            _despawnTimer = timer.Once(_cfg.DespawnMinutes * 60f, () =>
            {
                if (Alive(_boss))
                {
                    if (_cfg.AnnounceSpawn)
                        Broadcast($"<color=#dc2626>{_cfg.BossName}</color> has vanished. Better luck next time.");
                    RemoveBoss(true);
                }
            });
        }

        private JObject BuildBossConfig()
        {
            var belt = new JArray();
            var wear = new JArray();
            if (string.IsNullOrEmpty(_cfg.Kit))
            {
                belt.Add(new JObject { ["ShortName"] = "rifle.ak", ["Amount"] = 1, ["SkinID"] = 0UL, ["mods"] = new JArray(), ["Ammo"] = "ammo.rifle" });
                foreach (var w in new[] { "metal.facemask", "metal.plate.torso", "roadsign.kilt", "pants", "tactical.gloves" })
                    wear.Add(new JObject { ["ShortName"] = w, ["SkinID"] = 0UL });
            }

            return new JObject
            {
                ["Name"] = _cfg.BossName,
                ["WearItems"] = wear,
                ["BeltItems"] = belt,
                ["Kit"] = _cfg.Kit ?? "",
                ["Health"] = _cfg.Health,
                ["RoamRange"] = _cfg.RoamRange,
                ["ChaseRange"] = _cfg.ChaseRange,
                ["SenseRange"] = _cfg.SenseRange,
                ["ListenRange"] = _cfg.SenseRange / 2f,
                ["AttackRangeMultiplier"] = 2f,
                ["CheckVisionCone"] = false,
                ["VisionCone"] = 135f,
                ["HostileTargetsOnly"] = false,
                ["DamageScale"] = _cfg.DamageScale,
                ["TurretDamageScale"] = 1f,
                ["AimConeScale"] = 1f,
                ["DisableRadio"] = true,
                ["CanRunAwayWater"] = true,
                ["CanSleep"] = false,
                ["SleepDistance"] = 100f,
                ["Speed"] = _cfg.Speed,
                ["AreaMask"] = 1,
                ["AgentTypeID"] = -1372625422,
                ["HomePosition"] = string.Empty,
                ["MemoryDuration"] = 30f,
                ["States"] = new JArray { "RoamState", "ChaseState", "CombatState" }
            };
        }

        // ── Death / rewards ───────────────────────────────────────────────────
        private void OnEntityDeath(ScientistNPC scientist, HitInfo info)
        {
            if (scientist == null || scientist.net == null) return;
            if (scientist.net.ID.Value != _bossNetId) return;

            _bossNetId = 0;
            _boss = null;
            _despawnTimer?.Destroy();

            var pos = scientist.transform.position;
            var killer = info?.InitiatorPlayer;
            string grid = GridFromPos(pos);

            // Loot
            SpawnLoot(pos);

            // Rewards + announce
            if (killer != null)
            {
                if (_cfg.EconomicsReward > 0)
                    Economics?.Call("Deposit", killer.UserIDString, _cfg.EconomicsReward);
                if (_cfg.ServerRewardsPoints > 0)
                    ServerRewards?.Call("AddPoints", killer.userID, _cfg.ServerRewardsPoints);

                if (_cfg.ReportToDashboard)
                    Interface.CallHook("OnApBossKilled", killer, _cfg.BossName);

                killer.ChatMessage($"You slew the {_cfg.BossName}! Rewards delivered. Loot dropped at {grid}.");
                if (_cfg.AnnounceKill)
                {
                    Broadcast($"⚔️ <color=#34d399>{killer.displayName}</color> slew <color=#dc2626>{_cfg.BossName}</color> at <color=#fbbf24>{grid}</color>!");
                    SendDiscord($"⚔️ **{killer.displayName}** killed **{_cfg.BossName}** at **{grid}**.");
                }
            }
            else if (_cfg.AnnounceKill)
            {
                Broadcast($"<color=#dc2626>{_cfg.BossName}</color> was destroyed. Loot dropped at <color=#fbbf24>{grid}</color>.");
            }
        }

        private void SpawnLoot(Vector3 pos)
        {
            try
            {
                var crate = GameManager.server.CreateEntity(_cfg.LootCratePrefab, pos + Vector3.up * 0.5f, Quaternion.identity);
                if (crate == null) return;
                crate.Spawn();

                var container = (crate as StorageContainer)?.inventory;
                if (container != null)
                {
                    foreach (var li in _cfg.BonusLoot)
                    {
                        if (string.IsNullOrEmpty(li.ShortName) || li.Amount <= 0) continue;
                        var item = ItemManager.CreateByName(li.ShortName, li.Amount, li.SkinID);
                        if (item == null) continue;
                        if (!item.MoveToContainer(container)) item.Drop(pos + Vector3.up, Vector3.up);
                    }
                }
            }
            catch (Exception ex)
            {
                PrintError($"[ApBoss] Loot spawn failed: {ex.Message}");
            }
        }

        private void RemoveBoss(bool announced)
        {
            _despawnTimer?.Destroy();
            _despawnTimer = null;
            _bossNetId = 0;
            if (Alive(_boss)) _boss.Kill();
            _boss = null;
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private static bool Alive(BaseEntity e) => e != null && !e.IsDestroyed;

        private Vector3 FindSpawnPosition()
        {
            float size = (float)World.Size;
            float half = size / 2f * 0.85f; // keep away from the very edge
            int badMask = (int)(TerrainTopology.Enum.Ocean | TerrainTopology.Enum.Lake |
                TerrainTopology.Enum.River | TerrainTopology.Enum.Offshore |
                TerrainTopology.Enum.Monument | TerrainTopology.Enum.Building |
                TerrainTopology.Enum.Cliff | TerrainTopology.Enum.Mountain);

            for (int i = 0; i < 40; i++)
            {
                float x = UnityEngine.Random.Range(-half, half);
                float z = UnityEngine.Random.Range(-half, half);
                var probe = new Vector3(x, 0f, z);
                float y = TerrainMeta.HeightMap.GetHeight(probe);
                var pos = new Vector3(x, y, z);

                if (y < TerrainMeta.WaterMap.GetHeight(pos)) continue; // underwater
                if ((TerrainMeta.TopologyMap.GetTopology(pos) & badMask) != 0) continue;
                return pos;
            }
            return Vector3.zero;
        }

        // Rust grid label (matches in-game / GridAPI): count = floor(size/(1024/7)),
        // cell = size/count, column letters + 0-indexed row from the north edge.
        private string GridFromPos(Vector3 pos)
        {
            float size = (float)World.Size;
            int n = Mathf.Max(1, Mathf.FloorToInt(size / (1024f / 7f)));
            float cell = size / n;
            float half = size / 2f;
            int col = Mathf.Clamp(Mathf.FloorToInt((pos.x + half) / cell), 0, n - 1);
            int row = Mathf.Clamp(Mathf.FloorToInt((half - pos.z) / cell), 0, n - 1);
            return ColLabel(col) + row;
        }

        private static string ColLabel(int i)
        {
            string s = "";
            i++;
            while (i > 0) { int r = (i - 1) % 26; s = (char)('A' + r) + s; i = (i - 1) / 26; }
            return s;
        }

        private void Broadcast(string msg) => PrintToChat($"{_cfg.ChatPrefix} {msg}");

        private void SendDiscord(string content)
        {
            if (string.IsNullOrEmpty(_cfg.DiscordWebhook)) return;
            var payload = JsonConvert.SerializeObject(new { content });
            webrequest.Enqueue(_cfg.DiscordWebhook, payload,
                (code, resp) => { }, this, RequestMethod.POST,
                new Dictionary<string, string> { ["Content-Type"] = "application/json" }, 30f);
        }
    }
}
