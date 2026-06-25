<script setup lang="ts">
import { ref, watch } from 'vue';
import type { KnowledgeAnchor, KnowledgeRelation } from '@/api/types';
import { listKnowledgeRelationsByAnchor } from '@/api/knowledgeRelation';
import { anchorLabel, navigateKnowledgeAnchor, type KnowledgeAnchorNavigateHandlers } from '@/utils/knowledgeAnchor';

const props = defineProps<{
  kbId: string;
  anchor: KnowledgeAnchor | null;
  navigate: KnowledgeAnchorNavigateHandlers;
  afterNavigate?: () => void;
}>();

const loading = ref(false);
const outgoing = ref<KnowledgeRelation[]>([]);
const incoming = ref<KnowledgeRelation[]>([]);

async function refresh() {
  if (!props.anchor?.locator) {
    outgoing.value = [];
    incoming.value = [];
    return;
  }
  loading.value = true;
  try {
    const result = await listKnowledgeRelationsByAnchor(props.kbId, props.anchor.locator);
    outgoing.value = result.outgoing;
    incoming.value = result.incoming;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.kbId, props.anchor?.locator] as const,
  () => { void refresh(); },
  { immediate: true },
);

defineExpose({ refresh });

function otherAnchor(relation: KnowledgeRelation, direction: 'out' | 'in'): KnowledgeAnchor {
  return direction === 'out' ? relation.to : relation.from;
}

function onNavigate(anchor: KnowledgeAnchor) {
  void navigateKnowledgeAnchor(anchor, props.navigate).finally(() => {
    props.afterNavigate?.();
  });
}
</script>

<template>
  <div v-if="anchor && (outgoing.length || incoming.length || loading)" class="krl">
    <div v-if="loading" class="krl-loading">加载关联…</div>
    <template v-else>
      <div v-if="outgoing.length" class="krl-section">
        <div class="krl-heading">关联到</div>
        <button
          v-for="relation in outgoing"
          :key="relation.id"
          type="button"
          class="krl-item"
          @click="onNavigate(otherAnchor(relation, 'out'))"
        >
          <span class="krl-type" :style="{ color: relation.relationTypeColor || '#1677ff' }">{{ relation.relationTypeLabel }}</span>
          <span class="krl-label">{{ anchorLabel(otherAnchor(relation, 'out')) }}</span>
        </button>
      </div>
      <div v-if="incoming.length" class="krl-section">
        <div class="krl-heading">被关联</div>
        <button
          v-for="relation in incoming"
          :key="relation.id"
          type="button"
          class="krl-item"
          @click="onNavigate(otherAnchor(relation, 'in'))"
        >
          <span class="krl-type" :style="{ color: relation.relationTypeColor || '#1677ff' }">{{ relation.relationTypeLabel }}</span>
          <span class="krl-label">{{ anchorLabel(otherAnchor(relation, 'in')) }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.krl {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.krl-loading {
  font-size: 12px;
  color: #8c8c8c;
}

.krl-section + .krl-section {
  margin-top: 8px;
}

.krl-heading {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 4px;
}

.krl-item {
  display: flex;
  gap: 8px;
  width: 100%;
  border: none;
  background: #fafafa;
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 4px;
  cursor: pointer;
  text-align: left;
}

.krl-item:hover {
  background: #f0f5ff;
}

.krl-type {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
}

.krl-label {
  font-size: 12px;
  color: #434343;
  word-break: break-word;
}
</style>
