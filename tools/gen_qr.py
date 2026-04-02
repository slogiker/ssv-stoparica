#!/usr/bin/env python3
"""
Generate a QR code image for an SSV-STOP device.
The QR encodes: https://<domain>/?device=<service-uuid>

Usage:
    python3 gen_qr.py <service-uuid> [output.png] [--domain <domain>]

Example:
    python3 gen_qr.py 6e400001-b5a3-f393-e0a9-e50e24dcca9e SSV-STOP-A.png

Requires:
    pip install qrcode[pil]
"""

import sys
import qrcode

DEFAULT_DOMAIN = 'ssv.slogiker.si'

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    service_uuid = sys.argv[1]
    output       = sys.argv[2] if len(sys.argv) > 2 else f"qr_{service_uuid[:8]}.png"
    domain       = DEFAULT_DOMAIN

    # Optional --domain override
    if '--domain' in sys.argv:
        idx = sys.argv.index('--domain')
        domain = sys.argv[idx + 1]

    url = f"https://{domain}/?device={service_uuid}"
    print(f"Generating QR for: {url}")

    qr = qrcode.QRCode(
        version=None,           # auto-size
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    img.save(output)
    print(f"Saved: {output}")

if __name__ == '__main__':
    main()
