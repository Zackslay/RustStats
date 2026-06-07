using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("ApAuction", "SlayStudios", "1.0.0")]
    [Description("Player-to-player market: list items for RP, others buy them. Chat-based, persistent, escrowed.")]
    public class ApAuction : RustPlugin
    {
        [PluginReference] private Plugin ServerRewards, Economics;

        private Configuration _cfg;
        private StoredData _data;

        // ── Config ────────────────────────────────────────────────────────────
        private class Configuration
        {
            [JsonProperty("Currency mode: serverrewards | economics | bank")] public string CurrencyMode { get; set; } = "serverrewards";
            [JsonProperty("Currency label (e.g. RP, coins, AP Points)")] public string CurrencyLabel { get; set; } = "RP";
            [JsonProperty("Bank plugin name (bank mode)")] public string BankPlugin { get; set; } = "BankSystem";
            [JsonProperty("Bank deposit method")] public string BankDeposit { get; set; } = "Deposit";
            [JsonProperty("Bank withdraw method")] public string BankWithdraw { get; set; } = "Withdraw";
            [JsonProperty("Bank balance method")] public string BankBalance { get; set; } = "Balance";
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
            Puts($"[ApAuction] {_data.Listings.Count} active listings.");
        }

        private void OnServerSave() => Save();
        private void Unload() => Save();

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
                case "mine": MarketMine(player); break;
                case "help": MarketHelp(player); break;
                default: MarketList(player, args); break;
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

        private void MarketSell(BasePlayer player, string[] args)
        {
            if (args.Length < 2 || !int.TryParse(args[1], out var price) || price <= 0)
            {
                Msg(player, "Usage: hold an item, then /market sell <price>"); return;
            }
            if (price > _cfg.MaxPrice) { Msg(player, $"Max price is {_cfg.MaxPrice} {Cur}."); return; }
            if (_data.Listings.Count(l => l.SellerId == player.userID) >= _cfg.MaxListings)
            {
                Msg(player, $"You already have {_cfg.MaxListings} listings (the max)."); return;
            }

            var held = player.GetActiveItem();
            if (held == null) { Msg(player, "Hold the item you want to list."); return; }

            if (_cfg.ListingFee > 0)
            {
                if (!TakePoints(player, _cfg.ListingFee)) { Msg(player, $"You need {_cfg.ListingFee} {Cur} for the listing fee."); return; }
            }

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

            // Escrow: remove the exact held stack.
            held.RemoveFromContainer();
            held.Remove();

            _data.Listings.Add(listing);
            Save();
            Msg(player, $"Listed {listing.Amount}x {DisplayName(listing.Shortname)} for <color=#fbbf24>{price}</color> {Cur} (#{listing.Id}).");
        }

        private void MarketBuy(BasePlayer player, string[] args)
        {
            if (args.Length < 2 || !int.TryParse(args[1], out var id)) { Msg(player, "Usage: /market buy <id>"); return; }
            var listing = _data.Listings.FirstOrDefault(l => l.Id == id);
            if (listing == null) { Msg(player, "That listing no longer exists."); return; }
            if (listing.SellerId == player.userID) { Msg(player, "That's your own listing — use /market cancel <id>."); return; }

            if (!TakePoints(player, listing.Price))
            {
                Msg(player, $"Not enough {Cur}. You need {listing.Price}, have {GetBalance(player)}."); return;
            }

            // Pay the seller (works offline) and hand over the item.
            GivePoints(listing.SellerId, listing.Price);
            var item = ItemManager.CreateByName(listing.Shortname, listing.Amount, listing.SkinId);
            if (item != null) player.GiveItem(item, BaseEntity.GiveItemReason.PickedUp);

            _data.Listings.Remove(listing);
            Save();

            Msg(player, $"Bought {listing.Amount}x {DisplayName(listing.Shortname)} for <color=#fbbf24>{listing.Price}</color> {Cur}.");
            var seller = BasePlayer.FindByID(listing.SellerId);
            seller?.ChatMessage($"{_cfg.ChatPrefix} {player.displayName} bought your {DisplayName(listing.Shortname)} for {listing.Price} {Cur}!");
        }

        private void MarketCancel(BasePlayer player, string[] args)
        {
            if (args.Length < 2 || !int.TryParse(args[1], out var id)) { Msg(player, "Usage: /market cancel <id>"); return; }
            var listing = _data.Listings.FirstOrDefault(l => l.Id == id);
            if (listing == null) { Msg(player, "That listing no longer exists."); return; }
            if (listing.SellerId != player.userID && !player.IsAdmin) { Msg(player, "That isn't your listing."); return; }

            var item = ItemManager.CreateByName(listing.Shortname, listing.Amount, listing.SkinId);
            if (item != null) player.GiveItem(item, BaseEntity.GiveItemReason.PickedUp);
            _data.Listings.Remove(listing);
            Save();
            Msg(player, $"Reclaimed {listing.Amount}x {DisplayName(listing.Shortname)} (#{listing.Id}).");
        }

        // ── Currency helpers ──────────────────────────────────────────────────
        private void GivePoints(ulong userId, int amount)
        {
            if (amount <= 0) return;
            switch (_cfg.CurrencyMode)
            {
                case "economics": Economics?.Call("Deposit", userId.ToString(), (double)amount); break;
                case "bank": Bank?.Call(_cfg.BankDeposit, userId, (double)amount); break;
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
                case "economics": Economics?.Call("Withdraw", p.UserIDString, (double)amount); break;
                case "bank": Bank?.Call(_cfg.BankWithdraw, p.userID, (double)amount); break;
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
