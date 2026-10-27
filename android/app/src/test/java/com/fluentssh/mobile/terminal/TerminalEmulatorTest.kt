package com.fluentssh.mobile.terminal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.ArrayList
import java.util.Collections

/**
 * JVM unit tests for the pure Kotlin terminal emulator.
 *
 * These tests only touch the public API described in the UI contract and assert
 * concrete cell / cursor / scrollback values instead of "does not crash".
 */
class TerminalEmulatorTest {

    // --------------------------------------------------------------- helpers

    private fun emulator(
        cols: Int = 10,
        rows: Int = 3,
        scrollbackLimit: Int = 100,
    ): TerminalEmulator = TerminalEmulator(
        cols = cols,
        rows = rows,
        scrollbackLimit = scrollbackLimit,
    )

    private fun TerminalEmulator.line(index: Int): TerminalLine = snapshot().screen[index]

    private fun TerminalEmulator.lineText(index: Int): String = snapshot().screen[index].text.trimEnd()

    private fun TerminalEmulator.lineTexts(): List<String> = snapshot().screen.map { it.text.trimEnd() }

    private fun TerminalEmulator.cell(row: Int, col: Int): TerminalCell = snapshot().screen[row].cells[col]

    private fun TerminalEmulator.scrollbackTexts(): List<String> =
        snapshot().scrollback.map { it.text.trimEnd() }

    // -------------------------------------------------------------- text / wrap

    @Test
    fun plainTextIsRenderedCellByCell() {
        val terminal = emulator()
        terminal.feed("hello")

        val snapshot = terminal.snapshot()
        assertEquals(10, snapshot.cols)
        assertEquals(3, snapshot.rows)
        assertEquals(3, snapshot.screen.size)
        assertEquals(10, snapshot.screen[0].cells.size)
        assertEquals("hello", snapshot.screen[0].text.trimEnd())
        assertEquals("h", snapshot.screen[0].cells[0].text)
        assertEquals("o", snapshot.screen[0].cells[4].text)
        assertEquals(" ", snapshot.screen[0].cells[5].text)
        assertEquals(0, snapshot.cursorRow)
        assertEquals(5, snapshot.cursorCol)
        assertTrue(terminal.version > 0L)
    }

    @Test
    fun crAndLfMoveTheCursor() {
        val terminal = emulator(10, 3)
        terminal.feed("ab\r\ncd")

        assertEquals(listOf("ab", "cd", ""), terminal.lineTexts())
        val snapshot = terminal.snapshot()
        assertEquals(1, snapshot.cursorRow)
        assertEquals(2, snapshot.cursorCol)
    }

    @Test
    fun backspaceMovesLeftWithoutUnderflow() {
        val terminal = emulator(10, 2)
        terminal.feed("abc\u0008X")
        assertEquals("abX", terminal.lineText(0))
        assertEquals(3, terminal.snapshot().cursorCol)

        terminal.feed("\u0008\u0008\u0008\u0008\u0008")
        assertEquals(0, terminal.snapshot().cursorCol)
    }

    @Test
    fun deferredWrapHappensOnlyWhenNextCharacterArrives() {
        val terminal = emulator(5, 2)
        terminal.feed("abcde")

        // Cursor stays on the last column and only a pending wrap flag is set.
        assertEquals("abcde", terminal.lineText(0))
        assertEquals(4, terminal.snapshot().cursorCol)
        assertEquals(0, terminal.snapshot().cursorRow)

        terminal.feed("f")
        assertEquals("abcde", terminal.lineText(0))
        assertEquals("f", terminal.lineText(1))
        assertEquals(1, terminal.snapshot().cursorRow)
        assertEquals(1, terminal.snapshot().cursorCol)
    }

    @Test
    fun longLineWrapsAcrossMultipleRows() {
        val terminal = emulator(5, 4)
        terminal.feed("abcdefghijklmn")

        assertEquals(listOf("abcde", "fghij", "klmn", ""), terminal.lineTexts())
        val snapshot = terminal.snapshot()
        assertEquals(2, snapshot.cursorRow)
        assertEquals(4, snapshot.cursorCol)
    }

    @Test
    fun carriageReturnCancelsPendingWrap() {
        val terminal = emulator(5, 2)
        terminal.feed("abcde\r\nX")
        assertEquals("abcde", terminal.lineText(0))
        assertEquals("X", terminal.lineText(1))
        assertEquals(1, terminal.snapshot().cursorCol)
    }

    @Test
    fun autowrapCanBeDisabled() {
        val terminal = emulator(3, 2)
        terminal.feed("\u001b[?7l")
        terminal.feed("abcde")

        // Without autowrap the last column is overwritten in place.
        assertEquals("abe", terminal.lineText(0))
        assertEquals("", terminal.lineText(1))
        assertEquals(2, terminal.snapshot().cursorCol)

        terminal.feed("\u001b[?7h")
        terminal.feed("f")
        assertEquals("abf", terminal.lineText(0))
        terminal.feed("g")
        assertEquals("g", terminal.lineText(1))
    }

