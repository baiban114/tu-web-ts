<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type {
  MultiTableData,
  MultiTableField,
  MultiTableFieldOption,
  MultiTableFieldType,
  MultiTableRecord,
  MultiTableView,
} from '@/api/types'
import {
  MultiTableColumnController,
  tableContextMenuPosition,
} from './tableCore'

const props = withDefaults(defineProps<{
  data?: MultiTableData
  editable?: boolean
}>(), {
  editable: true,
})

const emit = defineEmits<{
  (e: 'change', data: MultiTableData): void
}>()

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const fieldTypes: Array<{ value: MultiTableFieldType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'singleSelect', label: '枚举' },
  { value: 'checkbox', label: '勾选' },
  { value: 'url', label: 'URL' },
  { value: 'lifecycle', label: '生命周期' },
]

const lifecycleOptions = (): MultiTableFieldOption[] => [
  { id: 'not-started', label: '未开始', color: '#e2e8f0' },
  { id: 'active', label: '进行中', color: '#dbeafe' },
  { id: 'blocked', label: '阻塞', color: '#fee2e2' },
  { id: 'done', label: '已完成', color: '#dcfce7' },
  { id: 'archived', label: '归档', color: '#f1f5f9' },
]

const defaultData = (): MultiTableData => ({
  fields: [
    { id: 'title', name: '标题', type: 'text', required: true },
    {
      id: 'status',
      name: '状态',
      type: 'singleSelect',
      options: [
        { id: 'todo', label: '待处理', color: '#e2e8f0' },
        { id: 'doing', label: '进行中', color: '#dbeafe' },
        { id: 'done', label: '已完成', color: '#dcfce7' },
      ],
    },
    { id: 'owner', name: '负责人', type: 'text' },
    { id: 'dueDate', name: '截止日期', type: 'date' },
  ],
  records: [
    { id: `record-${uid()}`, values: { title: '示例任务', status: 'todo', owner: '', dueDate: '' } },
  ],
  views: [
    { id: 'view-table', name: '表格', type: 'table' },
    { id: 'view-kanban', name: '看板', type: 'kanban', groupByFieldId: 'status' },
  ],
  activeViewId: 'view-table',
})

const fallbackData = ref<MultiTableData>(defaultData())
const settingsFieldId = ref('')
const draggingRecordId = ref('')
const hoveredKanbanGroupId = ref('')
const kanbanMenu = ref({
  visible: false,
  fieldId: '',
  optionId: '',
  x: 0,
  y: 0,
})
const fieldMenu = ref({
  visible: false,
  fieldId: '',
  x: 0,
  y: 0,
})

const normalized = computed<MultiTableData>(() => {
  const base = props.data && props.data.fields?.length ? props.data : fallbackData.value
  return {
    fields: base.fields || [],
    records: base.records || [],
    views: base.views?.length ? base.views : defaultData().views,
    activeViewId: base.activeViewId || base.views?.[0]?.id || 'view-table',
  }
})

const activeView = computed<MultiTableView>(() => {
  return normalized.value.views.find((view) => view.id === normalized.value.activeViewId) || normalized.value.views[0]
})

const selectableFields = computed(() => {
  return normalized.value.fields.filter((field) => field.type === 'singleSelect' || field.type === 'lifecycle')
})

const kanbanField = computed<MultiTableField | undefined>(() => {
  const groupBy = activeView.value?.groupByFieldId || selectableFields.value[0]?.id
  return normalized.value.fields.find((field) => field.id === groupBy)
})

const settingsField = computed(() => {
  return normalized.value.fields.find((field) => field.id === settingsFieldId.value)
})

const clone = (): MultiTableData => JSON.parse(JSON.stringify(normalized.value))

const commit = (next: MultiTableData) => {
  if (!props.data || !props.data.fields?.length) {
    fallbackData.value = next
  }
  emit('change', next)
}

const closeKanbanMenu = () => {
  kanbanMenu.value.visible = false
}

const closeFieldMenu = () => {
  fieldMenu.value.visible = false
}

const closeContextMenus = () => {
  closeKanbanMenu()
  closeFieldMenu()
}

const closeContextMenusOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeContextMenus()
}

const defaultValueForField = (field: Pick<MultiTableField, 'type' | 'options'>) => {
  if (field.type === 'checkbox') return false
  if (field.type === 'singleSelect' || field.type === 'lifecycle') return field.options?.[0]?.id || ''
  return ''
}

