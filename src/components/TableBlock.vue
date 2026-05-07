<script setup lang="ts">
import { computed } from 'vue';

export interface TableBlockData {
  headers: string[];
  rows: string[][];
}

const props = withDefaults(defineProps<{
  data?: TableBlockData;
  editable?: boolean;
}>(), {
  editable: true,
});

const emit = defineEmits<{
  (e: 'change', data: TableBlockData): void;
}>();

const normalizedData = computed<TableBlockData>(() => {
  const headers = props.data?.headers?.length ? props.data.headers : ['列 1', '列 2', '列 3'];
  const rows = props.data?.rows?.length ? props.data.rows : [['', '', ''], ['', '', '']];
  return {
    headers,
    rows: rows.map((row) => headers.map((_, index) => row[index] ?? '')),
  };
});

function commit(next: TableBlockData) {
  emit('change', {
    headers: [...next.headers],
    rows: next.rows.map((row) => [...row]),
  });
}

function updateHeader(index: number, value: string) {
  const next = normalizedData.value;
  next.headers[index] = value;
  commit(next);
}

function updateCell(rowIndex: number, columnIndex: number, value: string) {
  const next = normalizedData.value;
  next.rows[rowIndex][columnIndex] = value;
  commit(next);
}

function addRow() {
  const next = normalizedData.value;
  next.rows.push(next.headers.map(() => ''));
  commit(next);
}

function removeRow(rowIndex: number) {
  const next = normalizedData.value;
  if (next.rows.length <= 1) return;
  next.rows.splice(rowIndex, 1);
  commit(next);
}

function addColumn() {
  const next = normalizedData.value;
  next.headers.push(`列 ${next.headers.length + 1}`);
  next.rows.forEach((row) => row.push(''));
  commit(next);
}

function removeColumn(columnIndex: number) {
  const next = normalizedData.value;
  if (next.headers.length <= 1) return;
  next.headers.splice(columnIndex, 1);
  next.rows.forEach((row) => row.splice(columnIndex, 1));
  commit(next);
}
</script>

<template>
  <div class="table-block">
    <div class="table-block__scroll">
      <table>
        <thead>
          <tr>
            <th v-for="(header, columnIndex) in normalizedData.headers" :key="columnIndex">
              <input
                v-if="editable"
                :value="header"
                @input="updateHeader(columnIndex, ($event.target as HTMLInputElement).value)"
              />
              <span v-else>{{ header }}</span>
            </th>
            <th v-if="editable" class="table-block__action-cell"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in normalizedData.rows" :key="rowIndex">
            <td v-for="(cell, columnIndex) in row" :key="columnIndex">
              <textarea
                v-if="editable"
                :value="cell"
                rows="1"
                @input="updateCell(rowIndex, columnIndex, ($event.target as HTMLTextAreaElement).value)"
              />
              <span v-else>{{ cell }}</span>
            </td>
            <td v-if="editable" class="table-block__action-cell">
              <button type="button" :disabled="normalizedData.rows.length <= 1" @click="removeRow(rowIndex)">删除行</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editable" class="table-block__toolbar">
      <button type="button" @click="addRow">添加行</button>
      <button type="button" @click="addColumn">添加列</button>
      <button
        v-for="(_, columnIndex) in normalizedData.headers"
        :key="columnIndex"
        type="button"
        :disabled="normalizedData.headers.length <= 1"
        @click="removeColumn(columnIndex)"
      >
        删除列 {{ columnIndex + 1 }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.table-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.table-block__scroll {
  overflow-x: auto;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  background: #fff;
}

table {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
}

th,
td {
  min-width: 120px;
  border-right: 1px solid #d0d7de;
  border-bottom: 1px solid #d0d7de;
  padding: 0;
  vertical-align: top;
}

th:last-child,
td:last-child {
  border-right: 0;
}

tbody tr:last-child td {
  border-bottom: 0;
}

th {
  background: #f6f8fa;
}

input,
textarea {
  width: 100%;
  min-height: 38px;
  border: 0;
  padding: 9px 10px;
  background: transparent;
  font: inherit;
  line-height: 1.45;
  resize: vertical;
  outline: none;
}

input {
  font-weight: 600;
}

span {
  display: block;
  padding: 9px 10px;
  white-space: pre-wrap;
}

.table-block__action-cell {
  width: 86px;
  min-width: 86px;
  text-align: center;
  background: #fbfcfd;
}

.table-block__action-cell button {
  margin: 6px;
}

.table-block__toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

button {
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
  padding: 6px 10px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  color: #8c959f;
  background: #f6f8fa;
}
</style>
