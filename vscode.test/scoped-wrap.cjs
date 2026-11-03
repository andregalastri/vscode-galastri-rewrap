const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {pathToFileURL} = require('node:url')
const Module = require('node:module')
const ts = require('typescript')

async function main() {
    const core = await import(pathToFileURL(path.resolve('core/dist/dev/Main.js')).href)
    const modules = {'./Core': core}
    for (const name of ['Ataula', 'MarkdownCode', 'ScopedWrap']) {
        const loaded = new Module(name)
        loaded.require = key => modules[key]
        loaded._compile(ts.transpileModule(fs.readFileSync(`vscode/src/${name}.ts`, 'utf8'), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019},
        }).outputText, name + '.cjs')
        modules['./' + name] = loaded.exports
    }
    const {rewrapScoped} = modules['./ScopedWrap']
    const source = fs.readFileSync('vscode.test/fixtures/ataula-comment.txt', 'utf8').trimEnd().split('\n')
    const file = {path: 'example.php', language: 'php', getMarkers: () => core.noCustomMarkers}
    const settings = {column: 80, tabWidth: 4, wholeComment: true, reformat: false, doubleSentenceSpacing: false}
    const line = text => source.findIndex(value => value.includes(text))
    const cursor = number => ({anchor: {line: number, character: 12}, active: {line: number, character: 12}})
    function run(selections) {
        const result = rewrapScoped(file, settings, selections, source, false)
        const lines = [...source]
        lines.splice(result.edit.startLine, result.edit.endLine - result.edit.startLine + 1, ...result.edit.lines)
        return lines
    }
    function content(lines) {
        return lines.filter(value => value.includes('│')).map(value => value.slice(value.indexOf('│') + 2, value.lastIndexOf('│')).trimEnd())
    }
    const original = content(source)
    const array = original.slice(original.findIndex(value => value === '['), original.findIndex(value => value === '];') + 1)
    // Cursor in prose only reflows that paragraph; code and later paragraphs keep their breaks.
    const inside = run([cursor(line('Router vai'))])
    const after = content(inside)
    const startArray = after.findIndex(value => value === '[')
    assert.deepEqual(after.slice(startArray, startArray + array.length), array)
    const untouchedStart = original.findIndex(value => value.startsWith("Se 'listar'"))
    assert.deepEqual(after.slice(after.findIndex(value => value.startsWith("Se 'listar'"))), original.slice(untouchedStart))
    // Even an explicit selection of the entire table must preserve the array's lines and indentation.
    const selected = run([{anchor: {line: line('┌'), character: 0}, active: {line: line('└'), character: source[line('└')].length}}])
    const allContent = content(selected)
    const at = allContent.findIndex(value => value === '[')
    assert.deepEqual(allContent.slice(at, at + array.length), array)
    // Cursor outside the box: preserve the entire example byte for byte and the following paragraph.
    const outside = run([cursor(line('Armazena a lista'))])
    assert.notDeepEqual(outside, source)
    const oldBox = source.slice(line('┌'), line('└') + 1).join('\n')
    assert.ok(outside.join('\n').includes(oldBox))
    assert.ok(outside.join('\n').includes(source.slice(line('Note que')).join('\n')))
    assert.ok(outside.filter(value => value.includes('Armazena') || value.includes('Este parágrafo')).every(value => value.length <= 80))
    console.log('Scoped wrapping: 3 user-example checks passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
