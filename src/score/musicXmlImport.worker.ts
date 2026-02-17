/// <reference lib="webworker" />

import { DOMParser as LinkedomDOMParser } from 'linkedom'
import { parseMusicXml } from './musicXml'
import type { ImportResult } from './types'

type WorkerParseRequest = {
  id: number
  xmlText: string
}

type WorkerParseResponse =
  | {
      id: number
      ok: true
      result: ImportResult
    }
  | {
      id: number
      ok: false
      error: string
    }

const workerScope = self as DedicatedWorkerGlobalScope

if (typeof DOMParser === 'undefined') {
  ;(workerScope as unknown as { DOMParser: typeof LinkedomDOMParser }).DOMParser = LinkedomDOMParser
}

workerScope.onmessage = (event: MessageEvent<WorkerParseRequest>) => {
  const { id, xmlText } = event.data
  try {
    const result = parseMusicXml(xmlText)
    const payload: WorkerParseResponse = { id, ok: true, result }
    workerScope.postMessage(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse MusicXML in worker.'
    const payload: WorkerParseResponse = { id, ok: false, error: message }
    workerScope.postMessage(payload)
  }
}

export {}
