using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApMarket", "SlayStudios", "1.0.0")]
    [Description("Vendor shop: players sell (and optionally buy) items for RP/coins via chat commands")]
    public class ApMarket : RustPlugin
    {
        [PluginReference] private Plugin ServerRewards, Economics;

        // ── Config ────────────────────────────────────────────────────────────
        private Configuration _cfg;

        private class ItemPrice
        {
            [JsonProperty("Sell price (per item, 0 = not sellable)")] public int Sell { get; set; }
            [JsonProperty("Buy price (per item, 0 = not buyable)")] public int Buy { get; set; }
        }

        private class Configuration
        {
            [JsonProperty("Use Economics money instead of ServerRewards RP")]
            public bool UseEconomics { get; set; } = false;

            [JsonProperty("Allow buying")] public bool AllowBuy { get; set; } = true;

            [JsonProperty("Chat prefix")] public string ChatPrefix { get; set; } = "<color=#34d399>[Market]</color>";

            [JsonProperty("Prices (item shortname -> sell/buy)")]
            public Dictionary<string, ItemPrice> Prices { get; set; } = new()
            {
                ["scrap"] = new ItemPrice { Sell = 2, Buy = 0 },
                ["cloth"] = new ItemPrice { Sell = 1, Buy = 0 },
                ["leather"] = new ItemPrice { Sell = 1, Buy = 0 },
                ["sulfur"] = new ItemPrice { Sell = 1, Buy = 0 },
                ["crude.oil"] = new ItemPrice { Sell = 2, Buy = 0 },
                ["lowgradefuel"] = new ItemPrice { Sell = 1, Buy = 0 },
                ["metal.refined"] = new ItemPrice { Sell = 5, Buy = 0 },
                ["bone.fragments"] = new ItemPrice { Sell = 1, Buy = 0 },
                ["bandage"] = new ItemPrice { Sell = 0, Buy = 2 },
                ["syringe.medical"] = new ItemPrice { Sell = 0, Buy = 10 },
            };
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { _cfg = Config.ReadObject<Configuration>(); }
            catch { _cfg = new Configuration(); }
            if (_cfg.Prices == null || _cfg.Prices.Count == 0) _cfg.Prices = new Configuration().Prices;
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_cfg);
        protected override void LoadDefaultConfig() => _cfg = new Configuration();

        private void OnServerInitialized()
        {
            LoadConfig();
            if (ServerRewards == null && !_cfg.UseEconomics)
                PrintWarning("[ApMarket] ServerRewards not loaded — selling for RP won't pay out until it is.");
            if (Economics == null && _cfg.UseEconomics)
                PrintWarning("[ApMarket] Economics not loaded — selling for coins won't pay out until it is.");
        }

        private string Cur => _cfg.UseEconomics ? "coins" : "RP";

        // ── Sell ──────────────────────────────────────────────────────────────
        [ChatCommand("sell")]
        private void CmdSell(BasePlayer player, string command, string[] args)
        {
            if (args.Length > 0 && args[0].ToLower() == "all") { SellAll(player); return; }

            var held = player.GetActiveItem();
            if (held == null) { Msg(player, "Hold the item to sell, or use /sell all. See /sellprice."); return; }

            if (!_cfg.Prices.TryGetValue(held.info.shortname, out var price) || price.Sell <= 0)
            {
                Msg(player, $"{held.info.displayName.english} can't be sold here.");
                return;
            }

            int amount = held.amount;
            if (args.Length > 0 && int.TryParse(args[0], out var n)) amount = Mathf.Clamp(n, 1, held.amount);

            SellShortname(player, held.info.shortname, amount, price.Sell);
        }

        private void SellAll(BasePlayer player)
        {
            int totalPay = 0;
            int totalItems = 0;
            foreach (var kv in _cfg.Prices)
            {
                if (kv.Value.Sell <= 0) continue;
                var def = ItemManager.FindItemDefinition(kv.Key);
                if (def == null) continue;
                int have = player.inventory.GetAmount(def.itemid);
                if (have <= 0) continue;
                int taken = player.inventory.Take(null, def.itemid, have);
                if (taken <= 0) continue;
                totalPay += taken * kv.Value.Sell;
                totalItems += taken;
            }
            if (totalPay <= 0) { Msg(player, "You have nothing sellable. See /sellprice."); return; }
            GivePoints(player, totalPay);
            Msg(player, $"Sold {totalItems} items for <color=#fbbf24>{totalPay}</color> {Cur}.");
        }

        private void SellShortname(BasePlayer player, string shortname, int amount, int unit)
        {
            var def = ItemManager.FindItemDefinition(shortname);
            if (def == null) { Msg(player, "Unknown item."); return; }
            int taken = player.inventory.Take(null, def.itemid, amount);
            if (taken <= 0) { Msg(player, "Nothing to sell."); return; }
            int pay = taken * unit;
            GivePoints(player, pay);
            Msg(player, $"Sold {taken}x {def.displayName.english} for <color=#fbbf24>{pay}</color> {Cur}.");
        }

        // ── Buy ───────────────────────────────────────────────────────────────
        [ChatCommand("buy")]
        private void CmdBuy(BasePlayer player, string command, string[] args)
        {
            if (!_cfg.AllowBuy) { Msg(player, "Buying is disabled."); return; }
            if (args.Length < 1) { Msg(player, "Usage: /buy <item> [amount]"); return; }

            string shortname = args[0].ToLower();
            if (!_cfg.Prices.TryGetValue(shortname, out var price) || price.Buy <= 0)
            {
                Msg(player, $"'{shortname}' isn't buyable. See /sellprice for the catalog.");
                return;
            }
            var def = ItemManager.FindItemDefinition(shortname);
            if (def == null) { Msg(player, "Unknown item."); return; }

            int amount = 1;
            if (args.Length > 1 && int.TryParse(args[1], out var n)) amount = Mathf.Max(1, n);

            int cost = amount * price.Buy;
            if (!TakePoints(player, cost))
            {
                Msg(player, $"Not enough {Cur}. You need {cost}, have {GetBalance(player)}.");
                return;
            }
            player.GiveItem(ItemManager.CreateByName(shortname, amount), BaseEntity.GiveItemReason.PickedUp);
            Msg(player, $"Bought {amount}x {def.displayName.english} for <color=#fbbf24>{cost}</color> {Cur}.");
        }

        // ── Price list ────────────────────────────────────────────────────────
        [ChatCommand("sellprice")]
        private void CmdSellPrice(BasePlayer player, string command, string[] args)
        {
            var sb = new StringBuilder();
            sb.AppendLine($"<color=#34d399>── Market ({Cur}) ──</color>");
            foreach (var kv in _cfg.Prices.OrderByDescending(k => k.Value.Sell))
            {
                var def = ItemManager.FindItemDefinition(kv.Key);
                string name = def?.displayName?.english ?? kv.Key;
                var parts = new List<string>();
                if (kv.Value.Sell > 0) parts.Add($"sell <color=#fbbf24>{kv.Value.Sell}</color>");
                if (_cfg.AllowBuy && kv.Value.Buy > 0) parts.Add($"buy <color=#f87171>{kv.Value.Buy}</color>");
                if (parts.Count == 0) continue;
                sb.AppendLine($"{name} — {string.Join(", ", parts)}");
            }
            sb.AppendLine("<color=#9ca3af>/sell (held) · /sell all · /buy <item> [amount]</color>");
            player.ChatMessage(sb.ToString());
        }

        // ── Currency helpers ──────────────────────────────────────────────────
        private void GivePoints(BasePlayer p, int amount)
        {
            if (amount <= 0) return;
            if (_cfg.UseEconomics) Economics?.Call("Deposit", p.UserIDString, (double)amount);
            else ServerRewards?.Call("AddPoints", p.userID, amount);
        }

        private int GetBalance(BasePlayer p)
        {
            if (_cfg.UseEconomics)
            {
                var b = Economics?.Call("Balance", p.userID);
                if (b is double d) return (int)d;
                return 0;
            }
            var pts = ServerRewards?.Call("CheckPoints", p.userID);
            return pts is int i ? i : 0;
        }

        private bool TakePoints(BasePlayer p, int amount)
        {
            if (GetBalance(p) < amount) return false;
            if (_cfg.UseEconomics) Economics?.Call("Withdraw", p.UserIDString, (double)amount);
            else ServerRewards?.Call("TakePoints", p.userID, amount);
            return true;
        }

        private void Msg(BasePlayer p, string msg) => p.ChatMessage($"{_cfg.ChatPrefix} {msg}");
    }
}
