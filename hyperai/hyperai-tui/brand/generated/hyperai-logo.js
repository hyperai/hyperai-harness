/**
 * GENERATED FILE — do not edit by hand.
 * Terminal logo data for hyperai-tui, generated from the canonical SVG source
 * `brand/hyperai-logo.svg` (120x120 viewBox: white circle
 * + embedded 271x267 icon painted into a 90x89 rect).
 *
 * The build composites the SVG analytically (white circle + icon, 4x4
 * supersampling), then downsamples to two letter-grid sprites in the upstream
 * whale frame format — one palette letter per sprite pixel, `.` transparent —
 * so the runtime renders them through the whale's own `renderSpriteRows`
 * (true-color half blocks, no image protocol, no recoloring):
 *
 *   wide      40x40 sprite -> 20 display rows (main, terminal rows >= 44)
 *   compact   26x26 sprite -> 13 display rows (small windows)
 *
 * Colors come from the SVG itself: white circle [255,255,255], icon
 * accent [225,29,72], and intermediate blends for anti-aliased
 * edges. Transparent pixels stay transparent (terminal background shows through).
 *
 * Regenerate with:
 *
 *   node scripts/generate-logo-art.mjs
 */

/** Display columns of the art slot (same as the upstream whale box). */
export const HYPERAI_LOGO_COLUMNS = 40

/** Terminal rows at or above which the wide 40x40 sprite is used. */
export const HYPERAI_LOGO_WIDE_MIN_ROWS = 44

/** Sprite rows of the wide variant (half-block: two sprite pixels per display row). */
export const HYPERAI_LOGO_SPRITE_ROWS_WIDE = 40

/** Sprite rows of the compact variant (half-block: two sprite pixels per display row). */
export const HYPERAI_LOGO_SPRITE_ROWS_COMPACT = 26

/** Palette map, letter -> [r, g, b], read by `renderSpriteRows`. */
export const HYPERAI_LOGO_PALETTE = {
  "W": [
    255,
    255,
    255
  ],
  "a": [
    248,
    199,
    209
  ],
  "b": [
    240,
    142,
    164
  ],
  "c": [
    233,
    86,
    118
  ],
  "R": [
    225,
    29,
    72
  ]
}

/** Wide letter-grid sprite (40x40 mark centered in 40 columns). */
export const HYPERAI_LOGO_SPRITE_WIDE = [
  "................WWWWWWWW................",
  ".............WWWWWWWWWWWWWW.............",
  "..........WWWWWWWWWWWWWWWWWWWW..........",
  ".........WWWWWWWWaaaaaaWWWWWWWW.........",
  ".......WWWWWWWbcRRRRRRRRcbWWWWWWW.......",
  "......WWWWWWbRRRRRRRRRRRRRRbWWWWWW......",
  ".....WWWWWbRRRRRRRRRRRRRRRRRRaWWWWW.....",
  "....WWWWWcRRRRRRcbbbbbcRRRRRRRbWWWWW....",
  "....WWWWcRRRRRbWWWWWWWWWbRRRRRRbWWWW....",
  "...WWWWcRRRRRaWWaaWbcbaWWaRRRRRRbWWWW...",
  "..WWWWbRRRRRbWacRRbWcRRcWWaRRRRRRaWWWW..",
  "..WWWaRRRRRcWWRRRRRbWbRaaaWaRRRRRRWWWW..",
  "..WWWcRRRRRbWaRRRRRbWRbWcRaWcRRRRRbWWWW.",
  ".WWWWRRRRRRWWWRRcWaWcRWaRRcWaRRRRRRWWWW.",
  ".WWWbRRRRRcWWWacWaWaRRcaaRRaWcRRRRRaWWW.",
  ".WWWcRRRRRbWWWWWaRRaacRaaRRbWaRRRRRcWWW.",
  "WWWWRRRRRRaWWWWWacRRbWaWaRRRWaRRRRRRWWWW",
  "WWWaRRRRRRWWWWWWWWcRRbWcaaRRWWRRRRRRWWWW",
  "WWWaRRRRRcWWWWaWWWWcRRRRbWcRaWRRRRRRaWWW",
  "WWWaRRRRRaWWaRRaWWWWcRRcWaRRWWRRRRRRaWWW",
  "WWWaRRRRRWWWaRRbWWWWWbcWbaacWWRRRRRRaWWW",
  "WWWaRRRRcWWWWbcWWWWWWWWbRRaWWaRRRRRRaWWW",
  "WWWaRRRRbWWWWWWWWWWWWWWbRRRaWbRRRRRRWWWW",
  "WWWWRRRRbWWWWWWWWWWWWWWWabaWWcRRRRRcWWWW",
  ".WWWcRRRRaaWWWWWWWWWWWWWWWWWbRRRRRRbWWW.",
  ".WWWbRRRRRcWWWWWWWWWWWWWWWWaRRRRRRRaWWW.",
  ".WWWWRRRRRcWWWWWWWWWWWWWWWWbRRRRRRcWWWW.",
  "..WWWbRRRRcWWWWWWWWWWWWWWWWcRRRRRRbWWWW.",
  "..WWWWRRRRRWWWWWWWWWWWWWWWWcRRRRRcWWWW..",
  "..WWWWaRRRRbWWWWWWWWWWWWWWWcRRRRRaWWWW..",
  "...WWWWbRRRRbWWWWWWWWWWWWWWcRRRRaWWWW...",
  "....WWWWbRRRRcbbbaWWWWWWWWWbRRRaWWWW....",
  "....WWWWWbRRRRRRRbWWWWWWWWWaRRaWWWWW....",
  ".....WWWWWacRRRRRbWWWWWWWWWacaWWWWW.....",
  "......WWWWWWbcRRRbWWWWWWWWWWWWWWWW......",
  ".......WWWWWWWabcaWWWWWWWWWWWWWWW.......",
  ".........WWWWWWWWWWWWWWWWWWWWWW.........",
  "..........WWWWWWWWWWWWWWWWWWWW..........",
  "............WWWWWWWWWWWWWWWW............",
  "................WWWWWWWW................"
]

