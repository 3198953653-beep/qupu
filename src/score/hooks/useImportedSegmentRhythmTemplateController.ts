import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { buildSelectionsForMeasureRange } from '../selectionMeasureRange'
import {
  buildSegmentDurationCombo,
  buildSegmentRhythmTemplateApplication,
  parseTimelineSegmentScopeKey,
  type TimelineSegmentScope,
} from '../segmentRhythmTemplateEngine'
import {
  collectRhythmTemplateTagSets,
  queryRhythmTemplateRowsByDurationCombo,
  type RhythmTemplateRow,
} from '../rhythmTemplateDb'
import type { MeasurePair, ScoreSourceKind, SegmentRhythmTemplateBinding, TimeSignature } from '../types'

export function useImportedSegmentRhythmTemplateController(params: {
  scoreSourceKind: ScoreSourceKind
  measurePairsRef: MutableRefObject<MeasurePair[]>
  chordRulerEntriesByPair: import('../chordRuler').ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
  measureKeyFifthsByMeasure: number[] | null
  segmentRhythmTemplateBindings: Record<string, SegmentRhythmTemplateBinding>
  setSegmentRhythmTemplateBindings: (nextValue: Record<string, SegmentRhythmTemplateBinding> | ((current: Record<string, SegmentRhythmTemplateBinding>) => Record<string, SegmentRhythmTemplateBinding>)) => void
  applyKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: import('../types').Selection,
    nextSelections?: import('../types').Selection[],
    source?: 'default' | 'midi-step',
    options?: { collapseScopesToAdd?: Array<{ pairIndex: number; staff: 'treble' | 'bass' }> },
  ) => void
}) {
  const {
    scoreSourceKind,
    measurePairsRef,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
    measureKeyFifthsByMeasure,
    segmentRhythmTemplateBindings,
    setSegmentRhythmTemplateBindings,
    applyKeyboardEditResult,
  } = params

  const [isOpen, setIsOpen] = useState(false)
  const [activeScopeKey, setActiveScopeKey] = useState<string | null>(null)
  const [durationCombo, setDurationCombo] = useState<string | null>(null)
  const [allTemplateRows, setAllTemplateRows] = useState<RhythmTemplateRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(null)
  const [selectedStyles, setSelectedStyles] = useState<string[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const requestSeqRef = useRef(0)

  const activeScope = useMemo<TimelineSegmentScope | null>(() => {
    if (!activeScopeKey) return null
    return parseTimelineSegmentScopeKey(activeScopeKey)
  }, [activeScopeKey])

  const selectedBinding = useMemo(
    () => (activeScopeKey ? segmentRhythmTemplateBindings[activeScopeKey] ?? null : null),
    [activeScopeKey, segmentRhythmTemplateBindings],
  )

  const { difficultyOptions, styleOptions } = useMemo(
    () => collectRhythmTemplateTagSets(allTemplateRows),
    [allTemplateRows],
  )

  const filteredTemplateRows = useMemo(() => allTemplateRows.filter((row) => {
    const matchesDifficulty = !selectedDifficulty || row.difficultyTags.includes(selectedDifficulty)
    const matchesStyles = selectedStyles.length === 0 || selectedStyles.some((style) => row.styleTags.includes(style))
    return matchesDifficulty && matchesStyles
  }), [allTemplateRows, selectedDifficulty, selectedStyles])

  useEffect(() => {
    if (!isOpen) return
    setSelectedTemplateId((current) => {
      if (current && filteredTemplateRows.some((row) => row.id === current)) {
        return current
      }
      return filteredTemplateRows[0]?.id ?? null
    })
  }, [filteredTemplateRows, isOpen])

  const closeModal = useCallback(() => {
    setIsOpen(false)
    setActiveScopeKey(null)
    setDurationCombo(null)
    setAllTemplateRows([])
    setIsLoading(false)
    setIsApplying(false)
    setErrorMessage(null)
    setSelectedDifficulty(null)
    setSelectedStyles([])
    setSelectedTemplateId(null)
  }, [])

  useEffect(() => {
    if (scoreSourceKind === 'musicxml-file') return
    closeModal()
  }, [closeModal, scoreSourceKind])

  const openModalForScope = useCallback((scopeKey: string) => {
    if (scoreSourceKind !== 'musicxml-file') return
    const scope = parseTimelineSegmentScopeKey(scopeKey)
    if (!scope) return
    const restoredBinding = segmentRhythmTemplateBindings[scopeKey] ?? null

    setIsOpen(true)
    setActiveScopeKey(scopeKey)
    setDurationCombo(null)
    setAllTemplateRows([])
    setIsLoading(true)
    setIsApplying(false)
    setErrorMessage(null)
    setSelectedDifficulty(restoredBinding?.selectedDifficulty ?? null)
    setSelectedStyles(restoredBinding?.selectedStyles ?? [])
    setSelectedTemplateId(restoredBinding?.templateId ?? null)
  }, [scoreSourceKind, segmentRhythmTemplateBindings])

  useEffect(() => {
    if (!isOpen || !activeScope) return
    const requestId = requestSeqRef.current + 1
    requestSeqRef.current = requestId

    const nextDurationCombo = buildSegmentDurationCombo({
      scope: activeScope,
      chordRulerEntriesByPair,
      measureTimeSignaturesByMeasure,
    })

    setDurationCombo(nextDurationCombo)
    if (!nextDurationCombo) {
      setAllTemplateRows([])
      setErrorMessage('当前段落没有可用和弦时值序列，暂时无法匹配律动模板。')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    void queryRhythmTemplateRowsByDurationCombo(nextDurationCombo)
      .then((rows) => {
        if (requestSeqRef.current !== requestId) return
        setAllTemplateRows(rows)
        setIsLoading(false)
        setErrorMessage(null)
        setSelectedTemplateId((current) => {
          if (current && rows.some((row) => row.id === current)) return current
          const bindingTemplateId =
            selectedBinding && selectedBinding.durationCombo === nextDurationCombo
              ? selectedBinding.templateId
              : null
          if (bindingTemplateId && rows.some((row) => row.id === bindingTemplateId)) {
            return bindingTemplateId
          }
          return rows[0]?.id ?? null
        })
      })
      .catch((error) => {
        if (requestSeqRef.current !== requestId) return
        setAllTemplateRows([])
        setIsLoading(false)
        setErrorMessage(error instanceof Error ? error.message : '律动模板数据库加载失败。')
      })
  }, [
    activeScope,
    chordRulerEntriesByPair,
    isOpen,
    measureTimeSignaturesByMeasure,
    selectedBinding,
  ])

  const toggleStyleFilter = useCallback((style: string) => {
    setSelectedStyles((current) =>
      current.includes(style)
        ? current.filter((entry) => entry !== style)
        : [...current, style],
    )
  }, [])

  const applySelectedTemplate = useCallback(async (templateIdOverride?: string) => {
    if (!activeScope || !activeScopeKey) return
    const templateId = templateIdOverride ?? selectedTemplateId
    if (!templateId) return
    const selectedTemplate = allTemplateRows.find((row) => row.id === templateId)
    if (!selectedTemplate) return

    setIsApplying(true)
    setErrorMessage(null)

    try {
      const result = await buildSegmentRhythmTemplateApplication({
        measurePairs: measurePairsRef.current,
        scope: activeScope,
        chordRulerEntriesByPair,
        measureTimeSignaturesByMeasure,
        measureKeyFifthsByMeasure,
        patternData: selectedTemplate.patternData,
        seedTemplDetails:
          selectedBinding?.templateId === selectedTemplate.id
            ? selectedBinding.templDetails
            : null,
      })

      const nextSelections = buildSelectionsForMeasureRange({
        measurePairs: result.nextPairs,
        startPairIndex: activeScope.startPairIndex,
        endPairIndexInclusive: activeScope.endPairIndexInclusive,
      })
      const nextSelection = nextSelections[0]
      if (!nextSelection) {
        throw new Error('所选段落没有可写回的目标音符。')
      }

      applyKeyboardEditResult(
        result.nextPairs,
        nextSelection,
        nextSelections,
        'default',
        { collapseScopesToAdd: result.collapseScopesToAdd },
      )

      setSegmentRhythmTemplateBindings((current) => ({
        ...current,
        [activeScopeKey]: {
          scopeKey: activeScopeKey,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          selectedDifficulty,
          selectedStyles,
          patternData: selectedTemplate.patternData,
          templDetails: result.templDetails,
          durationCombo: result.durationCombo,
        },
      }))

      closeModal()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '套用律动模板失败。')
      setIsApplying(false)
    }
  }, [
    activeScope,
    activeScopeKey,
    allTemplateRows,
    applyKeyboardEditResult,
    chordRulerEntriesByPair,
    closeModal,
    measureKeyFifthsByMeasure,
    measurePairsRef,
    measureTimeSignaturesByMeasure,
    selectedDifficulty,
    selectedStyles,
    selectedTemplateId,
    setSegmentRhythmTemplateBindings,
  ])

  const handleTemplateDoubleClick = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId)
    void applySelectedTemplate(templateId)
  }, [applySelectedTemplate])

  return {
    onTimelineSegmentDoubleClick: openModalForScope,
    rhythmTemplateLoadModal: {
      isOpen,
      scope: activeScope,
      durationCombo,
      isLoading,
      isApplying,
      errorMessage,
      difficultyOptions,
      styleOptions,
      allTemplateRows,
      filteredTemplateRows,
      selectedDifficulty,
      selectedStyles,
      selectedTemplateId,
      closeModal,
      setSelectedDifficulty,
      toggleStyleFilter,
      setSelectedTemplateId,
      applySelectedTemplate,
      handleTemplateDoubleClick,
    },
  }
}
