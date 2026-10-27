package com.fluentssh.mobile.ui.terminal

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.ssh.TerminalSession
import com.fluentssh.mobile.terminal.TerminalCell
import com.fluentssh.mobile.terminal.TerminalColor
import com.fluentssh.mobile.terminal.TerminalLine
import com.fluentssh.mobile.terminal.TerminalSnapshot
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Compose terminal renderer: per-cell background runs + per-style text runs,
 * monospace metrics, scrollback drag, cursor block. Kept independent from the
 * parser (pure Kotlin) so both sides stay testable.
 */
@Composable
fun TerminalCanvas(
    session: TerminalSession,
    fontSizeSp: Int,
    modifier: Modifier = Modifier,
    showCursor: Boolean = true,
    onTap: () -> Unit,
    onSizeChanged: (cols: Int, rows: Int) -> Unit,
) {
    val colors = LocalFluentColors.current
    val version by session.version.collectAsStateWithLifecycle()
    var snapshot by remember { mutableStateOf(session.snapshot()) }
    LaunchedEffect(version) { snapshot = session.snapshot() }

    val measurer = rememberTextMeasurer()
    val baseStyle = remember(fontSizeSp) {
        TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = fontSizeSp.sp,
            lineHeight = (fontSizeSp * 1.18f).sp,
        )
    }
    val cellWidthPx: Float
    val cellHeightPx: Float
    run {
        val sample = measurer.measure(AnnotatedString("MMMMMMMMMM"), baseStyle)
        cellWidthPx = (sample.size.width / 10f).coerceAtLeast(1f)
        cellHeightPx = ceil(sample.size.height.toFloat()).coerceAtLeast(1f)
    }

    var scrollOffset by remember { mutableFloatStateOf(0f) }

    BoxWithConstraints(
        modifier
            .background(colors.terminalBackground)
            .pointerInput(cellHeightPx) {
                detectVerticalDragGestures { change, dragAmount ->
                    change.consume()
                    val maxOffset = snapshot.scrollback.size.toFloat()
                    scrollOffset = (scrollOffset + dragAmount / cellHeightPx).coerceIn(0f, maxOffset)
                }
            }
            .pointerInput(Unit) {
                detectTapGestures {
                    if (scrollOffset > 0.5f) {
                        scrollOffset = 0f
                    } else {
                        onTap()
                    }
                }
            },
    ) {
        val density = LocalDensity.current
        val widthPx = with(density) { maxWidth.toPx() }
        val heightPx = with(density) { maxHeight.toPx() }
        val cols = floor(widthPx / cellWidthPx).toInt().coerceAtLeast(10)
        val rows = floor(heightPx / cellHeightPx).toInt().coerceAtLeast(4)
        LaunchedEffect(cols, rows) { onSizeChanged(cols, rows) }

        Canvas(Modifier.fillMaxSize()) {
            drawRect(colors.terminalBackground)
            val snap: TerminalSnapshot = snapshot
            val offsetInt = scrollOffset.roundToInt().coerceIn(0, snap.scrollback.size)
            val all: List<TerminalLine> = if (offsetInt > 0) snap.scrollback + snap.screen else snap.screen
            val endExclusive = (all.size - offsetInt).coerceIn(0, all.size)
            val start = (endExclusive - rows).coerceAtLeast(0)
            val visible = all.subList(start, endExclusive)
            val renderRows = minOf(visible.size, rows, snap.screen.size + offsetInt)

            visible.forEachIndexed { rowIndex, line ->
                if (rowIndex >= rows) return@forEachIndexed
                val y = rowIndex * cellHeightPx
                val cells = line.cells
                // background runs
                var c = 0
                while (c < cells.size && c < cols) {
                    val bg = effectiveBg(cells[c], colors.terminalBackground, colors.terminalForeground)
                    var e = c + 1
                    while (e < cells.size && e < cols && effectiveBg(cells[e], colors.terminalBackground, colors.terminalForeground) == bg) e++
                    if (bg != colors.terminalBackground) {
                        drawRect(bg, topLeft = Offset(c * cellWidthPx, y), size = Size((e - c) * cellWidthPx, cellHeightPx))
                    }
                    c = e
                }
                // text runs, grouped by style
                var t = 0
                while (t < cells.size && t < cols) {
                    if (cells[t].text.isEmpty()) {
                        t++
                        continue
                    }
                    val fg = effectiveFg(cells[t], colors.terminalForeground, colors.terminalBackground)
                    val bold = cells[t].bold
                    val italic = cells[t].italic
                    val underline = cells[t].underline
                    val strike = cells[t].strike
                    var e = t
                    val builder = StringBuilder()
                    while (e < cells.size && e < cols) {
                        val cell = cells[e]
                        if (cell.text.isEmpty()) {
                            e++
                            continue
                        }
                        if (effectiveFg(cell, colors.terminalForeground, colors.terminalBackground) != fg ||
                            cell.bold != bold || cell.italic != italic ||
                            cell.underline != underline || cell.strike != strike
                        ) {
                            break
                        }
                        builder.append(cell.text)
                        e++
                    }
                    if (builder.isNotEmpty()) {
                        val style = baseStyle.copy(
                            color = fg,
                            fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
                            fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
                            textDecoration = when {
                                underline && strike -> TextDecoration.combine(listOf(TextDecoration.Underline, TextDecoration.LineThrough))
                                underline -> TextDecoration.Underline
                                strike -> TextDecoration.LineThrough
                                else -> null
                            },
                        )
                        val layout = measurer.measure(AnnotatedString(builder.toString()), style)
                        drawText(layout, topLeft = Offset(t * cellWidthPx, y + (cellHeightPx - layout.size.height) / 2f))
                    }
                    t = e
                }
            }

            // cursor block
            if (showCursor && offsetInt == 0 && snap.cursorVisible && snap.cursorRow < rows) {
                val cx = snap.cursorCol * cellWidthPx
                val cy = snap.cursorRow * cellHeightPx
                drawRect(
                    colors.terminalCursor.copy(alpha = 0.55f),
                    topLeft = Offset(cx, cy),
                    size = Size(cellWidthPx, cellHeightPx),
                )
            }
            if (renderRows == 0) {
                // nothing yet
            }
        }

        if (scrollOffset > 0.5f) {
            Box(
                Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 8.dp)
                    .background(colors.surfaceContainerHigh.copy(alpha = 0.92f), RoundedCornerShape(999.dp))
                    .clickable { scrollOffset = 0f }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(
                    "历史 ${scrollOffset.roundToInt()} 行 · 点按回到底部",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textSecondary,
                )
            }
        }
    }
}

