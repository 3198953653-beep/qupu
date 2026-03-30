import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseTimelineSegmentScopeKey } from '../segmentRhythmTemplateEngine'
import {
  PEDAL_LAYOUT_MODE_LABELS,
  PEDAL_STYLE_LABELS,
  buildPedalSpansForScope,
  getDefaultPedalApplyScope,
  sortPedalSpans,
  spanIntersectsPedalScope,
} from '../pedalUtils'
import type { ChordRulerEntry } from '../chordRuler'
import type {
  MeasurePair,
  PedalApplyScope,
  PedalLayoutMode,
  PedalSpan,
  PedalStyle,
  TimeSignature,
} from '../types'
import type {
  ActiveChordSelection,
  ChordRulerMarkerMeta,
  TimelineSegmentBlock,
} from './chordMarkerTypes'

type ScopeOption = {
  scope: PedalApplyScope
  label: string
  disabled: boolean
}

type ResolvedPedalScopeRange =
  | { scope: 'all' }
  | {
      scope: 'segment'
      startPairIndex: number
      endPairIndexInclusive: number
    }
  | {
      scope: 'chord'
      pairIndex: number
      startTick: number
      endTick: number
    }

function countChordEntriesInScope(params: {
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  scope: ResolvedPedalScopeRange | null
}): number {
  const { chordRulerEntriesByPair, scope } = params
  if (!chordRulerEntriesByPair || !scope) return 0
  if (scope.scope === 'all') {
    return chordRulerEntriesByPair.reduce((sum, entries) => sum + entries.length, 0)
  }
  if (scope.scope === 'segment') {
    let count = 0
    for (let pairIndex = scope.startPairIndex; pairIndex <= scope.endPairIndexInclusive; pairIndex += 1) {
      count += chordRulerEntriesByPair[pairIndex]?.length ?? 0
    }
    return count
  }
  return (chordRulerEntriesByPair[scope.pairIndex] ?? []).filter(
    (entry) => Math.round(entry.startTick) === Math.round(scope.startTick) && Math.round(entry.endTick) === Math.round(scope.endTick),
  ).length
}

