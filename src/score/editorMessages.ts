import type { AccidentalEditFailureReason } from './accidentalEdits'
import type { CopyPasteFailureReason } from './copyPasteEdits'
import type { DurationEditFailureReason } from './durationEdits'
import type { MeasureDeleteFailureReason } from './measureEdits'
import type { TieDeleteFailureReason } from './tieEdits'

export function getDurationEditFailureMessage(reason: DurationEditFailureReason): string {
  switch (reason) {
    case 'no-selection':
      return '未选中可编辑音符'
    case 'multi-note-block':
      return '当前多选范围不支持改时值'
    case 'selection-not-found':
      return '未选中可编辑音符'
    case 'insufficient-ticks':
      return '当前小节剩余时值不足，无法修改为该时值'
    case 'unsupported-dot':
      return '当前时值暂不支持附点修改'
    case 'unsupported-grouping':
      return '当前节奏无法在不跨拍规则下重组'
    default:
      return '当前操作暂不支持'
  }
}

export function getCopyPasteFailureMessage(reason: CopyPasteFailureReason): string {
  switch (reason) {
    case 'no-selection':
      return '未选中可复制/粘贴的音符'
    case 'multi-timepoint':
    case 'multi-note-block':
      return '当前仅支持同一时间点复制'
    case 'selection-not-found':
      return '未选中可复制/粘贴的音符'
    case 'rest-source':
      return '暂不支持复制休止符'
    case 'clipboard-empty':
      return '剪贴板为空'
    case 'insufficient-ticks':
      return '后续时值不足，无法粘贴该时值'
    case 'unsupported-dot':
      return '当前时值暂不支持附点修改'
    case 'unsupported-grouping':
      return '当前节奏无法在不跨拍规则下重组'
    default:
      return '复制粘贴暂不支持当前操作'
  }
}

export function getAccidentalEditFailureMessage(reason: AccidentalEditFailureReason): string {
  switch (reason) {
    case 'no-selection':
      return '未选中可编辑音符'
    case 'selection-not-found':
      return '未找到可编辑目标'
    case 'no-editable-note':
      return '当前目标是休止符，无法添加变音记号'
    case 'no-op':
      return '当前音符已是该变音'
    case 'conflict':
      return '多选目标冲突，未执行修改'
    default:
      return '当前操作暂不支持'
  }
}

export function getDeleteAccidentalFailureMessage(reason: AccidentalEditFailureReason): string {
  switch (reason) {
    case 'no-selection':
      return '未选中可删除的变音记号'
    case 'selection-not-found':
      return '未找到目标变音记号'
    case 'no-editable-note':
      return '当前目标不可编辑'
    case 'no-op':
      return '当前变音记号已不存在'
    case 'conflict':
      return '目标冲突，未执行删除'
    default:
      return '当前操作暂不支持'
  }
}

export function getDeleteTieFailureMessage(reason: TieDeleteFailureReason): string {
  switch (reason) {
    case 'selection-not-found':
      return '未找到目标延音线'
    case 'no-op':
      return '当前延音线已不存在'
    default:
      return '当前操作暂不支持'
  }
}

export function getDeleteMeasureFailureMessage(reason: MeasureDeleteFailureReason): string {
  switch (reason) {
    case 'selection-not-found':
      return '未找到可删除的小节'
    case 'invalid-scope':
      return '当前未选中小节范围'
    case 'unsupported-grouping':
      return '当前拍号下无法生成满小节休止'
    default:
      return '当前操作暂不支持'
  }
}