    // ------------------------------------------------------------- cursor moves

    @Test
    fun cursorPositioningAndRelativeMoves() {
        val terminal = emulator(10, 5)

        terminal.feed("\u001b[3;4H")
        assertEquals(2, terminal.snapshot().cursorRow)
        assertEquals(3, terminal.snapshot().cursorCol)

        terminal.feed("\u001b[2A")
        assertEquals(0, terminal.snapshot().cursorRow)
        assertEquals(3, terminal.snapshot().cursorCol)

        terminal.feed("\u001b[5C")
        assertEquals(8, terminal.snapshot().cursorCol)

        terminal.feed("\u001b[2B")
        assertEquals(2, terminal.snapshot().cursorRow)

        terminal.feed("\u001b[3D")
        assertEquals(5, terminal.snapshot().cursorCol)

        terminal.feed("\u001b[5G")
        assertEquals(4, terminal.snapshot().cursorCol)

        terminal.feed("\u001b[4d")
        assertEquals(3, terminal.snapshot().cursorRow)
        assertEquals(4, terminal.snapshot().cursorCol)

        terminal.feed("\u001b[2;7f")
        assertEquals(1, terminal.snapshot().cursorRow)
        assertEquals(6, terminal.snapshot().cursorCol)

        terminal.feed("\u001b[H")
        assertEquals(0, terminal.snapshot().cursorRow)
        assertEquals(0, terminal.snapshot().cursorCol)

        // CNL / CPL always land in column zero.
        terminal.feed("\u001b[2E")
        assertEquals(2, terminal.snapshot().cursorRow)
        assertEquals(0, terminal.snapshot().cursorCol)
        terminal.feed("\u001b[1F")
        assertEquals(1, terminal.snapshot().cursorRow)
        assertEquals(0, terminal.snapshot().cursorCol)

        // HPR / VPR.
        terminal.feed("\u001b[3a")
        assertEquals(3, terminal.snapshot().cursorCol)
        terminal.feed("\u001b[2e")
        assertEquals(3, terminal.snapshot().cursorRow)

        // Out of range CUP is clamped.
        terminal.feed("\u001b[99;99H")
        assertEquals(4, terminal.snapshot().cursorRow)
        assertEquals(9, terminal.snapshot().cursorCol)
    }

    @Test
    fun saveAndRestoreCursorPosition() {
        val terminal = emulator(10, 3)
        terminal.feed("ab")
        terminal.feed("\u001b7")
        terminal.feed("XY")
        assertEquals(4, terminal.snapshot().cursorCol)

        terminal.feed("\u001b8")
        assertEquals(2, terminal.snapshot().cursorCol)
        terminal.feed("z")
        assertEquals("abzY", terminal.lineText(0))
    }

    @Test
    fun csiSaveRestoreCursorAlias() {
        val terminal = emulator(10, 3)
        terminal.feed("ab\u001b[s")
        terminal.feed("X")
        terminal.feed("\u001b[u")
        terminal.feed("Q")
        assertEquals("abQ", terminal.lineText(0))
        assertEquals(3, terminal.snapshot().cursorCol)
    }

    @Test
    fun saveRestoreAlsoRestoresGraphicRendition() {
        val terminal = emulator(10, 3)
        terminal.feed("\u001b[31m")
        terminal.feed("\u001b7")
        terminal.feed("\u001b[32m")
        terminal.feed("\u001b[1;2H")
        terminal.feed("Y")
        terminal.feed("\u001b8")
        terminal.feed("Z")

        assertEquals("Z", terminal.cell(0, 0).text)
        assertEquals(TerminalColor.Indexed(1), terminal.cell(0, 0).fg) // Z restored to red
        assertEquals("Y", terminal.cell(0, 1).text)
        assertEquals(TerminalColor.Indexed(2), terminal.cell(0, 1).fg) // Y was green
    }

    // ------------------------------------------------------------------ erasing

    @Test
    fun eraseInLineModes() {
        val terminal = emulator(10, 2)
        terminal.feed("abcdef")
        terminal.feed("\u001b[1;3H")
        terminal.feed("\u001b[K")
        assertEquals("ab", terminal.lineText(0))
        assertEquals(" ", terminal.cell(0, 2).text)
        assertEquals(2, terminal.snapshot().cursorCol)

        val other = emulator(10, 2)
        other.feed("abcdef")
        other.feed("\u001b[1;4H")
        other.feed("\u001b[1K")
        assertEquals("    ef", other.lineText(0))

        val third = emulator(10, 2)
        third.feed("abcdef")
        third.feed("\u001b[1;4H")
        third.feed("\u001b[2K")
        assertEquals("", third.lineText(0))
    }

