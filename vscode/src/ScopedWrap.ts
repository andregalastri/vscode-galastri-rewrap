import {DocType, Edit, Selection, Settings, rewrap, rewrapForced} from './Core'
import {ataulaRanges, rewrapAtaula, AtaulaResult} from './Ataula'
import {rewrapMarkdownCode} from './MarkdownCode'

interface Range {start: number, end: number}

function interval(selection: Selection): Range {
    const start = Math.min(selection.anchor.line, selection.active.line)
    let end = Math.max(selection.anchor.line, selection.active.line)
    const last = selection.anchor.line > selection.active.line ? selection.anchor : selection.active
    if (end > start && last.character === 0) end--
    return {start, end}
}

function blankOrBoundary(line: string): boolean {
    const blank = /^\s*(?:(?:\/\*+|\*\/?|\/{2,}|#|--|>)[ \t]*)*$/
    const fenceOrRule = /^\s*(?:\*[ \t]*)?(?:`{3,}|~{3,}|[-─━_=]{3,})/
    return blank.test(line) || fenceOrRule.test(line)
}

function selectLines(range: Range, lines: readonly string[]): Selection {
    return {anchor: {line: range.start, character: 0}, active: {line: range.end, character: lines[range.end].length}}
}

/** Explicit ranges prevent a source parser from expanding to a whole comment. */
export function rewrapScoped(file: DocType, settings: Settings, selections: readonly Selection[], lines: readonly string[], force: boolean): AtaulaResult {
    const boxes = ataulaRanges(lines)
    const selected: Selection[] = []
    function inBox(line: number) { return boxes.some(box => line >= box.start && line <= box.end) }
    for (const selection of selections) {
        const {anchor, active} = selection
        if (anchor.line !== active.line || anchor.character !== active.character || inBox(active.line)) {
            selected.push(selection)
            continue
        }
        if (blankOrBoundary(lines[active.line])) continue
        let start = active.line
        let end = active.line
        while (start > 0 && !inBox(start - 1) && !blankOrBoundary(lines[start - 1])) start--
        while (end + 1 < lines.length && !inBox(end + 1) && !blankOrBoundary(lines[end + 1])) end++
        selected.push(selectLines({start, end}, lines))
    }
    selected.sort((a, b) => interval(a).start - interval(b).start)
    const config = {...settings, wholeComment: false}
    const edits: Edit[] = []
    const messages = new Set<string>()
    function clipped(range: Range): Selection[] {
        const result: Selection[] = []
        for (const selection of selected) {
            const bounds = interval(selection)
            const start = Math.max(range.start, bounds.start)
            const end = Math.min(range.end, bounds.end)
            if (start > end) continue
            if (start === bounds.start && end === bounds.end) result.push(selection)
            else result.push(selectLines({start, end}, lines))
        }
        return result
    }
    function prose(range: Range) {
        if (range.end < range.start) return
        const parts = clipped(range)
        if (!parts.length) return
        let edit = rewrapMarkdownCode(file, config, parts, lines, force)
        if (!edit) {
            const getLine = (i: number) => i < lines.length ? lines[i] : null
            if (force) edit = rewrapForced(config, parts, getLine)
            else edit = rewrap(file, config, parts, getLine)
        }
        if (!edit.isEmpty) edits.push(edit)
    }
    let start = 0
    for (const box of boxes) {
        prose({start, end: box.start - 1})
        const parts = clipped(box)
        if (parts.length) {
            const result = rewrapAtaula(lines, config, parts)
            if (result) {
                if (!result.edit.isEmpty) edits.push(result.edit)
                if (result.message) messages.add(result.message)
            }
        }
        start = box.end + 1
    }
    prose({start, end: lines.length - 1})
    const output = [...lines]
    for (const edit of edits.sort((a, b) => b.startLine - a.startLine)) {
        output.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.lines)
    }
    let begin = 0
    while (begin < lines.length && begin < output.length && lines[begin] === output[begin]) begin++
    let oldEnd = lines.length - 1
    let newEnd = output.length - 1
    while (oldEnd >= begin && newEnd >= begin && lines[oldEnd] === output[newEnd]) { oldEnd--; newEnd-- }
    return {
        edit: {startLine: begin, endLine: oldEnd, lines: output.slice(begin, newEnd + 1), selections, isEmpty: begin > oldEnd && begin > newEnd},
        message: [...messages].join('\n') || undefined,
    }
}
