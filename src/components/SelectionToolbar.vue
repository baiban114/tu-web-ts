<script setup lang="ts">
interface Props {
  visible: boolean
  top: number
  left: number
  zIndex?: number
  canMarkResourceExcerpt?: boolean
  canMarkHeadingSource?: boolean
  canClearHeadingSource?: boolean
}

withDefaults(defineProps<Props>(), {
  zIndex: 20,
  canMarkResourceExcerpt: true,
  canMarkHeadingSource: false,
  canClearHeadingSource: false,
})

const emit = defineEmits<{
  (e: 'add-note'): void
  (e: 'mark-resource-excerpt'): void
  (e: 'mark-heading-source'): void
  (e: 'clear-heading-source'): void
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="selection-toolbar"
      :style="{ top: `${top}px`, left: `${left}px`, zIndex }"
      @mousedown.prevent.stop
      @click.stop
    >
      <button
        type="button"
        class="selection-toolbar__btn"
        @mousedown.prevent.stop
        @click="emit('add-note')"
      >
        添加笔记
      </button>
      <button
        v-if="canMarkHeadingSource"
        type="button"
        class="selection-toolbar__btn selection-toolbar__btn--source"
        @mousedown.prevent.stop
        @click="emit('mark-heading-source')"
      >
        标记来源
      </button>
      <button
        v-if="canClearHeadingSource"
        type="button"
        class="selection-toolbar__btn selection-toolbar__btn--clear"
        @mousedown.prevent.stop
        @click="emit('clear-heading-source')"
      >
        解除来源
      </button>
      <button
        v-if="canMarkResourceExcerpt"
        type="button"
        class="selection-toolbar__btn selection-toolbar__btn--resource"
        @mousedown.prevent.stop
        @click="emit('mark-resource-excerpt')"
      >
        标记节选
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.selection-toolbar {
  position: fixed;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  pointer-events: none;
}

.selection-toolbar__btn {
  pointer-events: auto;
  padding: 6px 14px;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  background: #fff;
  color: #24292f;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(31, 35, 40, 0.14);
  white-space: nowrap;
  transition: background 0.15s;
}

.selection-toolbar__btn:hover {
  background: #f3f4f6;
}

.selection-toolbar__btn--resource {
  border-color: #bfdbfe;
  color: #075985;
}

.selection-toolbar__btn--resource:hover {
  background: #eff6ff;
}

.selection-toolbar__btn--source {
  border-color: #bbf7d0;
  color: #166534;
}

.selection-toolbar__btn--source:hover {
  background: #f0fdf4;
}

.selection-toolbar__btn--clear {
  border-color: #fecaca;
  color: #991b1b;
}

.selection-toolbar__btn--clear:hover {
  background: #fef2f2;
}
</style>
