import type {Edit, Selection, Settings} from './Core'

interface Row { prefix: string, text: string }
interface Table { start: number, end: number, rows: Row[], right: number, columns: number[] }
export interface AtaulaResult { edit: Edit, message?: string }

const vertical = /[│|├┤┼+]/
const junction = /[┌┬┐├┼┤└┴┘|+]/
const horizontal = /^[─\-=_]+$/

/** Same column accounting as Rewrap, including tab stops and wide characters. */
function width(text: string, tabSize: number): number {
    let column = 0
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        if (code === 9) column += tabSize - column % tabSize
        else if (code === 0 || code >= 32) {
            if (code >= 0x2e80 && code <= 0xd7af || code >= 0xf900 && code <= 0xfaff || code >= 0xff01 && code <= 0xff5e) column += 2
            else column++
        }
    }
    return column
}

function row(text: string): Row | undefined {
    const match = text.match(/^([ \t]*(?:(?:>|\/{2,}|\/\*+|\*|#|--)[ \t]*)*)([┌├└│|+].*?[┐┤┘│|+])[ \t]*$/)
    if (match) return {prefix: match[1], text: match[2]}
}

function border(text: string): boolean {
    return /^[┌├└|+][─\-=_┌┬┐├┼┤└┴┘|+]+[┐┤┘|+]$/.test(text)
}

/** Recognize complete boxes, rather than treating ordinary Markdown pipes as tables. */
function tables(lines: readonly string[]): Table[] {
    const found: Table[] = []
    for (let start = 0; start < lines.length; start++) {
        const first = row(lines[start])
        if (!first || !border(first.text)) continue
        const rows = [first]
        let end = start + 1
        for (; end < lines.length; end++) {
            const next = row(lines[end])
            if (!next || next.text.length !== first.text.length) break
            rows.push(next)
            if (next.text.startsWith('└') && border(next.text)) { end++; break }
        }
        // ASCII tables can have adjacent rows separated by complete borders.
        while (rows.length > 1 && !border(rows[rows.length - 1].text)) { rows.pop(); end-- }
        if (rows.length < 3) continue
        const columns = new Set<number>([0])
        for (const item of rows) {
            if (!border(item.text)) continue
            for (let i = 0; i < item.text.length - 1; i++) if (junction.test(item.text[i])) columns.add(i)
        }
        found.push({start, end: end - 1, rows, right: first.text.length - 1, columns: [...columns].sort((a, b) => a - b)})
        start = end - 1
    }
    return found
}

function cellLeft(table: Table, text: string): number {
    for (let i = table.columns.length - 1; i >= 0; i--) {
        const column = table.columns[i]
        if (vertical.test(text[column]) || junction.test(text[column])) return column
    }
    return 0
}

/** Reflow paragraphs; keep nested boxes opaque and preserve blank paragraphs. */
function wrap(lines: string[], available: number, tabSize: number, doubleSpace: boolean): string[] | undefined {
    const output: string[] = []
    let paragraph: string[] = []
    function flush() {
        let current = ''
        const words = paragraph.join(' ').split(/\s+/).filter(Boolean)
        for (const word of words) {
            const gap = doubleSpace && /[.!?]$/.test(current) ? '  ' : ' '
            if (current && width(current + gap + word, tabSize) > available) { output.push(current); current = '' }
            // A long identifier must not push the right border past the ruler.
            let part = ''
            for (const char of word) {
                if (width(part + char, tabSize) > available) {
                    if (!part) throw new Error('A coluna final não tem espaço para este caractere.')
                    output.push(part); part = ''
                }
                part += char
            }
            if (current) current += gap + part
            else current = part
        }
        if (current) output.push(current)
        paragraph = []
    }
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trimEnd()
        if (/[┌┬┐└┴┘]/.test(line)) {
            flush()
            // Nested table rows must remain intact, including their padding.
            let depth = 0
            do {
                const nested = lines[i].trimEnd()
                if (width(nested, tabSize) > available) return undefined
                output.push(nested)
                depth += (nested.match(/┌/g) || []).length - (nested.match(/└/g) || []).length
                if (depth <= 0) break
                i++
            } while (i < lines.length)
        }
        else if (!line.trim()) { flush(); output.push('') }
        else paragraph.push(line.trim())
    }
    flush()
    return output.length ? output : ['']
}

function render(table: Table, settings: Settings): string[] | undefined {
    const size = Math.max(1, settings.tabWidth)
    const oldWidth = Math.max(...table.rows.map(item => width(item.prefix + item.text, size)))
    const limit = settings.column > 0 ? Math.min(settings.column, oldWidth) : oldWidth
    const output: string[] = []
    let index = 0
    while (index < table.rows.length) {
        const item = table.rows[index]
        const left = cellLeft(table, item.text)
        const before = item.prefix + item.text.slice(0, left + 1)
        const available = limit - width(before, size) - 3
        if (available < 1) return undefined
        const inner = item.text.slice(left + 1, table.right)
        if (horizontal.test(inner)) {
            output.push(before + inner[0].repeat(available + 2) + item.text[table.right])
            index++
            continue
        }
        const group: Row[] = []
        while (index < table.rows.length) {
            const next = table.rows[index]
            if (cellLeft(table, next.text) !== left || horizontal.test(next.text.slice(left + 1, table.right))) break
            group.push(next); index++
        }
        const capacity = Math.min(...group.map(part => limit - width(part.prefix + part.text.slice(0, left + 1), size) - 3))
        if (capacity < 1) return undefined
        const content = group.map(part => part.text.slice(left + 1, table.right).replace(/^ /, '').trimEnd())
        // Padding used to align other columns is not an extra paragraph.
        while (content.length > 1 && !content[content.length - 1].trim()) content.pop()
        const wrapped = wrap(content, capacity, size, settings.doubleSentenceSpacing)
        if (!wrapped) return undefined
        let keep = 1
        for (let i = 0; i < group.length; i++) {
            const previous = group[i].text.slice(0, left)
            if (previous.replace(/[│|├┤┼┬┴─\-=_+ ]/g, '').trim() || /[├┤┼┬┴─\-=_]/.test(previous)) keep = i + 1
        }
        const last = group[group.length - 1]
        const scaffold = Array(left + 1).fill(' ')
        for (const column of table.columns) {
            if (column <= left && vertical.test(last.text[column])) scaffold[column] = last.text[column] === '|' || last.text[column] === '+' ? '|' : '│'
        }
        for (let i = 0; i < Math.max(keep, wrapped.length); i++) {
            let prefix = last.prefix + scaffold.join('')
            if (i < group.length) prefix = group[i].prefix + group[i].text.slice(0, left + 1)
            const text = wrapped[i] || ''
            const padding = limit - width(prefix + ' ' + text, size) - 2
            output.push(prefix + ' ' + text + ' '.repeat(Math.max(0, padding)) + ' ' + last.text[table.right])
        }
    }
    return output
}

/** A recognized Ataula box is always handled here, even when it cannot fit. */
export function rewrapAtaula(lines: readonly string[], settings: Settings, selections: readonly Selection[]): AtaulaResult | undefined {
    const targets = tables(lines).filter(table => selections.some(selection =>
        selection.active.line >= table.start && selection.active.line <= table.end &&
        selection.anchor.line >= table.start && selection.anchor.line <= table.end))
    if (!targets.length) return undefined
    const empty: Edit = {startLine: 0, endLine: -1, lines: [], selections, isEmpty: true}
    const replacements: string[][] = []
    for (const table of targets) {
        const formatted = render(table, settings)
        if (!formatted) return {edit: empty, message: 'A última coluna não cabe neste limite sem alterar as colunas anteriores ou uma tabela interna. Aumente o limite ou reduza essas colunas manualmente.'}
        replacements.push(formatted)
    }
    const startLine = targets[0].start
    const endLine = targets[targets.length - 1].end
    const result = lines.slice(startLine, endLine + 1)
    for (let i = targets.length - 1; i >= 0; i--) result.splice(targets[i].start - startLine, targets[i].end - targets[i].start + 1, ...replacements[i])
    const unchanged = result.length === endLine - startLine + 1 && result.every((line, i) => line === lines[startLine + i])
    return {edit: {startLine, endLine, lines: result, selections, isEmpty: unchanged}}
}