    @Test
    fun eraseInDisplayModes() {
        val terminal = emulator(5, 3)
        terminal.feed("aaa\r\nbbb\r\nccc")
        terminal.feed("\u001b[2;3H")
        terminal.feed("\u001b[J")
        assertEquals(listOf("aaa", "bb", ""), terminal.lineTexts())
        assertEquals(1, terminal.snapshot().cursorRow)
        assertEquals(2, terminal.snapshot().cursorCol)

        val modeOne = emulator(5, 3)
        modeOne.feed("aaa\r\nbbb\r\nccc")
        modeOne.feed("\u001b[2;3H")
        modeOne.feed("\u001b[1J")
        assertEquals(listOf("", "", "ccc"), modeOne.lineTexts())

        val modeTwo = emulator(5, 3)
        modeTwo.feed("aaa\r\nbbb\r\nccc")
        modeTwo.feed("\u001b[2;3H")
        modeTwo.feed("\u001b[2J")
        assertEquals(listOf("", "", ""), modeTwo.lineTexts())
        assertEquals(1, modeTwo.snapshot().cursorRow)
    }

    @Test
    fun eraseCharactersUsesCurrentCursor() {
        val terminal = emulator(10, 2)
        terminal.feed("abcdef")
        terminal.feed("\u001b[1;3H")
        terminal.feed("\u001b[2X")
        assertEquals("ab  ef", terminal.lineText(0))
        assertEquals(" ", terminal.cell(0, 2).text)
        assertEquals(" ", terminal.cell(0, 3).text)
        assertEquals("e", terminal.cell(0, 4).text)
    }

    @Test
    fun eraseDisplayThreeAlsoClearsScrollback() {
        val terminal = emulator(5, 2)
        terminal.feed("1\r\n2\r\n3\r\n4")
        assertEquals(listOf("1", "2"), terminal.scrollbackTexts())

        terminal.feed("\u001b[3J")
        assertTrue(terminal.snapshot().scrollback.isEmpty())
        assertEquals(listOf("", ""), terminal.lineTexts())
    }

    // ------------------------------------------------------ insert / delete ops

    @Test
    fun insertAndDeleteCharacters() {
        val inserted = emulator(10, 2)
        inserted.feed("abcdef")
        inserted.feed("\u001b[1;2H")
        inserted.feed("\u001b[2@")
        assertEquals("a  bcdef", inserted.lineText(0))

        val deleted = emulator(10, 2)
        deleted.feed("abcdef")
        deleted.feed("\u001b[1;2H")
        deleted.feed("\u001b[2P")
        assertEquals("adef", deleted.lineText(0))
        assertEquals("f", deleted.cell(0, 3).text)
        assertEquals(" ", deleted.cell(0, 4).text)
    }

    @Test
    fun insertAndDeleteLines() {
        val inserted = emulator(5, 4)
        inserted.feed("A\r\nB\r\nC\r\nD")
        inserted.feed("\u001b[2;1H")
        inserted.feed("\u001b[1L")
        assertEquals(listOf("A", "", "B", "C"), inserted.lineTexts())
        assertEquals(1, inserted.snapshot().cursorRow)

        val deleted = emulator(5, 4)
        deleted.feed("A\r\nB\r\nC\r\nD")
        deleted.feed("\u001b[2;1H")
        deleted.feed("\u001b[1M")
        assertEquals(listOf("A", "C", "D", ""), deleted.lineTexts())
    }

    // ------------------------------------------------------------------ scrolling

    @Test
    fun scrollingRegionLimitsLineFeedScrolling() {
        val terminal = emulator(5, 5)
        terminal.feed("0\r\n1\r\n2\r\n3\r\n4")
        assertEquals(listOf("0", "1", "2", "3", "4"), terminal.lineTexts())

        terminal.feed("\u001b[2;4r")
        assertEquals(1, terminal.snapshot().cursorRow)
        assertEquals(0, terminal.snapshot().cursorCol)

        terminal.feed("\n\n\n")
        assertEquals(listOf("0", "2", "3", "", "4"), terminal.lineTexts())
        assertTrue(terminal.snapshot().scrollback.isEmpty())

        // Reverse index scrolls the region downwards at the top margin.
        terminal.feed("\u001b[2;1H")
        terminal.feed("\u001bM")
        assertEquals(listOf("0", "", "2", "3", "4"), terminal.lineTexts())
    }

    @Test
    fun scrollUpAndDownViaCsi() {
        val terminal = emulator(5, 3)
        terminal.feed("a\r\nb\r\nc")

        terminal.feed("\u001b[2S")
        assertEquals(listOf("c", "", ""), terminal.lineTexts())

        terminal.feed("\u001b[1T")
        assertEquals(listOf("", "c", ""), terminal.lineTexts())
    }

