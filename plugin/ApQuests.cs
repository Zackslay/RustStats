using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Plugins;
using Oxide.Game.Rust.Cui;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApQuests", "SlayStudios", "1.0.0")]
    [Description("Starter questline that funnels new players through their first milestones for RP rewards, with a CUI progress panel (/quests).")]
    public class ApQuests : RustPlugin
    {
        [PluginReference] private Plugin ServerRewards;

        private Configuration _cfg;

        // Quest types the funnel understands.
        // gather (matches Shortname) | animal | scientist | buildtc
        private class Quest
        {
            [JsonProperty("Key")] public string Key { get; set; } = "wood";
            [JsonProperty("Title")] public string Title { get; set; } = "Gather 100 wood";
            [JsonProperty("Type (gather|animal|scientist|buildtc)")] public string Type { get; set; } = "gather";
            [JsonProperty("Item shortname (gather only)")] public string Shortname { get; set; } = "wood";
            [JsonProperty("Target amount")] public int Target { get; set; } = 100;
            [JsonProperty("RP reward")] public int Reward { get; set; } = 25;
        }

        private class Configuration
        {
            [JsonProperty("Currency label")] public string CurrencyLabel { get; set; } = "RP";
            [JsonProperty("Chat prefix")] public string ChatPrefix { get; set; } = "<color=#a78bfa>[Quests]</color>";
            [JsonProperty("Welcome message on connect")] public bool Welcome { get; set; } = true;
            [JsonProperty("Final completion bonus RP")] public int FinalBonus { get; set; } = 100;
            [JsonProperty("Quests (in order)")] public List<Quest> Quests { get; set; } = new()
            {
                new Quest { Key = "wood",      Title = "Gather 100 wood",      Type = "gather",    Shortname = "wood",   Target = 100, Reward = 25 },
                new Quest { Key = "stone",     Title = "Gather 100 stone",     Type = "gather",    Shortname = "stones", Target = 100, Reward = 25 },
                new Quest { Key = "hunt",      Title = "Hunt an animal",       Type = "animal",    Shortname = "",       Target = 1,   Reward = 30 },
                new Quest { Key = "scientist", Title = "Kill 3 scientists",    Type = "scientist", Shortname = "",       Target = 3,   Reward = 50 },
                new Quest { Key = "tc",        Title = "Place a Tool Cupboard", Type = "buildtc",  Shortname = "",       Target = 1,   Reward = 50 },
            };
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { _cfg = Config.ReadObject<Configuration>(); }
            catch { _cfg = new Configuration(); }
            if (_cfg.Quests == null || _cfg.Quests.Count == 0) _cfg.Quests = new Configuration().Quests;
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_cfg);
        protected override void LoadDefaultConfig() => _cfg = new Configuration();

        // ── Persistence ─────────────────────────────────────────────────────────
        private class Progress
        {
            public int Step;       // index into _cfg.Quests
            public int Count;      // progress toward the current step
            public bool Done;      // whole questline complete
        }

        private class StoredData { public Dictionary<ulong, Progress> Players = new(); }

        private StoredData _data;
        private const string UiName = "ApQuests.Panel";

        private void Load()
        {
            try { _data = Interface.Oxide.DataFileSystem.ReadObject<StoredData>("ApQuests"); }
            catch { _data = null; }
            if (_data == null) _data = new StoredData();
            if (_data.Players == null) _data.Players = new Dictionary<ulong, Progress>();
        }

        private void Save() => Interface.Oxide.DataFileSystem.WriteObject("ApQuests", _data);

        private void OnServerInitialized()
        {
            LoadConfig();
            Load();
            Puts($"[ApQuests] {_cfg.Quests.Count} starter quests loaded.");
        }

        private void Unload()
        {
            foreach (var p in BasePlayer.activePlayerList) CuiHelper.DestroyUi(p, UiName);
            Save();
        }

        private Progress Get(ulong id)
        {
            if (!_data.Players.TryGetValue(id, out var p)) { p = new Progress(); _data.Players[id] = p; }
            return p;
        }

        private void OnPlayerConnected(BasePlayer player)
        {
            if (!_cfg.Welcome || player == null) return;
            var prog = Get(player.userID);
            if (prog.Done) return;
            timer.Once(8f, () =>
            {
                if (player != null && player.IsConnected)
                    Msg(player, "Welcome! Complete the starter quests for free <color=#fbbf24>" + _cfg.CurrencyLabel + "</color> — type <color=#fff>/quests</color> to see them.");
            });
        }

        // ── Progress hooks ───────────────────────────────────────────────────────
        private void OnDispenserGather(ResourceDispenser dispenser, BaseEntity entity, Item item)
        {
            if (entity is BasePlayer p && item != null) Advance(p, "gather", item.info.shortname, item.amount);
        }

        private void OnDispenserBonus(ResourceDispenser dispenser, BaseEntity entity, Item item)
        {
            if (entity is BasePlayer p && item != null) Advance(p, "gather", item.info.shortname, item.amount);
        }

        private void OnCollectiblePickup(CollectibleEntity collectible, BasePlayer player)
        {
            if (collectible?.itemList == null || player == null) return;
            foreach (var ia in collectible.itemList)
                Advance(player, "gather", ia.itemDef.shortname, (int)ia.amount);
        }

        // Scientists (most-specific overload — Oxide routes NPC deaths here).
        private void OnEntityDeath(NPCPlayer npc, HitInfo info)
        {
            var killer = info?.InitiatorPlayer;
            if (killer == null || npc == null) return;
            Advance(killer, "scientist", null, 1);
        }

        // Animals / players / other (NPC humanoids never reach here).
        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            var killer = info?.InitiatorPlayer;
            if (killer == null) return;
            if (entity is BaseAnimalNPC) Advance(killer, "animal", null, 1);
        }

        private void OnEntityBuilt(Planner planner, GameObject go)
        {
            var player = planner?.GetOwnerPlayer();
            if (player == null || go == null) return;
            if (go.ToBaseEntity() is BuildingPrivlidge) Advance(player, "buildtc", null, 1);
        }

        // Core advance: only the player's CURRENT step can progress (a true funnel).
        private void Advance(BasePlayer player, string type, string shortname, int amount)
        {
            if (player == null || amount <= 0) return;
            var prog = Get(player.userID);
            if (prog.Done || prog.Step >= _cfg.Quests.Count) return;

            var q = _cfg.Quests[prog.Step];
            if (q.Type != type) return;
            if (q.Type == "gather" && !string.Equals(q.Shortname, shortname, StringComparison.OrdinalIgnoreCase)) return;

            prog.Count += amount;
            if (prog.Count < q.Target) { Save(); RefreshIfOpen(player); return; }

            // Step complete → reward + advance.
            if (q.Reward > 0) ServerRewards?.Call("AddPoints", player.userID, q.Reward);
            Msg(player, $"✔ <color=#34d399>{q.Title}</color> complete! +{q.Reward} {_cfg.CurrencyLabel}");
            prog.Step++;
            prog.Count = 0;

            if (prog.Step >= _cfg.Quests.Count)
            {
                prog.Done = true;
                if (_cfg.FinalBonus > 0) ServerRewards?.Call("AddPoints", player.userID, _cfg.FinalBonus);
                Msg(player, $"🎓 You finished the starter questline! Bonus +{_cfg.FinalBonus} {_cfg.CurrencyLabel}. Good luck out there.");
                CuiHelper.DestroyUi(player, UiName);
            }
            Save();
            RefreshIfOpen(player);
        }

        // ── UI ────────────────────────────────────────────────────────────────────
        private readonly HashSet<ulong> _open = new();

        [ChatCommand("quests")]
        private void CmdQuests(BasePlayer player, string command, string[] args)
        {
            if (_open.Contains(player.userID)) { CloseUi(player); return; }
            OpenUi(player);
        }

        [ConsoleCommand("apquests.close")]
        private void CcClose(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer;
            if (p != null) CloseUi(p);
        }

        private void RefreshIfOpen(BasePlayer player)
        {
            if (player != null && _open.Contains(player.userID)) OpenUi(player);
        }

        private void CloseUi(BasePlayer player)
        {
            _open.Remove(player.userID);
            CuiHelper.DestroyUi(player, UiName);
        }

        private void OpenUi(BasePlayer player)
        {
            var prog = Get(player.userID);
            _open.Add(player.userID);
            CuiHelper.DestroyUi(player, UiName);

            var c = new CuiElementContainer();
            c.Add(new CuiPanel { Image = { Color = "0 0 0 0.75" }, RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }, CursorEnabled = true }, "Overlay", UiName);
            string panel = c.Add(new CuiPanel { Image = { Color = "0.10 0.10 0.12 0.98" }, RectTransform = { AnchorMin = "0.32 0.24", AnchorMax = "0.68 0.78" } }, UiName);

            // Header
            c.Add(new CuiPanel { Image = { Color = "0.45 0.35 0.70 0.95" }, RectTransform = { AnchorMin = "0 0.9", AnchorMax = "1 1" } }, panel);
            c.Add(new CuiLabel { Text = { Text = "  STARTER QUESTS", FontSize = 17, Align = TextAnchor.MiddleLeft, Color = "1 1 1 1" }, RectTransform = { AnchorMin = "0 0.9", AnchorMax = "0.8 1" } }, panel);
            c.Add(new CuiButton { Button = { Command = "apquests.close", Color = "0 0 0 0.4" }, Text = { Text = "✕", FontSize = 15, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" }, RectTransform = { AnchorMin = "0.9 0.9", AnchorMax = "1 1" } }, panel);

            if (prog.Done)
            {
                c.Add(new CuiLabel { Text = { Text = "🎓 All starter quests complete — nice work!", FontSize = 14, Align = TextAnchor.MiddleCenter, Color = "0.7 0.95 0.75 1" }, RectTransform = { AnchorMin = "0.05 0.4", AnchorMax = "0.95 0.6" } }, panel);
                CuiHelper.AddUi(player, c);
                return;
            }

            // Quest rows
            int n = _cfg.Quests.Count;
            float top = 0.86f, bottom = 0.04f;
            float rowH = (top - bottom) / Mathf.Max(1, n);
            for (int i = 0; i < n; i++)
            {
                var q = _cfg.Quests[i];
                float yMax = top - i * rowH;
                float yMin = yMax - rowH + 0.012f;

                bool done = i < prog.Step;
                bool current = i == prog.Step;
                int cur = current ? prog.Count : (done ? q.Target : 0);
                string status = done ? "<color=#34d399>✔</color>" : current ? $"<color=#fbbf24>{cur}/{q.Target}</color>" : "<color=#6b7280>locked</color>";
                string nameColor = done ? "0.55 0.6 0.55 1" : current ? "1 1 1 1" : "0.5 0.5 0.55 1";

                string row = c.Add(new CuiPanel { Image = { Color = current ? "0.18 0.16 0.24 0.9" : "0.14 0.14 0.16 0.7" }, RectTransform = { AnchorMin = $"0.03 {yMin}", AnchorMax = $"0.97 {yMax}" } }, panel);
                c.Add(new CuiLabel { Text = { Text = $"{i + 1}. {q.Title}", FontSize = 13, Align = TextAnchor.MiddleLeft, Color = nameColor }, RectTransform = { AnchorMin = "0.03 0", AnchorMax = "0.7 1" } }, row);
                c.Add(new CuiLabel { Text = { Text = status, FontSize = 13, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" }, RectTransform = { AnchorMin = "0.6 0", AnchorMax = "0.85 1" } }, row);
                c.Add(new CuiLabel { Text = { Text = $"+{q.Reward}", FontSize = 12, Align = TextAnchor.MiddleRight, Color = "0.9 0.8 0.4 1" }, RectTransform = { AnchorMin = "0.85 0", AnchorMax = "0.98 1" } }, row);
            }

            CuiHelper.AddUi(player, c);
        }

        private void Msg(BasePlayer p, string msg) => p.ChatMessage($"{_cfg.ChatPrefix} {msg}");
    }
}
