import { useEffect, type MutableRefObject } from 'react'
import type { MeasurePair, MusicXmlMetadata, TimeSignature } from '../types'

export function useImportedRefsSync(params: {
  measurePairsFromImport: MeasurePair[] | null
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  measureKeyFifthsFromImport: number[] | null
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureKeyModesFromImport: string[] | null
  measureKeyModesFromImportRef: MutableRefObject<string[] | null>
  measureDivisionsFromImport: number[] | null
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImport: TimeSignature[] | null
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  musicXmlMetadataFromImport: MusicXmlMetadata | null
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  measurePairs: MeasurePair[]
  measurePairsRef: MutableRefObject<MeasurePair[]>
}): void {
  const {
    measurePairsFromImport,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measureKeyModesFromImport,
    measureKeyModesFromImportRef,
    measureDivisionsFromImport,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    measurePairs,
    measurePairsRef,
  } = params

  useEffect(() => {
    measurePairsFromImportRef.current = measurePairsFromImport
  }, [measurePairsFromImport, measurePairsFromImportRef])

  useEffect(() => {
    measureKeyFifthsFromImportRef.current = measureKeyFifthsFromImport
  }, [measureKeyFifthsFromImport, measureKeyFifthsFromImportRef])

  useEffect(() => {
    measureKeyModesFromImportRef.current = measureKeyModesFromImport
  }, [measureKeyModesFromImport, measureKeyModesFromImportRef])

  useEffect(() => {
    measureDivisionsFromImportRef.current = measureDivisionsFromImport
  }, [measureDivisionsFromImport, measureDivisionsFromImportRef])

  useEffect(() => {
    measureTimeSignaturesFromImportRef.current = measureTimeSignaturesFromImport
  }, [measureTimeSignaturesFromImport, measureTimeSignaturesFromImportRef])

  useEffect(() => {
    musicXmlMetadataFromImportRef.current = musicXmlMetadataFromImport
  }, [musicXmlMetadataFromImport, musicXmlMetadataFromImportRef])

  useEffect(() => {
    measurePairsRef.current = measurePairs
  }, [measurePairs, measurePairsRef])
}
