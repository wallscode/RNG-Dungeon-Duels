#!/usr/bin/env python3
"""generate_art.py — Generate all game art via the Gemini API.

Prompts come verbatim from SPECIFICATION.md (Art Generation section), with the
global preamble prepended to every one. Output goes straight to
public/assets/** as .webp. The script is resumable: existing files are
skipped, so it can be re-run after rate limits or interruptions.

API key (never committed, never printed):
  1. env var GEMINI_API_KEY, or
  2. first line of ~/.gemini_api_key   (chmod 600)

Usage:
  python3 tools/generate_art.py            # generate everything missing
  python3 tools/generate_art.py --only kobold_scout hydra
  python3 tools/generate_art.py --list     # show what's missing and exit
"""

import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"

MODEL = "gemini-2.5-flash-image"
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

PREAMBLE = (
    "Painterly digital fantasy illustration, rich saturated colors, dramatic "
    "lighting, dungeons-and-dragons tabletop aesthetic, clean readable silhouette, "
    "slight vignette. CRITICAL: Standalone full-bleed background and character "
    "artwork only. DO NOT generate card borders. DO NOT generate frames. DO NOT "
    "leave blank boxes for text, titles, or numbers. DO NOT include nameplates, "
    "banners, labels, headers, or any user interface elements. No text, no "
    "watermarks, no layout panels. The subject must seamlessly blend into a "
    "continuous background environment. A tall vertical poster composition."
)

CREATURES = {
    "kobold_scout": "A small nimble kobold scout with a short bow, alert pose, scanning a dim rocky cavern, dynamic low-angle composition.",
    "feral_gnoll": "A savage hyena-like gnoll warrior baring razor-sharp teeth, holding a crude iron battle axe, blood-red moonlit wilderness background.",
    "sprite_trickster": "A mischievous glowing blue pixie sprite laughing and juggling floating spheres of dim starlight, dark enchanted forest setting.",
    "rabid_bat": "A massive, frenzied monstrous bat screeching with bared fangs, tattered wings, diving down through a foggy gothic graveyard.",
    "torch_goblin": "A crazed goblin cackling wildly while running with a sputtering, blazing tar torch, scattering orange embers in a dark cellar.",
    "stray_hound": "A lean, battle-scarred stray hound with alert glowing golden eyes, standing defensively on a rain-slicked medieval city street.",
    "shield_dwarf": "A stout dwarf warrior braced completely behind a massive, battered iron-rimmed round shield, determined expression, stone corridor behind him.",
    "dire_wolf": "A massive snarling dire wolf with shaggy grey fur, icy blue glowing eyes, lunging forward through deep snow under a pine canopy.",
    "goblin_archer": "A sly goblin archer drawing back a crooked, notched wooden bow, one eye closed tightly in concentration, lurking on a rocky ridge.",
    "thorn_sprite": "A defensive nature sprite made of jagged wood and sharp green briar thorns, defiant posture, blooming glowing flora background.",
    "bog_lurker": "A murky, half-submerged swamp monster made of moss and rotted logs, white glowing eyes peeking out from dark misty water.",
    "acolyte_of_luck": "A young smiling monk acolyte in jade robes, rolling three glowing golden runic dice across a polished wooden monastery floor.",
    "wandering_knight": "A stalwart traveling knight in polished steel plate armor, holding a gleaming longsword upright, windswept grassy field backdrop.",
    "pack_wolf": "A hunting grey timber wolf howling at a pale moon, dynamic composition with shadows of other wolves fading into the misty woods behind it.",
    "stone_golem": "A hulking monolith golem constructed of ancient mossy carved stones, bright cyan runic cracks glowing across its body, standing guard.",
    "ironhide_boar": "A massive, aggressive wild boar with metallic grey skin and thick iron-like hide, charging headlong through dense underbrush.",
    "flame_adept": "A fierce mage apprentice manifesting multiple spinning fireballs in orbit around their outstretched hands, casting a strong orange glow.",
    "temple_guard": "A solemn sentinel armored in heavy marble plate armor, holding a gold halberd, standing at the grand entrance of a sun-drenched temple.",
    "berserker": "A furious bare-chested northern barbarian mid-roar, swinging a massive double-bitted great axe, motion blur accentuating raw strength.",
    "trollkin_brute": "A muscular troll kin brawler with green warty skin, heavily bandaged fists, smiling aggressively in a muddy combat pit.",
    "cursed_marauder": "A spectral, gaunt skeletal raider clad in rotted leather armor, holding a cracked, glowing purple broadsword that bleeds dark smoke.",
    "shadow_assassin": "A hooded rogue completely wreathed in whisps of living black smoke, wielding twin curved obsidian daggers, crouching in a dark alleyway.",
    "pyromancer": "An elite robed sorcerer conjuring a massive, swirling orb of raging white-hot fire, amber embers floating in the dark background.",
    "dwarven_defender": "A heavily armored dwarf knight planting a massive tower shield firmly into the cracked stone floor, glowing gold sigils etched on the metal.",
    "storm_caller": "A wild-haired shaman holding a wooden staff skyward as branching fork lightning arcs across a stormy, cloud-filled dark sky.",
    "warband_captain": "A scarred orc warlord in spiked iron plate armor, pointing a broadsword forward aggressively, tattered war banners waving in the wind.",
    "ghoul_pack": "A ravenous pack of glowing-eyed ghouls clambering over ancient stone tombs in a desolate, foggy, moonlit churchyard.",
    "crystal_guardian": "An elegant crystalline construct formed from translucent sapphire gems, refracting beams of bright light from an inner magical core.",
    "frost_elemental": "A towering, humanoid elemental made of jagged blue glacier ice and swirling blizzard mist, its cold hands freezing the air.",
    "hill_giant": "A lumbering hill giant carrying a massive uprooted oak tree trunk as a club, wandering through a rocky highland valley.",
    "vampire_lord": "An aristocratic vampire count in a velvet crimson cape, holding a silver chalice filling with glowing red energy, dark castle interior.",
    "chaos_beast": "A horrific, shifting monstrosity made of tentacles, eyes, and iridescent color-changing plasma, floating in a warped planar void.",
    "war_troll": "A massive brutish war troll with iron armor plates bolted directly to its thick grey skin, wielding a heavy metal-spiked club.",
    "stone_colossus": "A mountain-sized titan carved from bedrock, its chest emitting a brilliant golden core radiance, towering over small pine trees.",
    "hydra": "A terrifying multi-headed marsh serpent, three heads snapping forward with venomous green fangs bare, dark swamp setting.",
    "ancient_dragon": "An imposing ancient red dragon with iridescent scales and sprawling bat wings, breathing a cone of fire downward from a high mountain peak.",
    "recruit": "A young, determined human foot soldier holding a simple steel shortsword and wooden buckler shield, wearing a clean leather jerkin.",
}

