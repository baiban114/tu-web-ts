<script setup lang="ts">
interface Props {
  visible: boolean
  top: number
  left: number
  zIndex?: number
  canMarkResourceExcerpt?: boolean
}

withDefaults(defineProps<Props>(), {
  zIndex: 20,
  canMarkResourceExcerpt: true,
})

const emit = defineEmits<{
  (e: 'add-note'): void
  (e: 'mark-resource-excerpt'): void
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
</style>