const normalizeValueForType = (value: unknown, field: MultiTableField) => {
  if (field.type === 'checkbox') return Boolean(value)
  if (field.type === 'number') return value === '' || value === null || value === undefined ? '' : Number(value)
  if (field.type === 'singleSelect' || field.type === 'lifecycle') {
    const options = field.options || []
    const current = String(value ?? '')
    return options.some((option) => option.id === current) ? current : options[0]?.id || ''
  }
  return String(value ?? '')
}

const setActiveView = (viewId: string) => {
  const next = clone()
  next.activeViewId = viewId
  commit(next)
}

const addRecord = () => {
  const next = clone()
  const values: MultiTableRecord['values'] = {}
  next.fields.forEach((field) => {
    values[field.id] = defaultValueForField(field)
  })
  next.records.push({ id: `record-${uid()}`, values })
  commit(next)
}

const addFieldByType = (type: MultiTableFieldType, name?: string) => {
  const next = clone()
  const id = `field-${uid()}`
  const field: MultiTableField = { id, name: name || `字段 ${next.fields.length + 1}`, type }
  if (type === 'singleSelect') {
    field.options = [
      { id: `option-${uid()}`, label: '选项 1', color: '#e2e8f0' },
      { id: `option-${uid()}`, label: '选项 2', color: '#dbeafe' },
    ]
  }
  if (type === 'lifecycle') {
    field.options = lifecycleOptions()
    field.lifecyclePreset = true
  }
  next.fields.push(field)
  next.records.forEach((record) => {
    record.values[id] = defaultValueForField(field)
  })
  settingsFieldId.value = id
  commit(next)
}

const addField = () => addFieldByType('text')

const updateField = (fieldId: string, patch: Partial<MultiTableField>) => {
  const next = clone()
  const field = next.fields.find((item) => item.id === fieldId)
  if (!field) return
  Object.assign(field, patch)
  commit(next)
}

const updateFieldName = (fieldId: string, value: string) => {
  const next = clone()
  new MultiTableColumnController(next, {
    createFieldId: () => `field-${uid()}`,
    defaultValueForField,
  }).renameColumn(fieldId, value)
  commit(next)
}

const updateFieldType = (fieldId: string, type: MultiTableFieldType) => {
  const next = clone()
  const field = next.fields.find((item) => item.id === fieldId)
  if (!field) return
  field.type = type
  if (type === 'singleSelect' && !field.options?.length) {
    field.options = [{ id: `option-${uid()}`, label: '选项 1', color: '#e2e8f0' }]
  } else if (type === 'lifecycle') {
    field.options = field.options?.length ? field.options : lifecycleOptions()
    field.lifecyclePreset = true
  } else {
    delete field.lifecyclePreset
    delete field.options
  }
  next.records.forEach((record) => {
    record.values[field.id] = normalizeValueForType(record.values[field.id], field)
  })
  next.views.forEach((view) => {
    if (view.type === 'kanban' && view.groupByFieldId === field.id && !['singleSelect', 'lifecycle'].includes(type)) {
      view.groupByFieldId = next.fields.find((item) => item.type === 'singleSelect' || item.type === 'lifecycle')?.id
    }
  })
  commit(next)
}

const deleteField = (fieldId: string) => {
  const next = clone()
  const controller = new MultiTableColumnController(next, {
    createFieldId: () => `field-${uid()}`,
    defaultValueForField,
  })
  const index = controller.getColumnIndex(fieldId)
  if (index < 0) return
  controller.deleteColumnAt(index)
  if (settingsFieldId.value === fieldId) settingsFieldId.value = ''
  commit(next)
}

const updateCell = (recordId: string, fieldId: string, value: string | number | boolean | null) => {
  const next = clone()
  const record = next.records.find((item) => item.id === recordId)
  if (record) record.values[fieldId] = value
  commit(next)
}

const addOption = (fieldId: string) => {
  const next = clone()
  const field = next.fields.find((item) => item.id === fieldId)
  if (!field) return
  field.options = field.options || []
  field.options.push({ id: `option-${uid()}`, label: `选项 ${field.options.length + 1}`, color: '#e2e8f0' })
  commit(next)
}