    @Test
    fun lineFeedAtBottomPushesScrollback() {
        val terminal = emulator(10, 2, scrollbackLimit = 100)
        terminal.feed("1\r\n2\r\n3\r\n4")

        assertEquals(listOf("3", "4"), terminal.lineTexts())
        assertEquals(listOf("1", "2"), terminal.scrollbackTexts())
    }

    @Test
    fun scrollbackHonoursItsLimit() {
        val terminal = emulator(5, 2, scrollbackLimit = 2)
        terminal.feed("a\r\nb\r\nc\r\nd\r\ne")

        assertEquals(listOf("d", "e"), terminal.lineTexts())
        assertEquals(listOf("b", "c"), terminal.scrollbackTexts())
    }

    @Test
    fun snapshotScrollbackIsCappedAt2000Lines() {
        val terminal = emulator(4, 2, scrollbackLimit = 5000)
        val batch = buildString {
            repeat(2100) { append("x\r\n") }
        }
        terminal.feed(batch)

        val snapshot = terminal.snapshot()
        assertEquals(2000, snapshot.scrollback.size)
        assertEquals("x", snapshot.scrollback.last().text.trimEnd())
    }

    // -------------------------------------------------------------- alternate screen

    @Test
    fun alternateScreenRestoresMainScreenAndCursor() {
        val terminal = emulator(5, 2, scrollbackLimit = 10)
        terminal.feed("MAIN")
        val mainCursorCol = terminal.snapshot().cursorCol
        assertEquals(4, mainCursorCol)

        terminal.feed("\u001b[?1049h")
        var snapshot = terminal.snapshot()
        assertTrue(snapshot.alternateScreen)
        assertEquals(0, snapshot.cursorRow)
        assertEquals(0, snapshot.cursorCol)
        assertEquals("", snapshot.screen[0].text.trimEnd())

        terminal.feed("a\r\nb\r\nc")
        assertEquals(listOf("b", "c"), terminal.lineTexts())
        // Alternate screen scrolling must not pollute the main scrollback.
        assertTrue(terminal.snapshot().scrollback.isEmpty())

        terminal.feed("\u001b[?1049l")
        snapshot = terminal.snapshot()
        assertFalse(snapshot.alternateScreen)
        assertEquals("MAIN", snapshot.screen[0].text.trimEnd())
        assertEquals(0, snapshot.cursorRow)
        assertEquals(4, snapshot.cursorCol)
    }

    @Test
    fun alternateScreenSequence47And1047StillWork() {
        val terminal = emulator(5, 2)
        terminal.feed("main")
        terminal.feed("\u001b[?47h")
        assertTrue(terminal.snapshot().alternateScreen)
        terminal.feed("\u001b[?47l")
        assertFalse(terminal.snapshot().alternateScreen)
        assertEquals("main", terminal.lineText(0))

        terminal.feed("\u001b[?1047h")
        assertTrue(terminal.snapshot().alternateScreen)
        terminal.feed("\u001b[?1047l")
        assertFalse(terminal.snapshot().alternateScreen)
        assertEquals("main", terminal.lineText(0))
    }

    // ----------------------------------------------------------------------- OSC

    @Test
    fun oscZeroAndTwoSetTheTitle() {
        val terminal = emulator()
        assertEquals("", terminal.snapshot().title)

        terminal.feed("\u001b]0;My Title\u0007")
        assertEquals("My Title", terminal.snapshot().title)

        terminal.feed("\u001b]2;Second\u001b\\")
        assertEquals("Second", terminal.snapshot().title)

        // Unknown OSC codes must be ignored.
        terminal.feed("\u001b]8;;https://example.invalid\u0007")
        assertEquals("Second", terminal.snapshot().title)

        val longTitle = "T".repeat(300)
        terminal.feed("\u001b]0;$longTitle\u0007")
        assertEquals(200, terminal.snapshot().title.length)
    }

    // ----------------------------------------------------------- DSR / DA / tabs

    @Test
    fun dsrAndDaResponsesAreQueuedAndDrained() {
        val terminal = emulator(10, 3)
        terminal.feed("ab")
        assertTrue(terminal.drainResponses().isEmpty())

        terminal.feed("\u001b[6n")
        var responses = terminal.drainResponses()
        assertEquals(1, responses.size)
        assertArrayEquals(ascii("\u001b[1;3R"), responses[0])
        assertTrue(terminal.drainResponses().isEmpty())

        terminal.feed("\u001b[3;4H\u001b[6n")
        responses = terminal.drainResponses()
        assertEquals(1, responses.size)
        assertArrayEquals(ascii("\u001b[3;4R"), responses[0])

        terminal.feed("\u001b[5n")
        assertArrayEquals(ascii("\u001b[0n"), terminal.drainResponses().single())

        terminal.feed("\u001b[c")
        assertArrayEquals(ascii("\u001b[?1;2c"), terminal.drainResponses().single())
    }

