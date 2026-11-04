#!/usr/bin/env python3
"""RFC-001 PoC: replay a captured PTY byte stream into screen text and a PNG.

`pty-capture.py` records the raw ANSI stream. That stream is not a screen: it is
cursor moves, erases and repaints. This script feeds it to a real terminal
emulator (pyte) so the evidence is what a person would actually have seen, then
renders the final screen to a PNG. Block-drawing characters (the pixel wordmark)
are drawn as pixels; other glyphs use a monospace font.

Usage: pty-screen.py <capture.raw> <output-prefix> [--cols 120] [--rows 40]
"""
import argparse
import sys

import pyte
from PIL import Image, ImageDraw, ImageFont

# ANSI palette (VS Code dark defaults; the exact shade does not matter for the
# branding checks, only that the pink is the brand pink).
ANSI = {
    "black": "#000000",
    "red": "#cd3131",
    "green": "#0dbc79",
    "brown": "#e5e510",
    "yellow": "#e5e510",
    "blue": "#2472c8",
    "magenta": "#bc3fbc",
    "cyan": "#11a8cd",
    "white": "#e5e5e5",
}
BRIGHT = {name: value for name, value in ANSI.items()}
BRIGHT.update({"black": "#666666", "red": "#f14c4c", "green": "#23d18b", "brown": "#f5f543",
               "yellow": "#f5f543", "blue": "#3b8eea", "magenta": "#d670d6", "cyan": "#29b8db",
               "white": "#ffffff"})
DEFAULT_FG = "#d4d4d4"
DEFAULT_BG = "#101010"

# Characters that draw a cell's upper/lower half or the whole cell.
HALF_TOP = "\u2580"
HALF_BOTTOM = "\u2584"
FULL = "\u2588"
LEFT = "\u258c"
RIGHT = "\u2590"
TOP_LEFT = "\u2598"

FONT_PATH = "/System/Library/Fonts/Menlo.ttc"
CELL_W, CELL_H = 9, 18


def color(name, bold):
    if name is None or name == "default":
        return None
    if name.startswith("#"):
        return name
    # pyte stores 24-bit SGR as bare hex ("ff6096"), without the leading '#'.
    if len(name) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in name):
        return "#" + name
    table = BRIGHT if bold else ANSI
    return table.get(name, ANSI.get(name))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("raw")
    parser.add_argument("out")
    parser.add_argument("--cols", type=int, default=120)
    parser.add_argument("--rows", type=int, default=40)
    parser.add_argument("--font-size", type=int, default=14)
    args = parser.parse_args()

    screen = pyte.Screen(args.cols, args.rows)
    stream = pyte.ByteStream(screen)
    with open(args.raw, "rb") as handle:
        stream.feed(handle.read())

    lines = screen.display
    with open(args.out + ".screen.txt", "w", encoding="utf-8") as handle:
        handle.write("\n".join(line.rstrip() for line in lines).rstrip() + "\n")

    image = Image.new("RGB", (args.cols * CELL_W, args.rows * CELL_H), DEFAULT_BG)
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT_PATH, args.font_size, index=0)
    for y in range(args.rows):
        row = screen.buffer[y]
        for x in range(args.cols):
            cell = row[x]
            ch = cell.data or " "
            fg = color(cell.fg, cell.bold) or DEFAULT_FG
            bg = color(cell.bg, False) or DEFAULT_BG
            px, py = x * CELL_W, y * CELL_H
            draw.rectangle([px, py, px + CELL_W - 1, py + CELL_H - 1], fill=bg)
            if cell.reverse:
                fg, bg = bg, fg
            if ch == " ":
                continue
            if ch in (HALF_TOP, HALF_BOTTOM, FULL):
                if ch in (HALF_TOP, FULL):
                    draw.rectangle([px, py, px + CELL_W - 1, py + CELL_H // 2 - 1], fill=fg)
                if ch in (HALF_BOTTOM, FULL):
                    draw.rectangle([px, py + CELL_H // 2, px + CELL_W - 1, py + CELL_H - 1], fill=fg)
                continue
            draw.text((px, py), ch, font=font, fill=fg)
    image.save(args.out + ".screen.png")
    sys.stdout.write(f"screen {args.cols}x{args.rows} -> {args.out}.screen.txt/.png\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