const updateOption = (fieldId: string, optionId: string, patch: Partial<MultiTableFieldOption>) => {
  const next = clone()
  const field = next.fields.find((item) => item.id === fieldId)
  const option = field?.options?.find((item) => item.id === optionId)
  if (!option) return
  Object.assign(option, patch)
  commit(next)
}

const deleteOption = (fieldId: string, optionId: string) => {
  const next = clone()
  const field = next.fields.find((item) => item.id === fieldId)
  if (!field?.options) return
  field.options = field.options.filter((option) => option.id !== optionId)
  next.records.forEach((record) => {
    if (record.values[fieldId] === optionId) record.values[fieldId] = field.options?.[0]?.id || ''
  })
  commit(next)
}

const openFieldMenu = (event: MouseEvent, fieldId: string) => {
  if (!props.editable) return
  event.preventDefault()
  event.stopPropagation()
  closeKanbanMenu()
  fieldMenu.value = {
    visible: true,
    fieldId,
    ...tableContextMenuPosition(event),
  }
}

const openKanbanColumnMenu = (event: MouseEvent, groupId: string) => {
  if (!props.editable || !kanbanField.value) return
  event.preventDefault()
  event.stopPropagation()
  closeFieldMenu()
  kanbanMenu.value = {
    visible: true,
    fieldId: kanbanField.value.id,
    optionId: groupId,
    ...tableContextMenuPosition(event),
  }
}

const onMultiTableContextMenu = (event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const fieldHeader = target.closest<HTMLElement>('[data-field-id]')
  if (fieldHeader?.dataset.fieldId) {
    openFieldMenu(event, fieldHeader.dataset.fieldId)
    return
  }
  const kanbanColumn = target.closest<HTMLElement>('[data-kanban-group-id]')
  if (kanbanColumn?.dataset.kanbanGroupId) {
    openKanbanColumnMenu(event, kanbanColumn.dataset.kanbanGroupId)
  }
}

const selectedField = computed(() => {
  return normalized.value.fields.find((field) => field.id === fieldMenu.value.fieldId)
})

const configureSelectedField = () => {
  if (!selectedField.value) return
  settingsFieldId.value = selectedField.value.id
  closeFieldMenu()
}

const renameSelectedField = () => {
  const field = selectedField.value
  if (!field) return
  const nextName = window.prompt('字段名称', field.name)?.trim()
  if (!nextName) return
  updateFieldName(field.id, nextName)
  closeFieldMenu()
}

const insertFieldByMenu = (position: 'before' | 'after') => {
  const field = selectedField.value
  if (!field) return
  const next = clone()
  const controller = new MultiTableColumnController(next, {
    createFieldId: () => `field-${uid()}`,
    defaultValueForField,
  })
  const index = controller.getColumnIndex(field.id)
  if (index < 0) return
  const inserted = controller.insertColumnAt(position === 'before' ? index : index + 1)
  settingsFieldId.value = inserted.id
  commit(next)
  closeFieldMenu()
}

const deleteSelectedField = () => {
  const field = selectedField.value
  if (!field) return
  if (!window.confirm(`删除字段「${field.name}」？该字段下的数据会一并删除。`)) return
  deleteField(field.id)
  closeFieldMenu()
}

const selectedKanbanOption = computed(() => {
  const field = normalized.value.fields.find((item) => item.id === kanbanMenu.value.fieldId)
  return field?.options?.find((option) => option.id === kanbanMenu.value.optionId)
})

const renameKanbanGroup = () => {
  const fieldId = kanbanMenu.value.fieldId
  const option = selectedKanbanOption.value
  if (!fieldId || !option) return
  const nextLabel = window.prompt('分组名称', option.label)?.trim()
  if (!nextLabel) return
  updateOption(fieldId, option.id, { label: nextLabel })
  closeKanbanMenu()
}

const setKanbanGroupColor = (color: string) => {
  const fieldId = kanbanMenu.value.fieldId
  const option = selectedKanbanOption.value
  if (!fieldId || !option) return
  updateOption(fieldId, option.id, { color })
  closeKanbanMenu()
}

const moveKanbanGroup = (direction: -1 | 1) => {
  const next = clone()
  const field = next.fields.find((item) => item.id === kanbanMenu.value.fieldId)
  const options = field?.options
  if (!options) return
  const index = options.findIndex((option) => option.id === kanbanMenu.value.optionId)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= options.length) return
  const [option] = options.splice(index, 1)
  options.splice(nextIndex, 0, option)
  commit(next)
  closeKanbanMenu()
}