    @Test
    fun tabsUseEightColumnStopsAndCanBeCustomised() {
        val defaultTabs = emulator(20, 2)
        defaultTabs.feed("a\tb")
        assertEquals("a", defaultTabs.cell(0, 0).text)
        assertEquals("b", defaultTabs.cell(0, 8).text)
        assertEquals(9, defaultTabs.snapshot().cursorCol)

        val custom = emulator(20, 2)
        custom.feed("\u001b[1;3H")
        custom.feed("\u001bH")
        custom.feed("\u001b[1;1H")
        custom.feed("a\tb")
        assertEquals("b", custom.cell(0, 2).text)

        val cleared = emulator(20, 2)
        cleared.feed("\u001b[3g")
        cleared.feed("a\tb")
        assertEquals("b", cleared.cell(0, 19).text)

        val back = emulator(20, 2)
        back.feed("a\tb")
        assertEquals(9, back.snapshot().cursorCol)
        back.feed("\u001b[Z")
        assertEquals(8, back.snapshot().cursorCol)
    }

    // ------------------------------------------------------------------- UTF-8

    @Test
    fun utf8SplitAcrossFeedsIsDecodedCorrectly() {
        val terminal = emulator(10, 2)
        val bytes = "中".toByteArray(Charsets.UTF_8)
        assertEquals(3, bytes.size)

        terminal.feed(bytes, 1)
        assertEquals("", terminal.lineText(0))
        terminal.feed(bytes.copyOfRange(1, 2))
        assertEquals("", terminal.lineText(0))
        terminal.feed(bytes.copyOfRange(2, 3))

        assertEquals("中", terminal.lineText(0))
        val cell = terminal.cell(0, 0)
        assertEquals("中", cell.text)
        assertTrue(cell.wide)
        assertEquals("", terminal.cell(0, 1).text)
        assertFalse(terminal.cell(0, 1).wide)
        assertEquals(" ", terminal.cell(0, 2).text)
        assertEquals(2, terminal.snapshot().cursorCol)

        terminal.feed("a")
        assertEquals("中a", terminal.lineText(0))
        assertEquals(3, terminal.snapshot().cursorCol)
    }

    @Test
    fun cjkWideCharsWrapWhenOnlyOneColumnRemains() {
        val terminal = emulator(4, 2)
        terminal.feed("abc中")

        // The CJK glyph needs two columns, only one is left: wrap first.
        assertEquals("abc", terminal.lineText(0))
        assertEquals("中", terminal.lineText(1))
        assertEquals(1, terminal.snapshot().cursorRow)
        assertEquals(2, terminal.snapshot().cursorCol)
    }

    @Test
    fun cjkWideCharsFillTheRestOfTheLine() {
        val terminal = emulator(4, 2)
        terminal.feed("ab中")
        assertEquals("ab中", terminal.lineText(0))
        assertTrue(terminal.cell(0, 2).wide)
        assertEquals("", terminal.cell(0, 3).text)
        assertEquals(3, terminal.snapshot().cursorCol)

        terminal.feed("X")
        assertEquals("X", terminal.lineText(1))
    }

    @Test
    fun combiningCharacterIsAttachedToPreviousCell() {
        val terminal = emulator(10, 2)
        terminal.feed("e\u0301")

        assertEquals("e\u0301", terminal.cell(0, 0).text)
        assertEquals(" ", terminal.cell(0, 1).text)
        assertEquals(1, terminal.snapshot().cursorCol)
    }

    @Test
    fun invalidUtf8IsReplacedWithUPlusFFFD() {
        val single = emulator()
        single.feed(byteArrayOf(0xFF.toByte()))
        assertEquals("\uFFFD", single.lineText(0))

        val truncated = emulator()
        truncated.feed(byteArrayOf(0xE4.toByte()))
        truncated.feed(byteArrayOf(0x41)) // 'A' interrupts the sequence
        assertEquals("\uFFFDA", truncated.lineText(0))

        val overlong = emulator()
        overlong.feed(byteArrayOf(0xC0.toByte(), 0x80.toByte()))
        assertEquals("\uFFFD\uFFFD", overlong.lineText(0))
    }

    @Test
    fun emojiSurrogatePairIsWide() {
        val terminal = emulator(10, 2)
        terminal.feed("😀")
        val cell = terminal.cell(0, 0)
        assertEquals("😀", cell.text)
        assertTrue(cell.wide)
        assertEquals("", terminal.cell(0, 1).text)
        assertEquals(2, terminal.snapshot().cursorCol)
    }

    // -------------------------------------------------------------------- SGR

