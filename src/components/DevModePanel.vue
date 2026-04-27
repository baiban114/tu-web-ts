<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElButton, ElCard, ElMessage, ElRadioButton, ElRadioGroup, ElTag } from 'element-plus';
import { getDataSource, getDefaultDataSource, setDataSource, type DataSource } from '@/dev/dataSource';
import { resetMockState } from '@/mock/store';
import { useWorkspaceStore } from '@/stores/workspace';

const workspaceStore = useWorkspaceStore();
const switching = ref(false);
const currentSource = ref<DataSource>(getDataSource());
const isDev = import.meta.env.DEV;

const sourceLabel = computed(() => currentSource.value === 'mock' ? 'Mock' : 'Backend');
const sourceTagType = computed(() => currentSource.value === 'mock' ? 'warning' : 'success');

async function applySource(source: DataSource) {
  if (source === currentSource.value) return;

  const previousSource = currentSource.value;
  switching.value = true;
  try {
    setDataSource(source);
    currentSource.value = source;
    await workspaceStore.reloadWorkspace();
    ElMessage.success(`已切换到${source === 'mock' ? '本地 Mock' : '后端'}数据源`);
  } catch (error) {
    setDataSource(previousSource);
    currentSource.value = previousSource;
    ElMessage.error(error instanceof Error ? error.message : '切换数据源失败');
  } finally {
    switching.value = false;
  }
}

async function resetMock() {
  switching.value = true;
  try {
    resetMockState();
    if (currentSource.value === 'mock') {
      await workspaceStore.reloadWorkspace();
    }
    ElMessage.success('本地 Mock 数据已重置');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '重置 Mock 数据失败');
  } finally {
    switching.value = false;
  }
}
</script>

<template>
  <div v-if="isDev" class="dev-mode-panel">
    <el-card shadow="always" class="dev-mode-panel__card">
      <div class="dev-mode-panel__header">
        <span class="dev-mode-panel__title">Developer Mode</span>
        <el-tag size="small" :type="sourceTagType">{{ sourceLabel }}</el-tag>
      </div>

      <div class="dev-mode-panel__body">
        <el-radio-group
          :model-value="currentSource"
          size="small"
          @update:model-value="(value) => applySource(value as DataSource)"
        >
          <el-radio-button label="backend">Backend</el-radio-button>
          <el-radio-button label="mock">Mock</el-radio-button>
        </el-radio-group>

        <div class="dev-mode-panel__actions">
          <el-button size="small" :loading="switching" @click="resetMock">Reset Mock</el-button>
        </div>

        <div class="dev-mode-panel__hint">
          默认来源: {{ getDefaultDataSource() }}
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.dev-mode-panel {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 3000;
}

.dev-mode-panel__card {
  width: 280px;
  border-radius: 14px;
  border: 1px solid rgba(24, 119, 255, 0.18);
  backdrop-filter: blur(14px);
  background: rgba(255, 255, 255, 0.92);
}

.dev-mode-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.dev-mode-panel__title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4b5563;
}

.dev-mode-panel__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dev-mode-panel__actions {
  display: flex;
  justify-content: flex-end;
}

.dev-mode-panel__hint {
  font-size: 12px;
  color: #6b7280;
}
</style>