const addKanbanGroupAfter = () => {
  const next = clone()
  const field = next.fields.find((item) => item.id === kanbanMenu.value.fieldId)
  if (!field) return
  field.options = field.options || []
  const index = field.options.findIndex((option) => option.id === kanbanMenu.value.optionId)
  const option = { id: `option-${uid()}`, label: `分组 ${field.options.length + 1}`, color: '#e2e8f0' }
  field.options.splice(index >= 0 ? index + 1 : field.options.length, 0, option)
  commit(next)
  closeKanbanMenu()
}

const deleteKanbanGroup = () => {
  const fieldId = kanbanMenu.value.fieldId
  const optionId = kanbanMenu.value.optionId
  const field = normalized.value.fields.find((item) => item.id === fieldId)
  if (!field?.options || field.options.length <= 1) return
  const option = field.options.find((item) => item.id === optionId)
  if (!option) return
  if (!window.confirm(`删除分组「${option.label}」？该列任务会移动到剩余第一个分组。`)) return
  deleteOption(fieldId, optionId)
  closeKanbanMenu()
}

const optionLabel = (field: MultiTableField | undefined, value: unknown) => {
  if (!field) return String(value || '未分组')
  return field.options?.find((option) => option.id === value)?.label || String(value || '未分组')
}

const optionColor = (field: MultiTableField | undefined, value: unknown) => {
  return field?.options?.find((option) => option.id === value)?.color || '#e2e8f0'
}

const displayValue = (field: MultiTableField, value: unknown) => {
  if (field.type === 'checkbox') return value ? '是' : '否'
  if (field.type === 'singleSelect' || field.type === 'lifecycle') return optionLabel(field, value)
  return String(value ?? '')
}

const kanbanGroups = computed(() => {
  const field = kanbanField.value
  const options = field?.options?.length ? field.options : [{ id: '', label: '未分组' }]
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    color: option.color,
    records: normalized.value.records.filter((record) => String(record.values[field?.id || ''] || '') === option.id),
  }))
})

const moveRecordToGroup = (recordId: string, groupId: string) => {
  const field = kanbanField.value
  if (!field) return
  const next = clone()
  const record = next.records.find((item) => item.id === recordId)
  if (!record) return
  record.values[field.id] = groupId
  commit(next)
}

const startKanbanMouseDrag = (event: MouseEvent | PointerEvent, recordId: string) => {
  if (event.button !== 0) return
  draggingRecordId.value = recordId
  window.addEventListener('mousemove', trackKanbanMouseDrag, true)
  window.addEventListener('mouseup', finishKanbanMouseDrag, true)
  window.addEventListener('pointermove', trackKanbanMouseDrag, true)
  window.addEventListener('pointerup', finishKanbanMouseDrag, true)
}

const startKanbanBoardMouseDrag = (event: MouseEvent | PointerEvent) => {
  if (event.button !== 0) return
  const target = event.target
  if (!(target instanceof Element)) return
  const card = target.closest<HTMLElement>('.kanban-card[data-record-id]')
  const recordId = card?.dataset.recordId
  if (!recordId) return
  startKanbanMouseDrag(event, recordId)
}

const startKanbanNativeDrag = (event: DragEvent, recordId: string) => {
  event.stopPropagation()
  draggingRecordId.value = recordId
  event.dataTransfer?.setData('text/plain', recordId)
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  if (event.currentTarget instanceof HTMLElement) {
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetX = Math.max(0, event.clientX - rect.left)
    const offsetY = Math.max(0, event.clientY - rect.top)
    event.dataTransfer.setDragImage(event.currentTarget, offsetX, offsetY)
  }
}

const finishKanbanNativeDrag = (event: DragEvent) => {
  event.stopPropagation()
  const recordId = draggingRecordId.value
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const groupId = target instanceof Element
    ? target.closest<HTMLElement>('[data-kanban-group-id]')?.dataset.kanbanGroupId ?? hoveredKanbanGroupId.value
    : hoveredKanbanGroupId.value
  draggingRecordId.value = ''
  hoveredKanbanGroupId.value = ''
  if (!recordId || !groupId) return
  moveRecordToGroup(recordId, groupId)
}

