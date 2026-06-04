using UnityEngine;
using System;
using System.Text.RegularExpressions;
using System.Linq;
using UnityEngine.AI;
using System.Collections.Generic;

namespace Oxide.Plugins
{
    [Info("GridAPI", "Steenamaroo", "1.0.3", ResourceId = 499)]
    [Description("Map grid API plugin.")]
    class GridAPI : RustPlugin
    {
        float grids, size;

        void OnServerInitialized()
        {
            grids = Mathf.FloorToInt((float)World.Size / (1024f / 7f));
            size = TerrainMeta.Size.x / 1024f;
        }

        #region GridMethods 
        Vector3 PosFromGrid(string l, string n, int o) 
        {
            var l1 = Convert.ToChar(l.Substring(l.Length - 1).ToUpper()) - 64;
            if (l.Length == 2)
                l1 += 26;

            return VReverse(l1 -1 + o, (float)Convert.ToDouble(n) + o);
        }

        Vector3 PosFromGridCentred(string l, string n)
        {
            Vector3 one = PosFromGrid(l, n, 0);
            Vector3 two = PosFromGrid(l, n, 1);
            return one + ((two - one) / 2f);
        }

        Vector3 VReverse(float a, float b) => new Vector3((-(World.Size / 2)) + (a * World.Size / grids), 0, World.Size / 2 - (b * World.Size / grids));

        string[] GridFromPos(Vector3 pos)
        {
            pos += new Vector3(World.Size / 2, 0, World.Size / 2);
            pos = new Vector3(pos.x / World.Size * grids + 1, 0, Mathf.FloorToInt(grids - (pos.z / World.Size * grids))); 
            return new string[] { ((pos.x > 26 ? "A" : "") + (char)(64 + (pos.x == 26 ? 26 : (pos.x % 26)))), pos.z.ToString() };
        }
        #endregion

        bool Valid(string a, string b)
        {
            int num;
            if (!Int32.TryParse(b, out num))
                return false;

            foreach (var c in a.ToCharArray())
                if (!Regex.IsMatch(c.ToString(), @"^[a-zA-Z]*$"))
                    return false;

            foreach (var c in b.ToCharArray())
                if (!Regex.IsMatch(c.ToString(), @"^[0-9]*$"))
                    return false;

            return true;
        }

        Vector3 GetNav(Vector3 pos, int radius, ref string close, bool admin, BasePlayer player)
        {
            Vector3 startpoint = new Vector3(pos.x, TerrainMeta.HeightMap.GetHeight(pos) + 30, pos.z);
            Vector3 rpoint = new Vector3();
            Vector2 r = new Vector2();
            NavMeshHit hit = new NavMeshHit();
            for (int i = 0; i < 15; i++)
            {
                r = UnityEngine.Random.insideUnitCircle * radius;
                rpoint = startpoint + new Vector3(r.x, 0, r.y);
                if (NavMesh.SamplePosition(rpoint, out hit, 60, NavMesh.AllAreas))
                {
                    var tHeight = TerrainMeta.HeightMap.GetHeight(hit.position);
                    if (hit.position.y > tHeight - 1 && tHeight > TerrainMeta.WaterMap.GetHeight(hit.position))
                    {
                        hit.position = AboveRock(hit.position);
                        return hit.position;
                    }
                }
            }
            return new Vector3();
        }

        Vector3 AboveRock(Vector3 pos)
        {
            var hit2 = Physics.RaycastAll(pos + new Vector3(0, 20, 0), Vector3.down, 19.9f, 1235288065);
            if (hit2.Any())
                return hit2[0].point;

            return pos;
        }

        #region API
        private string[] GetGrid(Vector3 pos) => GridFromPos(pos);

        private object IntersectionPosFromGrid(string a, string b)
        {
            if (!Valid(a, b))
                return "Input is not valid - <a-z><0-9>";
            return PosFromGrid(a, b, 0);
        }

        private object MiddlePosFromGrid(string a, string b)
        {
            if (!Valid(a, b))
                return "Input is not valid - <a-z><0-9>";
            return PosFromGridCentred(a, b);
        }

        private object RandomPosFromGrid(string a, string b, int radius)
        {
            if (!Valid(a, b))
                return "Input is not valid - <a-z><0-9>";
            var cpos = PosFromGridCentred(a, b);
            string close = string.Empty;
            var fin = GetNav(cpos, radius, ref close, true, null);
            if (fin == new Vector3())
                return "No suitable points were found.";

            return fin;
        }
        #endregion
    }
} 