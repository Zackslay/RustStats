using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.AI;

namespace Oxide.Plugins
{
    [Info("ApRaidCleanup", "SlayStudios", "1.1.0")]
    [Description("Removes broken (off-navmesh) animals that spam FSMComponent.BudgetedUpdate NRE — targeted auto ai.killanimals + raid-base sweep")]
    public class ApRaidCleanup : RustPlugin
    {
        [PluginReference] private Plugin RaidableBases;

        private Configuration _cfg;

        private class Configuration
        {
            [JsonProperty("Janitor: periodically remove broken (off-navmesh) animals")] public bool Janitor { get; set; } = true;
            [JsonProperty("Janitor scan interval (seconds)")] public float JanitorInterval { get; set; } = 60f;
            [JsonProperty("Janitor: only kill if broken on two consecutive scans")] public bool TwoStrike { get; set; } = true;
            [JsonProperty("Also sweep animals when a raid base spawns")] public bool RaidSweep { get; set; } = true;
            [JsonProperty("Raid base sweep radius (meters)")] public float Radius { get; set; } = 60f;
            [JsonProperty("Raid base follow-up sweep delays (seconds)")] public float[] SweepDelays { get; set; } = { 4f, 12f, 25f };
            [JsonProperty("Log how many animals were cleared")] public bool Log { get; set; } = true;
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { _cfg = Config.ReadObject<Configuration>(); }
            catch { _cfg = new Configuration(); }
            if (_cfg.SweepDelays == null) _cfg.SweepDelays = new[] { 4f, 12f, 25f };
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_cfg);
        protected override void LoadDefaultConfig() => _cfg = new Configuration();

        private readonly HashSet<ulong> _flaggedLastScan = new HashSet<ulong>();

        private void OnServerInitialized()
        {
            LoadConfig();
            if (_cfg.Janitor)
                timer.Every(Mathf.Max(15f, _cfg.JanitorInterval), RunJanitor);
        }

        // ── Broken-animal helpers ───────────────────────────────────────────────
        private static bool IsBroken(BaseAnimalNPC a)
        {
            if (a == null || a.IsDestroyed) return false;
            // A healthy animal sits on the navmesh with a valid agent. A trapped /
            // scaled / orphaned one has no agent or is off the mesh — that's what
            // throws FSMComponent.BudgetedUpdate every frame.
            var agent = a.GetComponent<NavMeshAgent>();
            if (agent == null) return true;
            if (!agent.isOnNavMesh) return true;
            return false;
        }

        private void RunJanitor()
        {
            var brokenNow = new List<BaseAnimalNPC>();
            foreach (var e in BaseNetworkable.serverEntities)
            {
                var a = e as BaseAnimalNPC;
                if (a == null) continue;
                if (IsBroken(a)) brokenNow.Add(a);
            }

            int killed = 0;
            var stillFlagged = new HashSet<ulong>();
            foreach (var a in brokenNow)
            {
                ulong id = a.net?.ID.Value ?? 0;
                if (id == 0) continue;
                // Two-strike: only remove if it was broken last scan too, so we never
                // kill an animal that's only momentarily off-mesh (falling/swimming).
                if (_cfg.TwoStrike && !_flaggedLastScan.Contains(id))
                {
                    stillFlagged.Add(id);
                    continue;
                }
                a.Kill();
                killed++;
            }

            _flaggedLastScan.Clear();
            foreach (var id in stillFlagged) _flaggedLastScan.Add(id);

            if (_cfg.Log && killed > 0)
                Puts($"[ApRaidCleanup] Janitor removed {killed} broken animal(s).");
        }

        // ── Raid-base sweep ─────────────────────────────────────────────────────
        private void OnRaidableBaseStarted(Vector3 raidPos, int mode)
        {
            if (!_cfg.RaidSweep) return;
            ClearAnimals(raidPos);
            foreach (var d in _cfg.SweepDelays)
            {
                float delay = Mathf.Max(0.5f, d);
                timer.Once(delay, () => ClearAnimals(raidPos));
            }
        }

        private void ClearAnimals(Vector3 center)
        {
            var list = new List<BaseAnimalNPC>();
            Vis.Entities(center, Mathf.Max(5f, _cfg.Radius), list);
            int killed = 0;
            foreach (var a in list)
            {
                if (a == null || a.IsDestroyed) continue;
                if (IsBroken(a)) { a.Kill(); killed++; }
            }
            if (_cfg.Log && killed > 0)
                Puts($"[ApRaidCleanup] Raid sweep removed {killed} broken animal(s) near {center}.");
        }

        // ── Diagnostic ──────────────────────────────────────────────────────────
        // Run "apraidcleanup.scan" from the server console / F1 to see exactly what
        // animals exist and which are broken (species, count, position, scale).
        [ConsoleCommand("apraidcleanup.scan")]
        private void CcScan(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer;
            if (p != null && !p.IsAdmin) return;

            var counts = new Dictionary<string, int>();
            var brokenCounts = new Dictionary<string, int>();
            var samples = new List<string>();

            foreach (var e in BaseNetworkable.serverEntities)
            {
                var a = e as BaseAnimalNPC;
                if (a == null || a.IsDestroyed) continue;
                string name = a.ShortPrefabName ?? "animal";
                counts[name] = counts.TryGetValue(name, out var c) ? c + 1 : 1;
                if (IsBroken(a))
                {
                    brokenCounts[name] = brokenCounts.TryGetValue(name, out var bc) ? bc + 1 : 1;
                    if (samples.Count < 25)
                    {
                        var agent = a.GetComponent<NavMeshAgent>();
                        var pos = a.transform.position;
                        float sc = a.transform.localScale.x;
                        samples.Add($"  {name} @ ({pos.x:0},{pos.y:0},{pos.z:0}) agentNull={agent == null} onMesh={(agent != null && agent.isOnNavMesh)} scale={sc:0.##}");
                    }
                }
            }

            var sb = new StringBuilder();
            sb.AppendLine($"[ApRaidCleanup] Animal scan — {counts.Values.Sum()} total, {brokenCounts.Values.Sum()} broken:");
            foreach (var kv in counts.OrderByDescending(k => k.Value))
                sb.AppendLine($"  {kv.Key}: {kv.Value} total" + (brokenCounts.TryGetValue(kv.Key, out var b) ? $" ({b} BROKEN)" : ""));
            if (samples.Count > 0)
            {
                sb.AppendLine("Broken samples:");
                foreach (var s in samples) sb.AppendLine(s);
            }
            arg.ReplyWith(sb.ToString());
            Puts(sb.ToString());
        }
    }
}