const preventKanbanNativeDrag = (event: DragEvent) => {
  if (event.target instanceof Element && event.target.closest('.kanban-card[data-record-id]')) return
  event.preventDefault()
  event.stopPropagation()
}

const trackKanbanDragTarget = (groupId: string) => {
  if (!draggingRecordId.value) return
  hoveredKanbanGroupId.value = groupId
}

const trackKanbanMouseDrag = (event: MouseEvent | PointerEvent) => {
  if (!draggingRecordId.value) return
  const columns = Array.from(document.querySelectorAll<HTMLElement>('.kanban-column[data-kanban-group-id]'))
  const hoveredColumn = columns.find((column) => {
    const rect = column.getBoundingClientRect()
    return event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom
  })
  const nearestColumn = hoveredColumn ?? columns
    .map((column) => {
      const rect = column.getBoundingClientRect()
      return {
        column,
        distance: Math.abs(event.clientX - (rect.left + rect.width / 2)),
      }
    })
    .sort((a, b) => a.distance - b.distance)[0]?.column
  const groupId = nearestColumn?.dataset.kanbanGroupId
  if (groupId == null) return
  hoveredKanbanGroupId.value = groupId
  const field = kanbanField.value
  const record = normalized.value.records.find((item) => item.id === draggingRecordId.value)
  if (field && record && String(record.values[field.id] || '') !== groupId) {
    moveRecordToGroup(record.id, groupId)
  }
}

const allowKanbanNativeDragOver = (event: DragEvent, groupId: string) => {
  event.preventDefault()
  trackKanbanDragTarget(groupId)
}

const dropKanbanNativeCard = (event: DragEvent, groupId: string) => {
  event.preventDefault()
  event.stopPropagation()
  const recordId = event.dataTransfer?.getData('text/plain') || draggingRecordId.value
  draggingRecordId.value = ''
  hoveredKanbanGroupId.value = ''
  if (!recordId) return
  moveRecordToGroup(recordId, groupId)
}

const finishKanbanMouseDrag = (event: MouseEvent | PointerEvent) => {
  trackKanbanMouseDrag(event)
  const recordId = draggingRecordId.value
  draggingRecordId.value = ''
  window.removeEventListener('mousemove', trackKanbanMouseDrag, true)
  window.removeEventListener('mouseup', finishKanbanMouseDrag, true)
  window.removeEventListener('pointermove', trackKanbanMouseDrag, true)
  window.removeEventListener('pointerup', finishKanbanMouseDrag, true)
  if (!recordId) return
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const groupId = target instanceof Element
    ? target.closest<HTMLElement>('[data-kanban-group-id]')?.dataset.kanbanGroupId
    : undefined
  const targetGroupId = groupId ?? hoveredKanbanGroupId.value
  hoveredKanbanGroupId.value = ''
  if (targetGroupId == null) return
  moveRecordToGroup(recordId, targetGroupId)
}

const hasContextMenu = computed(() => kanbanMenu.value.visible || fieldMenu.value.visible)

watch(() => hasContextMenu.value, (visible) => {
  if (visible) {
    window.addEventListener('click', closeContextMenus)
    window.addEventListener('keydown', closeContextMenusOnEscape)
  } else {
    window.removeEventListener('click', closeContextMenus)
    window.removeEventListener('keydown', closeContextMenusOnEscape)
  }
})

watch(() => draggingRecordId.value, (recordId) => {
  if (recordId) {
    window.addEventListener('mousemove', trackKanbanMouseDrag, true)
    window.addEventListener('mouseup', finishKanbanMouseDrag, true)
    window.addEventListener('pointermove', trackKanbanMouseDrag, true)
    window.addEventListener('pointerup', finishKanbanMouseDrag, true)
  } else {
    window.removeEventListener('mousemove', trackKanbanMouseDrag, true)
    window.removeEventListener('mouseup', finishKanbanMouseDrag, true)
    window.removeEventListener('pointermove', trackKanbanMouseDrag, true)
    window.removeEventListener('pointerup', finishKanbanMouseDrag, true)
    hoveredKanbanGroupId.value = ''
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenus)
  window.removeEventListener('keydown', closeContextMenusOnEscape)
  window.removeEventListener('mousemove', trackKanbanMouseDrag, true)
  window.removeEventListener('mouseup', finishKanbanMouseDrag, true)
  window.removeEventListener('pointermove', trackKanbanMouseDrag, true)
  window.removeEventListener('pointerup', finishKanbanMouseDrag, true)
})
</script>

