using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApRaidCleanup", "SlayStudios", "1.0.0")]
    [Description("Clears wild animals trapped inside RaidableBases when they spawn, preventing FSMComponent.BudgetedUpdate NRE spam")]
    public class ApRaidCleanup : RustPlugin
    {
        [PluginReference] private Plugin RaidableBases;

        private Configuration _cfg;

        private class Configuration
        {
            [JsonProperty("Clear radius around the base (meters)")] public float Radius { get; set; } = 60f;
            [JsonProperty("Follow-up sweep delays (seconds)")] public float[] SweepDelays { get; set; } = { 4f, 12f, 25f };
            [JsonProperty("Log how many animals were cleared")] public bool Log { get; set; } = false;
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

        private void OnServerInitialized()
        {
            LoadConfig();
            if (RaidableBases == null)
                PrintWarning("[ApRaidCleanup] RaidableBases is not loaded — this plugin only does anything alongside it.");
        }

        // RaidableBases fires OnRaidableBaseStarted with an object[] whose first
        // element is the base Location (Vector3). The single-object overload it
        // also fires won't match this signature, so we run exactly once per base.
        private void OnRaidableBaseStarted(Vector3 raidPos, int mode)
        {
            ClearAnimals(raidPos);
            if (_cfg.SweepDelays != null)
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
            foreach (var animal in list)
            {
                if (animal == null || animal.IsDestroyed) continue;
                animal.Kill();
                killed++;
            }
            if (_cfg.Log && killed > 0)
                Puts($"[ApRaidCleanup] Cleared {killed} animal(s) near a raid base at {center}.");
        }
    }
}
