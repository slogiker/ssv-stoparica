#!/usr/bin/env python3
"""
gen_esp.py — SSV Stoparica device provisioning tool

Run once per physical ESP32 stop box:
  python3 tools/gen_esp.py --name Hamercani
  python3 tools/gen_esp.py --name PGD-Podnanos-1
  python3 tools/gen_esp.py --letter B
  python3 tools/gen_esp.py          # auto-assigns next letter (A, B, C, ...)

What it produces in esp2/SSV-STOP-{suffix}/  (suffix = name or letter):
  SSV-STOP-{suffix}.ino        — flash this to the ESP32
  qr_SSV-STOP-{suffix}.png     — stick this on the stop box (encodes both UUIDs)
  INFO_SSV-STOP-{suffix}.txt   — all details for reference

Workflow:
  1. Run this script → folder created with all three files
  2. Flash the .ino to the ESP32 (Arduino IDE or esptool)
  3. Print and stick the QR code on the box
  4. User scans QR → opens app → auto-connects to that specific device
"""

import argparse
import glob
import re
import uuid
from pathlib import Path

try:
    import qrcode
except ImportError:
    print("ERROR: Install qrcode first:  pip install 'qrcode[pil]'")
    raise SystemExit(1)

REPO_ROOT = Path(__file__).parent.parent
ESP2_DIR  = REPO_ROOT / "esp2"
TEMPLATE  = ESP2_DIR / "esp2_stop" / "esp2_stop.ino"

# BLE device name max is 29 bytes; "SSV-STOP-" is 9 chars → 20 chars left for suffix.
# We cap at 18 to keep a safe margin.
MAX_SUFFIX_LEN = 18


def next_device_letter():
    """Return the first unused single letter A-Z for auto-naming."""
    existing = glob.glob(str(ESP2_DIR / "SSV-STOP-*/"))
    used = {Path(p).name[len("SSV-STOP-"):].upper()
            for p in existing
            if len(Path(p).name) == len("SSV-STOP-X")}
    for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        if c not in used:
            return c
    raise RuntimeError("All device letters A-Z are taken.")