<template>
  <section class="multi-table" @contextmenu.capture="onMultiTableContextMenu">
    <header class="multi-table__toolbar">
      <div class="multi-table__views">
        <button
          v-for="view in normalized.views"
          :key="view.id"
          type="button"
          :class="{ 'multi-table__view--active': view.id === activeView.id }"
          @click="setActiveView(view.id)"
        >
          {{ view.name }}
        </button>
      </div>
      <div class="multi-table__actions" v-if="editable">
        <button type="button" @click="addField">字段</button>
        <button type="button" @click="addFieldByType('url', '链接')">URL字段</button>
        <button type="button" @click="addFieldByType('lifecycle', '生命周期')">生命周期</button>
        <button type="button" @click="addRecord">记录</button>
      </div>
    </header>

    <section v-if="editable && settingsField" class="field-settings">
      <div class="field-settings__main">
        <label>
          字段名
          <input
            :value="settingsField.name"
            @input="updateFieldName(settingsField.id, ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label>
          类型
          <select
            :value="settingsField.type"
            @change="updateFieldType(settingsField.id, ($event.target as HTMLSelectElement).value as MultiTableFieldType)"
          >
            <option v-for="type in fieldTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
          </select>
        </label>
        <label class="field-settings__check">
          <input
            type="checkbox"
            :checked="Boolean(settingsField.required)"
            @change="updateField(settingsField.id, { required: ($event.target as HTMLInputElement).checked })"
          />
          必填
        </label>
        <button type="button" class="field-settings__danger" @click="deleteField(settingsField.id)">删除字段</button>
      </div>

      <div v-if="settingsField.type === 'singleSelect' || settingsField.type === 'lifecycle'" class="field-options">
        <div class="field-options__head">
          <span>枚举选项</span>
          <button type="button" @click="addOption(settingsField.id)">新增选项</button>
        </div>
        <div v-for="option in settingsField.options || []" :key="option.id" class="field-option">
          <input
            type="color"
            :value="option.color || '#e2e8f0'"
            @input="updateOption(settingsField!.id, option.id, { color: ($event.target as HTMLInputElement).value })"
          />
          <input
            :value="option.label"
            @input="updateOption(settingsField!.id, option.id, { label: ($event.target as HTMLInputElement).value })"
          />
          <button type="button" @click="deleteOption(settingsField!.id, option.id)">删除</button>
        </div>
      </div>
    </section>

    <div
      v-if="activeView.type === 'kanban'"
      class="multi-table__kanban"
      @pointerdown.capture="startKanbanBoardMouseDrag"
      @mousedown.capture="startKanbanBoardMouseDrag"
      @dragstart.capture="preventKanbanNativeDrag"
    >
      <section
        v-for="group in kanbanGroups"
        :key="group.id"
        class="kanban-column"
        :data-kanban-group-id="group.id"
        @dragenter="allowKanbanNativeDragOver($event, group.id)"
        @dragover="allowKanbanNativeDragOver($event, group.id)"
        @drop.capture="dropKanbanNativeCard($event, group.id)"
        @mouseenter="trackKanbanDragTarget(group.id)"
        @mousemove="trackKanbanDragTarget(group.id)"
      >
        <header
          class="kanban-column__header"
          :data-kanban-group-id="group.id"
          @contextmenu.prevent.stop="openKanbanColumnMenu($event, group.id)"
        >
          <span class="kanban-column__swatch" :style="{ background: group.color || '#e2e8f0' }"></span>
          <strong>{{ group.label }}</strong>
          <small>{{ group.records.length }}</small>
          <button
            v-if="editable"
            type="button"
            class="kanban-column__menu-button"
            title="列操作"
            @click.prevent.stop="openKanbanColumnMenu($event, group.id)"
          >
            ⋯
          </button>
        </header>
        <div
          class="kanban-column__body"
          :data-kanban-group-id="group.id"
          @dragenter="allowKanbanNativeDragOver($event, group.id)"
          @dragover="allowKanbanNativeDragOver($event, group.id)"
          @drop.capture="dropKanbanNativeCard($event, group.id)"
          @mouseenter="trackKanbanDragTarget(group.id)"
          @mousemove="trackKanbanDragTarget(group.id)"
        >
          <article
            v-for="record in group.records"
            :key="record.id"
            class="kanban-card"
            :class="{ 'kanban-card--dragging': draggingRecordId === record.id }"
            :data-record-id="record.id"
            draggable="true"
            @dragstart.capture="startKanbanNativeDrag($event, record.id)"
            @dragend.capture="finishKanbanNativeDrag($event)"
            @pointerdown.capture="startKanbanMouseDrag($event, record.id)"
            @mousedown.capture="startKanbanMouseDrag($event, record.id)"
          >
            <strong>{{ record.values.title || '未命名' }}</strong>
            <p>{{ optionLabel(kanbanField, record.values[kanbanField?.id || '']) }}</p>
          </article>
        </div>
      </section>
    </div>

    <div v-else class="multi-table__grid">
      <table>
        <thead>
          <tr>
            <th
              v-for="field in normalized.fields"
              :key="field.id"
              :data-field-id="field.id"
              @contextmenu.prevent.stop="openFieldMenu($event, field.id)"
            >
              <div class="field-header">
                <input
                  v-if="editable"
                  :value="field.name"
                  @change="updateFieldName(field.id, ($event.target as HTMLInputElement).value)"
                />
                <span v-else>{{ field.name }}</span>
                <button v-if="editable" type="button" title="字段设置" @click="settingsFieldId = field.id">设置</button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in normalized.records" :key="record.id">
            <td v-for="field in normalized.fields" :key="field.id">
              <select
                v-if="editable && (field.type === 'singleSelect' || field.type === 'lifecycle')"
                :value="String(record.values[field.id] || '')"
                @change="updateCell(record.id, field.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in field.options || []" :key="option.id" :value="option.id">{{ option.label }}</option>
              </select>
              <input
                v-else-if="editable && field.type === 'checkbox'"
                type="checkbox"
                :checked="Boolean(record.values[field.id])"
                @change="updateCell(record.id, field.id, ($event.target as HTMLInputElement).checked)"
              />
              <input
                v-else-if="editable"
                :type="field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'"
                :value="String(record.values[field.id] ?? '')"
                @input="updateCell(record.id, field.id, field.type === 'number' ? Number(($event.target as HTMLInputElement).value) : ($event.target as HTMLInputElement).value)"
              />
              <a
                v-else-if="field.type === 'url' && record.values[field.id]"
                :href="String(record.values[field.id])"
                target="_blank"
                rel="noreferrer"
              >
                {{ record.values[field.id] }}
              </a>
              <span
                v-else-if="field.type === 'singleSelect' || field.type === 'lifecycle'"
                class="option-badge"
                :style="{ background: optionColor(field, record.values[field.id]) }"
              >
                {{ optionLabel(field, record.values[field.id]) }}
              </span>
              <span v-else>{{ displayValue(field, record.values[field.id]) }}</span>
            </td>
          </tr>
          <tr v-if="editable" class="multi-table__add-row">
            <td :colspan="Math.max(1, normalized.fields.length)">
              <button type="button" @click="addRecord">+ 新增一行</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div
        v-if="fieldMenu.visible"
        class="multi-table-menu"
        :style="{ left: `${fieldMenu.x}px`, top: `${fieldMenu.y}px` }"
        @mousedown.stop
        @click.stop
        @contextmenu.prevent.stop
      >
        <button type="button" @click="configureSelectedField">字段设置</button>
        <button type="button" @click="renameSelectedField">重命名字段</button>
        <button type="button" @click="insertFieldByMenu('before')">在左侧新增列</button>
        <button type="button" @click="insertFieldByMenu('after')">在右侧新增列</button>
        <button type="button" class="multi-table-menu__danger" @click="deleteSelectedField">删除字段</button>
      </div>

      <div
        v-if="kanbanMenu.visible"
        class="multi-table-menu"
        :style="{ left: `${kanbanMenu.x}px`, top: `${kanbanMenu.y}px` }"
        @mousedown.stop
        @click.stop
        @contextmenu.prevent.stop
      >
        <button type="button" @click="renameKanbanGroup">重命名分组</button>
        <button type="button" @click="addKanbanGroupAfter">在右侧新增分组</button>
        <button type="button" @click="moveKanbanGroup(-1)">左移</button>
        <button type="button" @click="moveKanbanGroup(1)">右移</button>
        <div class="multi-table-menu__colors">
          <span>颜色</span>
          <button
            v-for="color in ['#e2e8f0', '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#ede9fe']"
            :key="color"
            type="button"
            :style="{ background: color }"
            @click="setKanbanGroupColor(color)"
          />
        </div>
        <button type="button" class="multi-table-menu__danger" @click="deleteKanbanGroup">删除分组</button>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.multi-table {
  overflow: hidden;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #fff;
}

