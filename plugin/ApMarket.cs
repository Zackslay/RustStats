using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Plugins;
using Oxide.Game.Rust.Cui;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApMarket", "SlayStudios", "1.1.0")]
    [Description("Vendor shop with an in-game UI menu: sell and buy items for RP/coins")]
    public class ApMarket : RustPlugin
    {
        [PluginReference] private Plugin ServerRewards, Economics;

        private const string UiName = "apmarket.ui";
        private const int PerPage = 8;

        // ── Config ────────────────────────────────────────────────────────────
        private Configuration _cfg;

        private class ItemPrice
        {
            [JsonProperty("Sell price (per item, 0 = not sellable)")] public int Sell { get; set; }
            [JsonProperty("Buy price (per item, 0 = not buyable)")] public int Buy { get; set; }
        }

        private class Configuration
        {
            [JsonProperty("Currency mode: serverrewards | economics | bank")] public string CurrencyMode { get; set; } = "serverrewards";
            [JsonProperty("Currency label (e.g. RP, coins, AP Points)")] public string CurrencyLabel { get; set; } = "RP";
            [JsonProperty("Bank plugin name (bank mode)")] public string BankPlugin { get; set; } = "BankSystem";
            [JsonProperty("Bank deposit method")] public string BankDeposit { get; set; } = "API_BankSystemDeposit";
            [JsonProperty("Bank withdraw method")] public string BankWithdraw { get; set; } = "API_BankSystemWithdraw";
            [JsonProperty("Bank balance method")] public string BankBalance { get; set; } = "API_BankSystemBalance";
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

        private void OnServerInitialized() => LoadConfig();
        private void Unload()
        {
            foreach (var p in BasePlayer.activePlayerList) CuiHelper.DestroyUi(p, UiName);
        }
        private void OnPlayerDisconnected(BasePlayer player, string reason) => CuiHelper.DestroyUi(player, UiName);

        private string Cur => _cfg.CurrencyLabel;
        private Plugin Bank => Interface.Oxide.RootPluginManager.GetPlugin(_cfg.BankPlugin) as Plugin;
        private List<KeyValuePair<string, ItemPrice>> Catalog =>
            _cfg.Prices.Where(p => p.Value.Sell > 0 || (_cfg.AllowBuy && p.Value.Buy > 0)).ToList();

        // ── Chat entry points ──────────────────────────────────────────────────
        [ChatCommand("shop")]
        private void CmdShop(BasePlayer player, string command, string[] args) => OpenUi(player, 0, "");

        [ChatCommand("sell")]
        private void CmdSell(BasePlayer player, string command, string[] args)
        {
            if (args.Length > 0 && args[0].ToLower() == "all") { SellAll(player); return; }
            var held = player.GetActiveItem();
            if (held == null) { Msg(player, "Hold the item to sell, or open /shop."); return; }
            if (!_cfg.Prices.TryGetValue(held.info.shortname, out var price) || price.Sell <= 0)
            { Msg(player, $"{held.info.displayName.english} can't be sold here."); return; }
            int amount = held.amount;
            if (args.Length > 0 && int.TryParse(args[0], out var n)) amount = Mathf.Clamp(n, 1, held.amount);
            var (taken, pay) = DoSell(player, held.info.shortname, amount);
            Msg(player, taken > 0 ? $"Sold {taken}x {DisplayName(held.info.shortname)} for {pay} {Cur}." : "Nothing to sell.");
        }

        [ChatCommand("sellprice")]
        private void CmdSellPrice(BasePlayer player, string command, string[] args) => OpenUi(player, 0, "");

        [ChatCommand("buy")]
        private void CmdBuy(BasePlayer player, string command, string[] args)
        {
            if (!_cfg.AllowBuy) { Msg(player, "Buying is disabled."); return; }
            if (args.Length < 1) { Msg(player, "Usage: /buy <item> [amount] — or open /shop"); return; }
            int amount = args.Length > 1 && int.TryParse(args[1], out var n) ? Mathf.Max(1, n) : 1;
            var (ok, msg) = DoBuy(player, args[0].ToLower(), amount);
            Msg(player, msg);
        }

        // ── Shared sell/buy logic ───────────────────────────────────────────────
        private (int taken, int pay) DoSell(BasePlayer player, string shortname, int amount)
        {
            if (!_cfg.Prices.TryGetValue(shortname, out var price) || price.Sell <= 0) return (0, 0);
            var def = ItemManager.FindItemDefinition(shortname);
            if (def == null) return (0, 0);
            int taken = player.inventory.Take(null, def.itemid, amount);
            if (taken <= 0) return (0, 0);
            int pay = taken * price.Sell;
            GivePoints(player, pay);
            return (taken, pay);
        }

        private void SellAll(BasePlayer player)
        {
            int totalPay = 0, totalItems = 0;
            foreach (var kv in _cfg.Prices)
            {
                if (kv.Value.Sell <= 0) continue;
                var def = ItemManager.FindItemDefinition(kv.Key);
                if (def == null) continue;
                int have = player.inventory.GetAmount(def.itemid);
                if (have <= 0) continue;
                var (taken, pay) = DoSell(player, kv.Key, have);
                totalItems += taken; totalPay += pay;
            }
            Msg(player, totalPay > 0 ? $"Sold {totalItems} items for {totalPay} {Cur}." : "Nothing sellable in your inventory.");
        }

        private (bool ok, string msg) DoBuy(BasePlayer player, string shortname, int amount)
        {
            if (!_cfg.AllowBuy) return (false, "Buying is disabled.");
            if (!_cfg.Prices.TryGetValue(shortname, out var price) || price.Buy <= 0)
                return (false, $"'{shortname}' isn't buyable.");
            var def = ItemManager.FindItemDefinition(shortname);
            if (def == null) return (false, "Unknown item.");
            int cost = amount * price.Buy;
            if (!TakePoints(player, cost))
                return (false, $"Not enough {Cur}. Need {cost}, have {GetBalance(player)}.");
            player.GiveItem(ItemManager.CreateByName(shortname, amount), BaseEntity.GiveItemReason.PickedUp);
            return (true, $"Bought {amount}x {DisplayName(shortname)} for {cost} {Cur}.");
        }

        // ── UI ──────────────────────────────────────────────────────────────────
        private void OpenUi(BasePlayer player, int page, string status)
        {
            var catalog = Catalog;
            int pages = Mathf.Max(1, Mathf.CeilToInt(catalog.Count / (float)PerPage));
            page = Mathf.Clamp(page, 0, pages - 1);

            CuiHelper.DestroyUi(player, UiName);
            var c = new CuiElementContainer();

            // Dimmed backdrop + main panel
            c.Add(new CuiPanel
            {
                Image = { Color = "0 0 0 0.75" },
                RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" },
                CursorEnabled = true
            }, "Overlay", UiName);

            string panel = c.Add(new CuiPanel
            {
                Image = { Color = "0.10 0.10 0.11 0.98" },
                RectTransform = { AnchorMin = "0.28 0.16", AnchorMax = "0.72 0.84" }
            }, UiName);

            // Header bar
            c.Add(new CuiPanel { Image = { Color = "0.86 0.15 0.15 0.95" }, RectTransform = { AnchorMin = "0 0.92", AnchorMax = "1 1" } }, panel);
            c.Add(new CuiLabel
            {
                Text = { Text = "  MARKET", FontSize = 18, Align = TextAnchor.MiddleLeft, Color = "1 1 1 1" },
                RectTransform = { AnchorMin = "0 0.92", AnchorMax = "0.7 1" }
            }, panel);
            c.Add(new CuiLabel
            {
                Text = { Text = $"{GetBalance(player)} {Cur}   ", FontSize = 13, Align = TextAnchor.MiddleRight, Color = "1 1 1 0.9" },
                RectTransform = { AnchorMin = "0.55 0.92", AnchorMax = "0.92 1" }
            }, panel);
            c.Add(new CuiButton
            {
                Button = { Command = "apmarket.close", Color = "0 0 0 0.4" },
                Text = { Text = "✕", FontSize = 16, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" },
                RectTransform = { AnchorMin = "0.92 0.92", AnchorMax = "1 1" }
            }, panel);

            // Column headers
            c.Add(new CuiLabel { Text = { Text = "Item", FontSize = 11, Align = TextAnchor.MiddleLeft, Color = "0.6 0.6 0.6 1" }, RectTransform = { AnchorMin = "0.03 0.86", AnchorMax = "0.45 0.91" } }, panel);
            c.Add(new CuiLabel { Text = { Text = "Price", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "0.6 0.6 0.6 1" }, RectTransform = { AnchorMin = "0.45 0.86", AnchorMax = "0.62 0.91" } }, panel);

            // Rows
            var pageItems = catalog.Skip(page * PerPage).Take(PerPage).ToList();
            for (int i = 0; i < pageItems.Count; i++)
            {
                var kv = pageItems[i];
                float top = 0.85f - i * 0.092f;
                float bot = top - 0.082f;
                string name = DisplayName(kv.Key);

                // alternating row bg
                if (i % 2 == 0)
                    c.Add(new CuiPanel { Image = { Color = "1 1 1 0.03" }, RectTransform = { AnchorMin = $"0.02 {F(bot)}", AnchorMax = $"0.98 {F(top)}" } }, panel);

                c.Add(new CuiLabel { Text = { Text = name, FontSize = 12, Align = TextAnchor.MiddleLeft, Color = "1 1 1 1" }, RectTransform = { AnchorMin = $"0.03 {F(bot)}", AnchorMax = $"0.45 {F(top)}" } }, panel);

                string priceText = "";
                if (kv.Value.Sell > 0) priceText += $"sell {kv.Value.Sell}";
                if (_cfg.AllowBuy && kv.Value.Buy > 0) priceText += (priceText.Length > 0 ? "  " : "") + $"buy {kv.Value.Buy}";
                c.Add(new CuiLabel { Text = { Text = priceText, FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "0.8 0.8 0.85 1" }, RectTransform = { AnchorMin = $"0.45 {F(bot)}", AnchorMax = $"0.62 {F(top)}" } }, panel);

                if (kv.Value.Sell > 0)
                {
                    c.Add(Btn($"apmarket.do sell1 {kv.Key} {page}", "Sell 1", "0.20 0.45 0.25 1", 0.63f, 0.74f, bot, top), panel);
                    c.Add(Btn($"apmarket.do sellall {kv.Key} {page}", "Sell All", "0.20 0.40 0.25 1", 0.745f, 0.86f, bot, top), panel);
                }
                if (_cfg.AllowBuy && kv.Value.Buy > 0)
                    c.Add(Btn($"apmarket.do buy1 {kv.Key} {page}", "Buy 1", "0.45 0.25 0.25 1", 0.865f, 0.97f, bot, top), panel);
            }

            // Footer: pager + status
            if (page > 0)
                c.Add(Btn($"apmarket.open {page - 1}", "< Prev", "0.2 0.2 0.22 1", 0.03f, 0.16f, 0.02f, 0.085f), panel);
            if (page < pages - 1)
                c.Add(Btn($"apmarket.open {page + 1}", "Next >", "0.2 0.2 0.22 1", 0.84f, 0.97f, 0.02f, 0.085f), panel);
            c.Add(new CuiLabel
            {
                Text = { Text = status.Length > 0 ? status : $"Page {page + 1}/{pages}  ·  hold items & Sell, or Buy with {Cur}", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "0.7 0.85 0.7 1" },
                RectTransform = { AnchorMin = "0.17 0.02", AnchorMax = "0.83 0.085" }
            }, panel);

            CuiHelper.AddUi(player, c);
        }

        // Invariant float formatting so CUI anchors never use comma decimals.
        private static string F(float v) => v.ToString("0.####", CultureInfo.InvariantCulture);

        private static CuiButton Btn(string cmd, string text, string color, float xMin, float xMax, float yMin, float yMax) => new()
        {
            Button = { Command = cmd, Color = color },
            Text = { Text = text, FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" },
            RectTransform = { AnchorMin = $"{F(xMin)} {F(yMin)}", AnchorMax = $"{F(xMax)} {F(yMax)}" }
        };

        // ── Console handlers (UI buttons) ────────────────────────────────────────
        [ConsoleCommand("apmarket.close")]
        private void CcClose(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer;
            if (p != null) CuiHelper.DestroyUi(p, UiName);
        }

        [ConsoleCommand("apmarket.open")]
        private void CcOpen(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer;
            if (p == null) return;
            OpenUi(p, arg.GetInt(0, 0), "");
        }

        [ConsoleCommand("apmarket.do")]
        private void CcDo(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer;
            if (p == null) return;
            string action = arg.GetString(0, "");
            string shortname = arg.GetString(1, "");
            int page = arg.GetInt(2, 0);
            if (action.Length == 0 || shortname.Length == 0) return;
            string status;

            switch (action)
            {
                case "sell1":
                {
                    var (taken, pay) = DoSell(p, shortname, 1);
                    status = taken > 0 ? $"Sold 1x {DisplayName(shortname)} (+{pay} {Cur})" : "None to sell";
                    break;
                }
                case "sellall":
                {
                    var def = ItemManager.FindItemDefinition(shortname);
                    int have = def != null ? p.inventory.GetAmount(def.itemid) : 0;
                    var (taken, pay) = DoSell(p, shortname, have);
                    status = taken > 0 ? $"Sold {taken}x {DisplayName(shortname)} (+{pay} {Cur})" : "None to sell";
                    break;
                }
                case "buy1":
                {
                    var (ok, msg) = DoBuy(p, shortname, 1);
                    status = msg;
                    break;
                }
                default: status = ""; break;
            }
            OpenUi(p, page, status);
        }

        // ── Currency ──────────────────────────────────────────────────────────
        private void GivePoints(BasePlayer p, int amount)
        {
            if (amount <= 0) return;
            switch (_cfg.CurrencyMode)
            {
                case "economics": Economics?.Call("Deposit", p.UserIDString, (double)amount); break;
                case "bank": Bank?.Call(_cfg.BankDeposit, p.userID, amount); break;
                default: ServerRewards?.Call("AddPoints", p.userID, amount); break;
            }
        }

        private int GetBalance(BasePlayer p)
        {
            switch (_cfg.CurrencyMode)
            {
                case "economics":
                {
                    var b = Economics?.Call("Balance", p.userID);
                    return b is double d ? (int)d : 0;
                }
                case "bank":
                {
                    var b = Bank?.Call(_cfg.BankBalance, p.userID);
                    if (b is double bd) return (int)bd;
                    if (b is int bi) return bi;
                    return 0;
                }
                default:
                {
                    var pts = ServerRewards?.Call("CheckPoints", p.userID);
                    return pts is int i ? i : 0;
                }
            }
        }

        private bool TakePoints(BasePlayer p, int amount)
        {
            if (GetBalance(p) < amount) return false;
            switch (_cfg.CurrencyMode)
            {
                case "economics": Economics?.Call("Withdraw", p.UserIDString, (double)amount); break;
                case "bank": Bank?.Call(_cfg.BankWithdraw, p.userID, amount); break;
                default: ServerRewards?.Call("TakePoints", p.userID, amount); break;
            }
            return true;
        }

        private static string DisplayName(string shortname)
        {
            var def = ItemManager.FindItemDefinition(shortname);
            return def?.displayName?.english ?? shortname;
        }

        private void Msg(BasePlayer p, string msg) => p.ChatMessage($"{_cfg.ChatPrefix} {msg}");
    }
}
