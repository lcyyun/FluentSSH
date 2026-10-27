package com.fluentssh.mobile.terminal

import java.io.ByteArrayOutputStream
import java.util.Collections
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * A pure Kotlin/JVM VT100/xterm-subset terminal emulator.
 *
 * All public methods are thread-safe (guarded by a single [ReentrantLock]).
 * Bytes are fed exactly as they arrive from the SSH channel; a small incremental
 * UTF-8 decoder makes multi-byte characters safe across feed boundaries.
 *
 * The emulator is deliberately UI-framework free: it only produces immutable
 * [TerminalSnapshot] values that a Compose/Android view can render.
 */
class TerminalEmulator(
    cols: Int = 80,
    rows: Int = 24,
    val scrollbackLimit: Int = 5000,
) {

    private val lock = ReentrantLock()

    private var _cols: Int = if (cols > 0) cols else 1
    private var _rows: Int = if (rows > 0) rows else 1

    /** Visible terminal width in cells. Assigning triggers [resize]. */
    var cols: Int
        get() = lock.withLock { _cols }
        set(value) {
            resize(value, rows)
        }

    /** Visible terminal height in rows. Assigning triggers [resize]. */
    var rows: Int
        get() = lock.withLock { _rows }
        set(value) {
            resize(cols, value)
        }

    @Volatile
    private var versionCounter: Long = 0L

    /** Monotonically increasing visual change counter; UI polls this to decide redraws. */
    val version: Long
        get() = versionCounter

    private val scrollbackCapacity: Int =
        if (scrollbackLimit <= 0) 0 else minOf(scrollbackLimit, MAX_SCROLLBACK_LINES)

    // ------------------------------------------------------------------ grids

    private var mainGrid: Array<Cell> = newGrid(_cols, _rows)
    private var altGrid: Array<Cell>? = null
    private var grid: Array<Cell> = mainGrid
    private var altActive: Boolean = false

    private var scrollTop: Int = 0
    private var scrollBottom: Int = _rows - 1

    private var tabStops: BooleanArray = defaultTabStops(_cols)

    private var curRow: Int = 0
    private var curCol: Int = 0
    private var wrapPending: Boolean = false

    private val scrollbackLines = ArrayDeque<TerminalLine>()

    private var title: String = ""
    private var cursorVisible: Boolean = true
    private var autoWrap: Boolean = true
    private var originMode: Boolean = false
    private var insertMode: Boolean = false
    private var newLineMode: Boolean = false
    private var bracketedPaste: Boolean = false
    private var cursorKeysApplication: Boolean = false

    private val pen = Pen()
    private val savedPen = Pen()
    private var savedRow: Int = 0
    private var savedCol: Int = 0
    private var savedOriginMode: Boolean = false
    private var savedFontG0Special: Boolean = false
    private var savedFontG1Special: Boolean = false
    private var savedGl: Int = 0

    private var fontG0Special: Boolean = false
    private var fontG1Special: Boolean = false
    private var gl: Int = 0 // 0 => G0, 1 => G1

    private var lastPrintedCodePoint: Int = -1

    // ------------------------------------------------------- parser + responses

    private var parserState: ParserState = ParserState.Ground
    private val csiParams = StringBuilder(32)
    private val csiIntermediates = StringBuilder(4)
    private val oscBuffer = ByteArrayOutputStream(64)
    private var charsetTargetG1: Boolean = false

    private val utf8Buffer = ByteArray(4)
    private var utf8Length: Int = 0
    private var utf8Needed: Int = 0

    private val responses = ArrayDeque<ByteArray>()

    private var cachedSnapshot: TerminalSnapshot? = null
    private var cachedSnapshotVersion: Long = -1L

    @Volatile
    private var bellCountValue: Long = 0L

    /** Number of BEL characters received since construction / last reset. */
    val bellCount: Long
        get() = bellCountValue

    /** True while the remote application enabled bracketed paste mode (`CSI ? 2004 h`). */
    val bracketedPasteEnabled: Boolean
        get() = lock.withLock { bracketedPaste }

    /** True while the remote application enabled application cursor keys (`CSI ? 1 h`). */
    val applicationCursorKeys: Boolean
        get() = lock.withLock { cursorKeysApplication }

    // ==================================================================== input

    /**
     * Feed raw SSH output bytes. Safe to call with arbitrary chunk boundaries:
     * a UTF-8 sequence split across calls is decoded correctly once complete.
     */
    fun feed(bytes: ByteArray, length: Int = bytes.size) {
        val n = if (length < 0) 0 else minOf(length, bytes.size)
        if (n == 0) return
        lock.withLock {
            var i = 0
            while (i < n) {
                processByte(bytes[i].toInt() and 0xFF)
                i++
            }
            versionCounter++
        }
    }

    /** Convenience entry point for tests / pasted text (encoded as UTF-8). */
    fun feed(text: String) {
        if (text.isEmpty()) return
        val bytes = text.toByteArray(Charsets.UTF_8)
        feed(bytes, bytes.size)
    }

    /** Change the terminal window size, preserving existing content where possible. */
    fun resize(cols: Int, rows: Int) {
        lock.withLock {
            resizeInternal(cols, rows)
        }
    }

    /** Clear the visible screen and home the cursor; scrollback is preserved. */
    fun clear() {
        lock.withLock {
            clearGrid()
            curRow = 0
            curCol = 0
            wrapPending = false
            versionCounter++
        }
    }

    /** Complete reset, e.g. after an SSH reconnect: screen, scrollback, modes, title. */
    fun reset() {
        lock.withLock {
            resetInternal()
            versionCounter++
        }
    }

    /** Return (and clear) pending terminal-to-host replies such as DSR/DA answers. */
    fun drainResponses(): List<ByteArray> = lock.withLock {
        if (responses.isEmpty()) {
            emptyList()
        } else {
            val out = ArrayList<ByteArray>(responses.size)
            for (response in responses) out.add(response)
            responses.clear()
            out
        }
    }

    // ================================================================= snapshot

    /** Build a fully immutable snapshot of the current terminal state. */
    fun snapshot(): TerminalSnapshot = lock.withLock {
        val version = versionCounter
        cachedSnapshot?.let { cached ->
            if (cachedSnapshotVersion == version) return cached
        }

        val screenLines = ArrayList<TerminalLine>(_rows)
        for (r in 0 until _rows) {
            val base = r * _cols
            val cells = ArrayList<TerminalCell>(_cols)
            for (c in 0 until _cols) {
                cells.add(toSnapshotCell(grid[base + c]))
            }
            screenLines.add(TerminalLine(Collections.unmodifiableList(cells)))
        }

        val visibleScrollback = minOf(scrollbackLimit, MAX_SCROLLBACK_SNAPSHOT).coerceAtLeast(0)
        val scrollbackCount = minOf(visibleScrollback, scrollbackLines.size)
        val scrollback: List<TerminalLine> = if (scrollbackCount == 0) {
            emptyList()
        } else {
            val skip = scrollbackLines.size - scrollbackCount
            val out = ArrayList<TerminalLine>(scrollbackCount)
            var index = 0
            for (line in scrollbackLines) {
                if (index >= skip) out.add(line)
                index++
            }
            Collections.unmodifiableList(out)
        }

        val snapshot = TerminalSnapshot(
            cols = _cols,
            rows = _rows,
            screen = Collections.unmodifiableList(screenLines),
            scrollback = scrollback,
            cursorCol = curCol,
            cursorRow = curRow,
            cursorVisible = cursorVisible,
            alternateScreen = altActive,
            title = title,
            selection = null,
        )
        cachedSnapshot = snapshot
        cachedSnapshotVersion = version
        snapshot
    }

    // ================================================================ byte parser

    private fun processByte(b: Int) {
        when (parserState) {
            ParserState.Ground -> handleGround(b)
            ParserState.Escape -> handleEscape(b)
            ParserState.CharsetG0, ParserState.CharsetG1 -> handleCharset(b)
            ParserState.Hash, ParserState.Space, ParserState.Percent -> {
                // ESC # / ESC SP / ESC % take exactly one following byte.
                parserState = ParserState.Ground
            }
            ParserState.Csi -> handleCsiByte(b)
            ParserState.Osc -> handleOscByte(b)
            ParserState.OscEsc -> handleOscEscByte(b)
            ParserState.Dcs -> if (b == 0x1B) parserState = ParserState.DcsEsc
            ParserState.DcsEsc -> parserState = if (b == 0x5C) ParserState.Ground else ParserState.Dcs
        }
    }

    private fun handleGround(b: Int) {
        when {
            b == 0x1B -> {
                flushPendingUtf8()
                parserState = ParserState.Escape
            }
            b == 0x7F -> flushPendingUtf8() // DEL: ignore
            b < 0x20 -> {
                flushPendingUtf8()
                handleControl(b)
            }
            b < 0x80 -> {
                flushPendingUtf8()
                printCodePoint(b)
            }
            else -> feedUtf8Byte(b)
        }
    }

    private fun handleControl(code: Int) {
        when (code) {
            0x07 -> bellCountValue++
            0x08 -> {
                curCol = if (curCol > 0) curCol - 1 else 0
                wrapPending = false
            }
            0x09 -> tabForward(1)
            0x0A, 0x0B, 0x0C -> {
                lineFeedInternal()
                wrapPending = false
                if (newLineMode) curCol = 0
            }
            0x0D -> {
                curCol = 0
                wrapPending = false
            }
            0x0E -> gl = 1 // SO: shift out to G1
            0x0F -> gl = 0 // SI: shift in to G0
            else -> Unit
        }
    }

    private fun handleEscape(b: Int) {
        parserState = ParserState.Ground
        when (b) {
            0x5B -> { // '['
                csiParams.setLength(0)
                csiIntermediates.setLength(0)
                parserState = ParserState.Csi
            }
            0x5D -> { // ']'
                oscBuffer.reset()
                parserState = ParserState.Osc
            }
            0x50, 0x58, 0x5E, 0x5F -> parserState = ParserState.Dcs // DCS/SOS/PM/APC
            0x28 -> { // '('
                charsetTargetG1 = false
                parserState = ParserState.CharsetG0
            }
            0x29 -> { // ')'
                charsetTargetG1 = true
                parserState = ParserState.CharsetG1
            }
            0x23 -> parserState = ParserState.Hash // '#'
            0x20 -> parserState = ParserState.Space // ' '
            0x25 -> parserState = ParserState.Percent // '%'
            0x37 -> saveCursorState() // ESC 7
            0x38 -> restoreCursorState() // ESC 8
            0x44 -> { // ESC D: index
                lineFeedInternal()
                wrapPending = false
            }
            0x45 -> { // ESC E: next line
                curCol = 0
                lineFeedInternal()
                wrapPending = false
            }
            0x4D -> reverseIndex() // ESC M
            0x48 -> if (curCol in tabStops.indices) tabStops[curCol] = true // ESC H
            0x63 -> resetInternal() // ESC c: RIS
            0x5C, 0x3D, 0x3E, 0x4E, 0x4F, 0x36, 0x39, 0x46, 0x47, 0x4C, 0x6C -> Unit
            else -> if (b < 0x20) handleControl(b) else Unit
        }
    }

    private fun handleCharset(b: Int) {
        val special = b == 0x30 // '0' => DEC special graphics
        val ascii = b == 0x42 || b == 0x41 // 'B' or 'A'
        if (charsetTargetG1) {
            if (special) fontG1Special = true else if (ascii) fontG1Special = false
        } else {
            if (special) fontG0Special = true else if (ascii) fontG0Special = false
        }
        charsetTargetG1 = false
        parserState = ParserState.Ground
    }

    private fun handleCsiByte(b: Int) {
        when {
            b in 0x30..0x3F -> {
                if (csiParams.length < MAX_CSI_PARAM_CHARS) {
                    csiParams.append(b.toChar())
                } else {
                    csiParams.setLength(0)
                    csiIntermediates.setLength(0)
                    parserState = ParserState.Ground
                }
            }
            b in 0x20..0x2F -> {
                if (csiIntermediates.length < 8) csiIntermediates.append(b.toChar())
            }
            b in 0x40..0x7E -> {
                val finalChar = b.toChar()
                parserState = ParserState.Ground
                dispatchCsi(finalChar)
            }
            b == 0x18 || b == 0x1A -> { // CAN / SUB abort
                csiParams.setLength(0)
                csiIntermediates.setLength(0)
                parserState = ParserState.Ground
            }
            b == 0x1B -> { // a new escape aborts the current CSI
                csiParams.setLength(0)
                csiIntermediates.setLength(0)
                parserState = ParserState.Escape
            }
            b < 0x20 -> handleControl(b)
            else -> Unit // DEL / high bytes inside CSI are ignored
        }
    }

    private fun handleOscByte(b: Int) {
        when {
            b == 0x07 -> {
                dispatchOsc()
                parserState = ParserState.Ground
            }
            b == 0x1B -> parserState = ParserState.OscEsc
            else -> if (oscBuffer.size() < MAX_OSC_BYTES) oscBuffer.write(b)
        }
    }

    private fun handleOscEscByte(b: Int) {
        if (b == 0x5C) {
            dispatchOsc()
        } else {
            oscBuffer.reset() // malformed escape inside OSC: drop the whole string
        }
        parserState = ParserState.Ground
    }

    private fun dispatchOsc() {
        if (oscBuffer.size() == 0) return
        val text = oscBuffer.toByteArray().toString(Charsets.UTF_8)
        val separator = text.indexOf(';')
        if (separator <= 0) return
        val code = text.substring(0, separator).trim().toIntOrNull() ?: return
        when (code) {
            0, 2 -> setTitle(text.substring(separator + 1))
            else -> Unit // icon name / clipboard / hyperlinks / colors ignored
        }
    }

    private fun setTitle(newTitle: String) {
        title = if (newTitle.length > MAX_TITLE_LENGTH) {
            newTitle.substring(0, MAX_TITLE_LENGTH)
        } else {
            newTitle
        }
    }

    // ===================================================================== CSI

    private fun dispatchCsi(finalChar: Char) {
        val intermediates = csiIntermediates.toString()
        val raw = csiParams.toString()
        if (intermediates.isNotEmpty()) {
            // DECSTR (CSI ! p) is the only intermediate sequence worth supporting.
            if (intermediates == "!" && finalChar == 'p') softReset()
            return
        }
        var marker = '\u0000'
        var start = 0
        while (start < raw.length) {
            val ch = raw[start]
            if (ch == '?' || ch == '>' || ch == '<' || ch == '=') {
                marker = ch
                start++
            } else {
                break
            }
        }
        val paramRaw = raw.substring(start)
        val params = parseParams(paramRaw)

        when (finalChar) {
            '@' -> insertChars(count(params))
            'A' -> cursorUp(count(params))
            'B' -> cursorDown(count(params))
            'C' -> cursorForward(count(params))
            'D' -> cursorBackward(count(params))
            'E' -> {
                cursorDown(count(params))
                curCol = 0
                wrapPending = false
            }
            'F' -> {
                cursorUp(count(params))
                curCol = 0
                wrapPending = false
            }
            'G', '`' -> {
                curCol = (position(params) - 1).coerceIn(0, _cols - 1)
                wrapPending = false
            }
            'H', 'f' -> cursorPosition(position(params, 0), position(params, 1))
            'I' -> tabForward(count(params))
            'J' -> eraseInDisplay(defaultOf(params, 0, 0))
            'K' -> eraseInLine(defaultOf(params, 0, 0))
            'L' -> insertLines(count(params))
            'M' -> deleteLines(count(params))
            'P' -> deleteChars(count(params))
            'S' -> scrollUpInRegion(count(params))
            'T' -> scrollDownInRegion(count(params))
            'X' -> eraseChars(count(params))
            'Z' -> tabBackward(count(params))
            'a' -> cursorForward(count(params))
            'b' -> repeat(count(params)) { repeatLastCodePoint() }
            'c' -> {
                if (marker == '>') {
                    queueResponse("\u001b[>0;0;0c")
                } else if (marker == '\u0000') {
                    queueResponse("\u001b[?1;2c")
                }
            }
            'd' -> cursorRowAbsolute(position(params))
            'e' -> cursorDown(count(params))
            'g' -> {
                when (defaultOf(params, 0, 0)) {
                    0 -> {
                        if (curCol in tabStops.indices) tabStops[curCol] = false
                    }
                    3 -> tabStops = BooleanArray(_cols)
                    else -> Unit
                }
            }
            'h' -> setModes(marker, params, true)
            'l' -> setModes(marker, params, false)
            'm' -> if (marker == '\u0000') applySgr(paramRaw)
            'n' -> deviceStatusReport(marker, params)
            'r' -> if (marker == '\u0000') setScrollRegion(params)
            's' -> saveCursorState()
            'u' -> restoreCursorState()
            else -> Unit
        }
    }

    private fun parseParams(raw: String): IntArray {
        if (raw.isEmpty()) return EMPTY_PARAMS
        val parts = raw.split(';')
        return IntArray(parts.size) { index ->
            val segment = parts[index]
            val colon = segment.indexOf(':')
            val head = if (colon >= 0) segment.substring(0, colon) else segment
            head.toIntOrNull() ?: -1
        }
    }

    private fun count(params: IntArray, index: Int = 0): Int {
        val value = params.getOrNull(index) ?: 1
        return when {
            value < 0 -> 1
            value == 0 -> 1
            value > 10000 -> 10000
            else -> value
        }
    }

    private fun position(params: IntArray, index: Int = 0, default: Int = 1): Int {
        val value = params.getOrNull(index) ?: default
        return when {
            value <= 0 -> default
            value > 100000 -> 100000
            else -> value
        }
    }

    private fun defaultOf(params: IntArray, index: Int, default: Int): Int {
        val value = params.getOrNull(index) ?: return default
        return if (value < 0) default else value
    }

    // ------------------------------------------------------------ cursor moves

    private fun cursorPosition(row1: Int, col1: Int) {
        curRow = if (originMode) {
            (scrollTop + row1 - 1).coerceIn(scrollTop, scrollBottom)
        } else {
            (row1 - 1).coerceIn(0, _rows - 1)
        }
        curCol = (col1 - 1).coerceIn(0, _cols - 1)
        wrapPending = false
    }

    private fun cursorRowAbsolute(row1: Int) {
        curRow = if (originMode) {
            (scrollTop + row1 - 1).coerceIn(scrollTop, scrollBottom)
        } else {
            (row1 - 1).coerceIn(0, _rows - 1)
        }
        wrapPending = false
    }

    private fun cursorUp(n: Int) {
        val minimum = if (curRow >= scrollTop) scrollTop else 0
        curRow = maxOf(minimum, curRow - n)
        wrapPending = false
    }

    private fun cursorDown(n: Int) {
        val maximum = if (curRow <= scrollBottom) scrollBottom else _rows - 1
        curRow = minOf(maximum, curRow + n)
        wrapPending = false
    }

    private fun cursorForward(n: Int) {
        curCol = minOf(_cols - 1, curCol + n)
        wrapPending = false
    }

    private fun cursorBackward(n: Int) {
        curCol = maxOf(0, curCol - n)
        wrapPending = false
    }

    private fun tabForward(count: Int) {
        repeat(count) {
            var column = curCol + 1
            while (column < _cols && !tabStops[column]) column++
            curCol = if (column < _cols) column else _cols - 1
        }
        wrapPending = false
    }

    private fun tabBackward(count: Int) {
        repeat(count) {
            var column = curCol - 1
            while (column > 0 && !tabStops[column]) column--
            curCol = if (column >= 0) column else 0
        }
        wrapPending = false
    }

    private fun saveCursorState() {
        savedRow = curRow
        savedCol = curCol
        savedPen.copyFrom(pen)
        savedOriginMode = originMode
        savedFontG0Special = fontG0Special
        savedFontG1Special = fontG1Special
        savedGl = gl
    }

    private fun restoreCursorState() {
        curRow = savedRow.coerceIn(0, _rows - 1)
        curCol = savedCol.coerceIn(0, _cols - 1)
        pen.copyFrom(savedPen)
        originMode = savedOriginMode
        fontG0Special = savedFontG0Special
        fontG1Special = savedFontG1Special
        gl = savedGl
        wrapPending = false
    }

    // ----------------------------------------------------------- line editing

    private fun insertChars(nIn: Int) {
        val n = minOf(nIn, _cols - curCol)
        if (n <= 0) return
        val base = curRow * _cols
        System.arraycopy(grid, base + curCol, grid, base + curCol + n, _cols - curCol - n)
        for (c in curCol until curCol + n) {
            grid[base + c] = Cell()
        }
        wrapPending = false
    }

    private fun deleteChars(nIn: Int) {
        val n = minOf(nIn, _cols - curCol)
        if (n <= 0) return
        val base = curRow * _cols
        System.arraycopy(grid, base + curCol + n, grid, base + curCol, _cols - curCol - n)
        for (c in _cols - n until _cols) {
            grid[base + c] = Cell()
        }
        wrapPending = false
    }

    private fun eraseChars(nIn: Int) {
        val n = minOf(nIn, _cols - curCol)
        if (n <= 0) return
        eraseRange(curRow, curCol, curCol + n - 1)
        wrapPending = false
    }

    private fun insertLines(nIn: Int) {
        if (curRow < scrollTop || curRow > scrollBottom) return
        val n = minOf(nIn, scrollBottom - curRow + 1)
        if (n <= 0) return
        val c = _cols
        for (r in scrollBottom downTo curRow + n) {
            System.arraycopy(grid, (r - n) * c, grid, r * c, c)
        }
        for (r in curRow until curRow + n) {
            val base = r * c
            for (col in 0 until c) grid[base + col] = Cell()
        }
        wrapPending = false
    }

    private fun deleteLines(nIn: Int) {
        if (curRow < scrollTop || curRow > scrollBottom) return
        val n = minOf(nIn, scrollBottom - curRow + 1)
        if (n <= 0) return
        val c = _cols
        for (r in curRow..scrollBottom - n) {
            System.arraycopy(grid, (r + n) * c, grid, r * c, c)
        }
        for (r in scrollBottom - n + 1..scrollBottom) {
            val base = r * c
            for (col in 0 until c) grid[base + col] = Cell()
        }
        wrapPending = false
    }

    private fun eraseInDisplay(mode: Int) {
        when (mode) {
            0 -> {
                eraseRange(curRow, curCol, _cols - 1)
                for (r in curRow + 1 until _rows) clearRow(r)
            }
            1 -> {
                for (r in 0 until curRow) clearRow(r)
                eraseRange(curRow, 0, curCol)
            }
            2 -> for (r in 0 until _rows) clearRow(r)
            3 -> {
                for (r in 0 until _rows) clearRow(r)
                scrollbackLines.clear()
            }
            else -> Unit
        }
        wrapPending = false
    }

    private fun eraseInLine(mode: Int) {
        when (mode) {
            0 -> eraseRange(curRow, curCol, _cols - 1)
            1 -> eraseRange(curRow, 0, curCol)
            2 -> clearRow(curRow)
            else -> Unit
        }
        wrapPending = false
    }

    private fun clearRow(row: Int) {
        val base = row * _cols
        for (c in 0 until _cols) grid[base + c].blank()
    }

    /** Erase an inclusive column range, keeping wide character halves consistent. */
    private fun eraseRange(row: Int, fromIn: Int, toIn: Int) {
        if (fromIn > toIn) return
        var from = fromIn.coerceIn(0, _cols - 1)
        var to = toIn.coerceIn(0, _cols - 1)
        val first = grid[row * _cols + from]
        if (first.placeholder && from > 0) from--
        val last = grid[row * _cols + to]
        if (last.wide && to + 1 < _cols) to++
        for (c in from..to) {
            grid[row * _cols + c].blank()
        }
    }

    // ------------------------------------------------------------- scrolling

    private fun lineFeedInternal() {
        wrapPending = false
        if (curRow == scrollBottom) {
            scrollUpRegion(1, pushToScrollback = !altActive && scrollTop == 0)
        } else if (curRow < _rows - 1) {
            curRow++
        }
    }

    private fun reverseIndex() {
        wrapPending = false
        if (curRow == scrollTop) {
            scrollDownRegion(1)
        } else if (curRow > 0) {
            curRow--
        }
    }

    private fun scrollUpInRegion(n: Int) {
        scrollUpRegion(n, pushToScrollback = false)
        wrapPending = false
    }

    private fun scrollDownInRegion(n: Int) {
        scrollDownRegion(n)
        wrapPending = false
    }

    private fun scrollUpRegion(nIn: Int, pushToScrollback: Boolean) {
        val top = scrollTop
        val bottom = scrollBottom
        if (top < 0 || bottom >= _rows || top > bottom) return
        val n = nIn.coerceIn(1, bottom - top + 1)
        val c = _cols
        repeat(n) {
            if (pushToScrollback) pushScrollbackRow(top)
            for (r in top until bottom) {
                System.arraycopy(grid, (r + 1) * c, grid, r * c, c)
            }
            val base = bottom * c
            for (col in 0 until c) grid[base + col] = Cell()
        }
    }

    private fun scrollDownRegion(nIn: Int) {
        val top = scrollTop
        val bottom = scrollBottom
        if (top < 0 || bottom >= _rows || top > bottom) return
        val n = nIn.coerceIn(1, bottom - top + 1)
        val c = _cols
        repeat(n) {
            for (r in bottom downTo top + 1) {
                System.arraycopy(grid, (r - 1) * c, grid, r * c, c)
            }
            val base = top * c
            for (col in 0 until c) grid[base + col] = Cell()
        }
    }

    private fun pushScrollbackRow(row: Int) {
        if (scrollbackCapacity <= 0) return
        val base = row * _cols
        val cells = ArrayList<TerminalCell>(_cols)
        for (c in 0 until _cols) {
            cells.add(toSnapshotCell(grid[base + c]))
        }
        scrollbackLines.addLast(TerminalLine(Collections.unmodifiableList(cells)))
        while (scrollbackLines.size > scrollbackCapacity) {
            scrollbackLines.removeFirst()
        }
    }

    private fun setScrollRegion(params: IntArray) {
        val top = position(params, 0, 1)
        val bottom = position(params, 1, _rows)
        if (top >= 1 && bottom <= _rows && top < bottom) {
            scrollTop = top - 1
            scrollBottom = bottom - 1
        } else {
            scrollTop = 0
            scrollBottom = _rows - 1
        }
        curRow = scrollTop
        curCol = 0
        wrapPending = false
    }

    // ------------------------------------------------------------------- modes

    private fun setModes(marker: Char, params: IntArray, enabled: Boolean) {
        if (params.isEmpty()) return
        for (param in params) {
            if (param < 0) continue
            if (marker == '?') {
                setPrivateMode(param, enabled)
            } else {
                setAnsiMode(param, enabled)
            }
        }
    }

    private fun setPrivateMode(mode: Int, enabled: Boolean) {
        when (mode) {
            1 -> cursorKeysApplication = enabled
            6 -> {
                originMode = enabled
                curRow = if (enabled) scrollTop else 0
                curCol = 0
                wrapPending = false
            }
            7 -> autoWrap = enabled
            25 -> cursorVisible = enabled
            47 -> switchAlternateScreen(enabled, 47)
            1047 -> switchAlternateScreen(enabled, 1047)
            1048 -> if (enabled) saveCursorState() else restoreCursorState()
            1049 -> switchAlternateScreen(enabled, 1049)
            2004 -> bracketedPaste = enabled
            else -> Unit
        }
    }

    private fun setAnsiMode(mode: Int, enabled: Boolean) {
        when (mode) {
            4 -> insertMode = enabled
            20 -> newLineMode = enabled
            else -> Unit
        }
    }

    private fun switchAlternateScreen(enabled: Boolean, mode: Int) {
        if (enabled) {
            if (altActive) return
            val buffer = altGrid ?: newGrid(_cols, _rows).also { altGrid = it }
            for (cell in buffer) cell.blank()
            if (mode == 1049) saveCursorState()
            altActive = true
            grid = buffer
            if (mode == 1049) {
                curRow = 0
                curCol = 0
                wrapPending = false
            }
        } else {
            if (!altActive) return
            altActive = false
            grid = mainGrid
            if (mode == 1049) restoreCursorState()
        }
    }

    private fun softReset() {
        pen.reset()
        savedPen.reset()
        originMode = false
        autoWrap = true
        insertMode = false
        newLineMode = false
        cursorVisible = true
        gl = 0
        fontG0Special = false
        fontG1Special = false
        scrollTop = 0
        scrollBottom = _rows - 1
        wrapPending = false
    }

    private fun resetInternal() {
        altActive = false
        altGrid = null
        grid = mainGrid
        clearGrid()
        scrollbackLines.clear()
        curRow = 0
        curCol = 0
        wrapPending = false
        cursorVisible = true
        autoWrap = true
        originMode = false
        insertMode = false
        newLineMode = false
        bracketedPaste = false
        cursorKeysApplication = false
        pen.reset()
        savedPen.reset()
        savedRow = 0
        savedCol = 0
        savedOriginMode = false
        savedFontG0Special = false
        savedFontG1Special = false
        savedGl = 0
        fontG0Special = false
        fontG1Special = false
        gl = 0
        title = ""
        bellCountValue = 0L
        lastPrintedCodePoint = -1
        scrollTop = 0
        scrollBottom = _rows - 1
        tabStops = defaultTabStops(_cols)
        responses.clear()
        parserState = ParserState.Ground
        csiParams.setLength(0)
        csiIntermediates.setLength(0)
        oscBuffer.reset()
        resetUtf8()
    }

    // --------------------------------------------------------------------- SGR

    private fun applySgr(raw: String) {
        if (raw.isEmpty()) {
            pen.reset()
            return
        }
        val segments = raw.split(';')
        var i = 0
        while (i < segments.size) {
            val segment = segments[i]
            val subParams = segment.split(':')
            val code = subParams[0].toIntOrNull() ?: 0
            when {
                code == 38 || code == 48 -> {
                    val foreground = code == 38
                    if (subParams.size > 1) {
                        // Colon separated form: 38:5:n or 38:2[:colorspace]:r:g:b
                        when (subParams[1].toIntOrNull() ?: -1) {
                            5 -> {
                                val index = subParams.getOrNull(2)?.toIntOrNull() ?: 0
                                applyExtendedColor(foreground, TerminalColor.Indexed(index.coerceIn(0, 255)))
                            }
                            2 -> {
                                val (r, g, b) = if (subParams.size >= 6) {
                                    Triple(
                                        subParams[3].toIntOrNull() ?: 0,
                                        subParams[4].toIntOrNull() ?: 0,
                                        subParams[5].toIntOrNull() ?: 0,
                                    )
                                } else if (subParams.size >= 5) {
                                    Triple(
                                        subParams[2].toIntOrNull() ?: 0,
                                        subParams[3].toIntOrNull() ?: 0,
                                        subParams[4].toIntOrNull() ?: 0,
                                    )
                                } else {
                                    Triple(0, 0, 0)
                                }
                                applyExtendedColor(foreground, rgbColor(r, g, b))
                            }
                            else -> Unit
                        }
                    } else {
                        // Semicolon separated form: 38;5;n / 38;2;r;g;b
                        val mode = segments.getOrNull(i + 1)?.toIntOrNull() ?: -1
                        when (mode) {
                            5 -> {
                                val index = segments.getOrNull(i + 2)?.toIntOrNull() ?: 0
                                applyExtendedColor(foreground, TerminalColor.Indexed(index.coerceIn(0, 255)))
                                i += 2
                            }
                            2 -> {
                                val r = segments.getOrNull(i + 2)?.toIntOrNull() ?: 0
                                val g = segments.getOrNull(i + 3)?.toIntOrNull() ?: 0
                                val b = segments.getOrNull(i + 4)?.toIntOrNull() ?: 0
                                applyExtendedColor(foreground, rgbColor(r, g, b))
                                i += 4
                            }
                            else -> i += 1
                        }
                    }
                }
                else -> applySimpleSgr(code)
            }
            i++
        }
    }

    private fun rgbColor(r: Int, g: Int, b: Int): TerminalColor =
        TerminalColor.Rgb(r.coerceIn(0, 255), g.coerceIn(0, 255), b.coerceIn(0, 255))

    private fun applyExtendedColor(foreground: Boolean, color: TerminalColor) {
        if (foreground) pen.fg = color else pen.bg = color
    }

    private fun applySimpleSgr(code: Int) {
        when (code) {
            0 -> pen.reset()
            1 -> pen.bold = true
            2 -> pen.bold = true // dim is folded into bold (allowed by the spec)
            3 -> pen.italic = true
            4, 21 -> pen.underline = true
            7 -> pen.inverse = true
            9 -> pen.strike = true
            22 -> pen.bold = false
            23 -> pen.italic = false
            24 -> pen.underline = false
            27 -> pen.inverse = false
            29 -> pen.strike = false
            in 30..37 -> pen.fg = TerminalColor.Indexed(code - 30)
            39 -> pen.fg = TerminalColor.Default
            in 40..47 -> pen.bg = TerminalColor.Indexed(code - 40)
            49 -> pen.bg = TerminalColor.Default
            in 90..97 -> pen.fg = TerminalColor.Indexed(code - 90 + 8)
            in 100..107 -> pen.bg = TerminalColor.Indexed(code - 100 + 8)
            else -> Unit
        }
    }

    // -------------------------------------------------------------- DSR / DA

    private fun deviceStatusReport(marker: Char, params: IntArray) {
        when (defaultOf(params, 0, 0)) {
            5 -> queueResponse("\u001b[0n")
            6 -> {
                val row = if (originMode) curRow - scrollTop + 1 else curRow + 1
                val col = curCol + 1
                if (marker == '?') {
                    queueResponse("\u001b[?$row;${col}R")
                } else {
                    queueResponse("\u001b[$row;${col}R")
                }
            }
            else -> Unit
        }
    }

    private fun queueResponse(response: String) {
        if (responses.size >= MAX_RESPONSES) responses.removeFirst()
        responses.addLast(response.toByteArray(Charsets.US_ASCII))
    }

    // ================================================================ printing

    private fun printCodePoint(input: Int) {
        var codepoint = input
        if (isSpecialGraphicsActive()) codepoint = mapDecSpecial(codepoint)
        val width0 = codePointWidth(codepoint)
        if (width0 == 0) {
            appendCombiningCodePoint(codepoint)
            return
        }
        lastPrintedCodePoint = codepoint
        var width = width0
        if (width == 2 && _cols < 2) width = 1

        if (wrapPending) {
            wrapPending = false
            if (autoWrap) {
                curCol = 0
                lineFeedInternal()
            }
        }
        if (width == 2 && curCol >= _cols - 1) {
            if (autoWrap) {
                curCol = 0
                lineFeedInternal()
            } else {
                curCol = _cols - 2
            }
        }
        if (insertMode) insertChars(width)
        placeGraphic(codepoint, width)
        val next = curCol + width
        if (next >= _cols) {
            if (autoWrap) wrapPending = true
            curCol = _cols - 1
        } else {
            curCol = next
        }
    }

    private fun placeGraphic(codepoint: Int, width: Int) {
        clearSplitAt(curRow, curCol)
        if (width == 2) clearSplitAt(curRow, curCol + 1)
        val first = cellAt(curRow, curCol)
        copyPenTo(first)
        first.text = codePointToString(codepoint)
        first.wide = width == 2
        first.placeholder = false
        if (width == 2) {
            val second = cellAt(curRow, curCol + 1)
            copyPenTo(second)
            second.text = ""
            second.wide = false
            second.placeholder = true
        }
    }

    private fun clearSplitAt(row: Int, col: Int) {
        if (col < 0 || col >= _cols) return
        val cell = grid[row * _cols + col]
        if (cell.placeholder) {
            if (col > 0) grid[row * _cols + col - 1].blank()
        } else if (cell.wide && col + 1 < _cols) {
            grid[row * _cols + col + 1].blank()
        }
    }

    private fun appendCombiningCodePoint(codepoint: Int) {
        var column = if (wrapPending) _cols - 1 else curCol - 1
        if (column < 0) return
        if (column >= _cols) column = _cols - 1
        var cell = grid[curRow * _cols + column]
        if (cell.placeholder && column > 0) {
            column--
            cell = grid[curRow * _cols + column]
        }
        if (cell.placeholder) return
        cell.text += codePointToString(codepoint)
    }

    private fun repeatLastCodePoint() {
        if (lastPrintedCodePoint >= 0) printCodePoint(lastPrintedCodePoint)
    }

    private fun codePointToString(codepoint: Int): String =
        if (codepoint in 0..0xFFFF) codepoint.toChar().toString() else String(Character.toChars(codepoint))

    private fun copyPenTo(cell: Cell) {
        cell.fg = pen.fg
        cell.bg = pen.bg
        cell.bold = pen.bold
        cell.italic = pen.italic
        cell.underline = pen.underline
        cell.strike = pen.strike
        cell.inverse = pen.inverse
    }

    private fun cellAt(row: Int, col: Int): Cell = grid[row * _cols + col]

    private fun isSpecialGraphicsActive(): Boolean = if (gl == 0) fontG0Special else fontG1Special

    // ================================================================= UTF-8

    private fun feedUtf8Byte(b: Int) {
        if (utf8Needed == 0) {
            when {
                b < 0x80 -> printCodePoint(b)
                b in 0xC2..0xDF -> {
                    utf8Buffer[0] = b.toByte()
                    utf8Length = 1
                    utf8Needed = 2
                }
                b in 0xE0..0xEF -> {
                    utf8Buffer[0] = b.toByte()
                    utf8Length = 1
                    utf8Needed = 3
                }
                b in 0xF0..0xF4 -> {
                    utf8Buffer[0] = b.toByte()
                    utf8Length = 1
                    utf8Needed = 4
                }
                else -> printCodePoint(0xFFFD) // invalid lead byte
            }
        } else {
            if ((b and 0xC0) != 0x80) {
                // Truncated sequence: emit a replacement and retry this byte as a lead byte.
                resetUtf8()
                printCodePoint(0xFFFD)
                feedUtf8Byte(b)
                return
            }
            utf8Buffer[utf8Length] = b.toByte()
            utf8Length++
            if (utf8Length == utf8Needed) {
                val codepoint = decodeUtf8Sequence()
                resetUtf8()
                when {
                    codepoint < 0 -> printCodePoint(0xFFFD)
                    codepoint < 0x20 || codepoint in 0x80..0x9F -> handleControl(codepoint)
                    else -> printCodePoint(codepoint)
                }
            }
        }
    }

    private fun decodeUtf8Sequence(): Int {
        val b0 = utf8Buffer[0].toInt() and 0xFF
        return when (utf8Needed) {
            2 -> ((b0 and 0x1F) shl 6) or (utf8Buffer[1].toInt() and 0x3F)
            3 -> {
                val codepoint = ((b0 and 0x0F) shl 12) or
                    ((utf8Buffer[1].toInt() and 0x3F) shl 6) or
                    (utf8Buffer[2].toInt() and 0x3F)
                if (codepoint < 0x800 || codepoint in 0xD800..0xDFFF) -1 else codepoint
            }
            4 -> {
                val codepoint = ((b0 and 0x07) shl 18) or
                    ((utf8Buffer[1].toInt() and 0x3F) shl 12) or
                    ((utf8Buffer[2].toInt() and 0x3F) shl 6) or
                    (utf8Buffer[3].toInt() and 0x3F)
                if (codepoint < 0x10000 || codepoint > 0x10FFFF) -1 else codepoint
            }
            else -> -1
        }
    }

    private fun resetUtf8() {
        utf8Length = 0
        utf8Needed = 0
    }

    private fun flushPendingUtf8() {
        if (utf8Needed > 0) {
            resetUtf8()
            printCodePoint(0xFFFD)
        }
    }

    // ============================================================== cell helpers

    private fun newGrid(columns: Int, lines: Int): Array<Cell> = Array(columns * lines) { Cell() }

    private fun defaultTabStops(columns: Int): BooleanArray {
        val stops = BooleanArray(columns)
        var i = 0
        while (i < columns) {
            stops[i] = true
            i += 8
        }
        return stops
    }

    private fun clearGrid() {
        for (cell in grid) cell.blank()
    }

    private fun resizeInternal(newCols: Int, newRows: Int) {
        val targetCols = if (newCols > 0) newCols else 1
        val targetRows = if (newRows > 0) newRows else 1
        if (targetCols == _cols && targetRows == _rows) return

        val oldCols = _cols
        val oldRows = _rows
        mainGrid = resizeGrid(mainGrid, oldCols, oldRows, targetCols, targetRows)
        altGrid = altGrid?.let { resizeGrid(it, oldCols, oldRows, targetCols, targetRows) }
        _cols = targetCols
        _rows = targetRows
        grid = if (altActive) (altGrid ?: mainGrid) else mainGrid
        scrollTop = 0
        scrollBottom = _rows - 1
        curRow = curRow.coerceIn(0, _rows - 1)
        curCol = curCol.coerceIn(0, _cols - 1)
        wrapPending = false
        tabStops = defaultTabStops(_cols)
        versionCounter++
    }

    private fun resizeGrid(
        old: Array<Cell>,
        oldCols: Int,
        oldRows: Int,
        newCols: Int,
        newRows: Int,
    ): Array<Cell> {
        val resized = newGrid(newCols, newRows)
        if (oldCols <= 0 || oldRows <= 0) return resized
        val copyRows = minOf(oldRows, newRows)
        val copyCols = minOf(oldCols, newCols)
        for (r in 0 until copyRows) {
            System.arraycopy(old, r * oldCols, resized, r * newCols, copyCols)
        }
        return resized
    }

    private fun toSnapshotCell(cell: Cell): TerminalCell {
        if (cell.placeholder) {
            return TerminalCell(
                text = "",
                fg = cell.fg,
                bg = cell.bg,
                bold = cell.bold,
                italic = cell.italic,
                underline = cell.underline,
                strike = cell.strike,
                inverse = cell.inverse,
                wide = false,
            )
        }
        return TerminalCell(
            text = cell.text,
            fg = cell.fg,
            bg = cell.bg,
            bold = cell.bold,
            italic = cell.italic,
            underline = cell.underline,
            strike = cell.strike,
            inverse = cell.inverse,
            wide = cell.wide,
        )
    }

    // ========================================================= character widths

    private fun codePointWidth(codepoint: Int): Int = when {
        codepoint == 0 -> 0
        codepoint < 0x20 -> 0
        codepoint in 0x7F..0x9F -> 0
        isZeroWidth(codepoint) -> 0
        isWideCodePoint(codepoint) -> 2
        else -> 1
    }

    private fun isZeroWidth(codepoint: Int): Boolean = when (codepoint) {
        in 0x0300..0x036F -> true
        in 0x0483..0x0489 -> true
        in 0x0591..0x05BD -> true
        0x05BF -> true
        in 0x05C1..0x05C2 -> true
        in 0x05C4..0x05C5 -> true
        0x05C7 -> true
        in 0x0610..0x061A -> true
        in 0x064B..0x065F -> true
        0x0670 -> true
        in 0x06D6..0x06DC -> true
        in 0x06DF..0x06E4 -> true
        in 0x06E7..0x06E8 -> true
        in 0x06EA..0x06ED -> true
        0x0711 -> true
        in 0x0730..0x074A -> true
        in 0x07A6..0x07B0 -> true
        in 0x07EB..0x07F3 -> true
        in 0x0816..0x082D -> true
        in 0x0859..0x085B -> true
        in 0x08D3..0x0903 -> true
        0x093A -> true
        0x093C -> true
        in 0x0941..0x0948 -> true
        0x094D -> true
        in 0x0951..0x0957 -> true
        in 0x0962..0x0963 -> true
        in 0x0E31..0x0E31 -> true
        in 0x0E34..0x0E3A -> true
        in 0x0E47..0x0E4E -> true
        0x0F18, 0x0F19 -> true
        0x0F35 -> true
        0x0F37 -> true
        0x0F39 -> true
        in 0x0F71..0x0F7E -> true
        in 0x0F80..0x0F84 -> true
        in 0x1AB0..0x1AFF -> true
        in 0x1DC0..0x1DFF -> true
        0x200B, 0x200C, 0x200D, 0x200E, 0x200F -> true
        in 0x202A..0x202E -> true
        in 0x2060..0x2064 -> true
        in 0x20D0..0x20FF -> true
        in 0xFE00..0xFE0F -> true
        in 0xFE20..0xFE2F -> true
        0xFEFF -> true
        in 0xE0100..0xE01EF -> true
        else -> false
    }

    private fun isWideCodePoint(codepoint: Int): Boolean = when (codepoint) {
        in 0x1100..0x115F -> true
        in 0x2E80..0x303E -> true
        in 0x3041..0x33FF -> true
        in 0x3400..0x4DBF -> true
        in 0x4E00..0x9FFF -> true
        in 0xA000..0xA4CF -> true
        in 0xA960..0xA97F -> true
        in 0xAC00..0xD7A3 -> true
        in 0xF900..0xFAFF -> true
        in 0xFE10..0xFE19 -> true
        in 0xFE30..0xFE6F -> true
        in 0xFF00..0xFF60 -> true
        in 0xFFE0..0xFFE6 -> true
        in 0x16FE0..0x16FFF -> true
        in 0x17000..0x187FF -> true
        in 0x18800..0x18AFF -> true
        in 0x1B000..0x1B16F -> true
        in 0x1F000..0x1F02F -> true
        in 0x1F0A0..0x1F0FF -> true
        in 0x1F200..0x1F2FF -> true
        in 0x1F300..0x1F64F -> true
        in 0x1F680..0x1F6FF -> true
        in 0x1F700..0x1F77F -> true
        in 0x1F780..0x1F7FF -> true
        in 0x1F800..0x1F8FF -> true
        in 0x1F900..0x1F9FF -> true
        in 0x1FA70..0x1FAFF -> true
        in 0x20000..0x2FFFD -> true
        in 0x30000..0x3FFFD -> true
        else -> false
    }

    private fun mapDecSpecial(codepoint: Int): Int = when (codepoint) {
        0x5F -> 0x20
        0x60 -> 0x25C6 // ◆
        0x61 -> 0x2592 // ▒
        0x62 -> 0x2409 // ␉
        0x63 -> 0x240C // ␌
        0x64 -> 0x240D // ␍
        0x65 -> 0x240A // ␊
        0x66 -> 0x00B0 // °
        0x67 -> 0x00B1 // ±
        0x68 -> 0x2424 // ␤
        0x69 -> 0x240B // ␋
        0x6A -> 0x2518 // ┘
        0x6B -> 0x2510 // ┐
        0x6C -> 0x250C // ┌
        0x6D -> 0x2514 // └
        0x6E -> 0x253C // ┼
        0x6F -> 0x23BA // ⎺
        0x70 -> 0x23BB // ⎻
        0x71 -> 0x2500 // ─
        0x72 -> 0x23BC // ⎼
        0x73 -> 0x23BD // ⎽
        0x74 -> 0x251C // ├
        0x75 -> 0x2524 // ┤
        0x76 -> 0x2534 // ┴
        0x77 -> 0x252C // ┬
        0x78 -> 0x2502 // │
        0x79 -> 0x2264 // ≤
        0x7A -> 0x2265 // ≥
        0x7B -> 0x03C0 // π
        0x7C -> 0x2260 // ≠
        0x7D -> 0x00A3 // £
        0x7E -> 0x00B7 // ·
        else -> codepoint
    }

    // ========================================================== internal classes

    private enum class ParserState {
        Ground,
        Escape,
        CharsetG0,
        CharsetG1,
        Hash,
        Space,
        Percent,
        Csi,
        Osc,
        OscEsc,
        Dcs,
        DcsEsc,
    }

    private class Cell {
        var text: String = " "
        var fg: TerminalColor = TerminalColor.Default
        var bg: TerminalColor = TerminalColor.Default
        var bold: Boolean = false
        var italic: Boolean = false
        var underline: Boolean = false
        var strike: Boolean = false
        var inverse: Boolean = false
        var wide: Boolean = false
        var placeholder: Boolean = false

        fun blank() {
            text = " "
            fg = TerminalColor.Default
            bg = TerminalColor.Default
            bold = false
            italic = false
            underline = false
            strike = false
            inverse = false
            wide = false
            placeholder = false
        }
    }

    private class Pen {
        var fg: TerminalColor = TerminalColor.Default
        var bg: TerminalColor = TerminalColor.Default
        var bold: Boolean = false
        var italic: Boolean = false
        var underline: Boolean = false
        var strike: Boolean = false
        var inverse: Boolean = false

        fun reset() {
            fg = TerminalColor.Default
            bg = TerminalColor.Default
            bold = false
            italic = false
            underline = false
            strike = false
            inverse = false
        }

        fun copyFrom(other: Pen) {
            fg = other.fg
            bg = other.bg
            bold = other.bold
            italic = other.italic
            underline = other.underline
            strike = other.strike
            inverse = other.inverse
        }
    }

    private companion object {
        private const val MAX_SCROLLBACK_LINES = 5000
        private const val MAX_SCROLLBACK_SNAPSHOT = 2000
        private const val MAX_TITLE_LENGTH = 200
        private const val MAX_RESPONSES = 256
        private const val MAX_CSI_PARAM_CHARS = 256
        private const val MAX_OSC_BYTES = 4096
        private val EMPTY_PARAMS = IntArray(0)
    }
}
