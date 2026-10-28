const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {pathToFileURL} = require('node:url')
const Module = require('node:module')
const ts = require('typescript')

async function main() {
    const core = await import(pathToFileURL(path.resolve('core/dist/dev/Main.js')).href)
    const loaded = new Module('markdown-code')
    loaded.require = name => {
        assert.equal(name, './Core')
        return core
    }
    loaded._compile(ts.transpileModule(fs.readFileSync('vscode/src/MarkdownCode.ts', 'utf8'), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019},
    }).outputText, 'markdown-code.cjs')
    const {rewrapMarkdownCode} = loaded.exports
    const file = {path: 'example.md', language: 'markdown', getMarkers: () => core.noCustomMarkers}
    const php = {...file, path: '', language: 'php'}
    const settings = {column: 40, tabWidth: 4, wholeComment: true, reformat: false, doubleSentenceSpacing: false}
    const body = ['<?php', '/**', ' * comentário longo que deveria ser quebrado sem perder os asteriscos ou os delimitadores do comentário.', ' */', '$value = "esta linha de código deve permanecer exatamente como está";']
    const selection = [{anchor: {line: 2, character: 8}, active: {line: 2, character: 8}}]
    const expectedEdit = core.rewrap(php, settings, selection, i => body[i] ?? null)
    const expected = [...body]
    expected.splice(expectedEdit.startLine, expectedEdit.endLine - expectedEdit.startLine + 1, ...expectedEdit.lines)
    assert.notDeepEqual(expected, body)
    for (const force of [false, true]) {
        const lines = ['antes', '```php', ...body, '```', 'depois']
        const selected = selection.map(s => ({anchor: {...s.anchor, line: s.anchor.line + 2}, active: {...s.active, line: s.active.line + 2}}))
        const edit = rewrapMarkdownCode(file, settings, selected, lines, force)
        const actual = [...lines]
        actual.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.lines)
        assert.deepEqual(actual, ['antes', '```php', ...expected, '```', 'depois'])
        assert.deepEqual(edit.selections, selected)
    }
    // Unlabelled, unclosed fences containing a comment also use comment rules.
    const lines = ['~~~', ...body.slice(1, 4)]
    const selected = [{anchor: {line: 2, character: 5}, active: {line: 2, character: 5}}]
    const edit = rewrapMarkdownCode(file, settings, selected, lines, false)
    assert.ok(edit && !edit.isEmpty)
    const actual = [...lines]
    actual.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.lines)
    assert.equal(actual[0], '~~~')
    assert.equal(actual[1], '/**')
    assert.equal(actual[actual.length - 1], ' */')
    assert.ok(actual.slice(2, -1).every(line => line.startsWith(' * ') && line.length <= settings.column))
    console.log('Markdown code comments: 3 focused checks passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
