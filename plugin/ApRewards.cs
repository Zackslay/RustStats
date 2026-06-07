using System;
using System.Linq;
using Oxide.Core.Plugins;

namespace Oxide.Plugins
{
    [Info("ApRewards", "SlayStudios", "1.0.0")]
    [Description("Grant/take/check ServerRewards RP via a non-conflicting 'aprp' command")]
    public class ApRewards : RustPlugin
    {
        [PluginReference] private Plugin ServerRewards;
        private const string PermUse = "aprewards.use";

        private void Init() => permission.RegisterPermission(PermUse, this);

        // Console: aprp add|take|check <name|steamid|all> <amount>
        [ConsoleCommand("aprp")]
        private void CcAprp(ConsoleSystem.Arg arg)
        {
            var p = arg.Connection?.player as BasePlayer;
            // Server console / RCON (p == null) is always allowed; in-game needs perm.
            if (p != null && !permission.UserHasPermission(p.UserIDString, PermUse))
            {
                arg.ReplyWith("You don't have permission.");
                return;
            }
            Handle(arg.GetString(0, ""), arg.GetString(1, ""), arg.GetString(2, ""), arg.ReplyWith);
        }

        [ChatCommand("aprp")]
        private void CmdAprp(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin && !permission.UserHasPermission(player.UserIDString, PermUse))
            {
                player.ChatMessage("You don't have permission.");
                return;
            }
            Handle(
                args.Length > 0 ? args[0] : "",
                args.Length > 1 ? args[1] : "",
                args.Length > 2 ? args[2] : "",
                player.ChatMessage);
        }

        private void Handle(string action, string target, string amountStr, Action<string> reply)
        {
            if (ServerRewards == null) { reply("ServerRewards is not loaded."); return; }
            action = action.ToLower();

            if (action.Length == 0 || target.Length == 0)
            {
                reply("Usage: aprp add|take|check <name|steamid|all> <amount>");
                return;
            }

            int amount = 0;
            bool needAmount = action == "add" || action == "take";
            if (needAmount && (!int.TryParse(amountStr, out amount) || amount <= 0))
            {
                reply("Amount must be a positive number.");
                return;
            }

            // Bulk: every online player.
            if (target.ToLower() == "all")
            {
                int n = 0;
                foreach (var pl in BasePlayer.activePlayerList)
                {
                    if (action == "add") ServerRewards.Call("AddPoints", pl.userID, amount);
                    else if (action == "take") ServerRewards.Call("TakePoints", pl.userID, amount);
                    else { reply("'all' only supports add/take."); return; }
                    n++;
                }
                reply($"{action} {amount} RP for {n} online player(s).");
                return;
            }

            ulong id = ResolveId(target, out string name);
            if (id == 0)
            {
                reply($"Player not found: '{target}'. Use a full online name, or a SteamID (works offline).");
                return;
            }

            switch (action)
            {
                case "add":
                    ServerRewards.Call("AddPoints", id, amount);
                    reply($"Added {amount} RP to {name}.");
                    break;
                case "take":
                    ServerRewards.Call("TakePoints", id, amount);
                    reply($"Took {amount} RP from {name}.");
                    break;
                case "check":
                    var b = ServerRewards.Call("CheckPoints", id);
                    reply($"{name} has {(b is int bi ? bi : 0)} RP.");
                    break;
                default:
                    reply("Unknown action. Use add | take | check.");
                    break;
            }
        }

        // SteamID (works offline) or an online player's (partial) name.
        private ulong ResolveId(string target, out string name)
        {
            if (target.Length >= 17 && ulong.TryParse(target, out var sid))
            {
                var byId = BasePlayer.FindByID(sid);
                name = byId?.displayName ?? target;
                return sid;
            }
            var pl = BasePlayer.activePlayerList.FirstOrDefault(x => x.displayName.Equals(target, StringComparison.OrdinalIgnoreCase))
                  ?? BasePlayer.activePlayerList.FirstOrDefault(x => x.displayName.ToLower().Contains(target.ToLower()));
            name = pl?.displayName ?? target;
            return pl?.userID ?? 0;
        }
    }
}
