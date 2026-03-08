import type { ReactNode } from 'react'
import VexFlow from 'vexflow'

import {
  NOTATION_PALETTE_ICON_SPECS,
  type NotationPaletteGlyphLayer,
  type NotationPaletteIconId,
} from '../notationPaletteConfig'

const MUSIC_FONT_FAMILY = 'Bravura, Academico, serif'
const UI_FONT_FAMILY = '"Segoe UI", system-ui, sans-serif'
const { Glyphs } = VexFlow

type GlyphTextProps = {
  glyph: string
  x?: number
  y?: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: number | string
}

function resolveGlyphContent(glyph: string, fontFamily: string) {
  if (fontFamily === MUSIC_FONT_FAMILY) {
    return Glyphs[glyph as keyof typeof Glyphs] ?? glyph
  }
  return glyph
}

function GlyphText(props: GlyphTextProps) {
  const {
    glyph,
    x = 12,
    y = 12,
    fontSize = 20,
    fontFamily = MUSIC_FONT_FAMILY,
    fontWeight = 400,
  } = props
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fill="currentColor"
      aria-hidden="true"
    >
      {resolveGlyphContent(glyph, fontFamily)}
    </text>
  )
}

function wrapIcon(children: ReactNode, boxSize = 24) {
  return (
    <span className="notation-palette-cell-icon" aria-hidden="true">
      <svg viewBox={`0 0 ${boxSize} ${boxSize}`} role="presentation" focusable="false">
        {children}
      </svg>
    </span>
  )
}

function renderLayer(layer: NotationPaletteGlyphLayer, index: number) {
  const fontFamily = layer.fontFamily ?? MUSIC_FONT_FAMILY
  return (
    <GlyphText
      key={`${layer.glyph}-${index}`}
      glyph={layer.glyph}
      x={12 + (layer.dx ?? 0)}
      y={12 + (layer.dy ?? 0)}
      fontSize={layer.fontSize}
      fontFamily={fontFamily}
      fontWeight={layer.fontWeight ?? 400}
    />
  )
}

export function NotationPaletteIcon(props: { iconId: NotationPaletteIconId }) {
  const { iconId } = props
  const spec = NOTATION_PALETTE_ICON_SPECS[iconId]
  if (!spec) {
    return wrapIcon(
      <GlyphText glyph="?" fontFamily={UI_FONT_FAMILY} fontSize={16} fontWeight={700} y={12.45} />,
    )
  }
  return wrapIcon(spec.layers.map(renderLayer), spec.boxSize ?? 24)
}