.multi-table__toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.multi-table__views,
.multi-table__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 5px 9px;
  background: #fff;
  color: #334155;
  cursor: pointer;
}

.multi-table__view--active {
  border-color: #1677ff;
  color: #1677ff;
  background: #eff6ff;
}

.field-settings {
  display: grid;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid #e2e8f0;
  background: #fbfdff;
}

.field-settings__main,
.field-options__head,
.field-option {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
}

.field-settings label {
  display: grid;
  gap: 4px;
  min-width: 140px;
  color: #475569;
  font-size: 12px;
}

.field-settings__check {
  display: flex !important;
  flex-direction: row;
  align-items: center;
  min-width: auto !important;
  padding-bottom: 6px;
}

.field-settings__check input {
  width: auto;
}

.field-settings__danger {
  border-color: #fecaca;
  color: #b91c1c;
}

.field-options {
  display: grid;
  gap: 8px;
}

.field-options__head {
  justify-content: space-between;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.field-option input[type='color'] {
  width: 42px;
  height: 30px;
  padding: 2px;
}

.field-option input:not([type='color']) {
  max-width: 220px;
}

.multi-table__grid {
  overflow: auto;
  max-height: 520px;
}

table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}

th,
td {
  min-width: 150px;
  border-right: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  padding: 8px;
  text-align: left;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8fafc;
}

