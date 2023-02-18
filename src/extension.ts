import * as vscode from 'vscode'
import * as azdata from 'azdata'
import { RefineService } from './refineService'
import { CreateRefineService, TTokenLine, TTokenLineChunk } from 'mssqlrefine'

export type TDebugMode = 'off' | 'debug' | 'trace' | 'error'
export type TCase = 'lower' | 'upper' | 'off'

export function activate(context: vscode.ExtensionContext) {

    const shared = {
        tokens: [] as TTokenLine[],
        refineService: new RefineService(),
        inEditText: false,
        allyChannel: vscode.window.createOutputChannel("ally"),
        confiruration: {
            queryTextCase_debug: 'debug' as TDebugMode,
            queryTextCase_Case: 'off' as TCase
        },
        log: function (debug: TDebugMode, text: string, json?: object) {
            let textChannel = ''
            if (debug === 'error') {
                textChannel = text
            } else if (this.confiruration.queryTextCase_debug === 'debug' && debug === 'debug') {
                textChannel = text
            } else if (this.confiruration.queryTextCase_debug === 'trace') {
                textChannel = text
            }
            if (textChannel.length > 0) {
                if (json) {
                    textChannel = textChannel.replace('{{json}}', JSON.stringify(json))
                }
                this.allyChannel.appendLine(`[${new Date().toLocaleString()}] [${debug === 'debug' ? 'D' : debug === 'trace' ? 'T' : debug === 'error' ? 'E' : ''}] ${textChannel}`)
            }
        },
        loadConfiguration: function () {
            this.confiruration.queryTextCase_Case = vscode.workspace.getConfiguration().get('Ally.QueryTextCase.Case') as 'lower' | 'upper'
            this.confiruration.queryTextCase_debug = vscode.workspace.getConfiguration().get('Ally.QueryTextCase.Debug') as TDebugMode
            this.log('debug', `loadConfiguration - "queryTextCase_Case"="${this.confiruration.queryTextCase_Case}", "queryTextCase_debug"="${this.confiruration.queryTextCase_debug}"`)
        }
    }
    shared.refineService.setLogger((debug: TDebugMode, text: string, json?: object) => shared.log(debug, text, json))
    shared.loadConfiguration()

    context.subscriptions.push(vscode.commands.registerCommand('Ally.QueryTextCase.Upper', () => {
        try {
            if (shared.inEditText) return
            shared.inEditText = true
            OnCommand_Ally_QueryTextCase('upper', shared.tokens, shared.refineService)
            shared.inEditText = false
        } catch (ex) {
            shared.inEditText = false
            shared.log('error', (ex as Error).message)
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Ally.QueryTextCase.Lower', () => {
        try {
            if (shared.inEditText) return
            shared.inEditText = true
            OnCommand_Ally_QueryTextCase('lower', shared.tokens, shared.refineService)
            shared.inEditText = false
        } catch (ex) {
            shared.inEditText = false
            shared.log('error', (ex as Error).message)
        }
    }));

    vscode.workspace.onDidChangeConfiguration(event => {
        shared.loadConfiguration()
    })

    vscode.workspace.onDidChangeTextDocument(event => {
        try {
            if (shared.inEditText) return
            shared.inEditText = true
            onDidChangeTextDocument(
                shared.confiruration.queryTextCase_Case,
                shared.tokens,
                shared.refineService,
                (debug, text, json) => shared.log(debug, text, json),
                event)
            shared.inEditText = false
        } catch (ex) {
            shared.inEditText = false
            shared.log('error', (ex as Error).message)
        }
    })

    vscode.window.onDidChangeActiveTextEditor(changeEvent => {
        shared.tokens.splice(0)
        shared.log('debug', 'onDidChangeActiveTextEditor - clear tokens')
    })
}

// this method is called when your extension is deactivated
export function deactivate() {
}

function onDidChangeTextDocument(
    caseWorld: TCase,
    tokens: TTokenLine[],
    refineService: RefineService,
    log: (debug: TDebugMode, text: string, json?: object) => void,
    event: vscode.TextDocumentChangeEvent
) {
    if (caseWorld !== 'lower' && caseWorld !== 'upper') return
    if (event.contentChanges.length !== 1) return
    const cc = event.contentChanges[0]
    if (cc.range.start.line !== cc.range.end.line) return
    const line = cc.range.end.line
    if (line < 0) return
    if (!isWatchChar(cc.text)) return

    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const document = event.document
    if (!document || document.languageId !== 'sql') return

    log('trace', `onDidChangeTextDocument - edit in line ${line}`)
    let tStart = -1
    let tStop = -1
    if (tokens.length <= 0) {
        tStart = 0
        tStop = line
        log('trace', `onDidChangeTextDocument - tokens no need splice (length = 0)`)
    } else {
        const length = tokens.length
        if (line >= length) {
            log('trace', `onDidChangeTextDocument - tokens no need splice (line(${line}) >= length(${length}))`)
        } else {
            tokens.splice(line)
            log('trace', `onDidChangeTextDocument - tokens splice length ${length} => ${tokens.length}`)
        }
        tStart = tokens.length
        tStop = line
    }

    var text = Array(tStop - tStart + 1)
    for (let i = 0; i < text.length; i++) {
        text[i] = document.lineAt(tStart + i).text
    }

    refineService.addTokens(tokens, text)
    log('trace', `onDidChangeTextDocument - tokens len = ${tokens.length}`)
    if (tokens.length <= line) return

    let needEditLine = false

    for (let i = tokens[line].chunks.length - 1; i >= 0; i--) {
        if (tokens[line].chunks[i].idx < cc.range.end.character) {
            const chunk = tokens[line].chunks[i]
            if (chunk.kind === 'code' && (chunk.kindCode || []).length > 0) {
                const t = caseWorld === 'upper' ? chunk.text.toUpperCase()
                    : caseWorld === 'lower' ? chunk.text.toLowerCase()
                        : chunk.text
                if (t !== chunk.text) {
                    chunk.text = t
                    needEditLine = true
                    log('trace', `onDidChangeTextDocument - "needEditLine" = "${needEditLine}"`)
                }
            }
            break
        }
    }

    if (needEditLine) {
        const newText = tokens[line].chunks.map(m => m.text).join('')
        editor.edit(editBuilder => {
            editBuilder.replace(document.lineAt(line).range, newText)
        })
    }
}

function OnCommand_Ally_QueryTextCase(
    caseWorld: TCase,
    tokens: TTokenLine[],
    refineService: RefineService
) {
    if (caseWorld !== 'lower' && caseWorld !== 'upper') return
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const document = editor.document
    if (!document) return

    tokens.splice(0)
    var text = Array(document.lineCount)
    for (let i = 0; i < text.length; i++) {
        text[i] = document.lineAt(i).text
    }
    refineService.addTokens(tokens, text)

    const editLines = [] as number[]
    tokens.forEach((token, line) => {
        let needEditLine = false
        token.chunks.forEach(chunk => {
            if (chunk.kind === 'code' && (chunk.kindCode || []).length > 0) {
                const t = caseWorld === 'upper' ? chunk.text.toUpperCase()
                            : caseWorld === 'lower' ? chunk.text.toLowerCase()
                            : chunk.text
                if (t !== chunk.text) {
                    chunk.text = t
                    needEditLine = true
                }
            }
        })
        if (needEditLine) {
            editLines.push(line)
        }
    })

    if (editLines.length > 0) {
        editor.edit(editBuilder => {
            editLines.forEach(line => {
                const newText = tokens[line].chunks.map(m => m.text).join('')
                editBuilder.replace(document.lineAt(line).range, newText)
            })
        })
    }
}

const watchChars = [' ', '\n', '()', '(', '\t', ';', '\u00A0', '\'', '\\', '*', '-']
function isWatchChar(ch: string): boolean {
    return watchChars.includes(ch)
}