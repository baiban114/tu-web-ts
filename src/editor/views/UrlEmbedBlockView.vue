<script setup lang="ts">
import { computed, ref } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps(nodeViewProps)

const blockId = computed(() => props.node.attrs.blockId || '')
const url = computed(() => String(props.node.attrs.url || ''))
const height = computed(() => Number(props.node.attrs.height) || 360)
const loadFailed = ref(false)

function openInNewTab() {
  if (!url.value) return
  window.open(url.value, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <node-view-wrapper class="url-embed-block-nv" :data-block-id="blockId">
    <div class="url-embed-block" :style="{ height: `${height}px` }">
      <div v-if="loadFailed" class="url-embed-block__fallback">
        <p class="url-embed-block__fallback-url" :title="url">{{ url }}</p>
        <button type="button" class="url-embed-block__open-btn" @click="openInNewTab">
          在新标签打开
        </button>
      </div>
      <iframe
        v-else
        class="url-embed-block__iframe"
        :src="url"
        :title="url"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerpolicy="no-referrer"
        loading="lazy"
        @error="loadFailed = true"
      />
    </div>
  </node-view-wrapper>
</template>

<style scoped>
.url-embed-block {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  overflow: hidden;
  background: #f9fafb;
  box-sizing: border-box;
}

.url-embed-block__iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}

.url-embed-block__fallback {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
}

.url-embed-block__fallback-url {
  margin: 0;
  font-size: 13px;
  color: #4b5563;
  word-break: break-all;
}

.url-embed-block__open-btn {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
}

.url-embed-block__open-btn:hover {
  background: #f3f4f6;
}
</style>