    @Test
    fun sgrBasicColorsAndAttributes() {
        val terminal = emulator(20, 2)
        terminal.feed("\u001b[31;42;1;3;4;7;9mX")

        val x = terminal.cell(0, 0)
        assertEquals(TerminalColor.Indexed(1), x.fg)
        assertEquals(TerminalColor.Indexed(2), x.bg)
        assertTrue(x.bold)
        assertTrue(x.italic)
        assertTrue(x.underline)
        assertTrue(x.inverse)
        assertTrue(x.strike)

        terminal.feed("\u001b[22;23;24;27;29mY")
        val y = terminal.cell(0, 1)
        assertFalse(y.bold)
        assertFalse(y.italic)
        assertFalse(y.underline)
        assertFalse(y.inverse)
        assertFalse(y.strike)
        // Color codes are independent from the attribute resets.
        assertEquals(TerminalColor.Indexed(1), y.fg)
        assertEquals(TerminalColor.Indexed(2), y.bg)

        terminal.feed("\u001b[39;49mZ")
        val z = terminal.cell(0, 2)
        assertEquals(TerminalColor.Default, z.fg)
        assertEquals(TerminalColor.Default, z.bg)
    }

    @Test
    fun sgrBrightColorsAndReset() {
        val terminal = emulator(20, 2)
        terminal.feed("\u001b[91;101mA")
        assertEquals(TerminalColor.Indexed(9), terminal.cell(0, 0).fg)
        assertEquals(TerminalColor.Indexed(9), terminal.cell(0, 0).bg)

        terminal.feed("\u001b[0mB")
        val b = terminal.cell(0, 1)
        assertEquals(TerminalColor.Default, b.fg)
        assertEquals(TerminalColor.Default, b.bg)
        assertFalse(b.bold)
    }

    @Test
    fun sgr256AndTrueColor() {
        val terminal = emulator(20, 2)
        terminal.feed("\u001b[38;5;196mX")
        terminal.feed("\u001b[48;5;21mY")
        terminal.feed("\u001b[38;2;10;20;30mZ")
        terminal.feed("\u001b[48;2;1;2;3mW")

        assertEquals(TerminalColor.Indexed(196), terminal.cell(0, 0).fg)
        assertEquals(TerminalColor.Indexed(196), terminal.cell(0, 1).fg)
        assertEquals(TerminalColor.Indexed(21), terminal.cell(0, 1).bg)
        assertEquals(TerminalColor.Rgb(10, 20, 30), terminal.cell(0, 2).fg)
        assertEquals(TerminalColor.Rgb(1, 2, 3), terminal.cell(0, 3).bg)

        terminal.feed("\u001b[38:2::100:150:200mC")
        terminal.feed("\u001b[38:5:99mD")
        assertEquals(TerminalColor.Rgb(100, 150, 200), terminal.cell(0, 4).fg)
        assertEquals(TerminalColor.Indexed(99), terminal.cell(0, 5).fg)
    }

    // --------------------------------------------------------- ESC / DEC graphics

    @Test
    fun decSpecialGraphicsMapping() {
        val terminal = emulator(10, 2)
        terminal.feed("\u001b(0lqk")
        assertEquals("┌", terminal.cell(0, 0).text)
        assertEquals("─", terminal.cell(0, 1).text)
        assertEquals("┐", terminal.cell(0, 2).text)

        terminal.feed("x")
        assertEquals("│", terminal.cell(0, 3).text)

        terminal.feed("\u001b(Bq")
        assertEquals("q", terminal.cell(0, 4).text)
    }

    @Test
    fun indexNextLineAndReverseIndex() {
        val terminal = emulator(10, 5)
        terminal.feed("ab\r\ncd")
        terminal.feed("\u001b[2;3H")

        terminal.feed("\u001bD") // index
        assertEquals(2, terminal.snapshot().cursorRow)
        assertEquals(2, terminal.snapshot().cursorCol)

        terminal.feed("\u001bE") // next line
        assertEquals(3, terminal.snapshot().cursorRow)
        assertEquals(0, terminal.snapshot().cursorCol)

        terminal.feed("\u001bM") // reverse index
        assertEquals(2, terminal.snapshot().cursorRow)
    }

    // ------------------------------------------------------------------ resize

    @Test
    fun resizeTruncatesAndPadsWithoutCrashing() {
        val terminal = emulator(10, 3)
        terminal.feed("abcdef")
        assertEquals(6, terminal.snapshot().cursorCol)

        terminal.resize(5, 2)
        var snapshot = terminal.snapshot()
        assertEquals(5, snapshot.cols)
        assertEquals(2, snapshot.rows)
        assertEquals(2, snapshot.screen.size)
        assertEquals(5, snapshot.screen[0].cells.size)
        assertEquals("abcde", snapshot.screen[0].text.trimEnd())
        assertEquals(4, snapshot.cursorCol)
        assertEquals(0, snapshot.cursorRow)

        terminal.resize(8, 4)
        snapshot = terminal.snapshot()
        assertEquals(8, snapshot.cols)
        assertEquals(4, snapshot.rows)
        assertEquals(4, snapshot.screen.size)
        assertEquals(8, snapshot.screen[0].cells.size)
        assertEquals("abcde", snapshot.screen[0].text.trimEnd())
        assertEquals("", snapshot.screen[2].text.trimEnd())
        assertEquals("", snapshot.screen[3].text.trimEnd())

        terminal.resize(3, 1)
        snapshot = terminal.snapshot()
        assertEquals(3, snapshot.cols)
        assertEquals(1, snapshot.rows)
        assertEquals(1, snapshot.screen.size)
        assertEquals(3, snapshot.screen[0].cells.size)
        assertEquals("abc", snapshot.screen[0].text.trimEnd())

        terminal.feed("Z")
        assertEquals("abZ", terminal.lineText(0))
    }