SORCERIES = {
    "spark": "A small but blindingly bright crackle of electrical static electricity bursting violently from the tip of a pointer finger.",
    "focus_ritual": "Glowing arcane symbols and geometric magic circles hovering over a meditating wizard's open upturned hands, serene teal magical light.",
    "coin_flip": "A gold coin spinning mid-air in slow motion, splitting into bright light on one half and casting a dark heavy shadow on the other half.",
    "hex": "Sinister, toxic green smoke wisps curling into the shape of a screaming skull, wrapping around an invisible cursed target.",
    "firebolt": "A single concentrated projectile bolt of roaring fire streaking diagonally through dark air, leaving a bright heat motion trail.",
    "healing_word": "A warm, comforting cascade of shimmering golden stardust floating gently downward from a holy rift in a dark ceiling.",
    "lucky_draw": "Three blank magical cards bursting out from a glowing cascade of kaleidoscopic luck energy, sparkling trail accents.",
    "blessing": "A brilliant beam of divine sunlight piercing through dark clouds, bathing the area in a protective celestial golden aura.",
    "chain_lightning": "A massive branch of volatile blue lightning striking a single point and splitting off into three smaller arcs running outwards.",
    "berserk_brew": "A bubbling glass vial filled with a violent, glowing neon-crimson potion, boiling over and spitting angry red sparks.",
    "mend_the_ranks": "An expansive ring of pulsing emerald-green restorative light expanding outward along a cracked battlefield floor.",
    "sap_strength": "Ghostly spectral vines of dull purple energy reaching up out of the floor, draining the vital color and light away from a center point.",
    "fireball": "A massive exploding sphere of churning red and orange flame expanding outward violently, generating a blinding white heat core.",
    "frost_nova": "A freezing shockwave of sharp ice shards and white frost mist blasting outward horizontally across a frozen ground plane.",
    "polymorph_gamble": "A whimsical, unpredictable swirl of pink and purple transmutation magic with a funny, startled white sheep silhouette materializing inside.",
    "second_wind": "A swirling vortex of refreshing bright blue wind and golden holy light rushing upward, symbolizing a sudden burst of vital energy.",
    "meteor": "A colossal blazing meteor enveloped in a thick layer of fire crashing violently into the earth, creating a shockwave of molten rock.",
    "mass_disarray": "A chaotic field of warped mirrors and twisting psychological energy patterns, fracturing light and breaking spatial reality.",
    "twin_fates": "Two massive ethereal scales hanging in balance, one filled with brilliant golden light, the other filled with heavy, dark violet plasma.",
    "inferno": "A literal sea of fire consuming everything, waves of pure rolling molten lava and towering pillars of black soot and flame.",
    "divine_wrath": "A massive vertical column of pure blinding holy light smashing down from the heavens, blasting away shadow with solar radiance.",
    "reinforcements": "A luminous, ghostly glowing ethereal army of knights holding swords, charging forward out of a massive magical gateway portal.",
    "cataclysm": "The earth violently tearing open, jagged stone pillars shifting upward while deep volcanic red lava geysers burst from ground cracks.",
    "wheel_of_fortune": "A colossal, floating ancient stone wheel carved with glowing red, blue, and green runes, spinning rapidly in a starry cosmic void.",
}

