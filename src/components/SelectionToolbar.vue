<script setup lang="ts">
interface Props {
  visible: boolean;
  top: number;
  left: number;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: 'add-note'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="selection-toolbar"
      :style="{ top: `${top}px`, left: `${left}px` }"
      @mousedown.stop
      @click.stop
    >
      <button type="button" class="selection-toolbar__btn" @click="emit('add-note')">
        添加笔记
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.selection-toolbar {
  position: fixed;
  z-index: 1000002;
  transform: translateX(-50%);
  margin-top: 6px;
}

.selection-toolbar__btn {
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
