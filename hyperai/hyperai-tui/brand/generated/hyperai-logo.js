/**
 * GENERATED FILE — do not edit by hand.
 * Terminal logo data for hyperai-tui in the SAME letter-grid format as the
 * upstream whale frames: one palette letter per sprite pixel, `.` transparent.
 * Derived from `brand/hyperai-logo.png` (60x60 PNG,
 * mark bbox 56x56, 26x26 sprite centered in the
 * whale's 40-column slot -> 13 display rows of half blocks).
 * Rendered at runtime by the whale's own `renderSpriteRows` (components/Whale.js).
 * Regenerate with:
 *
 *   node scripts/generate-logo-art.mjs
 *
 * The mark is a downsampled copy of the official artwork, never a redraw: the
 * white plate stays white, the pink pattern keeps its official color, and the
 * transparent margin stays transparent (terminal background shows through).
 */

/** Display columns of the art slot (same as the upstream whale box). */
export const HYPERAI_LOGO_COLUMNS = 40
/** Sprite rows (half-block: two sprite pixels per display row). */
export const HYPERAI_LOGO_SPRITE_ROWS = 26

/** Palette map, letter -> [r, g, b], read by `renderSpriteRows`. */
export const HYPERAI_LOGO_PALETTE = {
  "W": [
    255,
    255,
    255
  ],
  "p": [
    255,
    166,
    196
  ],
  "P": [
    255,
    96,
    150
  ]
}

/** Letter-grid sprite rows (whale frame format). */
export const HYPERAI_LOGO_SPRITE = [
  "..................WWWWW.................",
  "...............WWWWWWWWWWW..............",
  ".............WWWWWWWWWWWWWW.............",
  "............WWWWpPPPPPPppWWW............",
  "...........WWWpPPPPPPPPPPPWWW...........",
  "..........WWWpPPPPppppPPPPPWWW..........",
  ".........WWWpPPPWWpWppWWpPPPWWW.........",
  ".........WWpPPPWpPPpWPpWWpPPPWWW........",
  "........WWWPPPpWpPPpppWPpWPPPpWW........",
  "........WWpPPPpWpPWWPpWpPWpPPPWW........",
  "........WWPPPPWWWWppWPWpPppPPPpWW.......",
  ".......WWWPPPPWWWWWPpWWWPppPPPpWW.......",
  ".......WWWPPPpWWpWWWPPPWpppPPPPWW.......",
  ".......WWWPPPpWpPpWWWpWpWppPPPPWW.......",
  ".......WWWPPPWWWWWWWWWpPPWpPPPpWW.......",
  ".......WWWPPPWWWWWWWWWWpWWpPPPpWW.......",
  "........WWpPPPWWWWWWWWWWWWPPPPWWW.......",
  "........WWWPPPWWWWWWWWWWWpPPPPWW........",
  "........WWWpPPpWWWWWWWWWWPPPPpWW........",
  ".........WWWPPPWWWWWWWWWWPPPpWWW........",
  "..........WWWPPPpppWWWWWWpPpWWW.........",
  "...........WWWPPPPpWWWWWWppWWW..........",
  "............WWWpPPpWWWWWWWWWW...........",
  ".............WWWWWpWWWWWWWWW............",
  "..............WWWWWWWWWWWWW.............",
  ".................WWWWWWW................"
]

/** Colorless preview of the same sprite (docs / no-color logs). */
export const HYPERAI_LOGO_MONO = "                  #####                 \n               ###########              \n             ##############             \n            ####+******++###            \n           ###+***********###           \n          ###+****++++*****###          \n         ###+***##+#++##+***###         \n         ##+***#+**+#*+##+***###        \n        ###***+#+**+++#*+#***+##        \n        ##+***+#+*##*+#+*#+***##        \n        ##****####++#*#+*++***+##       \n       ###****#####*+###*++***+##       \n       ###***+##+###***#+++****##       \n       ###***+#+*+###+#+#++****##       \n       ###***#########+**#+***+##       \n       ###***##########+##+***+##       \n        ##+***############****###       \n        ###***###########+****##        \n        ###+**+##########****+##        \n         ###***##########***+###        \n          ###***+++######+*+###         \n           ###****+######++###          \n            ###+**+##########           \n             #####+#########            \n              #############             \n                 #######                "
