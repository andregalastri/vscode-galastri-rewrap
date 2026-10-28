import {DocType, Edit, Selection, Settings, languageNameForFile, noCustomMarkers, rewrap, rewrapForced} from './Core'

interface Section {
    start: number
    end: number
    prefix: string
    language?: string
    code: boolean
}

/** Fence labels use Markdown aliases, rather than necessarily VS Code IDs. */
function language(label: string): string {
    const aliases = {js: 'javascript', jsx: 'javascriptreact', ts: 'typescript', tsx: 'typescriptreact', sh: 'shellscript', bash: 'shellscript', 'c++': 'cpp', 'c#': 'csharp'}
    const name = label.trim().split(/\s+/)[0].toLowerCase()
    return aliases[name] || name
}

function sections(lines: readonly string[]): Section[] {
    const result: Section[] = []
    const opening = /^([ \t]*(?:>[ \t]*)*)(`{3,}|~{3,})(.*)$/
    let prose = 0
    for (let row = 0; row < lines.length; row++) {
        const match = lines[row].match(opening)
        if (!match || match[2][0] === '`' && match[3].includes('`')) continue
        if (prose < row) result.push({start: prose, end: row - 1, prefix: '', code: false})
        const prefix = match[1]
        const marker = match[2]
        const closing = new RegExp('^' + marker[0] + '{' + marker.length + ',}[ \\t]*$')
        const start = row + 1
        row = start
        while (row < lines.length) {
            let text = lines[row]
            if (prefix && text.startsWith(prefix)) text = text.slice(prefix.length)
            if (closing.test(text.trimStart())) break
            row++
        }
        result.push({start, end: row - 1, prefix, language: language(match[3]), code: true})
        prose = row + 1
    }
    if (prose < lines.length) result.push({start: prose, end: lines.length - 1, prefix: '', code: false})
    return result
}

function localSelections(section: Section, selections: readonly Selection[], content: string[]): Selection[] {
    const result: Selection[] = []
    for (const selection of selections) {
        const a = selection.anchor
        const b = selection.active
        let first = a
        let last = b
        if (a.line > b.line || a.line === b.line && a.character > b.character) { first = b; last = a }
        const empty = first.line === last.line && first.character === last.character
        let endLine = last.line
        if (!empty && last.line > first.line && last.character === 0) endLine--
        if (first.line > section.end || endLine < section.start) continue
        function local(point) {
            const line = Math.max(section.start, Math.min(section.end, point.line))
            let character = point.character - section.prefix.length
            if (point.line < section.start) character = 0
            if (point.line > section.end) character = content[line - section.start].length
            return {line: line - section.start, character: Math.max(0, character)}
        }
        result.push({anchor: local(a), active: local(b)})
    }
    return result
}

/** Use the existing source-language parser on the body, keeping fences opaque. */
export function rewrapMarkdownCode(file: DocType, settings: Settings, selections: readonly Selection[], lines: readonly string[], force: boolean): Edit | undefined {
    if (file.language !== 'markdown' && file.language !== 'mdx') return undefined
    const chunks = sections(lines)
    const plans: {section: Section, content: string[], selected: Selection[], file: DocType, known: boolean}[] = []
    let hasCodeSelection = false
    for (const section of chunks) {
        if (section.end < section.start) continue
        const content = lines.slice(section.start, section.end + 1).map(text => {
            if (section.prefix && text.startsWith(section.prefix)) return text.slice(section.prefix.length)
            return text
        })
        const selected = localSelections(section, selections, content)
        if (!selected.length) continue
        let id = section.language
        // Unlabelled examples often consist solely of a C/PHP-style comment.
        if (section.code && !id && content.some(text => /^\s*(?:\/\*|\/\/)/.test(text))) id = 'php'
        const embedded: DocType = {path: '', language: id || '', getMarkers: () => noCustomMarkers}
        const known = section.code && !!id && !!languageNameForFile(embedded)
        if (known) hasCodeSelection = true
        plans.push({section, content, selected, file: embedded, known})
    }
    if (!hasCodeSelection) return undefined
    const output = [...lines]
    for (const plan of plans.reverse()) {
        const {section, content, selected, known} = plan
        let column = settings.column
        // Quote/indent prefixes are outside the embedded document's columns.
        if (column > 0) {
            let prefixWidth = 0
            for (const char of section.prefix) {
                if (char === '\t') prefixWidth += settings.tabWidth - prefixWidth % settings.tabWidth
                else prefixWidth++
            }
            column = Math.max(1, column - prefixWidth)
        }
        const config = {...settings, column}
        const getLine = (i: number) => i < content.length ? content[i] : null
        let edit: Edit
        if (known) edit = rewrap(plan.file, config, selected, getLine)
        else if (force) edit = rewrapForced(config, selected, getLine)
        else if (!section.code) edit = rewrap(file, config, selected, getLine)
        else continue
        if (edit.isEmpty) continue
        const replacement = [...content]
        replacement.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.lines)
        output.splice(section.start, section.end - section.start + 1, ...replacement.map(text => section.prefix + text))
    }
    let start = 0
    while (start < lines.length && start < output.length && lines[start] === output[start]) start++
    let end = lines.length - 1
    let newEnd = output.length - 1
    while (end >= start && newEnd >= start && lines[end] === output[newEnd]) { end--; newEnd-- }
    return {startLine: start, endLine: end, lines: output.slice(start, newEnd + 1), selections, isEmpty: start > end && start > newEnd}
}
