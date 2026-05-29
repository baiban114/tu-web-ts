<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import {
  deleteAiAgentApiKey,
  getAiAgentSettings,
  testAiAgentConnection,
  updateAiAgentSettings,
} from '@/api/aiSettings'

const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const message = ref('')

const form = reactive({
  enabled: false,
  baseUrl: '',
  model: '',
  apiKey: '',
  apiKeyConfigured: false,
})

function readableError(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback
  if (message.includes('secret encryption key is not configured')) {
    return '后端未配置 TU_SECRET_ENCRYPTION_KEY。请设置 base64 编码的 32 字节密钥并重启后端。'
  }
  if (message.includes('secret encryption key must be')) {
    return 'TU_SECRET_ENCRYPTION_KEY 格式不正确，需要 base64 编码的 32 字节密钥。'
  }
  return message
}

onMounted(() => {
  void loadSettings()
})

async function loadSettings() {
  loading.value = true
  error.value = ''
  try {
    const settings = await getAiAgentSettings()
    form.enabled = settings.enabled
    form.baseUrl = settings.baseUrl || ''
    form.model = settings.model || ''
    form.apiKey = ''
    form.apiKeyConfigured = settings.apiKeyConfigured
  } catch (err) {
    error.value = readableError(err, '加载 AI Agent 配置失败')
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const settings = await updateAiAgentSettings({
      enabled: form.enabled,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
    })
    form.enabled = settings.enabled
    form.baseUrl = settings.baseUrl || ''
    form.model = settings.model || ''
    form.apiKey = ''
    form.apiKeyConfigured = settings.apiKeyConfigured
    message.value = 'AI Agent 配置已保存'
  } catch (err) {
    error.value = readableError(err, '保存 AI Agent 配置失败')
  } finally {
    saving.value = false
  }
}

async function removeApiKey() {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const settings = await deleteAiAgentApiKey()
    form.apiKey = ''
    form.apiKeyConfigured = settings.apiKeyConfigured
    message.value = 'API Key 已删除'
  } catch (err) {
    error.value = readableError(err, '删除 API Key 失败')
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await testAiAgentConnection()
    message.value = result.message || (result.ok ? '连接成功' : '连接失败')
  } catch (err) {
    error.value = readableError(err, '测试连接失败')
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <main class="settings-page">
    <header class="settings-page__header">
      <div>
        <p>系统配置</p>
        <h1>AI Agent</h1>
      </div>
      <RouterLink to="/">返回工作区</RouterLink>
    </header>

    <section class="settings-panel">
      <div class="settings-panel__title">
        <div>
          <h2>OpenAI-compatible 接入</h2>
          <p>配置学习计划生成使用的模型服务。API Key 只保存加密值，不会回显。</p>
        </div>
        <span :class="{ 'settings-status--ok': form.enabled && form.apiKeyConfigured }" class="settings-status">
          {{ form.enabled && form.apiKeyConfigured ? '已配置' : '未配置' }}
        </span>
      </div>

      <form class="settings-form" @submit.prevent="saveSettings">
        <label class="settings-form__check">
          <input v-model="form.enabled" type="checkbox" />
          启用 AI Agent
        </label>
        <label>
          Base URL
          <input v-model="form.baseUrl" placeholder="https://api.openai.com/v1" required />
        </label>
        <label>
          Model
          <input v-model="form.model" placeholder="gpt-4.1-mini" required />
        </label>
        <label>
          API Key
          <input
            v-model="form.apiKey"
            type="password"
            :placeholder="form.apiKeyConfigured ? '留空则保留当前 Key' : '粘贴 API Key'"
          />
        </label>
        <div class="settings-form__key-state">
          {{ form.apiKeyConfigured ? 'Key 已配置' : 'Key 未配置' }}
        </div>
        <div class="settings-form__actions">
          <button type="submit" :disabled="saving || loading">{{ saving ? '保存中...' : '保存配置' }}</button>
          <button type="button" :disabled="saving || !form.apiKeyConfigured" @click="removeApiKey">删除 Key</button>
          <button type="button" :disabled="testing || !form.apiKeyConfigured" @click="testConnection">
            {{ testing ? '测试中...' : '测试连接' }}
          </button>
        </div>
      </form>

      <p v-if="message" class="settings-message">{{ message }}</p>
      <p v-if="error" class="settings-error">{{ error }}</p>
    </section>
  </main>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
  padding: 28px;
  background: #f8fafc;
  color: #0f172a;
}

.settings-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 920px;
  margin: 0 auto 20px;
}

.settings-page__header p {
  margin: 0 0 4px;
  color: #64748b;
  font-size: 13px;
}

.settings-page__header h1 {
  margin: 0;
  font-size: 28px;
}

.settings-page__header a {
  color: #1677ff;
  text-decoration: none;
}

.settings-panel {
  display: grid;
  gap: 18px;
  max-width: 920px;
  margin: 0 auto;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  padding: 20px;
  background: #fff;
}

.settings-panel__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.settings-panel__title h2 {
  margin: 0 0 6px;
  font-size: 18px;
}

.settings-panel__title p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.settings-status {
  flex: none;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 4px 10px;
  color: #64748b;
  font-size: 12px;
  background: #f8fafc;
}

.settings-status--ok {
  border-color: #bbf7d0;
  color: #166534;
  background: #f0fdf4;
}

.settings-form {
  display: grid;
  gap: 14px;
}

.settings-form label {
  display: grid;
  gap: 6px;
  color: #475569;
  font-size: 13px;
}

.settings-form input {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 10px;
  color: #0f172a;
  font-size: 14px;
}

.settings-form__check {
  display: flex !important;
  flex-direction: row;
  align-items: center;
}

.settings-form__check input {
  width: auto;
}

.settings-form__key-state {
  color: #64748b;
  font-size: 13px;
}

.settings-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.settings-form__actions button {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 12px;
  background: #fff;
  color: #334155;
  cursor: pointer;
}

.settings-form__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.settings-message,
.settings-error {
  margin: 0;
  font-size: 13px;
}

.settings-message {
  color: #166534;
}

.settings-error {
  color: #b91c1c;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
