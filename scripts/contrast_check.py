#!/usr/bin/env python3
"""
WCAG 2.x contrast-ratio calculator — used for DHARA UI Revision v2.2.1
Stage 4 ("measure contrast with a tool, not by hand").

Usage:
    python3 contrast_check.py "#505B68" "#FFFFFF" [--small|--large]

Supports plain hex (#RRGGBB, #RGB) and "rgba(r,g,b,a)" composited over a
given background (for translucent text/overlays), e.g.:

    python3 contrast_check.py "rgba(255,255,255,0.68) over #14365A" "#14365A"
"""
import sys
import re


def parse_color(spec, bg_for_alpha=None):
    spec = spec.strip()
    m = re.match(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)(?:\s+over\s+(#[0-9a-fA-F]{3,6}))?", spec)
    if m:
        r, g, b = float(m.group(1)), float(m.group(2)), float(m.group(3))
        a = float(m.group(4)) if m.group(4) is not None else 1.0
        over = m.group(5) or bg_for_alpha
        if a < 1.0:
            if not over:
                raise ValueError(f"'{spec}' has alpha<1 but no 'over #hex' background given")
            br, bg_, bb = hex_to_rgb(over)
            r = a * r + (1 - a) * br
            g = a * g + (1 - a) * bg_
            b = a * b + (1 - a) * bb
        return (r, g, b)
    return hex_to_rgb(spec)


def hex_to_rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError(f"not a valid hex color: {h}")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def relative_luminance(rgb):
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(rgb1, rgb2):
    l1, l2 = relative_luminance(rgb1), relative_luminance(rgb2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    large = '--large' in sys.argv
    if len(args) != 2:
        print(__doc__)
        sys.exit(1)
    fg_spec, bg_spec = args
    bg_rgb = parse_color(bg_spec)
    fg_rgb = parse_color(fg_spec, bg_for_alpha=bg_spec)
    ratio = contrast_ratio(fg_rgb, bg_rgb)
    threshold = 3.0 if large else 4.5
    status = "PASS" if ratio >= threshold else "FAIL"
    print(f"fg={fg_spec}  bg={bg_spec}")
    print(f"fg_rgb={fg_rgb}  bg_rgb={bg_rgb}")
    print(f"contrast ratio = {ratio:.2f}:1   threshold={threshold}:1 ({'large text/graphics' if large else 'normal text'})   -> {status}")


if __name__ == "__main__":
    main()