private fun effectiveFg(cell: TerminalCell, defaultFg: Color, defaultBg: Color): Color {
    val fg = resolveColor(cell.fg, defaultFg, cell.bold)
    val bg = resolveColor(cell.bg, defaultBg, false)
    return if (cell.inverse) bg else fg
}

private fun effectiveBg(cell: TerminalCell, defaultBg: Color, defaultFg: Color): Color {
    val fg = resolveColor(cell.fg, defaultFg, cell.bold)
    val bg = resolveColor(cell.bg, defaultBg, false)
    return if (cell.inverse) fg else bg
}

private fun resolveColor(color: TerminalColor, default: Color, bold: Boolean): Color = when (color) {
    TerminalColor.Default -> default
    is TerminalColor.Indexed -> {
        val index = if (bold && color.index in 0..7) color.index + 8 else color.index.coerceIn(0, 255)
        palette[index]
    }
    is TerminalColor.Rgb -> Color(color.r.coerceIn(0, 255), color.g.coerceIn(0, 255), color.b.coerceIn(0, 255))
}

private fun paletteColor(r: Int, g: Int, b: Int): Color = Color(r, g, b)

private val palette: Array<Color> = run {
    val base = intArrayOf(
        0x1B222C, 0xE06C75, 0x98C379, 0xE5C07B, 0x61AFEF, 0xC678DD, 0x56B6C2, 0xABB2BF,
        0x5C6370, 0xE06C75, 0x98C379, 0xE5C07B, 0x61AFEF, 0xC678DD, 0x56B6C2, 0xFFFFFF,
    )
    val colors = ArrayList<Color>(256)
    base.forEach { colors.add(Color(0xFF000000.toInt() or it)) }
    val steps = intArrayOf(0, 95, 135, 175, 215, 255)
    for (r in steps) for (g in steps) for (b in steps) {
        colors.add(paletteColor(r.coerceAtMost(255), g.coerceAtMost(255), b.coerceAtMost(255)))
    }
    for (i in 0 until 24) {
        val v = 8 + i * 10
        colors.add(paletteColor(v, v, v))
    }
    colors.toTypedArray()
}
