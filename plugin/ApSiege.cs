using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Oxide.Core;
using Oxide.Core.Libraries;
using Oxide.Core.Plugins;
using Oxide.Game.Rust.Cui;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApSiege", "SlayStudios", "1.0.0")]
    [Description("Hold-the-monument: escalating NPC waves attack a monument; clear them all for a reward vault. Shown on the live map.")]
    public class ApSiege : RustPlugin
    {
        [PluginReference] private Plugin NpcSpawn, Economics, ServerRewards;

        private Configuration _cfg;

        private class LootItem
        {
            [JsonProperty("Item shortname")] public string ShortName { get; set; } = "scrap";
            [JsonProperty("Amount")] public int Amount { get; set; } = 500;
            [JsonProperty("Skin ID")] public ulong SkinID { get; set; } = 0;
        }

        private class Configuration
        {
            [JsonProperty("Siege interval (minutes)")] public float IntervalMinutes { get; set; } = 90f;
            [JsonProperty("First siege delay (minutes)")] public float FirstDelayMinutes { get; set; } = 15f;
            [JsonProperty("Number of waves")] public int Waves { get; set; } = 5;
            [JsonProperty("NPCs in wave 1")] public int BaseWaveSize { get; set; } = 3;
            [JsonProperty("Extra NPCs per wave")] public int WaveSizeStep { get; set; } = 2;
            [JsonProperty("NPC health (wave 1)")] public float BaseHealth { get; set; } = 150f;
            [JsonProperty("NPC health added per wave")] public float HealthStep { get; set; } = 40f;
            [JsonProperty("NPC damage scale (wave 1)")] public float BaseDamageScale { get; set; } = 0.8f;
            [JsonProperty("NPC damage scale added per wave")] public float DamageStep { get; set; } = 0.1f;
            [JsonProperty("Spawn radius around monument")] public float SpawnRadius { get; set; } = 30f;
            [JsonProperty("Reward radius (players within get rewards)")] public float RewardRadius { get; set; } = 80f;
            [JsonProperty("Seconds to clear a wave before the siege fails")] public float WaveTimeoutSeconds { get; set; } = 240f;

            [JsonProperty("Economics reward per player")] public double EconomicsReward { get; set; } = 750;
            [JsonProperty("ServerRewards points per player")] public int ServerRewardsPoints { get; set; } = 400;
            [JsonProperty("Reward crate prefab")] public string CratePrefab { get; set; } =
                "assets/prefabs/deployable/chinookcrate/codelockedhackablecrate.prefab";
            [JsonProperty("Reward crate loot")] public List<LootItem> CrateLoot { get; set; } = new()
            {
                new LootItem { ShortName = "scrap", Amount = 750 },
                new LootItem { ShortName = "rifle.ak", Amount = 1 },
                new LootItem { ShortName = "explosive.timed", Amount = 4 },
            };

            [JsonProperty("Chat prefix")] public string ChatPrefix { get; set; } = "<color=#f97316>[SIEGE]</color>";
            [JsonProperty("Announce")] public bool Announce { get; set; } = true;
            [JsonProperty("Show on-screen banner")] public bool ShowBanner { get; set; } = true;
            [JsonProperty("Banner duration (seconds)")] public float BannerSeconds { get; set; } = 8f;
            [JsonProperty("Banner fade (seconds)")] public float BannerFade { get; set; } = 0.4f;
            [JsonProperty("Discord webhook URL (optional)")] public string DiscordWebhook { get; set; } = "";
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { _cfg = Config.ReadObject<Configuration>(); }
            catch { _cfg = new Configuration(); }
            if (_cfg.CrateLoot == null || _cfg.CrateLoot.Count == 0) _cfg.CrateLoot = new Configuration().CrateLoot;
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_cfg);
        protected override void LoadDefaultConfig() => _cfg = new Configuration();

        // ── State ─────────────────────────────────────────────────────────────
        private bool _active;
        private Vector3 _center;
        private string _monumentName;
        private string _grid;
        private int _wave;
        private readonly HashSet<ulong> _aliveNpcs = new();
        private readonly HashSet<ulong> _participants = new();
        private Timer _waveTimeout;
        private Timer _bannerTimer;
        private const string BannerUi = "ApSiege.Banner";

        private void OnServerInitialized()
        {
            LoadConfig();
            if (NpcSpawn == null) { PrintError("NpcSpawn not loaded — ApSiege disabled."); return; }
            timer.Once(_cfg.FirstDelayMinutes * 60f, () =>
            {
                TryStart();
                timer.Every(_cfg.IntervalMinutes * 60f, () => TryStart());
            });
            Puts($"[ApSiege] Ready. {_cfg.Waves} waves, every {_cfg.IntervalMinutes} min.");
        }

        private void Unload()
        {
            _bannerTimer?.Destroy();
            foreach (var p in BasePlayer.activePlayerList) CuiHelper.DestroyUi(p, BannerUi);
            EndSiege(false, true);
        }

        [ChatCommand("apsiege")]
        private void CmdApSiege(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin) { player.ChatMessage("You don't have permission."); return; }
            var sub = args.Length > 0 ? args[0].ToLower() : "";
            if (sub == "start") TryStart(true);
            else if (sub == "stop") { EndSiege(false, false); player.ChatMessage("[ApSiege] Siege stopped."); }
            else if (sub == "where" && _active) player.ChatMessage($"[ApSiege] {_monumentName} at {_grid} (wave {_wave}/{_cfg.Waves})");
            else player.ChatMessage("Usage: /apsiege start | stop | where");
        }

        // ── Siege flow ─────────────────────────────────────────────────────────
        private void TryStart(bool force = false)
        {
            if (_active) return;
            if (NpcSpawn == null) return;

            var mon = PickMonument();
            if (mon == null) { Puts("[ApSiege] No suitable monument found."); return; }

            _active = true;
            _center = mon.transform.position;
            _monumentName = CleanName(mon);
            _grid = GridFromPos(_center);
            _wave = 0;
            _aliveNpcs.Clear();
            _participants.Clear();

            Interface.CallHook("OnApSiegeStarted", _center, $"Siege: {_monumentName}");
            if (_cfg.Announce)
            {
                Broadcast($"🛡️ A siege is starting at <color=#fbbf24>{_monumentName}</color> ({_grid})! Defend it through {_cfg.Waves} waves for a reward vault.");
                SendDiscord($"🛡️ **Siege** started at **{_monumentName}** ({_grid}).");
            }
            NextWave();
        }

        private void NextWave()
        {
            if (!_active) return;
            _wave++;
            if (_wave > _cfg.Waves) { Victory(); return; }

            int count = _cfg.BaseWaveSize + (_wave - 1) * _cfg.WaveSizeStep;
            float health = _cfg.BaseHealth + (_wave - 1) * _cfg.HealthStep;
            float dmg = _cfg.BaseDamageScale + (_wave - 1) * _cfg.DamageStep;

            for (int i = 0; i < count; i++)
            {
                var pos = RandomPointAround(_center, _cfg.SpawnRadius);
                var npc = NpcSpawn.Call("SpawnNpc", pos, BuildNpcConfig(health, dmg)) as ScientistNPC;
                if (npc != null && npc.net != null) _aliveNpcs.Add(npc.net.ID.Value);
            }

            // If NpcSpawn produced nothing, don't stall waiting on a kill that can't
            // come — abort the siege cleanly instead of hanging until the timeout.
            if (_aliveNpcs.Count == 0)
            {
                PrintError("[ApSiege] Wave spawned 0 NPCs (NpcSpawn issue) — aborting siege.");
                if (_cfg.Announce) Broadcast($"The siege at {_monumentName} fizzled out.");
                EndSiege(false, false);
                return;
            }

            Interface.CallHook("OnApSiegeUpdated", $"Siege: {_monumentName} (Wave {_wave}/{_cfg.Waves})");
            if (_cfg.Announce)
                Broadcast($"⚔️ Wave <color=#f97316>{_wave}/{_cfg.Waves}</color> — <color=#fff>{count}</color> hostiles incoming at {_monumentName}!");
            ShowSiegeBanner($"SIEGE — {_monumentName}", $"Wave {_wave}/{_cfg.Waves} · {count} hostiles");

            _waveTimeout?.Destroy();
            _waveTimeout = timer.Once(_cfg.WaveTimeoutSeconds, () =>
            {
                if (_active) { Broadcast($"The siege at {_monumentName} was not held in time. It collapses."); EndSiege(false, false); }
            });
        }

        private void OnEntityDeath(ScientistNPC npc, HitInfo info)
        {
            if (!_active || npc == null || npc.net == null) return;
            if (!_aliveNpcs.Remove(npc.net.ID.Value)) return;

            var killer = info?.InitiatorPlayer;
            if (killer != null && !killer.IsNpc) _participants.Add(killer.userID);

            if (_aliveNpcs.Count == 0)
            {
                _waveTimeout?.Destroy();
                if (_cfg.Announce && _wave <= _cfg.Waves)
                    Broadcast($"✅ Wave {_wave} cleared!");
                timer.Once(5f, NextWave);
            }
        }

        private void Victory()
        {
            _waveTimeout?.Destroy();
            var pos = _center + Vector3.up * 0.5f;

            // Reward everyone near the monument (and anyone who landed a kill).
            var rewarded = new HashSet<ulong>(_participants);
            foreach (var p in BasePlayer.activePlayerList)
                if (p != null && !p.IsNpc && Vector3.Distance(p.transform.position, _center) <= _cfg.RewardRadius)
                    rewarded.Add(p.userID);

            foreach (var id in rewarded)
            {
                if (_cfg.EconomicsReward > 0) Economics?.Call("Deposit", id.ToString(), _cfg.EconomicsReward);
                if (_cfg.ServerRewardsPoints > 0) ServerRewards?.Call("AddPoints", id, _cfg.ServerRewardsPoints);
            }

            SpawnCrate(pos);

            if (_cfg.Announce)
            {
                Broadcast($"🏆 The siege at <color=#fbbf24>{_monumentName}</color> was repelled! A reward vault dropped at {_grid}.");
                SendDiscord($"🏆 **Siege** at **{_monumentName}** completed — {rewarded.Count} defenders rewarded.");
            }
            ShowSiegeBanner("SIEGE REPELLED", $"{_monumentName} held · vault at {_grid}");
            EndSiege(true, false);
        }

        private void EndSiege(bool victory, bool unloading)
        {
            _waveTimeout?.Destroy();
            _waveTimeout = null;

            // Despawn any remaining siege NPCs.
            foreach (var id in _aliveNpcs.ToList())
            {
                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(id)) as BaseEntity;
                if (ent != null && !ent.IsDestroyed) ent.Kill();
            }
            _aliveNpcs.Clear();
            _participants.Clear();
            _active = false;
            // Keep the closing banner up briefly (Victory sets one) but clear any
            // standing wave banner timer; the per-banner timer will remove the UI.
            Interface.CallHook("OnApSiegeEnded");
        }

        private void OnPlayerConnected(BasePlayer player)
        {
            if (!_cfg.ShowBanner || !_active || player == null) return;
            timer.Once(2f, () =>
            {
                if (player != null && player.IsConnected && _active)
                    ShowSiegeBanner(player, $"SIEGE — {_monumentName}", $"Wave {_wave}/{_cfg.Waves} in progress");
            });
        }

        // ── Banner UI ──────────────────────────────────────────────────────────
        private void ShowSiegeBanner(string title, string subtitle)
        {
            if (!_cfg.ShowBanner) return;
            foreach (var p in BasePlayer.activePlayerList) ShowSiegeBanner(p, title, subtitle);
            _bannerTimer?.Destroy();
            _bannerTimer = timer.Once(Mathf.Max(1f, _cfg.BannerSeconds), DestroySiegeBanner);
        }

        private void ShowSiegeBanner(BasePlayer player, string title, string subtitle)
        {
            if (player == null || !player.IsConnected) return;
            float fade = Mathf.Max(0f, _cfg.BannerFade);
            CuiHelper.DestroyUi(player, BannerUi);

            var c = new CuiElementContainer();
            c.Add(new CuiPanel
            {
                Image = { Color = "0.18 0.08 0.02 0.92", FadeIn = fade },
                RectTransform = { AnchorMin = "0.34 0.90", AnchorMax = "0.66 0.965" },
                CursorEnabled = false,
                FadeOut = fade
            }, "Overlay", BannerUi);
            c.Add(new CuiPanel
            {
                Image = { Color = "0.95 0.45 0.10 1", FadeIn = fade },
                RectTransform = { AnchorMin = "0 0", AnchorMax = "0.02 1" },
                FadeOut = fade
            }, BannerUi);
            c.Add(new CuiLabel
            {
                Text = { Text = title, FontSize = 15, Align = TextAnchor.UpperLeft, Color = "0.98 0.62 0.30 1", FadeIn = fade },
                RectTransform = { AnchorMin = "0.05 0.5", AnchorMax = "0.97 0.95" },
                FadeOut = fade
            }, BannerUi);
            c.Add(new CuiLabel
            {
                Text = { Text = subtitle, FontSize = 12, Align = TextAnchor.LowerLeft, Color = "1 1 1 1", FadeIn = fade },
                RectTransform = { AnchorMin = "0.05 0.08", AnchorMax = "0.97 0.5" },
                FadeOut = fade
            }, BannerUi);
            CuiHelper.AddUi(player, c);
        }

        private void DestroySiegeBanner()
        {
            foreach (var p in BasePlayer.activePlayerList) CuiHelper.DestroyUi(p, BannerUi);
            _bannerTimer?.Destroy();
            _bannerTimer = null;
        }

        private void SpawnCrate(Vector3 pos)
        {
            try
            {
                var crate = GameManager.server.CreateEntity(_cfg.CratePrefab, pos, Quaternion.identity);
                if (crate == null) return;
                crate.Spawn();
                var container = (crate as StorageContainer)?.inventory;
                if (container != null)
                {
                    foreach (var li in _cfg.CrateLoot)
                    {
                        if (string.IsNullOrEmpty(li.ShortName) || li.Amount <= 0) continue;
                        var item = ItemManager.CreateByName(li.ShortName, li.Amount, li.SkinID);
                        if (item == null) continue;
                        if (!item.MoveToContainer(container)) item.Drop(pos + Vector3.up, Vector3.up);
                    }
                }
            }
            catch (Exception ex) { PrintError($"[ApSiege] Crate spawn failed: {ex.Message}"); }
        }

        // ── NPC config ─────────────────────────────────────────────────────────
        private JObject BuildNpcConfig(float health, float dmg)
        {
            var belt = new JArray
            {
                new JObject { ["ShortName"] = "rifle.semiauto", ["Amount"] = 1, ["SkinID"] = 0UL, ["mods"] = new JArray(), ["Ammo"] = "ammo.rifle" }
            };
            var wear = new JArray();
            foreach (var w in new[] { "hazmatsuit" })
                wear.Add(new JObject { ["ShortName"] = w, ["SkinID"] = 0UL });

            return new JObject
            {
                ["Name"] = "Siege Raider",
                ["WearItems"] = wear,
                ["BeltItems"] = belt,
                ["Kit"] = "",
                ["Health"] = health,
                ["RoamRange"] = 40f,
                ["ChaseRange"] = 120f,
                ["SenseRange"] = 120f,
                ["ListenRange"] = 60f,
                ["AttackRangeMultiplier"] = 2f,
                ["CheckVisionCone"] = false,
                ["VisionCone"] = 135f,
                ["HostileTargetsOnly"] = false,
                ["DamageScale"] = dmg,
                ["TurretDamageScale"] = 1f,
                ["AimConeScale"] = 1.5f,
                ["DisableRadio"] = true,
                ["CanRunAwayWater"] = true,
                ["CanSleep"] = false,
                ["SleepDistance"] = 100f,
                ["Speed"] = 7f,
                ["AreaMask"] = 1,
                ["AgentTypeID"] = -1372625422,
                ["HomePosition"] = string.Empty,
                ["MemoryDuration"] = 30f,
                ["States"] = new JArray { "RoamState", "ChaseState", "CombatState" }
            };
        }

        // ── Monuments / helpers ─────────────────────────────────────────────────
        private MonumentInfo PickMonument()
        {
            var monuments = TerrainMeta.Path?.Monuments;
            if (monuments == null || monuments.Count == 0) return null;
            var named = monuments.Where(m => m != null && !string.IsNullOrEmpty(m.displayPhrase.english)
                && m.name != null && !m.name.Contains("cave") && !m.name.Contains("swamp")).ToList();
            if (named.Count == 0) named = monuments.Where(m => m != null).ToList();
            if (named.Count == 0) return null;
            return named[UnityEngine.Random.Range(0, named.Count)];
        }

        private static string CleanName(MonumentInfo m)
        {
            var s = m.displayPhrase.english;
            if (string.IsNullOrEmpty(s)) s = m.name;
            return s.Replace("\n", "").Trim();
        }

        private Vector3 RandomPointAround(Vector3 center, float radius)
        {
            for (int i = 0; i < 10; i++)
            {
                var a = UnityEngine.Random.Range(0f, Mathf.PI * 2f);
                var r = UnityEngine.Random.Range(radius * 0.4f, radius);
                var x = center.x + Mathf.Cos(a) * r;
                var z = center.z + Mathf.Sin(a) * r;
                var probe = new Vector3(x, 0f, z);
                var y = TerrainMeta.HeightMap.GetHeight(probe);
                var pos = new Vector3(x, y, z);
                if (y >= TerrainMeta.WaterMap.GetHeight(pos)) return pos;
            }
            return center;
        }

        private static bool Alive(BaseEntity e) => e != null && !e.IsDestroyed;

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
