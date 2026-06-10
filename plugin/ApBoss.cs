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
    [Info("ApBoss", "SlayStudios", "1.1.0")]
    [Description("Timed roaming boss event with tiers (NpcSpawn), loot + Economics/ServerRewards rewards and dashboard boss tracking")]
    public class ApBoss : RustPlugin
    {
        [PluginReference] private Plugin NpcSpawn, Economics, ServerRewards, EntityScaleManager;

        // ── Config ────────────────────────────────────────────────────────────
        private Configuration _cfg;

        private class LootItem
        {
            [JsonProperty("Item shortname")] public string ShortName { get; set; } = "rifle.ak";
            [JsonProperty("Amount")] public int Amount { get; set; } = 1;
            [JsonProperty("Skin ID")] public ulong SkinID { get; set; } = 0;
        }

        private class BossTier
        {
            [JsonProperty("Tier name")] public string Name { get; set; } = "AP Marauder";
            [JsonProperty("Spawn weight (relative chance)")] public float Weight { get; set; } = 60f;
            [JsonProperty("Name colour (hex)")] public string Color { get; set; } = "#9ca3af";
            [JsonProperty("Health")] public float Health { get; set; } = 3000f;
            [JsonProperty("Damage scale")] public float DamageScale { get; set; } = 1.25f;
            [JsonProperty("Map marker scale (1.0 = normal, harder = bigger)")] public float MarkerScale { get; set; } = 1.0f;
            [JsonProperty("Economics reward")] public double EconomicsReward { get; set; } = 500;
            [JsonProperty("ServerRewards points")] public int ServerRewardsPoints { get; set; } = 250;
            [JsonProperty("Loot crate prefab")] public string LootCratePrefab { get; set; } =
                "assets/prefabs/deployable/chinookcrate/codelockedhackablecrate.prefab";
            [JsonProperty("Bonus loot items")] public List<LootItem> BonusLoot { get; set; } = new()
            {
                new LootItem { ShortName = "scrap", Amount = 250 },
            };
        }

        private class Configuration
        {
            [JsonProperty("Spawn interval (minutes)")] public float SpawnIntervalMinutes { get; set; } = 75f;
            [JsonProperty("First spawn delay (minutes)")] public float FirstSpawnDelayMinutes { get; set; } = 10f;
            [JsonProperty("Despawn after (minutes, if not killed)")] public float DespawnMinutes { get; set; } = 20f;

            [JsonProperty("Roam range")] public float RoamRange { get; set; } = 60f;
            [JsonProperty("Chase range")] public float ChaseRange { get; set; } = 175f;
            [JsonProperty("Sense range")] public float SenseRange { get; set; } = 175f;
            [JsonProperty("Speed")] public float Speed { get; set; } = 7.5f;
            [JsonProperty("Kit name (optional, overrides default gear if set)")] public string Kit { get; set; } = "";

            [JsonProperty("Chat prefix")] public string ChatPrefix { get; set; } = "<color=#dc2626>[BOSS]</color>";
            [JsonProperty("Announce spawn")] public bool AnnounceSpawn { get; set; } = true;
            [JsonProperty("Announce kill")] public bool AnnounceKill { get; set; } = true;
            [JsonProperty("Discord webhook URL (optional)")] public string DiscordWebhook { get; set; } = "";

            [JsonProperty("Show boss spawn banner UI")] public bool ShowBossSpawnBanner { get; set; } = true;
            [JsonProperty("Boss spawn banner duration (seconds)")] public float BossSpawnBannerSeconds { get; set; } = 15f;
            [JsonProperty("Boss spawn banner fade (seconds)")] public float BossSpawnBannerFade { get; set; } = 0.4f;
            [JsonProperty("Boss spawn banner title")] public string BossSpawnBannerTitle { get; set; } = "BOSS EVENT ACTIVE";
            [JsonProperty("Boss spawn banner subtitle")] public string BossSpawnBannerSubtitle { get; set; } = "Hunt it down for rewards";
            [JsonProperty("Boss spawn banner background colour (RGBA)")] public string BossSpawnBannerBackground { get; set; } = "0.08 0.02 0.02 0.92";
            [JsonProperty("Boss spawn banner accent colour (RGBA)")] public string BossSpawnBannerAccent { get; set; } = "0.86 0.15 0.15 1";
            [JsonProperty("Boss spawn banner text colour (RGBA)")] public string BossSpawnBannerText { get; set; } = "1 1 1 1";

            [JsonProperty("Report boss kills to dashboard (RustCompanion)")] public bool ReportToDashboard { get; set; } = true;

            [JsonProperty("Apply physical (in-world) boss scaling from MarkerScale")] public bool PhysicalScaling { get; set; } = true;
            [JsonProperty("Physical scale multiplier (x MarkerScale)")] public float PhysicalScaleMultiplier { get; set; } = 1f;

            [JsonProperty("Show in-game map marker")] public bool ShowMapMarker { get; set; } = true;
            [JsonProperty("Map marker radius")] public float MapMarkerRadius { get; set; } = 0.35f;
            [JsonProperty("Map marker alpha")] public float MapMarkerAlpha { get; set; } = 0.6f;
            [JsonProperty("Map marker update interval (seconds)")] public float MapMarkerUpdateInterval { get; set; } = 2f;

            [JsonProperty("Boss tiers")] public List<BossTier> Tiers { get; set; } = new()
            {
                new BossTier { Name = "AP Marauder", Weight = 60f, Color = "#9ca3af", Health = 3000f, DamageScale = 1.25f, MarkerScale = 1.0f, EconomicsReward = 500, ServerRewardsPoints = 250,
                    BonusLoot = new() { new LootItem { ShortName = "scrap", Amount = 250 }, new LootItem { ShortName = "rifle.ak", Amount = 1 } } },
                new BossTier { Name = "AP Warlord", Weight = 30f, Color = "#dc2626", Health = 6000f, DamageScale = 1.5f, MarkerScale = 1.3f, EconomicsReward = 1000, ServerRewardsPoints = 500,
                    BonusLoot = new() { new LootItem { ShortName = "scrap", Amount = 500 }, new LootItem { ShortName = "explosive.timed", Amount = 4 } } },
                new BossTier { Name = "AP Overlord", Weight = 10f, Color = "#fbbf24", Health = 12000f, DamageScale = 1.8f, MarkerScale = 1.6f, EconomicsReward = 2500, ServerRewardsPoints = 1250,
                    BonusLoot = new() { new LootItem { ShortName = "scrap", Amount = 1000 }, new LootItem { ShortName = "explosive.timed", Amount = 10 }, new LootItem { ShortName = "rifle.ak", Amount = 2 } } },
            };
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { _cfg = Config.ReadObject<Configuration>(); }
            catch { _cfg = new Configuration(); }
            if (_cfg.Tiers == null || _cfg.Tiers.Count == 0) _cfg.Tiers = new Configuration().Tiers;
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_cfg);
        protected override void LoadDefaultConfig() => _cfg = new Configuration();

        // ── State ─────────────────────────────────────────────────────────────
        private ScientistNPC _boss;
        private ulong _bossNetId;
        private BossTier _tier;
        private string _bossGrid;
        private Timer _despawnTimer;
        private Timer _bannerTimer;
        private const string BossBannerUi = "ApBoss.BossBanner";

        // In-game (G) map markers — a colored radius + a named label that follow the boss.
        private MapMarkerGenericRadius _mapMarker;
        private VendingMachineMapMarker _mapMarkerName;
        private Timer _markerTimer;

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
            Puts($"[ApBoss] Ready. {_cfg.Tiers.Count} tiers, spawns every {_cfg.SpawnIntervalMinutes} min.");
        }

        private void Unload() => RemoveBoss();

        private void OnPlayerConnected(BasePlayer player)
        {
            if (!_cfg.ShowBossSpawnBanner || !Alive(_boss) || _tier == null) return;
            timer.Once(2f, () =>
            {
                if (player == null || !player.IsConnected || !Alive(_boss) || _tier == null) return;
                ShowBossBanner(player, _tier, _bossGrid ?? GridFromPos(_boss.transform.position));
                // Late joiners get their own auto-clear (the shared spawn timer
                // may have already elapsed), so the banner doesn't linger.
                float secs = Mathf.Max(1f, _cfg.BossSpawnBannerSeconds);
                timer.Once(secs, () => { if (player != null && player.IsConnected) CuiHelper.DestroyUi(player, BossBannerUi); });
            });
        }

        // ── Commands ──────────────────────────────────────────────────────────
        [ChatCommand("apboss")]
        private void CmdApBoss(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin) { player.ChatMessage("You don't have permission."); return; }
            var sub = args.Length > 0 ? args[0].ToLower() : "";
            if (sub == "spawn")
            {
                BossTier forced = args.Length > 1 ? _cfg.Tiers.FirstOrDefault(t => t.Name.Replace(" ", "").ToLower().Contains(args[1].ToLower())) : null;
                TrySpawnBoss(true, forced);
            }
            else if (sub == "despawn") { RemoveBoss(); player.ChatMessage("[ApBoss] Boss removed."); }
            else if (sub == "where" && Alive(_boss)) { player.ChatMessage($"[ApBoss] {_tier?.Name} at {GridFromPos(_boss.transform.position)}"); }
            else player.ChatMessage("Usage: /apboss spawn [tier] | despawn | where");
        }

        // Console / RCON: apboss spawn [tier] | despawn | where
        [ConsoleCommand("apboss")]
        private void CcApBoss(ConsoleSystem.Arg arg)
        {
            // Server console / RCON has no player; in-game F1 console needs admin.
            var p = arg.Connection?.player as BasePlayer;
            if (p != null && !p.IsAdmin) { arg.ReplyWith("You don't have permission."); return; }

            var sub = arg.GetString(0, "").ToLower();
            if (sub == "spawn")
            {
                var tierArg = arg.GetString(1, "");
                BossTier forced = tierArg.Length > 0
                    ? _cfg.Tiers.FirstOrDefault(t => t.Name.Replace(" ", "").ToLower().Contains(tierArg.ToLower()))
                    : null;
                TrySpawnBoss(true, forced);
                arg.ReplyWith(forced != null ? $"[ApBoss] Spawning {forced.Name}." : "[ApBoss] Spawning a boss.");
            }
            else if (sub == "despawn") { RemoveBoss(); arg.ReplyWith("[ApBoss] Boss removed."); }
            else if (sub == "where")
                arg.ReplyWith(Alive(_boss) ? $"[ApBoss] {_tier?.Name} at {GridFromPos(_boss.transform.position)}" : "[ApBoss] No boss active.");
            else arg.ReplyWith("Usage: apboss spawn [tier] | despawn | where");
        }

        // ── Spawning ──────────────────────────────────────────────────────────
        private void TrySpawnBoss(bool force = false, BossTier forced = null)
        {
            if (NpcSpawn == null) return;
            if (Alive(_boss))
            {
                if (!force) return; // one boss at a time
                RemoveBoss();
            }

            var tier = forced ?? PickTier();
            if (tier == null) return;

            var pos = FindSpawnPosition();
            if (pos == Vector3.zero)
            {
                Puts("[ApBoss] Could not find a valid spawn position, will retry next cycle.");
                return;
            }

            var npc = NpcSpawn.Call("SpawnNpc", pos, BuildBossConfig(tier)) as ScientistNPC;
            if (npc == null)
            {
                PrintError("[ApBoss] NpcSpawn returned null — check NpcSpawn config/version.");
                return;
            }

            _boss = npc;
            _bossNetId = npc.net.ID.Value;
            _tier = tier;

            // Make the boss physically bigger in-world to match its tier/marker.
            ApplyPhysicalScale(npc, tier.MarkerScale);

            // In-game (G) map marker that follows the boss.
            CreateMapMarker(pos, tier);

            // Let the dashboard show a live boss marker (RustCompanion relays it).
            Interface.CallHook("OnApBossSpawned", _boss as BaseEntity, tier.Name, tier.MarkerScale);

            string grid = GridFromPos(pos);
            _bossGrid = grid;
            ShowBossBanner(tier, grid);
            if (_cfg.AnnounceSpawn)
            {
                Broadcast($"💀 <color={tier.Color}>{tier.Name}</color> has appeared at <color=#fbbf24>{grid}</color>! Hunt it down for rewards.");
                SendDiscord($"💀 **{tier.Name}** has spawned at **{grid}**.");
            }

            _despawnTimer?.Destroy();
            _despawnTimer = timer.Once(_cfg.DespawnMinutes * 60f, () =>
            {
                if (Alive(_boss))
                {
                    if (_cfg.AnnounceSpawn)
                        Broadcast($"<color={_tier.Color}>{_tier.Name}</color> has vanished. Better luck next time.");
                    RemoveBoss();
                }
            });
        }

        private BossTier PickTier()
        {
            float total = _cfg.Tiers.Sum(t => Mathf.Max(0f, t.Weight));
            if (total <= 0f) return _cfg.Tiers.FirstOrDefault();
            float roll = UnityEngine.Random.Range(0f, total);
            foreach (var t in _cfg.Tiers)
            {
                roll -= Mathf.Max(0f, t.Weight);
                if (roll <= 0f) return t;
            }
            return _cfg.Tiers.Last();
        }

        private JObject BuildBossConfig(BossTier tier)
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
                ["Name"] = tier.Name,
                ["WearItems"] = wear,
                ["BeltItems"] = belt,
                ["Kit"] = _cfg.Kit ?? "",
                ["Health"] = tier.Health,
                ["RoamRange"] = _cfg.RoamRange,
                ["ChaseRange"] = _cfg.ChaseRange,
                ["SenseRange"] = _cfg.SenseRange,
                ["ListenRange"] = _cfg.SenseRange / 2f,
                ["AttackRangeMultiplier"] = 2f,
                ["CheckVisionCone"] = false,
                ["VisionCone"] = 135f,
                ["HostileTargetsOnly"] = false,
                ["DamageScale"] = tier.DamageScale,
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

            var tier = _tier;
            var pos = scientist.transform.position;
            var killer = info?.InitiatorPlayer;
            string grid = GridFromPos(pos);

            // Clear state + notify dashboard before doing rewards.
            _bossNetId = 0;
            _boss = null;
            _tier = null;
            _bossGrid = null;
            _despawnTimer?.Destroy();
            DestroyBossBanner();
            RemoveMapMarker();
            Interface.CallHook("OnApBossDespawned");

            SpawnLoot(pos, tier);

            if (killer != null && tier != null)
            {
                if (tier.EconomicsReward > 0)
                    Economics?.Call("Deposit", killer.UserIDString, tier.EconomicsReward);
                if (tier.ServerRewardsPoints > 0)
                    ServerRewards?.Call("AddPoints", killer.userID, tier.ServerRewardsPoints);

                if (_cfg.ReportToDashboard)
                    Interface.CallHook("OnApBossKilled", killer, tier.Name);

                killer.ChatMessage($"You slew the {tier.Name}! Rewards delivered. Loot dropped at {grid}.");
                if (_cfg.AnnounceKill)
                {
                    Broadcast($"⚔️ <color=#34d399>{killer.displayName}</color> slew <color={tier.Color}>{tier.Name}</color> at <color=#fbbf24>{grid}</color>!");
                    SendDiscord($"⚔️ **{killer.displayName}** killed **{tier.Name}** at **{grid}**.");
                }
            }
            else if (_cfg.AnnounceKill && tier != null)
            {
                Broadcast($"<color={tier.Color}>{tier.Name}</color> was destroyed. Loot dropped at <color=#fbbf24>{grid}</color>.");
            }
        }

        private void SpawnLoot(Vector3 pos, BossTier tier)
        {
            if (tier == null) return;
            try
            {
                var crate = GameManager.server.CreateEntity(tier.LootCratePrefab, pos + Vector3.up * 0.5f, Quaternion.identity);
                if (crate == null) return;
                crate.Spawn();

                var container = (crate as StorageContainer)?.inventory;
                if (container != null)
                {
                    foreach (var li in tier.BonusLoot)
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

        private void RemoveBoss()
        {
            _despawnTimer?.Destroy();
            _despawnTimer = null;
            _bannerTimer?.Destroy();
            _bannerTimer = null;
            _bossNetId = 0;
            _tier = null;
            _bossGrid = null;
            if (Alive(_boss)) _boss.Kill();
            _boss = null;
            DestroyBossBanner();
            RemoveMapMarker();
            Interface.CallHook("OnApBossDespawned");
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private static bool Alive(BaseEntity e) => e != null && !e.IsDestroyed;

        // Drive the boss's real in-world size from its tier MarkerScale. Prefers
        // EntityScaleManager (handles client replication + collider resize for the
        // finicky humanoid case); falls back to a direct transform scale + network
        // update. Server-side scaling is supported by Rust (the "giant" trick) —
        // EntityScaleManager just makes it reliable for player-type NPCs.
        private void ApplyPhysicalScale(BaseEntity ent, float markerScale)
        {
            if (!_cfg.PhysicalScaling || ent == null) return;
            float scale = markerScale * Mathf.Max(0.01f, _cfg.PhysicalScaleMultiplier);
            if (scale <= 0f || Mathf.Approximately(scale, 1f)) return;

            if (EntityScaleManager != null)
            {
                EntityScaleManager.Call("API_ScaleEntity", ent, scale);
                return;
            }

            try
            {
                ent.transform.localScale = Vector3.one * scale;
                ent.SendNetworkUpdateImmediate();
            }
            catch (Exception ex)
            {
                PrintWarning($"[ApBoss] Physical scaling failed: {ex.Message} (install EntityScaleManager for reliable NPC scaling).");
            }
        }

        // ── In-game map marker ─────────────────────────────────────────────────
        // A named label (VendingMachineMapMarker) plus a tier-coloured circle
        // (MapMarkerGenericRadius) that follow the boss on the in-game (G) map.
        private void CreateMapMarker(Vector3 pos, BossTier tier)
        {
            if (!_cfg.ShowMapMarker) return;
            RemoveMapMarker();

            try
            {
                _mapMarkerName = GameManager.server.CreateEntity(
                    "assets/prefabs/deployable/vendingmachine/vending_mapmarker.prefab", pos) as VendingMachineMapMarker;
                if (_mapMarkerName != null)
                {
                    _mapMarkerName.markerShopName = tier.Name;
                    _mapMarkerName.enableSaving = false;
                    _mapMarkerName.Spawn();
                }

                _mapMarker = GameManager.server.CreateEntity(
                    "assets/prefabs/tools/map/genericradiusmarker.prefab", pos) as MapMarkerGenericRadius;
                if (_mapMarker != null)
                {
                    Color c = ColorUtility.TryParseHtmlString(tier.Color, out var parsed) ? parsed : Color.red;
                    _mapMarker.enableSaving = false;
                    _mapMarker.color1 = c;
                    _mapMarker.color2 = c;
                    _mapMarker.alpha = Mathf.Clamp01(_cfg.MapMarkerAlpha);
                    _mapMarker.radius = Mathf.Max(0.05f, _cfg.MapMarkerRadius);
                    if (_mapMarkerName != null)
                    {
                        _mapMarker.SetParent(_mapMarkerName);
                        _mapMarker.transform.localPosition = Vector3.zero;
                    }
                    _mapMarker.Spawn();
                    _mapMarker.SendUpdate();
                }

                _markerTimer?.Destroy();
                _markerTimer = timer.Every(Mathf.Max(0.5f, _cfg.MapMarkerUpdateInterval), UpdateMapMarker);
            }
            catch (Exception ex)
            {
                PrintWarning($"[ApBoss] Map marker create failed: {ex.Message}");
                RemoveMapMarker();
            }
        }

        private void UpdateMapMarker()
        {
            if (!Alive(_boss)) return;
            var pos = _boss.transform.position;
            // The radius marker is parented to the named marker, so moving the
            // parent moves both.
            if (_mapMarkerName != null && !_mapMarkerName.IsDestroyed)
            {
                _mapMarkerName.transform.position = pos;
                _mapMarkerName.SendNetworkUpdate();
            }
            if (_mapMarker != null && !_mapMarker.IsDestroyed)
            {
                if (_mapMarkerName == null) _mapMarker.transform.position = pos;
                _mapMarker.SendUpdate();
            }
        }

        private void RemoveMapMarker()
        {
            _markerTimer?.Destroy();
            _markerTimer = null;
            if (_mapMarker != null && !_mapMarker.IsDestroyed) _mapMarker.Kill();
            if (_mapMarkerName != null && !_mapMarkerName.IsDestroyed) _mapMarkerName.Kill();
            _mapMarker = null;
            _mapMarkerName = null;
        }

        private void ShowBossBanner(BossTier tier, string grid)
        {
            if (!_cfg.ShowBossSpawnBanner || tier == null) return;

            foreach (var player in BasePlayer.activePlayerList)
                ShowBossBanner(player, tier, grid);

            _bannerTimer?.Destroy();
            float seconds = Mathf.Max(1f, _cfg.BossSpawnBannerSeconds);
            _bannerTimer = timer.Once(seconds, DestroyBossBanner);
        }

        private void ShowBossBanner(BasePlayer player, BossTier tier, string grid)
        {
            if (player == null || !player.IsConnected || tier == null) return;

            CuiHelper.DestroyUi(player, BossBannerUi);

            float fade = Mathf.Max(0f, _cfg.BossSpawnBannerFade);

            var elements = new CuiElementContainer();
            elements.Add(new CuiPanel
            {
                Image = { Color = _cfg.BossSpawnBannerBackground, FadeIn = fade },
                RectTransform = { AnchorMin = "0.285 0.905", AnchorMax = "0.715 0.985" },
                CursorEnabled = false,
                FadeOut = fade
            }, "Overlay", BossBannerUi);

            elements.Add(new CuiPanel
            {
                Image = { Color = _cfg.BossSpawnBannerAccent, FadeIn = fade },
                RectTransform = { AnchorMin = "0 0", AnchorMax = "0.018 1" },
                CursorEnabled = false,
                FadeOut = fade
            }, BossBannerUi);

            elements.Add(new CuiLabel
            {
                Text =
                {
                    Text = _cfg.BossSpawnBannerTitle,
                    FontSize = 13,
                    Align = TextAnchor.UpperLeft,
                    Color = _cfg.BossSpawnBannerAccent,
                    FadeIn = fade
                },
                RectTransform = { AnchorMin = "0.045 0.58", AnchorMax = "0.62 0.92" },
                FadeOut = fade
            }, BossBannerUi);

            elements.Add(new CuiLabel
            {
                Text =
                {
                    Text = $"{tier.Name} spawned at grid {grid}",
                    FontSize = 18,
                    Align = TextAnchor.MiddleLeft,
                    Color = _cfg.BossSpawnBannerText,
                    FadeIn = fade
                },
                RectTransform = { AnchorMin = "0.045 0.16", AnchorMax = "0.74 0.66" },
                FadeOut = fade
            }, BossBannerUi);

            elements.Add(new CuiLabel
            {
                Text =
                {
                    Text = _cfg.BossSpawnBannerSubtitle,
                    FontSize = 11,
                    Align = TextAnchor.LowerLeft,
                    Color = "0.82 0.82 0.82 1",
                    FadeIn = fade
                },
                RectTransform = { AnchorMin = "0.045 0.04", AnchorMax = "0.74 0.26" },
                FadeOut = fade
            }, BossBannerUi);

            elements.Add(new CuiLabel
            {
                Text =
                {
                    Text = grid,
                    FontSize = 24,
                    Align = TextAnchor.MiddleCenter,
                    Color = _cfg.BossSpawnBannerText,
                    FadeIn = fade
                },
                RectTransform = { AnchorMin = "0.76 0.12", AnchorMax = "0.96 0.86" },
                FadeOut = fade
            }, BossBannerUi);

            CuiHelper.AddUi(player, elements);
        }

        private void DestroyBossBanner()
        {
            foreach (var player in BasePlayer.activePlayerList)
                CuiHelper.DestroyUi(player, BossBannerUi);
            _bannerTimer?.Destroy();
            _bannerTimer = null;
        }

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
