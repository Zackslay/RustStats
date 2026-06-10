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
    [Info("ApAuction", "SlayStudios", "1.1.0")]
    [Description("Player-to-player market with an in-game menu: list items for RP/points, others buy them.")]
    public class ApAuction : RustPlugin
    {
        [PluginReference] private Plugin ServerRewards, Economics;

        private const string UiName = "apauction.ui";
        private const int PerPage = 8;

        private Configuration _cfg;
        private StoredData _data;

        // ── Config ────────────────────────────────────────────────────────────
        private class Configuration
        {
            [JsonProperty("Currency mode: serverrewards | economics | bank")] public string CurrencyMode { get; set; } = "serverrewards";
            [JsonProperty("Currency label (e.g. RP, coins, AP Points)")] public string CurrencyLabel { get; set; } = "RP";
            [JsonProperty("Bank plugin name (bank mode)")] public string BankPlugin { get; set; } = "BankSystem";
            [JsonProperty("Bank deposit method")] public string BankDeposit { get; set; } = "API_BankSystemDeposit";
            [JsonProperty("Bank withdraw method")] public string BankWithdraw { get; set; } = "API_BankSystemWithdraw";
            [JsonProperty("Bank balance method")] public string BankBalance { get; set; } = "API_BankSystemBalance";
            [JsonProperty("Max active listings per player")] public int MaxListings { get; set; } = 5;
            [JsonProperty("Max price per listing")] public int MaxPrice { get; set; } = 1000000;
            [JsonProperty("Listing fee (RP, taken when listing)")] public int ListingFee { get; set; } = 0;
            [JsonProperty("Chat prefix")] public string ChatPrefix { get; set; } = "<color=#a78bfa>[Market]</color>";
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

        // ── Data ──────────────────────────────────────────────────────────────
        private class Listing
        {
            public int Id;
            public ulong SellerId;
            public string SellerName;
            public string Shortname;
            public int Amount;
            public ulong SkinId;
            public int Price;
            public long ListedAt;
        }

        private class StoredData
        {
            public int NextId = 1;
            public List<Listing> Listings = new();
        }

        private void Load()
        {
            try { _data = Interface.Oxide.DataFileSystem.ReadObject<StoredData>("ApAuction"); }
            catch { _data = null; }
            if (_data == null) _data = new StoredData();
            if (_data.Listings == null) _data.Listings = new List<Listing>();
        }

        private void Save() => Interface.Oxide.DataFileSystem.WriteObject("ApAuction", _data);

        private void OnServerInitialized()
        {
            LoadConfig();
            Load();
            Puts($"[ApAuction] {_data.Listings.Count} active listings. Currency mode: {_cfg.CurrencyMode}.");
            if (_cfg.CurrencyMode == "serverrewards" && ServerRewards == null)
                PrintError("[ApAuction] CurrencyMode is 'serverrewards' but ServerRewards is NOT loaded — buys/sells will not move points. Load ServerRewards or change the currency mode.");
            if (_cfg.CurrencyMode == "economics" && Economics == null)
                PrintError("[ApAuction] CurrencyMode is 'economics' but Economics is NOT loaded.");
        }

        private void OnServerSave() => Save();
        private void Unload()
        {
            foreach (var p in BasePlayer.activePlayerList) CuiHelper.DestroyUi(p, UiName);
            Save();
        }
        private void OnPlayerDisconnected(BasePlayer player, string reason) => CuiHelper.DestroyUi(player, UiName);

        private string Cur => _cfg.CurrencyLabel;
        private Plugin Bank => Interface.Oxide.RootPluginManager.GetPlugin(_cfg.BankPlugin) as Plugin;

        // ── Command ───────────────────────────────────────────────────────────
        [ChatCommand("market")]
        private void CmdMarket(BasePlayer player, string command, string[] args)
        {
            string sub = args.Length > 0 ? args[0].ToLower() : "";
            switch (sub)
            {
                case "sell": MarketSell(player, args); break;
                case "buy": MarketBuy(player, args); break;
                case "cancel": MarketCancel(player, args); break;
                case "mine": OpenUi(player, 0, "mine", ""); break;
                case "help": MarketHelp(player); break;
                case "chat": MarketList(player, args); break; // old text view
                default: OpenUi(player, 0, "all", ""); break;
            }
        }

        private void MarketHelp(BasePlayer player)
        {
            player.ChatMessage(
                $"{_cfg.ChatPrefix} Player Market\n" +
                "/market — browse listings\n" +
                "/market sell <price> — list the item in your hand\n" +
                "/market buy <id> — buy a listing\n" +
                "/market mine — your listings\n" +
                "/market cancel <id> — cancel & reclaim a listing");
        }

        private void MarketList(BasePlayer player, string[] args)
        {
            if (_data.Listings.Count == 0) { Msg(player, "No active listings. List one with /market sell <price>."); return; }
            int page = 1;
            if (args.Length > 0 && int.TryParse(args[0], out var p)) page = Mathf.Max(1, p);
            const int perPage = 12;
            int pages = Mathf.CeilToInt(_data.Listings.Count / (float)perPage);
            page = Mathf.Min(page, pages);

            var sb = new StringBuilder();
            sb.AppendLine($"<color=#a78bfa>── Market ── ({_data.Listings.Count} listings, page {page}/{pages})</color>");
            foreach (var l in _data.Listings.Skip((page - 1) * perPage).Take(perPage))
                sb.AppendLine($"#{l.Id} <color=#fff>{l.Amount}x {DisplayName(l.Shortname)}</color> — <color=#fbbf24>{l.Price}</color> {Cur} ({l.SellerName})");
            sb.AppendLine("<color=#9ca3af>/market buy <id> · /market sell <price> · /market help</color>");
            player.ChatMessage(sb.ToString());
        }

        private void MarketMine(BasePlayer player)
        {
            var mine = _data.Listings.Where(l => l.SellerId == player.userID).ToList();
            if (mine.Count == 0) { Msg(player, "You have no active listings."); return; }
            var sb = new StringBuilder();
            sb.AppendLine($"<color=#a78bfa>── Your listings ──</color>");
            foreach (var l in mine)
                sb.AppendLine($"#{l.Id} {l.Amount}x {DisplayName(l.Shortname)} — <color=#fbbf24>{l.Price}</color> {Cur}");
            player.ChatMessage(sb.ToString());
        }

        // Chat wrappers around the shared core actions.
        private void MarketSell(BasePlayer player, string[] args)
        {
            if (args.Length < 2 || !int.TryParse(args[1], out var price)) { Msg(player, "Usage: hold an item, then /market sell <price>"); return; }
            Msg(player, ListHeld(player, price));
        }

        private void MarketBuy(BasePlayer player, string[] args)
        {
            if (args.Length < 2 || !int.TryParse(args[1], out var id)) { Msg(player, "Usage: /market buy <id>"); return; }
            Msg(player, BuyListing(player, id));
        }

        private void MarketCancel(BasePlayer player, string[] args)
        {
            if (args.Length < 2 || !int.TryParse(args[1], out var id)) { Msg(player, "Usage: /market cancel <id>"); return; }
            Msg(player, CancelListing(player, id));
        }

        // ── Core actions (shared by chat + UI), return a status string ───────────
        private string ListHeld(BasePlayer player, int price)
        {
            if (price <= 0) return "Enter a price greater than 0.";
            if (price > _cfg.MaxPrice) return $"Max price is {_cfg.MaxPrice} {Cur}.";
            if (_data.Listings.Count(l => l.SellerId == player.userID) >= _cfg.MaxListings)
                return $"You already have {_cfg.MaxListings} listings (the max).";
            var held = player.GetActiveItem();
            if (held == null) return "Hold the item you want to list, then set a price.";
            if (_cfg.ListingFee > 0 && !TakePoints(player, _cfg.ListingFee))
                return $"You need {_cfg.ListingFee} {Cur} for the listing fee.";

            var listing = new Listing
            {
                Id = _data.NextId++,
                SellerId = player.userID,
                SellerName = player.displayName,
                Shortname = held.info.shortname,
                Amount = held.amount,
                SkinId = held.skin,
                Price = price,
                ListedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            };
            held.RemoveFromContainer();
            held.Remove();
            _data.Listings.Add(listing);
            Save();
            return $"Listed {listing.Amount}x {DisplayName(listing.Shortname)} for {price} {Cur} (#{listing.Id}).";
        }

        private string BuyListing(BasePlayer player, int id)
        {
            var listing = _data.Listings.FirstOrDefault(l => l.Id == id);
            if (listing == null) return "That listing no longer exists.";
            if (listing.SellerId == player.userID) return "That's your own listing — cancel it instead.";
            if (!TakePoints(player, listing.Price)) return $"Not enough {Cur}. Need {listing.Price}, have {GetBalance(player)}.";

            GivePoints(listing.SellerId, listing.Price);
            var item = ItemManager.CreateByName(listing.Shortname, listing.Amount, listing.SkinId);
            if (item != null) player.GiveItem(item, BaseEntity.GiveItemReason.PickedUp);
            _data.Listings.Remove(listing);
            Save();

            // Feed the dashboard's commodity price tracker (RustCompanion relays it).
            Interface.CallHook("OnApMarketSale", listing.Shortname, listing.Amount, listing.Price);

            var seller = BasePlayer.FindByID(listing.SellerId);
            seller?.ChatMessage($"{_cfg.ChatPrefix} {player.displayName} bought your {DisplayName(listing.Shortname)} for {listing.Price} {Cur}!");
            return $"Bought {listing.Amount}x {DisplayName(listing.Shortname)} for {listing.Price} {Cur}.";
        }

        private string CancelListing(BasePlayer player, int id)
        {
            var listing = _data.Listings.FirstOrDefault(l => l.Id == id);
            if (listing == null) return "That listing no longer exists.";
            if (listing.SellerId != player.userID && !player.IsAdmin) return "That isn't your listing.";
            var item = ItemManager.CreateByName(listing.Shortname, listing.Amount, listing.SkinId);
            if (item != null) player.GiveItem(item, BaseEntity.GiveItemReason.PickedUp);
            _data.Listings.Remove(listing);
            Save();
            return $"Reclaimed {listing.Amount}x {DisplayName(listing.Shortname)}.";
        }

        // ── UI ────────────────────────────────────────────────────────────────
        // Public entry point so other plugins (e.g. ShopController's MARKET
        // button) can open the market: ApAuction.Call("OpenMarketUi", player).
        private void OpenMarketUi(BasePlayer player)
        {
            if (player != null) OpenUi(player, 0, "all", "");
        }

        private void OpenUi(BasePlayer player, int page, string tab, string status)
        {
            bool mine = tab == "mine";
            var source = mine ? _data.Listings.Where(l => l.SellerId == player.userID).ToList() : _data.Listings;
            int pages = Mathf.Max(1, Mathf.CeilToInt(source.Count / (float)PerPage));
            page = Mathf.Clamp(page, 0, pages - 1);

            CuiHelper.DestroyUi(player, UiName);
            var c = new CuiElementContainer();

            c.Add(new CuiPanel { Image = { Color = "0 0 0 0.75" }, RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }, CursorEnabled = true }, "Overlay", UiName);
            string panel = c.Add(new CuiPanel { Image = { Color = "0.10 0.10 0.12 0.98" }, RectTransform = { AnchorMin = "0.26 0.14", AnchorMax = "0.74 0.86" } }, UiName);

            // Header
            c.Add(new CuiPanel { Image = { Color = "0.55 0.40 0.90 0.95" }, RectTransform = { AnchorMin = "0 0.92", AnchorMax = "1 1" } }, panel);
            c.Add(new CuiLabel { Text = { Text = "  PLAYER MARKET", FontSize = 18, Align = TextAnchor.MiddleLeft, Color = "1 1 1 1" }, RectTransform = { AnchorMin = "0 0.92", AnchorMax = "0.6 1" } }, panel);
            c.Add(new CuiLabel { Text = { Text = $"{GetBalance(player)} {Cur}   ", FontSize = 13, Align = TextAnchor.MiddleRight, Color = "1 1 1 0.9" }, RectTransform = { AnchorMin = "0.5 0.92", AnchorMax = "0.92 1" } }, panel);
            c.Add(new CuiButton { Button = { Command = "apauction.close", Color = "0 0 0 0.4" }, Text = { Text = "✕", FontSize = 16, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" }, RectTransform = { AnchorMin = "0.92 0.92", AnchorMax = "1 1" } }, panel);

            // Tabs
            bool sell = tab == "sell";
            c.Add(Btn("apauction.open 0 all", "Browse", tab == "all" ? "0.45 0.35 0.7 1" : "0.2 0.2 0.22 1", 0.02f, 0.20f, 0.865f, 0.91f), panel);
            c.Add(Btn("apauction.open 0 mine", "My Listings", tab == "mine" ? "0.45 0.35 0.7 1" : "0.2 0.2 0.22 1", 0.205f, 0.43f, 0.865f, 0.91f), panel);
            c.Add(Btn("apauction.open 0 sell", "+ Sell Item", sell ? "0.25 0.55 0.3 1" : "0.2 0.42 0.26 1", 0.435f, 0.63f, 0.865f, 0.91f), panel);

            // Sell screen
            if (sell)
            {
                var held = player.GetActiveItem();
                string heldName = held != null ? $"{held.amount}x {DisplayName(held.info.shortname)}" : "(nothing in your hands)";
                int myCount = _data.Listings.Count(l => l.SellerId == player.userID);

                c.Add(new CuiLabel { Text = { Text = "List an item for sale", FontSize = 17, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" }, RectTransform = { AnchorMin = "0.1 0.74", AnchorMax = "0.9 0.82" } }, panel);
                c.Add(new CuiLabel { Text = { Text = $"In your hands:  <color=#fbbf24>{heldName}</color>", FontSize = 15, Align = TextAnchor.MiddleCenter, Color = "0.85 0.85 0.9 1" }, RectTransform = { AnchorMin = "0.1 0.62", AnchorMax = "0.9 0.70" } }, panel);
                c.Add(new CuiLabel { Text = { Text = "Type a price below and press ENTER to list it:", FontSize = 12, Align = TextAnchor.MiddleCenter, Color = "0.7 0.7 0.75 1" }, RectTransform = { AnchorMin = "0.1 0.51", AnchorMax = "0.9 0.57" } }, panel);

                c.Add(new CuiPanel { Image = { Color = "1 1 1 0.12" }, RectTransform = { AnchorMin = "0.34 0.40", AnchorMax = "0.66 0.49" } }, panel);
                c.Add(new CuiElement
                {
                    Parent = panel,
                    Components =
                    {
                        new CuiInputFieldComponent { Command = "apauction.list", FontSize = 20, Align = TextAnchor.MiddleCenter, CharsLimit = 9, Color = "1 1 1 1", NeedsKeyboard = true },
                        new CuiRectTransformComponent { AnchorMin = "0.34 0.40", AnchorMax = "0.66 0.49" }
                    }
                });
                c.Add(new CuiLabel { Text = { Text = $"price in {Cur}", FontSize = 10, Align = TextAnchor.MiddleCenter, Color = "0.55 0.55 0.6 1" }, RectTransform = { AnchorMin = "0.34 0.355", AnchorMax = "0.66 0.40" } }, panel);
                c.Add(new CuiLabel { Text = { Text = $"Listing fee: {_cfg.ListingFee} {Cur}   ·   {myCount}/{_cfg.MaxListings} listings used", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "0.6 0.6 0.65 1" }, RectTransform = { AnchorMin = "0.1 0.27", AnchorMax = "0.9 0.33" } }, panel);
                c.Add(new CuiLabel { Text = { Text = status.Length > 0 ? status : "Tip: hold the exact stack you want to sell, then type the price.", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "0.8 0.75 0.95 1" }, RectTransform = { AnchorMin = "0.08 0.02", AnchorMax = "0.92 0.09" } }, panel);
                CuiHelper.AddUi(player, c);
                return;
            }

            // Rows
            var items = source.Skip(page * PerPage).Take(PerPage).ToList();
            if (items.Count == 0)
                c.Add(new CuiLabel { Text = { Text = mine ? "You have no listings. Hold an item and type a price above." : "No active listings yet.", FontSize = 13, Align = TextAnchor.MiddleCenter, Color = "0.6 0.6 0.6 1" }, RectTransform = { AnchorMin = "0.05 0.45", AnchorMax = "0.95 0.6" } }, panel);

            for (int i = 0; i < items.Count; i++)
            {
                var l = items[i];
                float top = 0.83f - i * 0.092f;
                float bot = top - 0.082f;
                if (i % 2 == 0)
                    c.Add(new CuiPanel { Image = { Color = "1 1 1 0.03" }, RectTransform = { AnchorMin = $"0.02 {F(bot)}", AnchorMax = $"0.98 {F(top)}" } }, panel);

                c.Add(new CuiLabel { Text = { Text = $"#{l.Id}  {l.Amount}x {DisplayName(l.Shortname)}", FontSize = 12, Align = TextAnchor.MiddleLeft, Color = "1 1 1 1" }, RectTransform = { AnchorMin = $"0.03 {F(bot)}", AnchorMax = $"0.50 {F(top)}" } }, panel);
                c.Add(new CuiLabel { Text = { Text = $"{l.Price} {Cur}", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "0.98 0.85 0.4 1" }, RectTransform = { AnchorMin = $"0.50 {F(bot)}", AnchorMax = $"0.66 {F(top)}" } }, panel);
                c.Add(new CuiLabel { Text = { Text = l.SellerName, FontSize = 10, Align = TextAnchor.MiddleCenter, Color = "0.7 0.7 0.75 1" }, RectTransform = { AnchorMin = $"0.66 {F(bot)}", AnchorMax = $"0.82 {F(top)}" } }, panel);

                if (l.SellerId == player.userID)
                    c.Add(Btn($"apauction.cancel {l.Id} {page} {tab}", "Cancel", "0.5 0.3 0.3 1", 0.83f, 0.97f, bot, top), panel);
                else
                    c.Add(Btn($"apauction.buy {l.Id} {page} {tab}", "Buy", "0.25 0.5 0.3 1", 0.83f, 0.97f, bot, top), panel);
            }

            // Footer
            if (page > 0) c.Add(Btn($"apauction.open {page - 1} {tab}", "< Prev", "0.2 0.2 0.22 1", 0.03f, 0.16f, 0.02f, 0.085f), panel);
            if (page < pages - 1) c.Add(Btn($"apauction.open {page + 1} {tab}", "Next >", "0.2 0.2 0.22 1", 0.84f, 0.97f, 0.02f, 0.085f), panel);
            c.Add(new CuiLabel { Text = { Text = status.Length > 0 ? status : $"Page {page + 1}/{pages}  ·  {source.Count} listing(s)", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "0.8 0.75 0.95 1" }, RectTransform = { AnchorMin = "0.17 0.02", AnchorMax = "0.83 0.085" } }, panel);

            CuiHelper.AddUi(player, c);
        }

        private static string F(float v) => v.ToString("0.####", CultureInfo.InvariantCulture);

        private static CuiButton Btn(string cmd, string text, string color, float xMin, float xMax, float yMin, float yMax) => new()
        {
            Button = { Command = cmd, Color = color },
            Text = { Text = text, FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" },
            RectTransform = { AnchorMin = $"{F(xMin)} {F(yMin)}", AnchorMax = $"{F(xMax)} {F(yMax)}" }
        };

        [ConsoleCommand("apauction.close")]
        private void CcClose(ConsoleSystem.Arg arg) { var p = arg.Connection?.player as BasePlayer; if (p != null) CuiHelper.DestroyUi(p, UiName); }

        [ConsoleCommand("apauction.open")]
        private void CcOpen(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer; if (p == null) return;
            OpenUi(p, arg.GetInt(0, 0), arg.GetString(1, "all"), "");
        }

        [ConsoleCommand("apauction.buy")]
        private void CcBuy(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer; if (p == null) return;
            string status = BuyListing(p, arg.GetInt(0, -1));
            OpenUi(p, arg.GetInt(1, 0), arg.GetString(2, "all"), status);
        }

        [ConsoleCommand("apauction.cancel")]
        private void CcCancel(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer; if (p == null) return;
            string status = CancelListing(p, arg.GetInt(0, -1));
            OpenUi(p, arg.GetInt(1, 0), arg.GetString(2, "all"), status);
        }

        [ConsoleCommand("apauction.list")]
        private void CcList(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer; if (p == null) return;
            string status = int.TryParse(arg.GetString(0, ""), out var price)
                ? ListHeld(p, price)
                : "Enter a number for the price.";
            OpenUi(p, 0, "sell", status);
        }

        // ── Currency helpers ──────────────────────────────────────────────────
        private void GivePoints(ulong userId, int amount)
        {
            if (amount <= 0) return;
            switch (_cfg.CurrencyMode)
            {
                case "economics": Economics?.Call("Deposit", userId.ToString(), (double)amount); break;
                case "bank": Bank?.Call(_cfg.BankDeposit, userId, amount); break;
                default: ServerRewards?.Call("AddPoints", userId, amount); break;
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
                case "economics": return Economics?.Call("Withdraw", p.UserIDString, (double)amount) != null;
                case "bank": Bank?.Call(_cfg.BankWithdraw, p.userID, amount); return true;
                // ServerRewards.TakePoints(object, int, string="") — pass all 3 args;
                // omitting the optional reason can make the cross-plugin Call no-op.
                default: return ServerRewards?.Call("TakePoints", p.userID, amount, "Market purchase") != null;
            }
        }

        private static string DisplayName(string shortname)
        {
            var def = ItemManager.FindItemDefinition(shortname);
            return def?.displayName?.english ?? shortname;
        }

        private void Msg(BasePlayer p, string msg) => p.ChatMessage($"{_cfg.ChatPrefix} {msg}");
    }
}
