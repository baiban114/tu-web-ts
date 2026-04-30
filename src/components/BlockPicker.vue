<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElDialog, ElEmpty, ElInput, ElScrollbar } from 'element-plus';
import { useBlockRegistryStore } from '@/stores/blockRegistry';
import type { BlockWithMeta } from '@/api/page';

type BlockFilterType = 'all' | 'text' | 'x6';

const props = withDefaults(defineProps<{
  visible: boolean;
  initialTypeFilter?: BlockFilterType;
}>(), {
  initialTypeFilter: 'all',
});

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
  (e: 'select', blockId: string): void;
}>();

const registryStore = useBlockRegistryStore();
const searchText = ref('');
const typeFilter = ref<BlockFilterType>(props.initialTypeFilter);

const filterOptions: Array<{ key: BlockFilterType; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'x6', label: '默认画板' },
];

const isTextBlock = (item: BlockWithMeta) => {
  return item.block.type === 'richtext' || item.block.type === 'richText';
};

const getTypeLabel = (item: BlockWithMeta) => {
  if (item.block.type === 'x6') return '默认画板';
  if (isTextBlock(item)) return '文本';
  return item.block.type;
};

const matchesTypeFilter = (item: BlockWithMeta) => {
  if (typeFilter.value === 'all') return true;
  if (typeFilter.value === 'text') return isTextBlock(item);
  if (typeFilter.value === 'x6') return item.block.type === 'x6';
  return true;
};

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return;
    searchText.value = '';
    typeFilter.value = props.initialTypeFilter;
    await registryStore.loadAll();
  },
);

const filteredBlocks = computed<BlockWithMeta[]>(() => {
  const keyword = searchText.value.trim().toLowerCase();
  const items = registryStore.getAllBlocks().filter(matchesTypeFilter);

  if (!keyword) return items;

  return items.filter(({ block, pageTitle }) => {
    return (block.content?.toLowerCase().includes(keyword) ?? false)
      || (block.title?.toLowerCase().includes(keyword) ?? false)
      || pageTitle.toLowerCase().includes(keyword)
      || getTypeLabel({ block, pageId: '', pageTitle }).toLowerCase().includes(keyword);
  });
});

function onSelect(item: BlockWithMeta) {
  emit('select', item.block.id);
  emit('update:visible', false);
}

function preview(item: BlockWithMeta): string {
  if (item.block.type === 'x6') {
    return item.block.title?.trim() || '默认画板';
  }

  const content = item.block.content;
  if (!content) return '空内容';

  const plain = content.replace(/[#*`>\-_\[\]]/g, '').trim();
  if (!plain) return '空内容';
  return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain;
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
        placeholder="搜索块内容、标题或页面名"
        clearable
        class="picker-search"
      />

      <div class="picker-filters">
        <button
          v-for="option in filterOptions"
          :key="option.key"
          type="button"
          class="picker-filter"
          :class="{ 'picker-filter--active': typeFilter === option.key }"
          @click="typeFilter = option.key"
        >
          {{ option.label }}
        </button>
      </div>

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
          <div class="picker-item__preview">{{ preview(item) }}</div>
          <div class="picker-item__meta">
            <span class="picker-item__type">{{ getTypeLabel(item) }}</span>
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

.picker-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.picker-filter {
  border: 1px solid #d9d9d9;
  background: #fff;
  color: #595959;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.picker-filter:hover {
  border-color: #91caff;
  color: #1677ff;
}

.picker-filter--active {
  border-color: #1677ff;
  background: #e6f4ff;
  color: #1677ff;
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