def main():
    parser = argparse.ArgumentParser(
        description="Provision a new SSV-STOP ESP32 device",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 tools/gen_esp.py --name Hamercani\n"
            "  python3 tools/gen_esp.py --name PGD-Podnanos-1\n"
            "  python3 tools/gen_esp.py --letter B\n"
            "  python3 tools/gen_esp.py          # auto A, B, C ...\n"
        ),
    )
    parser.add_argument(
        "--name", "-n", metavar="SUFFIX",
        help=(
            "Custom suffix — becomes the full device identity. "
            f"Letters, digits and hyphens only. Max {MAX_SUFFIX_LEN} chars. "
            "Result: SSV-STOP-<SUFFIX>. Takes precedence over --letter."
        ),
    )
    parser.add_argument(
        "--letter", metavar="X",
        help="Single letter A-Z. Used when --name is not given.",
    )
    parser.add_argument(
        "--domain", default="ssv.slogiker.si",
        help="Production domain for the QR URL (default: ssv.slogiker.si)",
    )
    args = parser.parse_args()

    if not TEMPLATE.exists():
        print(f"ERROR: Template not found: {TEMPLATE}")
        raise SystemExit(1)

    # ── Determine suffix: --name  >  --letter  >  auto-letter ────────────────
    if args.name is not None:
        # Sanitise: keep only alphanumeric and hyphens, collapse repeated hyphens
        suffix = re.sub(r"[^a-zA-Z0-9-]", "-", args.name.strip())
        suffix = re.sub(r"-{2,}", "-", suffix).strip("-")
        if not suffix:
            print("ERROR: --name produced an empty string after sanitisation.")
            raise SystemExit(1)
        if len(suffix) > MAX_SUFFIX_LEN:
            print(
                f"ERROR: --name suffix too long "
                f"({len(suffix)} chars, max {MAX_SUFFIX_LEN}): {suffix!r}"
            )
            raise SystemExit(1)
    elif args.letter is not None:
        if len(args.letter) != 1 or not args.letter.isalpha():
            print(f"ERROR: --letter must be a single letter A-Z, got: {args.letter!r}")
            raise SystemExit(1)
        suffix = args.letter.upper()
    else:
        suffix = next_device_letter()

    device_name = f"SSV-STOP-{suffix}"
    svc_uuid    = str(uuid.uuid4()).lower()   # unique per device — identifies which box
    chr_uuid    = str(uuid.uuid4()).lower()   # unique per device — BLE notify channel
    domain      = args.domain.rstrip("/")

    out_dir = ESP2_DIR / device_name
    if out_dir.exists():
        print(f"WARNING: {out_dir} already exists — files will be overwritten.")
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── Patch firmware template ──────────────────────────────────────────────
    src = TEMPLATE.read_text(encoding="utf-8")
    patched = re.sub(
        r'#define SERVICE_UUID\s+"[^"]+"',
        f'#define SERVICE_UUID        "{svc_uuid}"', src
    )
    patched = re.sub(
        r'#define CHARACTERISTIC_UUID\s+"[^"]+"',
        f'#define CHARACTERISTIC_UUID "{chr_uuid}"', patched
    )
    patched = re.sub(
        r'#define DEVICE_NAME\s+"[^"]+"',
        f'#define DEVICE_NAME         "{device_name}"', patched
    )

    ino_path = out_dir / f"{device_name}.ino"
    ino_path.write_text(patched, encoding="utf-8")

    # ── QR code — both UUIDs in URL so app can read them on scan ────────────
    url = f"https://{domain}/?device={svc_uuid}&char={chr_uuid}"
    # ERROR_CORRECT_H (30% redundancy) — stickers are used in dusty/wet
    # fire-training conditions; H handles up to 30% damage without scan failure.
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    qr_path = out_dir / f"qr_{device_name}.png"
    img.save(str(qr_path))

    # ── Info file ────────────────────────────────────────────────────────────
    info_path = out_dir / f"INFO_{device_name}.txt"
    info_path.write_text(
        f"SSV Stoparica — Device Info\n"
        f"{'='*60}\n\n"
        f"Device name      : {device_name}\n"
        f"Service UUID     : {svc_uuid}\n"
        f"Characteristic   : {chr_uuid}\n\n"
        f"QR URL           : {url}\n\n"
        f"{'─'*60}\n"
        f"Files in this folder\n"
        f"  {device_name}.ino        — flash to ESP32 (Arduino IDE / esptool)\n"
        f"  qr_{device_name}.png     — print & stick on the stop box\n"
        f"  INFO_{device_name}.txt   — this file\n\n"
        f"{'─'*60}\n"
        f"How it works\n"
        f"  1. Flash {device_name}.ino to the ESP32\n"
        f"  2. Print qr_{device_name}.png and stick it on the box\n"
        f"  3. User scans QR with Chrome on Android\n"
        f"     → opens {domain}/?device=...&char=...\n"
        f"  4. App reads both UUIDs from the URL,\n"
        f"     auto-scans for {device_name} and connects via BLE\n"
        f"  5. Pressing the button sends 0x01 notify → app stops timer\n\n"
        f"{'─'*60}\n"
        f"Wiring\n"
        f"  GPIO 0  — stop button (to GND, INPUT_PULLUP)\n"
        f"  GPIO 2  — onboard LED\n"
        f"             Blink 1Hz = advertising (waiting for phone)\n"
        f"             Solid ON  = phone connected\n\n"
        f"{'─'*60}\n"
        f"Troubleshooting\n"
        f"  - BLE not working? Make sure you use Chrome on Android\n"
        f"  - Wrong device connecting? Check the ?device= UUID matches\n"
        f"  - Lost this file? UUIDs are also in {device_name}.ino (#define lines)\n"
        f"  - Need a new QR? Re-run:  python3 tools/gen_esp.py --name {suffix}\n"
        f"    (same name → same folder will be overwritten with fresh QR)\n",
        encoding="utf-8",
    )

    # ── Terminal output ──────────────────────────────────────────────────────
    print()
    qr.print_ascii(invert=True)
    print()
    print(f"{'─'*60}")
    print(f"  Device   : {device_name}")
    print(f"  Service  : {svc_uuid}")
    print(f"  Char     : {chr_uuid}")
    print(f"  QR URL   : {url}")
    print(f"  Firmware : {ino_path.relative_to(REPO_ROOT)}")
    print(f"  QR image : {qr_path.relative_to(REPO_ROOT)}")
    print(f"{'─'*60}")
    print()
    print(f"Next steps:")
    print(f"  1. Flash  {ino_path.name}  to the ESP32")
    print(f"  2. Print  qr_{device_name}.png  and stick it on the stop box")
    print(f"  3. Scan with Chrome on Android → app auto-connects")
    print()


if __name__ == "__main__":
    main()
