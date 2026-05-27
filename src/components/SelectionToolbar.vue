<script setup lang="ts">
interface Props {
  visible: boolean
  top: number
  left: number
  zIndex?: number
}

withDefaults(defineProps<Props>(), {
  zIndex: 20,
})

const emit = defineEmits<{
  (e: 'add-note'): void
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
    </div>
  </Teleport>
</template>

<style scoped>
.selection-toolbar {
  position: fixed;
  transform: translateX(-50%);
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
</style>