    @Test
    fun assigningColsAndRowsDelegatesToResize() {
        val terminal = emulator(10, 3)
        terminal.feed("hello")
        terminal.cols = 20
        assertEquals(20, terminal.snapshot().cols)
        assertEquals(20, terminal.snapshot().screen[0].cells.size)
        assertEquals("hello", terminal.lineText(0))

        terminal.rows = 5
        assertEquals(5, terminal.snapshot().rows)
        assertEquals(5, terminal.snapshot().screen.size)
    }

    @Test
    fun zeroSizedConstructorIsClampedToAtLeastOneCell() {
        val terminal = TerminalEmulator(cols = 0, rows = 0, scrollbackLimit = 10)
        val snapshot = terminal.snapshot()
        assertEquals(1, snapshot.cols)
        assertEquals(1, snapshot.rows)
        assertEquals(1, snapshot.screen.size)
        assertEquals(1, snapshot.screen[0].cells.size)
        terminal.feed("x")
        assertEquals("x", terminal.lineText(0))
    }

    // ---------------------------------------------------------- clear / reset / version

    @Test
    fun clearBlanksScreenButKeepsScrollback() {
        val terminal = emulator(5, 2, scrollbackLimit = 10)
        terminal.feed("1\r\n2\r\n3\r\n4")
        assertEquals(2, terminal.snapshot().scrollback.size)

        terminal.clear()
        assertEquals(listOf("", ""), terminal.lineTexts())
        assertEquals(0, terminal.snapshot().cursorRow)
        assertEquals(0, terminal.snapshot().cursorCol)
        assertEquals(2, terminal.snapshot().scrollback.size)

        terminal.feed("x")
        assertEquals("x", terminal.lineText(0))
    }

    @Test
    fun resetClearsEverything() {
        val terminal = emulator(10, 3)
        terminal.feed("\u001b[31mhello\r\nworld")
        terminal.feed("\u001b]0;Title\u0007")
        terminal.feed("\u001b[?1049h")
        terminal.feed("\u001b[?25l")
        terminal.feed("\u001b[?7l")

        terminal.reset()
        val snapshot = terminal.snapshot()
        assertFalse(snapshot.alternateScreen)
        assertTrue(snapshot.cursorVisible)
        assertEquals("", snapshot.title)
        assertEquals(0, snapshot.cursorRow)
        assertEquals(0, snapshot.cursorCol)
        assertEquals(listOf("", "", ""), terminal.lineTexts())
        assertTrue(snapshot.scrollback.isEmpty())

        // Defaults are restored: autowrap on, default colors.
        terminal.feed("abcdefghijklm")
        assertEquals("abcdefghij", terminal.lineText(0))
        assertEquals("klm", terminal.lineText(1))
        assertEquals(TerminalColor.Default, terminal.cell(0, 0).fg)
    }

    @Test
    fun versionIncrementsOnVisibleChanges() {
        val terminal = TerminalEmulator()
        val initial = terminal.version

        terminal.feed("x")
        assertTrue(terminal.version > initial)
        val afterFeed = terminal.version

        terminal.resize(100, 30)
        assertTrue(terminal.version > afterFeed)
        val afterResize = terminal.version

        terminal.clear()
        assertTrue(terminal.version > afterResize)
        val afterClear = terminal.version

        terminal.reset()
        assertTrue(terminal.version > afterClear)

        val beforeSnapshot = terminal.version
        terminal.snapshot()
        assertEquals(beforeSnapshot, terminal.version)
    }

    // ---------------------------------------------------------------- snapshot

    @Test
    fun snapshotIsImmutableAndSelfConsistent() {
        val terminal = emulator(8, 4)
        terminal.feed("hi")
        val snapshot = terminal.snapshot()

        assertEquals(4, snapshot.screen.size)
        for (line in snapshot.screen) {
            assertEquals(8, line.cells.size)
        }
        assertEquals(8, snapshot.screen[0].text.length)
        assertNull(snapshot.selection)
        assertFalse(snapshot.alternateScreen)
        assertTrue(snapshot.cursorVisible)

        @Suppress("UNCHECKED_CAST")
        val screenAsMutable = snapshot.screen as MutableList<TerminalLine>
        assertThrows(UnsupportedOperationException::class.java) {
            screenAsMutable.add(TerminalLine(emptyList()))
        }

        @Suppress("UNCHECKED_CAST")
        val cellsAsMutable = snapshot.screen[0].cells as MutableList<TerminalCell>
        assertThrows(UnsupportedOperationException::class.java) {
            cellsAsMutable.add(TerminalCell())
        }

        // Old snapshots are not affected by later output.
        terminal.feed("more")
        assertEquals("hi", snapshot.screen[0].text.trimEnd())
        assertEquals("himore", terminal.lineText(0))
    }

