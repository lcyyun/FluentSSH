package com.fluentssh.mobile.terminal

/**
 * Immutable description of a terminal color.
 *
 * The three variants mirror how the UI resolves colors:
 *  - [Default] uses the theme foreground / background color.
 *  - [Indexed] is one of the 256 xterm palette entries.
 *  - [Rgb] is a 24-bit true color.
 */
sealed interface TerminalColor {
    data object Default : TerminalColor

    /** 0..255 xterm palette index. */
    data class Indexed(val index: Int) : TerminalColor

    /** 24-bit true color. */
    data class Rgb(val r: Int, val g: Int, val b: Int) : TerminalColor
}

/**
 * One rendered character cell.
 *
 * [text] is normally a single grapheme (or a base character plus combining marks).
 * A plain space is stored as `" "`.
 *
 * Wide characters (CJK, emoji, ...) occupy two cells: the first cell carries the
 * character with [wide] = `true`, the following placeholder cell carries
 * `text = ""` and `wide = false`.
 */
data class TerminalCell(
    val text: String = " ",
    val fg: TerminalColor = TerminalColor.Default,
    val bg: TerminalColor = TerminalColor.Default,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val underline: Boolean = false,
    val strike: Boolean = false,
    val inverse: Boolean = false,
    val wide: Boolean = false,
)

/** A single row of terminal cells. The list is immutable. */
data class TerminalLine(val cells: List<TerminalCell>) {
    val text: String get() = cells.joinToString("") { it.text }
}

/** Fully immutable view of the emulator, safe to hand to the UI thread. */
data class TerminalSnapshot(
    val cols: Int,
    val rows: Int,
    /** Exactly [rows] lines, each holding exactly [cols] cells. */
    val screen: List<TerminalLine>,
    /** Most recent scrollback lines, oldest first (at most min(scrollbackLimit, 2000)). */
    val scrollback: List<TerminalLine>,
    val cursorCol: Int,
    val cursorRow: Int,
    val cursorVisible: Boolean,
    val alternateScreen: Boolean,
    val title: String,
    /** Always null for now; reserved for UI driven text selection. */
    val selection: TerminalSelection? = null,
)

/** Text selection in screen coordinates (0-based, inclusive endpoints). */
data class TerminalSelection(
    val startRow: Int,
    val startCol: Int,
    val endRow: Int,
    val endCol: Int,
)
