const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const compiled = ts.transpileModule(fs.readFileSync('vscode/src/Ataula.ts', 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019},
}).outputText
const loaded = new Module('ataula-wrap')
loaded._compile(compiled, 'ataula-wrap.cjs')
const {rewrapAtaula} = loaded.exports
const settings = {column: 45, tabWidth: 4, doubleSentenceSpacing: false, wholeComment: true, reformat: false}
const cursor = line => [{anchor: {line, character: 5}, active: {line, character: 5}}]
function box(text, size = 80, prefix = '') {
    return [prefix + '┌' + '─'.repeat(size - 2) + '┐',
        ...text.map(line => prefix + '│ ' + line.padEnd(size - 4) + ' │'),
        prefix + '└' + '─'.repeat(size - 2) + '┘']
}
function format(lines, column = 45, line = 1) {
    const result = rewrapAtaula(lines, {...settings, column}, cursor(line))
    assert.ok(result, 'Ataula table detected')
    assert.equal(result.message, undefined)
    return [...lines.slice(0, result.edit.startLine), ...result.edit.lines, ...lines.slice(result.edit.endLine + 1)]
}
const prose = 'Se encontrar string, por exemplo, ele passa o trecho para stringFormatting, que aplica a formatação de strings.'
// The screenshot: comment prefix and both borders must fit inside the ruler.
const example = box([prose, '', 'E assim por diante...'], 130, ' * ')
const one = format(['antes', ...example, 'depois'], 50, 2)
assert.equal(one[0], 'antes'); assert.equal(one[one.length - 1], 'depois')
assert.ok(one.slice(1, -1).every(line => line.length === 50))
assert.equal(one.slice(2, -2).map(line => line.slice(5, -2).trim()).join(' ').replace(/\s+/g, ' ').trim(), (prose + ' E assim por diante...'))
// Only the last column changes; the first column's content and width survive.
const multi = ['┌─────────┬' + '─'.repeat(65) + '┐',
    '│ Nome    │ ' + 'Texto longo que precisa de várias linhas e mais espaço.'.padEnd(63) + ' │',
    '│ Outro   │ ' + ''.padEnd(64) + ' │',
    '├─────────┼' + '─'.repeat(65) + '┤',
    '│ Fim     │ ' + 'Mais um parágrafo com palavras suficientes.'.padEnd(63) + ' │',
    '└─────────┴' + '─'.repeat(65) + '┘']
// All original rows have the same physical right border.
multi[2] = '│ Outro   │ ' + ''.padEnd(63) + ' │'
const two = format(multi, 38)
assert.ok(two.every(line => line.length === 38))
assert.equal(two.filter(line => line.includes('Nome'))[0].slice(0, 11), multi[1].slice(0, 11))
assert.equal(two.filter(line => line.includes('Outro'))[0].slice(0, 11), multi[2].slice(0, 11))
assert.ok(two.some(line => line.startsWith('├─────────┼')))
// Quoted ASCII Ataula blocks are supported too.
const ascii = box(['one two three four five six seven eight nine ten'], 60, '> ')
    .map(line => line.replace(/[┌┐└┘│]/g, '|').replace(/─/g, '-'))
assert.ok(format(ascii, 27).every(line => line.length === 27 && line.startsWith('> ')))
// A too-small ruler must not corrupt fixed columns.
const refused = rewrapAtaula(multi, {...settings, column: 12}, cursor(1))
assert.ok(refused.message); assert.ok(refused.edit.isEmpty)
// Nested boxes remain boxes and are never joined to surrounding prose.
const child = box(['inner text'], 18)
const nested = format(box(['before words to reflow', ...child, 'after words to reflow'], 65), 40)
for (const line of child) assert.ok(nested.some(outer => outer.includes(line)))
// Tabs in the prefix count as editor columns, rather than one character.
const tabbed = format(box([prose], 130, '\t* '), 50)
assert.ok(tabbed.every(line => line.length + 3 === 50))
console.log('Ataula: 6 focused checks passed')
