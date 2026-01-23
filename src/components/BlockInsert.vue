<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  (e: 'click'): void;
}>();

const handleClick = () => {
  emit('click');
};
</script>

<template>
  <div class="block-insert">
    <div 
      class="insert-button"
      @click="handleClick"
      title="插入新块"
    >
      +
    </div>
  </div>
</template>

<style scoped>
.block-insert {
  position: relative;
  height: 24px;
  margin: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.insert-button {
  position: relative;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: #1890ff;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.3);
  opacity: 1;
  z-index: 2;
  pointer-events: auto;
}

.insert-button:hover {
  background-color: #40a9ff;
  transform: translateY(-50%) scale(1.1);
  box-shadow: 0 4px 12px rgba(24, 144, 255, 0.4);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-50%) scale(0.8);
  }
  to {
    opacity: 1;
    transform: translateY(-50%) scale(1);
  }
}
</style>