/** Compact letter-grid sprite (26x26 mark centered in 40 columns). */
export const HYPERAI_LOGO_SPRITE_COMPACT = [
  ".................WWWWWW.................",
  "..............WWWWWWWWWWWW..............",
  "............WWWWWabbbbaWWWWW............",
  "...........WWWacRRRRRRRRcaWWW...........",
  "..........WWWbRRRRRcRRRRRRbWWW..........",
  ".........WWWbRRRbaWWWWbRRRRbWWW.........",
  ".........WWbRRRaWbbaRcaWcRRRbWW.........",
  "........WWaRRRcWRRRcaRaaWRRRRaWW........",
  "........WWcRRRaWRRbacbbRabRRRcWW........",
  "........WWRRRRWWabbaRcaccWRRRRWWW.......",
  ".......WWbRRRcWWWWRcabWRRWcRRRaWW.......",
  ".......WWbRRRbWWWWaRRacaRabRRRbWW.......",
  ".......WWbRRRWWbcWWacRbaRabRRRbWW.......",
  ".......WWbRRcWWcRWWWWbabaabRRRbWW.......",
  ".......WWbRRbWWWWWWWWWcRbWcRRRbWW.......",
  ".......WWaRRbWWWWWWWWWWaWaRRRRaWW.......",
  "........WWRRRRWWWWWWWWWWWcRRRRWWW.......",
  "........WWcRRRWWWWWWWWWWaRRRRbWW........",
  "........WWaRRRaWWWWWWWWWaRRRRWWW........",
  ".........WWbRRcWWWWWWWWWaRRRaWW.........",
  ".........WWWbRRcbbaWWWWWWRRbWWW.........",
  "..........WWWaRRRRaWWWWWWcaWWW..........",
  "...........WWWWbRRaWWWWWWWWWW...........",
  "............WWWWWaWWWWWWWWWW............",
  "..............WWWWWWWWWWWW..............",
  "................WWWWWWWW................"
]

/** Colorless preview of the wide sprite (docs / no-color logs). */
export const HYPERAI_LOGO_MONO = "                ########                \n             ##############             \n          ####################          \n         ########++++++########         \n       #######-=********=-#######       \n      ######-**************-######      \n     #####-******************+#####     \n    #####=******=-----=*******-#####    \n    ####=*****-#########-******-####    \n   ####=*****+##++#-=-+##+******-####   \n  ####-*****-#+=**-#=**=##+******+####  \n  ###+*****=##*****-#-*+++#+******####  \n  ###=*****-#+*****-#*-#=*+#=*****-#### \n ####******###**=#+#=*#+**=#+******#### \n ###-*****=###+=#+#+**=++**+#=*****+### \n ###=*****-#####+**++=*++**-#+*****=### \n####******+#####+=**-#+#+***#+******####\n###+******########=**-#=++**##******####\n###+*****=####+####=****-#=*+#******+###\n###+*****+##+**+####=**=#+**##******+###\n###+*****###+**-#####-=#-++=##******+###\n###+****=####-=########-**+##+******+###\n###+****-##############-***+#-******####\n####****-###############+-+##=*****=####\n ###=****++#################-******-### \n ###-*****=################+*******+### \n ####*****=################-******=#### \n  ###-****=################=******-#### \n  ####*****################=*****=####  \n  ####+****-###############=*****+####  \n   ####-****-##############=****+####   \n    ####-****=---+#########-***+####    \n    #####-*******-#########+**+#####    \n     #####+=*****-#########+=+#####     \n      ######-=***-################      \n       #######+-=+###############       \n         ######################         \n          ####################          \n            ################            \n                ########                "
