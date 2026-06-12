using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Oxide.Core;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApElites", "SlayStudios", "1.0.0")]
    [Description("Rare elite modifier NPCs (Sprinter/Bomber/Regenerator) with guaranteed drops, announced at a grid")]
    public class ApElites : RustPlugin
    {
        [PluginReference] private Plugin NpcSpawn, ServerRewards;

        private Configuration _cfg;

        private class LootItem
        {
            [JsonProperty("Item shortname")] public string ShortName { get; set; } = "scrap";
            [JsonProperty("Amount")] public int Amount { get; set; } = 100;
            [JsonProperty("Skin ID")] public ulong SkinID { get; set; } = 0;
        }

        private class EliteType
        {
            [JsonProperty("Name")] public string Name { get; set; } = "Elite Sprinter";
            [JsonProperty("Colour (hex)")] public string Color { get; set; } = "#34d399";
            [JsonProperty("Spawn weight")] public float Weight { get; set; } = 1f;
            [JsonProperty("Health")] public float Health { get; set; } = 400f;
            [JsonProperty("Speed")] public float Speed { get; set; } = 8.5f;
            [JsonProperty("Damage scale")] public float DamageScale { get; set; } = 1f;
            [JsonProperty("Heal per second (Regenerator-style, 0 = off)")] public float HealPerSecond { get; set; } = 0f;
            [JsonProperty("ServerRewards RP for the kill")] public int Reward { get; set; } = 100;
            [JsonProperty("Guaranteed drops")] public List<LootItem> Loot { get; set; } = new();
        }

        private class Configuration
        {
            [JsonProperty("Spawn check interval (minutes)")] public float IntervalMinutes { get; set; } = 25f;
            [JsonProperty("Spawn chance per check (0-1)")] public float Chance { get; set; } = 0.5f;
            [JsonProperty("First check delay (minutes)")] public float FirstDelayMinutes { get; set; } = 8f;
            [JsonProperty("Despawn after (minutes, if not killed)")] public float DespawnMinutes { get; set; } = 12f;
            [JsonProperty("Chat prefix")] public string ChatPrefix { get; set; } = "<color=#a78bfa>[ELITE]</color>";
            [JsonProperty("Announce")] public bool Announce { get; set; } = true;
            [JsonProperty("Elite types")] public List<EliteType> Types { get; set; } = new()
            {
                new EliteType { Name = "Elite Sprinter", Color = "#34d399", Weight = 1f, Health = 400f, Speed = 10f, DamageScale = 1f, Reward = 100,
                    Loot = new() { new LootItem { ShortName = "scrap", Amount = 150 }, new LootItem { ShortName = "lowgradefuel", Amount = 100 } } },
                new EliteType { Name = "Elite Bomber", Color = "#f97316", Weight = 1f, Health = 500f, Speed = 6.5f, DamageScale = 1.6f, Reward = 125,
                    Loot = new() { new LootItem { ShortName = "scrap", Amount = 150 }, new LootItem { ShortName = "explosive.timed", Amount = 1 } } },
                new EliteType { Name = "Elite Regenerator", Color = "#60a5fa", Weight = 1f, Health = 600f, Speed = 6.5f, DamageScale = 1.1f, HealPerSecond = 8f, Reward = 150,
                    Loot = new() { new LootItem { ShortName = "scrap", Amount = 200 }, new LootItem { ShortName = "largemedkit", Amount = 3 } } },
            };
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { _cfg = Config.ReadObject<Configuration>(); }
            catch { _cfg = new Configuration(); }
            if (_cfg.Types == null || _cfg.Types.Count == 0) _cfg.Types = new Configuration().Types;
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_cfg);
        protected override void LoadDefaultConfig() => _cfg = new Configuration();

        // ── State ─────────────────────────────────────────────────────────────
        private ScientistNPC _elite;
        private ulong _eliteNetId;
        private EliteType _type;
        private Timer _despawnTimer;
        private Timer _healTimer;

        private void OnServerInitialized()
        {
            LoadConfig();
            if (NpcSpawn == null) { PrintError("NpcSpawn not loaded — ApElites disabled."); return; }
            timer.Once(_cfg.FirstDelayMinutes * 60f, () =>
            {
                TrySpawn();
                timer.Every(_cfg.IntervalMinutes * 60f, () => TrySpawn());
            });
            Puts($"[ApElites] Ready. {_cfg.Types.Count} elite types, check every {_cfg.IntervalMinutes} min.");
        }

        private void Unload() => RemoveElite();

        [ChatCommand("apelite")]
        private void CmdApElite(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin) { player.ChatMessage("You don't have permission."); return; }
            var sub = args.Length > 0 ? args[0].ToLower() : "";
            if (sub == "spawn")
            {
                EliteType forced = args.Length > 1
                    ? _cfg.Types.FirstOrDefault(t => t.Name.Replace(" ", "").ToLower().Contains(args[1].ToLower()))
                    : null;
                TrySpawn(true, forced);
            }
            else if (sub == "despawn") { RemoveElite(); player.ChatMessage("[ApElites] Elite removed."); }
            else if (sub == "where" && Alive(_elite)) player.ChatMessage($"[ApElites] {_type?.Name} at {GridFromPos(_elite.transform.position)}");
            else player.ChatMessage("Usage: /apelite spawn [type] | despawn | where");
        }

        // ── Spawning ──────────────────────────────────────────────────────────
        private void TrySpawn(bool force = false, EliteType forced = null)
        {
            if (NpcSpawn == null) return;
            if (Alive(_elite)) { if (!force) return; RemoveElite(); }
            if (!force && UnityEngine.Random.value > Mathf.Clamp01(_cfg.Chance)) return;

            var type = forced ?? PickType();
            if (type == null) return;

            var pos = FindSpawnPosition();
            if (pos == Vector3.zero) return;

            var npc = NpcSpawn.Call("SpawnNpc", pos, BuildConfig(type)) as ScientistNPC;
            if (npc == null) { PrintError("[ApElites] NpcSpawn returned null."); return; }

            _elite = npc;
            _eliteNetId = npc.net.ID.Value;
            _type = type;

            if (type.HealPerSecond > 0f)
            {
                _healTimer?.Destroy();
                _healTimer = timer.Every(1f, () =>
                {
                    if (Alive(_elite) && _elite.health < _elite.MaxHealth())
                        _elite.Heal(type.HealPerSecond);
                });
            }

            string grid = GridFromPos(pos);
            if (_cfg.Announce)
                Broadcast($"⚡ <color={type.Color}>{type.Name}</color> spotted at <color=#fbbf24>{grid}</color> — guaranteed drop for whoever takes it down!");

            _despawnTimer?.Destroy();
            _despawnTimer = timer.Once(_cfg.DespawnMinutes * 60f, () =>
            {
                if (Alive(_elite))
                {
                    if (_cfg.Announce) Broadcast($"<color={_type.Color}>{_type.Name}</color> slipped away…");
                    RemoveElite();
                }
            });
        }

        private EliteType PickType()
        {
            float total = _cfg.Types.Sum(t => Mathf.Max(0f, t.Weight));
            if (total <= 0f) return _cfg.Types.FirstOrDefault();
            float roll = UnityEngine.Random.Range(0f, total);
            foreach (var t in _cfg.Types)
            {
                roll -= Mathf.Max(0f, t.Weight);
                if (roll <= 0f) return t;
            }
            return _cfg.Types.Last();
        }

        private JObject BuildConfig(EliteType type)
        {
            var belt = new JArray
            {
                new JObject { ["ShortName"] = "smg.mp5", ["Amount"] = 1, ["SkinID"] = 0UL, ["mods"] = new JArray(), ["Ammo"] = "ammo.pistol" }
            };
            var wear = new JArray();
            foreach (var w in new[] { "metal.facemask", "roadsign.jacket", "pants", "shoes.boots" })
                wear.Add(new JObject { ["ShortName"] = w, ["SkinID"] = 0UL });

            return new JObject
            {
                ["Name"] = type.Name,
                ["WearItems"] = wear,
                ["BeltItems"] = belt,
                ["Kit"] = "",
                ["Health"] = type.Health,
                ["RoamRange"] = 50f,
                ["ChaseRange"] = 130f,
                ["SenseRange"] = 130f,
                ["ListenRange"] = 65f,
                ["AttackRangeMultiplier"] = 2f,
                ["CheckVisionCone"] = false,
                ["VisionCone"] = 135f,
                ["HostileTargetsOnly"] = false,
                ["DamageScale"] = type.DamageScale,
                ["TurretDamageScale"] = 1f,
                ["AimConeScale"] = 1.2f,
                ["DisableRadio"] = true,
                ["CanRunAwayWater"] = true,
                ["CanSleep"] = false,
                ["SleepDistance"] = 100f,
                ["Speed"] = type.Speed,
                ["AreaMask"] = 1,
                ["AgentTypeID"] = -1372625422,
                ["HomePosition"] = string.Empty,
                ["MemoryDuration"] = 30f,
                ["States"] = new JArray { "RoamState", "ChaseState", "CombatState" }
            };
        }

        // ── Death ─────────────────────────────────────────────────────────────
        private void OnEntityDeath(ScientistNPC npc, HitInfo info)
        {
            if (npc == null || npc.net == null || npc.net.ID.Value != _eliteNetId) return;

            var type = _type;
            var pos = npc.transform.position;
            var killer = info?.InitiatorPlayer;
            string grid = GridFromPos(pos);

            _eliteNetId = 0;
            _elite = null;
            _type = null;
            _despawnTimer?.Destroy();
            _healTimer?.Destroy();
            _healTimer = null;

            // Guaranteed drops, straight on the ground where it died.
            if (type != null)
            {
                foreach (var li in type.Loot)
                {
                    if (string.IsNullOrEmpty(li.ShortName) || li.Amount <= 0) continue;
                    var item = ItemManager.CreateByName(li.ShortName, li.Amount, li.SkinID);
                    item?.Drop(pos + Vector3.up * 0.5f, Vector3.up);
                }
            }

            if (killer != null && type != null)
            {
                if (type.Reward > 0) ServerRewards?.Call("AddPoints", killer.userID, type.Reward);
                killer.ChatMessage($"{_cfg.ChatPrefix} You took down the {type.Name}! +{type.Reward} RP, loot dropped.");
                if (_cfg.Announce)
                    Broadcast($"⚡ <color=#34d399>{killer.displayName}</color> took down <color={type.Color}>{type.Name}</color> at <color=#fbbf24>{grid}</color>!");
            }
        }

        private void RemoveElite()
        {
            _despawnTimer?.Destroy();
            _despawnTimer = null;
            _healTimer?.Destroy();
            _healTimer = null;
            _eliteNetId = 0;
            _type = null;
            if (Alive(_elite)) _elite.Kill();
            _elite = null;
        }

        // ── Helpers (same proven patterns as ApBoss) ───────────────────────────
        private static bool Alive(BaseEntity e) => e != null && !e.IsDestroyed;

        private Vector3 FindSpawnPosition()
        {
            float size = (float)World.Size;
            float half = size / 2f * 0.85f;
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
                if (y < TerrainMeta.WaterMap.GetHeight(pos)) continue;
                if ((TerrainMeta.TopologyMap.GetTopology(pos) & badMask) != 0) continue;
                return pos;
            }
            return Vector3.zero;
        }

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
    }
}
