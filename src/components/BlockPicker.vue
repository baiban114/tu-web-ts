<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ElDialog, ElInput, ElScrollbar, ElEmpty } from 'element-plus';
import { useBlockRegistryStore } from '@/stores/blockRegistry';
import type { BlockWithMeta } from '@/api/page';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
  (e: 'select', blockId: string): void;
}>();

const registryStore = useBlockRegistryStore();
const searchText = ref('');

// 打开时拉取全量 block
watch(
  () => props.visible,
  async (val) => {
    if (val) {
      searchText.value = '';
      await registryStore.loadAll();
    }
  },
);

const filteredBlocks = computed<BlockWithMeta[]>(() => {
  const q = searchText.value.trim().toLowerCase();
  const all = registryStore.getAllBlocks();
  if (!q) return all;
  return all.filter(
    ({ block, pageTitle }) =>
      block.content?.toLowerCase().includes(q) ||
      pageTitle.toLowerCase().includes(q),
  );
});

function onSelect(item: BlockWithMeta) {
  emit('select', item.block.id);
  emit('update:visible', false);
}

/** 截取 block 内容用于预览（去掉 markdown 符号，最多 80 字符） */
function preview(block: any): string {
  if (block.type === 'x6') {
    return '📋 默认画板';
  }
  const content = block.content;
  if (!content) return '（空内容）';
  const plain = content.replace(/[#*`>\-_\[\]]/g, '').trim();
  return plain.length > 80 ? plain.slice(0, 80) + '…' : plain || '（空内容）';
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="选择引用块"
    width="520px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="picker-body">
      <el-input
        v-model="searchText"
        placeholder="搜索块内容或页面名称…"
        clearable
        class="picker-search"
      />

      <el-scrollbar height="340px" class="picker-list-wrap">
        <div v-if="filteredBlocks.length === 0" class="picker-empty">
          <el-empty description="没有找到可引用的块" :image-size="60" />
        </div>

        <div
          v-for="item in filteredBlocks"
          :key="item.block.id"
          class="picker-item"
          @click="onSelect(item)"
        >
          <div class="picker-item__preview">{{ preview(item.block) }}</div>
          <div class="picker-item__meta">
            <span class="picker-item__type">{{ item.block.type === 'x6' ? '默认画板' : item.block.type }}</span>
            <span class="picker-item__page">来自：{{ item.pageTitle }}</span>
          </div>
        </div>
      </el-scrollbar>
    </div>
  </el-dialog>
</template>

<style scoped>
.picker-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.picker-search {
  width: 100%;
}

.picker-list-wrap {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
}

.picker-empty {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}

.picker-item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
  transition: background 0.12s;
}

.picker-item:last-child {
  border-bottom: none;
}

.picker-item:hover {
  background: #f0f7ff;
}

.picker-item__preview {
  font-size: 13px;
  color: #333;
  line-height: 1.5;
  margin-bottom: 4px;
  word-break: break-all;
}

.picker-item__meta {
  display: flex;
  gap: 10px;
  align-items: center;
}

.picker-item__type {
  font-size: 11px;
  color: #fff;
  background: #1677ff;
  padding: 1px 6px;
  border-radius: 8px;
}

.picker-item__page {
  font-size: 11px;
  color: #999;
}
</style>