    @Test
    fun cellTextConventionForSpacesAndWideChars() {
        val terminal = emulator(6, 2)
        terminal.feed("a中")
        val cells = terminal.line(0).cells
        assertEquals("a", cells[0].text)
        assertEquals("中", cells[1].text)
        assertTrue(cells[1].wide)
        assertEquals("", cells[2].text)
        assertFalse(cells[2].wide)
        assertEquals(" ", cells[3].text)
        assertEquals("a中", terminal.line(0).text.trimEnd())
    }

    // ------------------------------------------------------------- misc controls

    @Test
    fun bellAndIgnoreControlCharacters() {
        val terminal = emulator(10, 2)
        terminal.feed("a\u0007b")
        assertEquals("ab", terminal.lineText(0))
        assertEquals(1L, terminal.bellCount)

        // SO / SI are accepted and ignored for ASCII output.
        terminal.feed("\u000e\u000f")
        terminal.feed("c")
        assertEquals("abc", terminal.lineText(0))
    }

    @Test
    fun cursorVisibilityAndBracketedPasteModes() {
        val terminal = emulator(10, 2)
        assertTrue(terminal.snapshot().cursorVisible)
        terminal.feed("\u001b[?25l")
        assertFalse(terminal.snapshot().cursorVisible)
        terminal.feed("\u001b[?25h")
        assertTrue(terminal.snapshot().cursorVisible)

        assertFalse(terminal.bracketedPasteEnabled)
        terminal.feed("\u001b[?2004h")
        assertTrue(terminal.bracketedPasteEnabled)
        terminal.feed("\u001b[?2004l")
        assertFalse(terminal.bracketedPasteEnabled)
    }

    @Test
    fun lineFeedColumnBehaviourWithNewLineMode() {
        val terminal = emulator(10, 3)
        terminal.feed("ab")
        terminal.feed("\n")
        assertEquals(2, terminal.snapshot().cursorCol)

        val lnm = emulator(10, 3)
        lnm.feed("ab")
        lnm.feed("\u001b[20h")
        lnm.feed("\n")
        assertEquals(0, lnm.snapshot().cursorCol)
        assertEquals(1, lnm.snapshot().cursorRow)
    }

    @Test
    fun insertModeShiftsExistingCharacters() {
        val terminal = emulator(10, 2)
        terminal.feed("abc")
        terminal.feed("\u001b[1;1H")
        terminal.feed("\u001b[4h")
        terminal.feed("X")
        assertEquals("Xabc", terminal.lineText(0))
    }

    @Test
    fun repeatCharacterCsi() {
        val terminal = emulator(10, 2)
        terminal.feed("a\u001b[3b")
        assertEquals("aaaa", terminal.lineText(0))
        assertEquals(4, terminal.snapshot().cursorCol)
    }

    @Test
    fun c1AndDelBytesAreIgnored() {
        val terminal = emulator(10, 2)
        terminal.feed("a\u007fb")
        assertEquals("ab", terminal.lineText(0))

        val withC1 = emulator(10, 2)
        withC1.feed("a\u0085b") // C1 NEL encoded as UTF-8
        assertEquals("ab", withC1.lineText(0))
    }

    // -------------------------------------------------------------- thread safety

    @Test
    fun concurrentFeedsAndSnapshotsAreThreadSafe() {
        val terminal = TerminalEmulator(cols = 40, rows = 10, scrollbackLimit = 100)
        val errors = Collections.synchronizedList(ArrayList<Throwable>())
        val threads = (0 until 4).map { index ->
            Thread {
                try {
                    repeat(100) {
                        terminal.feed("line$index\r\n")
                        terminal.snapshot()
                    }
                } catch (t: Throwable) {
                    errors.add(t)
                }
            }
        }
        threads.forEach { it.start() }
        threads.forEach { it.join(15_000) }
        threads.forEach { assertFalse("thread did not finish", it.isAlive) }

        assertTrue("worker threw: $errors", errors.isEmpty())
        val snapshot = terminal.snapshot()
        assertEquals(40, snapshot.cols)
        assertEquals(10, snapshot.rows)
        assertEquals(10, snapshot.screen.size)
        assertEquals(40, snapshot.screen[0].cells.size)
        assertNotNull(snapshot.title)
    }

    // ------------------------------------------------------------ helper methods

    private fun ascii(text: String): ByteArray = text.toByteArray(Charsets.US_ASCII)
}
