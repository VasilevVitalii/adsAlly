import { OutputChannel } from 'vscode'
import { CreateRefineService, TTokenLine } from 'mssqlrefine'
import { performance } from 'node:perf_hooks'
import { TDebugMode } from './extension'

export class RefineService {
    private _serviceLower = CreateRefineService()
    private _serviceUpper = CreateRefineService()
    private _serviceOrigin = CreateRefineService()
    private _onLog = (mode: TDebugMode, text: string, json?: object) => {}


    constructor() {
        this._serviceLower.prepareWorldsAll('lower')
        this._serviceUpper.prepareWorldsAll('upper')
        this._serviceOrigin.prepareWorldsAll(undefined)
    }

    public setLogger(onLog: (mode: TDebugMode, text: string) => any) {
        this._onLog = onLog
    }

    public addTokens(
        head: TTokenLine[],
        tail: string[]
    ) {
        if (head && head.length > 0) {
            this._onLog('trace', `RefineService - getTokens - last in head[] - {{json}}`, head[head.length - 1])
        }

        head.push(...this._serviceOrigin.getTokens(tail, head))
    }
}

