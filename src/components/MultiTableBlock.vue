<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import type {
  MultiTableData,
  MultiTableField,
  MultiTableFieldOption,
  MultiTableFieldType,
  MultiTableRecord,
  MultiTableView,
} from '@/api/types'

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

const settingsFieldId = ref('')

const normalized = computed<MultiTableData>(() => {
  const base = props.data && props.data.fields?.length ? props.data : defaultData()
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
  emit('change', next)
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

const deleteRecord = (recordId: string) => {
  const next = clone()
  next.records = next.records.filter((record) => record.id !== recordId)
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
  updateField(fieldId, { name: value })
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
  next.fields = next.fields.filter((field) => field.id !== fieldId)
  next.records.forEach((record) => {
    delete record.values[fieldId]
  })
  const fallbackGroupBy = next.fields.find((field) => field.type === 'singleSelect' || field.type === 'lifecycle')?.id
  next.views.forEach((view) => {
    if (view.groupByFieldId === fieldId) view.groupByFieldId = fallbackGroupBy
  })
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

const setGroupRecords = (groupId: string, records: MultiTableRecord[]) => {
  const field = kanbanField.value
  if (!field) return
  const next = clone()
  const movedIds = new Set(records.map((record) => record.id))
  next.records = [
    ...next.records.filter((record) => !movedIds.has(record.id)),
    ...records.map((record) => ({
      ...record,
      values: { ...record.values, [field.id]: groupId },
    })),
  ]
  commit(next)
}
</script>

<template>
  <section class="multi-table">
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

    <div v-if="activeView.type === 'kanban'" class="multi-table__kanban">
      <section v-for="group in kanbanGroups" :key="group.id" class="kanban-column">
        <header class="kanban-column__header">
          <span :style="{ background: group.color || '#e2e8f0' }"></span>
          {{ group.label }}
          <small>{{ group.records.length }}</small>
        </header>
        <VueDraggable
          :model-value="group.records"
          group="multi-table-kanban"
          item-key="id"
          class="kanban-column__body"
          :disabled="!editable"
          @update:model-value="(records: unknown) => setGroupRecords(group.id, records as MultiTableRecord[])"
        >
          <article v-for="record in group.records" :key="record.id" class="kanban-card">
            <strong>{{ record.values.title || '未命名' }}</strong>
            <p>{{ optionLabel(kanbanField, record.values[kanbanField?.id || '']) }}</p>
          </article>
        </VueDraggable>
      </section>
    </div>

    <div v-else class="multi-table__grid">
      <table>
        <thead>
          <tr>
            <th v-for="field in normalized.fields" :key="field.id">
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
            <th v-if="editable"></th>
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
            <td v-if="editable" class="multi-table__delete">
              <button type="button" @click="deleteRecord(record.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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

.option-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 2px 8px;
  color: #334155;
  font-size: 12px;
}

.multi-table__delete {
  min-width: 72px;
}

.multi-table__kanban {
  display: grid;
  grid-auto-columns: minmax(240px, 1fr);
  grid-auto-flow: column;
  gap: 12px;
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
}

.kanban-column__header span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.kanban-column__header small {
  margin-left: auto;
  color: #64748b;
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
}

.kanban-card p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 12px;
}
</style>
