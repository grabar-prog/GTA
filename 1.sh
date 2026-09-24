#!/usr/bin/env bash
# traffic_density_fix.sh — убирает обращение к `c` до его объявления в buildCars.
set -euo pipefail

[[ -f game/gta.html ]] || { echo "missing game/gta.html"; exit 1; }

BK="game/gta.html.bak.densityfix.$(date +%Y%m%d_%H%M%S)"
cp game/gta.html "$BK"
echo "backup → $BK"

python3 - <<'PYEOF'
import sys
p = "game/gta.html"
s = open(p, encoding="utf-8").read()

if "if(!c.active)mesh.position.y=-1000;   // спрятан под землю до активации" not in s and \
   "if(!c.active)mesh.position.y=-1000;   // hidden" not in s:
    print("gta.html: строчка уже перенесена или отсутствует — skip")
    sys.exit(0)

# 1. Убрать преждевременное обращение к c — вернуть сцену к одной строке.
bad_variants = [
    "mesh.castShadow=true;mesh.position.set(x,0,z);mesh.rotation.y=yaw;scene.add(mesh);\n"
    "    if(!c.active)mesh.position.y=-1000;   // спрятан под землю до активации",
]
good = "mesh.castShadow=true;mesh.position.set(x,0,z);mesh.rotation.y=yaw;scene.add(mesh);"

fixed = False
for bad in bad_variants:
    if bad in s:
        s = s.replace(bad, good, 1)
        fixed = True
        print("removed premature c.active check")
        break

if not fixed:
    print("ERR: не нашёл вставку — возможно, gta.html уже правился вручную", file=sys.stderr)
    sys.exit(2)

# 2. Вставить ту же проверку после cars.push(c) — там c уже объявлен.
old = ("    cars.push(c);\n"
       "    const g=lanes.get(laneKey(c))||lanes.set(laneKey(c),[]).get(laneKey(c));g.push(c);")
new = ("    cars.push(c);\n"
       "    if(!c.active)mesh.position.y=-1000;   // спрятан под землю до активации\n"
       "    const g=lanes.get(laneKey(c))||lanes.set(laneKey(c),[]).get(laneKey(c));g.push(c);")
if old not in s:
    print("ERR: cars.push(c) anchor not found", file=sys.stderr)
    sys.exit(2)
s = s.replace(old, new, 1)
print("moved c.active check after cars.push(c)")

open(p, "w", encoding="utf-8").write(s)
print("gta.html: written")
PYEOF

if command -v node >/dev/null 2>&1; then
  TMP=$(mktemp -d)
  python3 - "$TMP" <<'PYEOF'
import re, sys, os
tmp = sys.argv[1]
s = open("game/gta.html", encoding="utf-8").read()
m = re.search(r'<script type="module">(.*?)</script>', s, re.DOTALL)
if not m:
    print("no module block", file=sys.stderr); sys.exit(1)
open(os.path.join(tmp, "module.mjs"), "w", encoding="utf-8").write(m.group(1))
PYEOF
  if out=$(node --check "$TMP/module.mjs" 2>&1); then
    echo "node --check: OK"
  else
    echo "node --check: FAIL"; echo "$out" | sed 's/^/  /'; rm -rf "$TMP"; exit 2
  fi
  rm -rf "$TMP"
fi

echo
echo "Проверка:"
echo "  grep -n 'c.active' game/gta.html | head"
echo "  # c.active должно встречаться: 1 раз в объявлении объекта,"
echo "  # 1 раз после cars.push(c), 1 раз в setTrafficMult — и нигде до const c=…"
echo
echo "Откат: mv $BK game/gta.html"