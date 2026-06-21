using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Oxide.Core.Plugins;
using UnityEngine;
using UnityEngine.AI;

namespace Oxide.Plugins
{
    [Info("ApRaidCleanup", "SlayStudios", "1.4.0")]
    [Description("Fixes off-navmesh animals (FSMComponent.BudgetedUpdate NRE spam) by warping them back onto the navmesh — no culling, so no respawn loop")]
    public class ApRaidCleanup : RustPlugin
    {
        [PluginReference] private Plugin RaidableBases;

        private Configuration _cfg;

        private class Configuration
        {
            [JsonProperty("Janitor: periodically fix off-navmesh animals")] public bool Janitor { get; set; } = true;
            [JsonProperty("Janitor scan interval (seconds)")] public float JanitorInterval { get; set; } = 15f;
            [JsonProperty("Warp search radius (meters) — how far to look for navmesh")] public float WarpSearchRadius { get; set; } = 40f;
            [JsonProperty("Kill animals that have no navmesh within range (e.g. deep ocean)")] public bool KillIfNoNavmesh { get; set; } = true;
            [JsonProperty("Also sweep when a raid base spawns")] public bool RaidSweep { get; set; } = true;
            [JsonProperty("Raid base sweep radius (meters)")] public float Radius { get; set; } = 60f;
            [JsonProperty("Log activity")] public bool Log { get; set; } = true;
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

        private bool _janitorStarted;

        private void Loaded() => StartJanitor();
        private void OnServerInitialized() => StartJanitor();

        private void StartJanitor()
        {
            if (_janitorStarted) return;
            _janitorStarted = true;
            LoadConfig();
            if (!_cfg.Janitor) return;
            float interval = Mathf.Max(5f, _cfg.JanitorInterval);
            // Delay first sweep so the navmesh is fully built at boot (otherwise
            // every animal looks off-mesh). Use apraidcleanup.fix for an instant pass.
            timer.Once(45f, () =>
            {
                RunJanitor();
                timer.Every(interval, RunJanitor);
            });
            Puts($"[ApRaidCleanup] Janitor scheduled: first sweep in 45s, then every {interval}s.");
        }

        // ── Detection + repair ──────────────────────────────────────────────────
        private static bool IsBroken(BaseAnimalNPC a)
        {
            if (a == null || a.IsDestroyed) return false;
            var agent = a.GetComponent<NavMeshAgent>();
            if (agent == null) return true;          // no agent → brain has nothing to drive
            if (!agent.isOnNavMesh) return true;     // off the mesh → FSM NREs every frame
            return false;
        }

        // Warp a stuck animal back onto the nearest navmesh point. Returns true if
        // rescued, false if no navmesh nearby (caller may then cull it).
        private bool TryRescue(BaseAnimalNPC a)
        {
            var pos = a.transform.position;
            if (!NavMesh.SamplePosition(pos, out var hit, Mathf.Max(2f, _cfg.WarpSearchRadius), NavMesh.AllAreas))
                return false;

            var agent = a.GetComponent<NavMeshAgent>();
            if (agent != null && agent.enabled)
            {
                if (!agent.Warp(hit.position))
                {
                    a.transform.position = hit.position;
                    agent.Warp(hit.position);
                }
            }
            else
            {
                a.transform.position = hit.position;
            }
            a.SendNetworkUpdate();
            return true;
        }

        // Returns (rescued, culled).
        private (int, int) Sweep(IEnumerable<BaseAnimalNPC> animals)
        {
            int rescued = 0, culled = 0;
            foreach (var a in animals)
            {
                if (!IsBroken(a)) continue;
                if (TryRescue(a)) rescued++;
                else if (_cfg.KillIfNoNavmesh) { a.Kill(); culled++; }
            }
            return (rescued, culled);
        }

        private List<BaseAnimalNPC> AllAnimals()
        {
            var list = new List<BaseAnimalNPC>();
            foreach (var e in BaseNetworkable.serverEntities)
                if (e is BaseAnimalNPC a && !a.IsDestroyed) list.Add(a);
            return list;
        }

        private void RunJanitor()
        {
            var animals = AllAnimals();
            var (rescued, culled) = Sweep(animals);
            if (_cfg.Log && (rescued > 0 || culled > 0))
                Puts($"[ApRaidCleanup] Janitor: {animals.Count} animals — rescued {rescued} onto navmesh, culled {culled} stranded.");
        }

        // ── Raid-base sweep ─────────────────────────────────────────────────────
        private void OnRaidableBaseStarted(Vector3 raidPos, int mode)
        {
            if (!_cfg.RaidSweep) return;
            timer.Once(5f, () =>
            {
                var list = new List<BaseAnimalNPC>();
                Vis.Entities(raidPos, Mathf.Max(5f, _cfg.Radius), list);
                var (rescued, culled) = Sweep(list);
                if (_cfg.Log && (rescued > 0 || culled > 0))
                    Puts($"[ApRaidCleanup] Raid sweep near {raidPos}: rescued {rescued}, culled {culled}.");
            });
        }

        // ── Commands ────────────────────────────────────────────────────────────
        [ConsoleCommand("apraidcleanup.fix")]
        private void CcFix(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer;
            if (p != null && !p.IsAdmin) return;

            var animals = AllAnimals();
            int brokenBefore = animals.Count(IsBroken);
            var (rescued, culled) = Sweep(animals);
            int brokenAfter = AllAnimals().Count(IsBroken);

            string msg = $"[ApRaidCleanup] fix: {animals.Count} animals, {brokenBefore} broken → rescued {rescued}, culled {culled}; {brokenAfter} still broken.";
            arg.ReplyWith(msg);
            Puts(msg);
        }

        [ConsoleCommand("apraidcleanup.scan")]
        private void CcScan(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer;
            if (p != null && !p.IsAdmin) return;

            var counts = new Dictionary<string, int>();
            var brokenCounts = new Dictionary<string, int>();
            foreach (var a in AllAnimals())
            {
                string name = a.ShortPrefabName ?? "animal";
                counts[name] = counts.TryGetValue(name, out var c) ? c + 1 : 1;
                if (IsBroken(a)) brokenCounts[name] = brokenCounts.TryGetValue(name, out var bc) ? bc + 1 : 1;
            }

            var sb = new StringBuilder();
            sb.AppendLine($"[ApRaidCleanup] Animal scan — {counts.Values.Sum()} total, {brokenCounts.Values.Sum()} broken:");
            foreach (var kv in counts.OrderByDescending(k => k.Value))
                sb.AppendLine($"  {kv.Key}: {kv.Value} total" + (brokenCounts.TryGetValue(kv.Key, out var b) ? $" ({b} broken)" : ""));
            arg.ReplyWith(sb.ToString());
            Puts(sb.ToString());
        }
    }
}