BOARD = {
    "arena_duel": (
        "A wide atmospheric fantasy duel arena, a colossal stone battlefield split "
        "cleanly into two facing lanes, illuminated by low burning iron wall torches. "
        "The background is dark, moody, and shrouded in shadows so foreground cards "
        "pop. The center is flat and clean to host dice animations."
    ),
    "arena_crypt": (
        "A wide atmospheric undead crypt duel arena, a vast moonlit necropolis floor "
        "flanked by rows of ancient mausoleums and leaning tombstones, lit by floating "
        "ghostly blue braziers. The background is dark, moody, and shrouded in fog so "
        "foreground cards pop. The center is flat and clean to host dice animations."
    ),
    "arena_forge": (
        "A wide atmospheric volcanic forge duel arena, a colossal obsidian battlefield "
        "ringed by channels of glowing lava, giant anvils and hanging chains at the "
        "edges, lit from below by molten light. The background is dark, moody, and "
        "shrouded in smoke so foreground cards pop. The center is flat and clean to "
        "host dice animations."
    ),
}

OPPONENTS = {
    "berserker": "Close-up head and shoulders portrait, face filling most of the frame: a furious bare-chested northern barbarian warlord, wild red hair, battle scars, roaring with absolute rage, dramatic torchlit dungeon background.",
    "tactician": "Close-up head and shoulders portrait, face filling most of the frame: a composed, calculating elven strategist in dark leather tactical armor, cold analytical eyes studying an invisible battlefield, candlelit war room.",
    "gambler": "Close-up head and shoulders portrait, face filling most of the frame: a roguish, grinning half-elf with a wide-brimmed hat, glowing runic cards fanned near his face, dimly lit tavern background.",
}


def jobs():
    """(output_path, prompt, aspect_ratio) for every asset."""
    out = []
    for name, prompt in {**CREATURES, **SORCERIES}.items():
        out.append((ASSETS / "cards" / f"{name}.webp", prompt, "2:3"))
    for name, prompt in BOARD.items():
        out.append((ASSETS / "board" / f"{name}.webp", prompt, "16:9"))
    for name, prompt in OPPONENTS.items():
        out.append((ASSETS / "opponents" / f"{name}.webp", prompt, "1:1"))
    return out


def api_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    keyfile = Path.home() / ".gemini_api_key"
    if keyfile.exists():
        return keyfile.read_text().strip().splitlines()[0]
    sys.exit(
        "No API key. Set GEMINI_API_KEY or write the key to ~/.gemini_api_key\n"
        "(create one free at https://aistudio.google.com/apikey)"
    )


def generate(key, prompt, aspect_ratio):
    body = json.dumps({
        "contents": [{"parts": [{"text": f"{PREAMBLE} {prompt}"}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect_ratio},
        },
    }).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    for part in data["candidates"][0]["content"]["parts"]:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline:
            return base64.b64decode(inline["data"])
    raise RuntimeError("response contained no image data")


def save_webp(png_bytes, path, quality=82):
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="generate only these basenames")
    ap.add_argument("--force", action="store_true", help="regenerate even if the file exists")
    ap.add_argument("--list", action="store_true", help="list missing assets and exit")
    args = ap.parse_args()

    todo = []
    for path, prompt, ratio in jobs():
        # --only accepts a bare basename ("hydra") or dir-qualified form
        # ("opponents/berserker") to disambiguate name collisions with cards.
        names = {path.stem, f"{path.parent.name}/{path.stem}"}
        if args.only and not names.intersection(args.only):
            continue
        if path.exists() and not args.force:
            continue
        todo.append((path, prompt, ratio))

    print(f"{len(todo)} asset(s) to generate.")
    if args.list or not todo:
        for path, _, _ in todo:
            print("  missing:", path.relative_to(ROOT))
        return

    key = api_key()
    failures = []
    for i, (path, prompt, ratio) in enumerate(todo, 1):
        label = path.relative_to(ROOT)
        for attempt in range(1, 5):
            try:
                print(f"[{i}/{len(todo)}] {label} …", flush=True)
                png = generate(key, prompt, ratio)
                save_webp(png, path)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    detail = e.read().decode(errors="replace")
                    if attempt >= 4:
                        print(f"    rate-limited on final attempt: {detail[:300]}")
                        failures.append(str(label))
                        break
                    wait = min(60 * attempt, 240)
                    print(f"    rate-limited; waiting {wait}s (attempt {attempt}/4)")
                    time.sleep(wait)
                elif 500 <= e.code < 600 and attempt < 4:
                    time.sleep(10 * attempt)
                else:
                    detail = e.read().decode(errors="replace")[:200]
                    print(f"    HTTP {e.code}: {detail}")
                    failures.append(str(label))
                    break
            except Exception as e:  # noqa: BLE001
                if attempt < 4:
                    time.sleep(5 * attempt)
                else:
                    print(f"    failed: {e}")
                    failures.append(str(label))
        time.sleep(1)  # gentle pacing between requests

    done = len(todo) - len(failures)
    print(f"\nGenerated {done}/{len(todo)}.")
    if failures:
        print("Failed (re-run to retry):")
        for f in failures:
            print("  ", f)
        sys.exit(1)


if __name__ == "__main__":
    main()