export function usePedalApplyController(params: {
  measurePairs: MeasurePair[]
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  activeChordSelection: ActiveChordSelection | null
  timelineSegmentBlocks: TimelineSegmentBlock[]
  pedalSpans: PedalSpan[]
  setPedalSpans: (value: PedalSpan[] | ((current: PedalSpan[]) => PedalSpan[])) => void
  clearActivePedalSelection: () => void
}) {
  const {
    measurePairs,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
    chordRulerMarkerMetaByKey,
    activeChordSelection,
    timelineSegmentBlocks,
    pedalSpans,
    setPedalSpans,
    clearActivePedalSelection,
  } = params

  const [isOpen, setIsOpen] = useState(false)
  const [selectedScope, setSelectedScope] = useState<PedalApplyScope>('all')
  const [selectedLayoutMode, setSelectedLayoutMode] = useState<PedalLayoutMode>('flexible')

  const hasAnyChordEntries = useMemo(
    () => Boolean(chordRulerEntriesByPair?.some((entries) => entries.length > 0)),
    [chordRulerEntriesByPair],
  )
  const activeTimelineSegment = useMemo(
    () => timelineSegmentBlocks.find((entry) => entry.isActive) ?? null,
    [timelineSegmentBlocks],
  )
  const activeSegmentScope = useMemo(
    () => (activeTimelineSegment ? parseTimelineSegmentScopeKey(activeTimelineSegment.scopeKey) : null),
    [activeTimelineSegment],
  )

  const scopeOptions = useMemo<ScopeOption[]>(() => ([
    { scope: 'all', label: '整首', disabled: !hasAnyChordEntries },
    { scope: 'segment', label: '当前段落', disabled: activeSegmentScope === null },
    { scope: 'chord', label: '当前和弦', disabled: activeChordSelection === null },
  ]), [activeChordSelection, activeSegmentScope, hasAnyChordEntries])

  const resolveScopeRange = useCallback((scope: PedalApplyScope): ResolvedPedalScopeRange | null => {
    if (scope === 'chord') {
      if (!activeChordSelection) return null
      return {
        scope: 'chord',
        pairIndex: activeChordSelection.pairIndex,
        startTick: activeChordSelection.startTick,
        endTick: activeChordSelection.endTick,
      }
    }
    if (scope === 'segment') {
      if (!activeSegmentScope) return null
      return {
        scope: 'segment',
        startPairIndex: activeSegmentScope.startPairIndex,
        endPairIndexInclusive: activeSegmentScope.endPairIndexInclusive,
      }
    }
    if (!hasAnyChordEntries) return null
    return { scope: 'all' }
  }, [activeChordSelection, activeSegmentScope, hasAnyChordEntries])

  const defaultScope = useMemo(
    () => getDefaultPedalApplyScope({
      hasActiveChord: activeChordSelection !== null,
      hasActiveSegment: activeSegmentScope !== null,
    }),
    [activeChordSelection, activeSegmentScope],
  )

  useEffect(() => {
    if (!isOpen) return
    const activeOption = scopeOptions.find((option) => option.scope === selectedScope)
    if (activeOption && !activeOption.disabled) return
    const fallbackOption = scopeOptions.find((option) => !option.disabled)
    if (!fallbackOption) return
    setSelectedScope(fallbackOption.scope)
  }, [isOpen, scopeOptions, selectedScope])

  const currentScopeRange = useMemo(
    () => resolveScopeRange(selectedScope),
    [resolveScopeRange, selectedScope],
  )
  const currentScopeChordCount = useMemo(
    () => countChordEntriesInScope({
      chordRulerEntriesByPair,
      scope: currentScopeRange,
    }),
    [chordRulerEntriesByPair, currentScopeRange],
  )

  const hasExistingSpansInScope = useMemo(
    () => Boolean(currentScopeRange && pedalSpans.some((span) => spanIntersectsPedalScope(span, currentScopeRange))),
    [currentScopeRange, pedalSpans],
  )

  const scopeSummary = useMemo(() => {
    if (selectedScope === 'chord') {
      if (!activeChordSelection) return '当前没有选中的和弦标记。'
      const marker = activeChordSelection.markerKey
        ? chordRulerMarkerMetaByKey.get(activeChordSelection.markerKey) ?? null
        : null
      const beatText = marker?.positionText ?? `起点 tick ${activeChordSelection.startTick}`
      const chordText = marker?.displayLabel ?? marker?.sourceLabel ?? '当前和弦'
      return `第 ${activeChordSelection.pairIndex + 1} 小节，${beatText}，${chordText}`
    }
    if (selectedScope === 'segment') {
      if (!activeSegmentScope) return '当前没有选中的段落。'
      return `第 ${activeSegmentScope.startPairIndex + 1}-${activeSegmentScope.endPairIndexInclusive + 1} 小节`
    }
    const measureCount = chordRulerEntriesByPair?.length ?? 0
    return measureCount > 0 ? `整首，共 ${measureCount} 个小节` : '当前谱面没有可用和弦时间轴。'
  }, [
    activeChordSelection,
    activeSegmentScope,
    chordRulerEntriesByPair?.length,
    chordRulerMarkerMetaByKey,
    selectedScope,
  ])

  const openModal = useCallback(() => {
    if (!hasAnyChordEntries) return
    setSelectedScope(defaultScope)
    setSelectedLayoutMode('flexible')
    setIsOpen(true)
  }, [defaultScope, hasAnyChordEntries])

  const closeModal = useCallback(() => {
    setIsOpen(false)
  }, [])

  const applyStyle = useCallback((style: PedalStyle) => {
    const scope = resolveScopeRange(selectedScope)
    if (!scope) return
    const nextSpans = buildPedalSpansForScope({
      style,
      layoutMode: selectedLayoutMode,
      scope,
      measurePairs,
      chordRulerEntriesByPair,
      measureTimeSignaturesByMeasure,
    })
    if (nextSpans.length === 0) return

    const shouldOverwrite =
      !pedalSpans.some((span) => spanIntersectsPedalScope(span, scope)) ||
      typeof window === 'undefined' ||
      window.confirm('当前范围已有踏板，是否覆盖？')

    if (!shouldOverwrite) return

    setPedalSpans((current) =>
      sortPedalSpans([
        ...current.filter((span) => !spanIntersectsPedalScope(span, scope)),
        ...nextSpans,
      ]),
    )
    clearActivePedalSelection()
    setIsOpen(false)
  }, [
    chordRulerEntriesByPair,
    clearActivePedalSelection,
    measurePairs,
    measureTimeSignaturesByMeasure,
    pedalSpans,
    resolveScopeRange,
    selectedLayoutMode,
    selectedScope,
    setPedalSpans,
  ])

  return {
    canOpenPedalModal: hasAnyChordEntries,
    openPedalModal: openModal,
    pedalApplyDialog: {
      isOpen,
      selectedScope,
      selectedLayoutMode,
      scopeOptions,
      layoutModeOptions: (Object.keys(PEDAL_LAYOUT_MODE_LABELS) as PedalLayoutMode[]).map((mode) => ({
        mode,
        label: PEDAL_LAYOUT_MODE_LABELS[mode],
      })),
      scopeSummary,
      chordCountInScope: currentScopeChordCount,
      hasExistingSpansInScope,
      styleOptions: (Object.keys(PEDAL_STYLE_LABELS) as PedalStyle[]).map((style) => ({
        style,
        label: PEDAL_STYLE_LABELS[style],
      })),
      closeModal,
      setSelectedScope,
      setSelectedLayoutMode,
      applyStyle,
    },
  }
}