.field-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.field-header button {
  flex: none;
  padding: 4px 7px;
  font-size: 12px;
}

input,
select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 5px 6px;
  font: inherit;
  background: transparent;
}

input:focus,
select:focus {
  border-color: #1677ff;
  outline: none;
  background: #fff;
}

td input[type='checkbox'] {
  width: auto;
}

.multi-table__add-row td {
  padding: 0;
  background: #f8fafc;
}

.multi-table__add-row button {
  width: 100%;
  border: 0;
  border-radius: 0;
  padding: 10px 12px;
  color: #64748b;
  text-align: left;
  background: transparent;
}

.multi-table__add-row button:hover {
  color: #1677ff;
  background: #eff6ff;
}

.option-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 2px 8px;
  color: #334155;
  font-size: 12px;
}

.multi-table__kanban {
  display: grid;
  grid-auto-columns: minmax(240px, 1fr);
  grid-auto-flow: column;
  gap: 12px;
  position: relative;
  overflow-x: auto;
  padding: 12px;
}

.kanban-column {
  display: flex;
  flex-direction: column;
  min-height: 280px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.kanban-column__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  font-weight: 700;
  user-select: none;
}

.kanban-column__swatch {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 999px;
}

.kanban-column__header small {
  margin-left: auto;
  color: #64748b;
}

.kanban-column__menu-button {
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
}

.kanban-column__menu-button:hover {
  border-color: #cbd5e1;
  background: #fff;
}

.kanban-column__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 10px;
}

.kanban-card {
  border: 1px solid #d8dee8;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  cursor: grab;
  user-select: none;
}

.kanban-card--dragging {
  cursor: grabbing;
  opacity: 0.65;
}

.kanban-card p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 12px;
}

.multi-table-menu {
  position: fixed;
  z-index: 1000;
  display: grid;
  min-width: 168px;
  gap: 4px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  padding: 6px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}

.multi-table-menu button {
  width: 100%;
  border-color: transparent;
  text-align: left;
  background: transparent;
}

.multi-table-menu button:hover {
  background: #f1f5f9;
}

.multi-table-menu__colors {
  display: grid;
  grid-template-columns: repeat(6, 22px);
  gap: 6px;
  padding: 6px 4px;
}

.multi-table-menu__colors span {
  grid-column: 1 / -1;
  color: #64748b;
  font-size: 12px;
}

.multi-table-menu__colors button {
  width: 22px;
  height: 22px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 0;
}

.multi-table-menu .multi-table-menu__danger {
  color: #b91c1c;
}
</style>
