using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Oxide.Core;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApMerchant", "SlayStudios", "1.0.0")]
    [Description("A roaming, invulnerable merchant NPC shown on the live map; /trade nearby for a daily bonus + the shop")]
    public class ApMerchant : RustPlugin
    {
        [PluginReference] private Plugin NpcSpawn, ServerRewards, ShopController;

        private Configuration _cfg;

        private class Configuration
        {
            [JsonProperty("Relocate interval (minutes)")] public float RelocateMinutes { get; set; } = 30f;
            [JsonProperty("First spawn delay (minutes)")] public float FirstDelayMinutes { get; set; } = 5f;
            [JsonProperty("Merchant name")] public string Name { get; set; } = "Wandering Merchant";
            [JsonProperty("Roam range")] public float RoamRange { get; set; } = 25f;
            [JsonProperty("Speed")] public float Speed { get; set; } = 4.5f;
            [JsonProperty("Trade range (meters)")] public float TradeRange { get; set; } = 15f;
            [JsonProperty("Daily trade bonus (RP, 0 = off)")] public int DailyBonus { get; set; } = 50;
            [JsonProperty("Shop plugin name")] public string ShopPlugin { get; set; } = "ShopController";
            [JsonProperty("Shop open method")] public string ShopOpenMethod { get; set; } = "CMDOpenShop";
            [JsonProperty("Chat prefix")] public string ChatPrefix { get; set; } = "<color=#fbbf24>[Merchant]</color>";
            [JsonProperty("Announce relocations")] public bool Announce { get; set; } = true;
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

        private ScientistNPC _merchant;
        private ulong _netId;
        private readonly Dictionary<ulong, string> _lastTradeDay = new();

        private void OnServerInitialized()
        {
            LoadConfig();
            if (NpcSpawn == null) { PrintError("NpcSpawn not loaded — ApMerchant disabled."); return; }
            timer.Once(_cfg.FirstDelayMinutes * 60f, () =>
            {
                Relocate();
                timer.Every(_cfg.RelocateMinutes * 60f, Relocate);
            });
        }

        private void Unload() => RemoveMerchant();

        [ChatCommand("trade")]
        private void CmdTrade(BasePlayer player, string command, string[] args)
        {
            if (!Alive(_merchant)) { Msg(player, "There's no merchant around right now. Check the live map."); return; }
            if (Vector3.Distance(player.transform.position, _merchant.transform.position) > _cfg.TradeRange)
            {
                Msg(player, $"You're not near the merchant. Find them at {GridFromPos(_merchant.transform.position)} (live map).");
                return;
            }

            if (_cfg.DailyBonus > 0)
            {
                string today = DateTime.UtcNow.ToString("yyyy-MM-dd");
                if (!_lastTradeDay.TryGetValue(player.userID, out var last) || last != today)
                {
                    _lastTradeDay[player.userID] = today;
                    ServerRewards?.Call("AddPoints", player.userID, _cfg.DailyBonus);
                    Msg(player, $"The merchant greets you — daily bonus: <color=#fbbf24>{_cfg.DailyBonus} RP</color>!");
                }
            }

            // Open the shop (best effort; players can also just use /shop).
            bool opened = false;
            try { if (ShopController != null) { ShopController.Call(_cfg.ShopOpenMethod, player, "shop", new string[0]); opened = true; } }
            catch (Exception ex) { PrintWarning($"[ApMerchant] shop open failed: {ex.Message}"); }
            if (!opened) Msg(player, "Use /shop to browse the merchant's wares.");
        }

        [ChatCommand("merchant")]
        private void CmdWhere(BasePlayer player, string command, string[] args)
        {
            if (!Alive(_merchant)) { Msg(player, "No merchant is around right now."); return; }
            Msg(player, $"The {_cfg.Name} is near {GridFromPos(_merchant.transform.position)}.");
        }

        private void Relocate()
        {
            if (NpcSpawn == null) return;
            RemoveMerchant();

            var pos = FindSpawnPosition();
            if (pos == Vector3.zero) { Puts("[ApMerchant] No valid spot, retrying next cycle."); return; }

            var npc = NpcSpawn.Call("SpawnNpc", pos, BuildConfig()) as ScientistNPC;
            if (npc == null) { PrintError("[ApMerchant] NpcSpawn returned null."); return; }

            _merchant = npc;
            _netId = npc.net.ID.Value;
            Interface.CallHook("OnApMerchantSpawned", _merchant as BaseEntity, _cfg.Name);

            if (_cfg.Announce)
                PrintToChat($"{_cfg.ChatPrefix} The <color=#fbbf24>{_cfg.Name}</color> has set up at <color=#fff>{GridFromPos(pos)}</color> — /trade nearby!");
        }

        private void RemoveMerchant()
        {
            _netId = 0;
            if (Alive(_merchant)) _merchant.Kill();
            _merchant = null;
            Interface.CallHook("OnApMerchantDespawned");
        }

        // Keep the merchant invulnerable so it can't be farmed.
        private object OnEntityTakeDamage(ScientistNPC npc, HitInfo info)
        {
            if (npc != null && npc.net != null && npc.net.ID.Value == _netId && _netId != 0)
            {
                info?.damageTypes?.ScaleAll(0f);
                return true;
            }
            return null;
        }

        private JObject BuildConfig()
        {
            var wear = new JArray { new JObject { ["ShortName"] = "hazmatsuit", ["SkinID"] = 0UL } };
            return new JObject
            {
                ["Name"] = _cfg.Name,
                ["WearItems"] = wear,
                ["BeltItems"] = new JArray(),
                ["Kit"] = "",
                ["Health"] = 1000f,
                ["RoamRange"] = _cfg.RoamRange,
                ["ChaseRange"] = 0f,
                ["SenseRange"] = 0f,
                ["ListenRange"] = 0f,
                ["AttackRangeMultiplier"] = 1f,
                ["CheckVisionCone"] = false,
                ["VisionCone"] = 135f,
                ["HostileTargetsOnly"] = true,
                ["DamageScale"] = 0f,
                ["TurretDamageScale"] = 0f,
                ["AimConeScale"] = 1f,
                ["DisableRadio"] = true,
                ["CanRunAwayWater"] = true,
                ["CanSleep"] = false,
                ["SleepDistance"] = 100f,
                ["Speed"] = _cfg.Speed,
                ["AreaMask"] = 1,
                ["AgentTypeID"] = -1372625422,
                ["HomePosition"] = string.Empty,
                ["MemoryDuration"] = 0f,
                ["States"] = new JArray { "RoamState" }
            };
        }

        // ── Helpers (shared with ApBoss) ───────────────────────────────────────
        private static bool Alive(BaseEntity e) => e != null && !e.IsDestroyed;

        private Vector3 FindSpawnPosition()
        {
            float size = (float)World.Size;
            float half = size / 2f * 0.85f;
            int badMask = (int)(TerrainTopology.Enum.Ocean | TerrainTopology.Enum.Lake |
                TerrainTopology.Enum.River | TerrainTopology.Enum.Offshore |
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

        private void Msg(BasePlayer p, string msg) => p.ChatMessage($"{_cfg.ChatPrefix} {msg}");
    }
}
