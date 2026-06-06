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
    [Info("MonumentZombies", "SlayStudios", "1.0.0")]
    [Description("Spawns easy melee NPCs at monuments for PvE action, with respawns (NpcSpawn). Perf-safe: no per-tick work.")]
    public class MonumentZombies : RustPlugin
    {
        [PluginReference] private Plugin NpcSpawn;

        // ── Config ────────────────────────────────────────────────────────────
        private Configuration _cfg;

        private class Configuration
        {
            [JsonProperty("Enabled")] public bool Enabled { get; set; } = true;
            [JsonProperty("NPCs per monument")] public int PerMonument { get; set; } = 2;
            [JsonProperty("Total NPC cap (keep modest for performance)")] public int TotalCap { get; set; } = 30;
            [JsonProperty("Spawn radius around monument (m)")] public float SpawnRadius { get; set; } = 25f;
            [JsonProperty("Respawn delay after death (seconds)")] public float RespawnDelay { get; set; } = 300f;

            [JsonProperty("NPC name")] public string Name { get; set; } = "Ghoul";
            [JsonProperty("NPC health")] public float Health { get; set; } = 150f;
            [JsonProperty("Damage scale (lower = easier)")] public float DamageScale { get; set; } = 0.5f;
            [JsonProperty("Speed")] public float Speed { get; set; } = 5.5f;
            [JsonProperty("Roam range")] public float RoamRange { get; set; } = 15f;
            [JsonProperty("Chase range")] public float ChaseRange { get; set; } = 45f;
            [JsonProperty("Sense range")] public float SenseRange { get; set; } = 45f;
            [JsonProperty("Melee weapon shortname")] public string MeleeWeapon { get; set; } = "machete";

            [JsonProperty("Skip monuments whose name contains any of")]
            public List<string> ExcludeKeywords { get; set; } = new()
            {
                "Substation", "Cave", "Swamp", "Stable", "Lighthouse", "Fishing Village", "Outpost", "Bandit"
            };
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
        private readonly Dictionary<ulong, Vector3> _npcHome = new(); // netID -> monument center
        private readonly Dictionary<ulong, ScientistNPC> _npcs = new(); // netID -> npc (for cleanup)
        private int _alive;

        private void OnServerInitialized()
        {
            LoadConfig();
            if (!_cfg.Enabled) return;
            if (NpcSpawn == null)
            {
                PrintError("NpcSpawn is not loaded — install NpcSpawn.cs. MonumentZombies is disabled.");
                return;
            }
            // Delay so monuments/terrain are fully ready.
            timer.Once(15f, PopulateMonuments);
        }

        private void Unload()
        {
            foreach (var npc in _npcs.Values.ToList())
                if (npc != null && !npc.IsDestroyed) npc.Kill();
            _npcs.Clear();
            _npcHome.Clear();
        }

        // ── Spawning ──────────────────────────────────────────────────────────
        private void PopulateMonuments()
        {
            var monuments = TerrainMeta.Path?.Monuments;
            if (monuments == null) { Puts("[MonumentZombies] No monuments found."); return; }

            int spawned = 0;
            foreach (var m in monuments)
            {
                if (m == null) continue;
                string name = m.displayPhrase.english?.Trim() ?? "";
                if (string.IsNullOrEmpty(name)) continue; // skip unnamed (rocks, lakes)
                if (_cfg.ExcludeKeywords.Any(k => name.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0)) continue;

                for (int i = 0; i < _cfg.PerMonument && _alive < _cfg.TotalCap; i++)
                {
                    if (SpawnAt(m.transform.position)) spawned++;
                }
                if (_alive >= _cfg.TotalCap) break;
            }
            Puts($"[MonumentZombies] Spawned {spawned} NPCs across monuments (cap {_cfg.TotalCap}).");
        }

        private bool SpawnAt(Vector3 center)
        {
            var pos = GroundNear(center, _cfg.SpawnRadius);
            if (pos == Vector3.zero) return false;

            var npc = NpcSpawn.Call("SpawnNpc", pos, BuildConfig()) as ScientistNPC;
            if (npc == null) return false;

            ulong id = npc.net.ID.Value;
            _npcHome[id] = center;
            _npcs[id] = npc;
            _alive++;
            return true;
        }

        private JObject BuildConfig()
        {
            var belt = new JArray
            {
                new JObject { ["ShortName"] = _cfg.MeleeWeapon, ["Amount"] = 1, ["SkinID"] = 0UL, ["mods"] = new JArray(), ["Ammo"] = "" }
            };
            var wear = new JArray();
            foreach (var w in new[] { "burlap.shirt", "burlap.trousers" })
                wear.Add(new JObject { ["ShortName"] = w, ["SkinID"] = 0UL });

            return new JObject
            {
                ["Name"] = _cfg.Name,
                ["WearItems"] = wear,
                ["BeltItems"] = belt,
                ["Kit"] = "",
                ["Health"] = _cfg.Health,
                ["RoamRange"] = _cfg.RoamRange,
                ["ChaseRange"] = _cfg.ChaseRange,
                ["SenseRange"] = _cfg.SenseRange,
                ["ListenRange"] = _cfg.SenseRange / 2f,
                ["AttackRangeMultiplier"] = 1.5f,
                ["CheckVisionCone"] = false,
                ["VisionCone"] = 180f,
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
                ["MemoryDuration"] = 15f,
                ["States"] = new JArray { "RoamState", "ChaseState", "CombatState" }
            };
        }

        // ── Respawn on death ──────────────────────────────────────────────────
        private void OnEntityDeath(ScientistNPC scientist, HitInfo info)
        {
            if (scientist?.net == null) return;
            ulong id = scientist.net.ID.Value;
            if (!_npcHome.TryGetValue(id, out var home)) return;

            _npcHome.Remove(id);
            _npcs.Remove(id);
            _alive = Mathf.Max(0, _alive - 1);

            // Respawn one at the same monument after the delay (if under cap).
            timer.Once(_cfg.RespawnDelay, () =>
            {
                if (_cfg.Enabled && _alive < _cfg.TotalCap) SpawnAt(home);
            });
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private Vector3 GroundNear(Vector3 center, float radius)
        {
            for (int i = 0; i < 12; i++)
            {
                Vector2 r = UnityEngine.Random.insideUnitCircle * radius;
                var probe = new Vector3(center.x + r.x, 0f, center.z + r.y);
                float y = TerrainMeta.HeightMap.GetHeight(probe);
                var pos = new Vector3(probe.x, y, probe.z);
                if (y < TerrainMeta.WaterMap.GetHeight(pos)) continue; // underwater
                return pos;
            }
            return Vector3.zero;
        }
    }
}
