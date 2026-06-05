<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  deleteAiAgentApiKey,
  getAiAgentSettings,
  testAiAgentConnection,
  updateAiAgentSettings,
} from '@/api/aiSettings'
import {
  getAiAgentRunLog,
  listAiAgentRunLogs,
  type AiAgentRunLogDetail,
  type AiAgentRunLogSummary,
} from '@/api/aiRuns'

const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const message = ref('')
const runLogs = ref<AiAgentRunLogSummary[]>([])
const runsLoading = ref(false)
const runsError = ref('')
const selectedRun = ref<AiAgentRunLogDetail | null>(null)
const selectedRunId = ref('')
const runsPage = ref(0)
const runsPageSize = 10
const totalRuns = ref(0)

const form = reactive({
  enabled: false,
  baseUrl: '',
  model: '',
  apiKey: '',
  apiKeyConfigured: false,
})

const totalRunPages = computed(() => Math.max(1, Math.ceil(totalRuns.value / runsPageSize)))

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
  void loadRunLogs()
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

async function loadRunLogs() {
  runsLoading.value = true
  runsError.value = ''
  try {
    const page = await listAiAgentRunLogs({ page: runsPage.value, pageSize: runsPageSize })
    runLogs.value = page.items
    totalRuns.value = page.total
    if (selectedRunId.value && !page.items.some((item) => item.id === selectedRunId.value)) {
      selectedRunId.value = ''
      selectedRun.value = null
    }
  } catch (err) {
    runsError.value = readableError(err, '加载 Agent 记录失败')
  } finally {
    runsLoading.value = false
  }
}

async function selectRunLog(id: string) {
  selectedRunId.value = id
  runsError.value = ''
  try {
    selectedRun.value = await getAiAgentRunLog(id)
  } catch (err) {
    selectedRun.value = null
    runsError.value = readableError(err, '加载 Agent 记录详情失败')
  }
}

function changeRunPage(delta: number) {
  const next = Math.min(totalRunPages.value - 1, Math.max(0, runsPage.value + delta))
  if (next === runsPage.value) return
  runsPage.value = next
  void loadRunLogs()
}

function statusLabel(status: string) {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'running') return '运行中'
  return status || '未知'
}

function taskTypeLabel(taskType: string) {
  return taskType === 'learning-plan' ? '学习计划生成' : taskType || '未知任务'
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-'
}

function formatDuration(value?: number | null) {
  return value == null ? '-' : `${value} ms`
}

function formatTokens(value?: number | null) {
  return value == null ? '-' : String(value)
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

    <section class="settings-panel agent-run-log">
      <div class="settings-panel__title">
        <div>
          <h2>Agent 记录</h2>
          <p>保存业务型 AI 生成的完整提示词、响应与量化指标。连接测试不会写入记录。</p>
        </div>
        <button type="button" :disabled="runsLoading" @click="loadRunLogs">
          {{ runsLoading ? '刷新中...' : '刷新' }}
        </button>
      </div>

      <p v-if="runsError" class="settings-error">{{ runsError }}</p>
      <p v-if="!runsLoading && !runLogs.length" class="agent-run-log__empty">暂无 Agent 记录</p>

      <div v-if="runLogs.length" class="agent-run-log__table-wrap">
        <table class="agent-run-log__table">
          <thead>
            <tr>
              <th>任务</th>
              <th>状态</th>
              <th>模型</th>
              <th>耗时</th>
              <th>Token</th>
              <th>开始时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="run in runLogs"
              :key="run.id"
              class="agent-run-log__row"
              :class="{ 'agent-run-log__row--selected': selectedRunId === run.id }"
            >
              <td>{{ taskTypeLabel(run.taskType) }}</td>
              <td>
                <span class="agent-run-log__status" :class="`agent-run-log__status--${run.status}`">
                  {{ statusLabel(run.status) }}
                </span>
              </td>
              <td>{{ run.model || '-' }}</td>
              <td>{{ formatDuration(run.durationMs) }}</td>
              <td>{{ formatTokens(run.totalTokens) }}</td>
              <td>{{ formatDate(run.startedAt) }}</td>
              <td>
                <button type="button" @click="selectRunLog(run.id)">查看记录</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalRuns > runsPageSize" class="agent-run-log__pager">
        <button type="button" :disabled="runsPage <= 0" @click="changeRunPage(-1)">上一页</button>
        <span>第 {{ runsPage + 1 }} / {{ totalRunPages }} 页</span>
        <button type="button" :disabled="runsPage >= totalRunPages - 1" @click="changeRunPage(1)">下一页</button>
      </div>

      <section v-if="selectedRun" class="agent-run-log__detail">
        <div class="agent-run-log__detail-head">
          <h3>{{ taskTypeLabel(selectedRun.taskType) }}</h3>
          <span>{{ statusLabel(selectedRun.status) }}</span>
        </div>
        <dl class="agent-run-log__metrics">
          <div>
            <dt>Base URL</dt>
            <dd>{{ selectedRun.baseUrl || '-' }}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{{ selectedRun.model || '-' }}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{{ formatDuration(selectedRun.durationMs) }}</dd>
          </div>
          <div>
            <dt>Prompt Tokens</dt>
            <dd>{{ formatTokens(selectedRun.promptTokens) }}</dd>
          </div>
          <div>
            <dt>Completion Tokens</dt>
            <dd>{{ formatTokens(selectedRun.completionTokens) }}</dd>
          </div>
          <div>
            <dt>Total Tokens</dt>
            <dd>{{ formatTokens(selectedRun.totalTokens) }}</dd>
          </div>
        </dl>
        <label>
          System Prompt
          <pre>{{ selectedRun.systemPrompt || '' }}</pre>
        </label>
        <label>
          User Prompt
          <pre>{{ selectedRun.userPrompt || '' }}</pre>
        </label>
        <label>
          Request Body
          <pre>{{ selectedRun.requestBodyJson || '' }}</pre>
        </label>
        <label>
          Raw Response
          <pre>{{ selectedRun.rawResponseBody || '' }}</pre>
        </label>
        <label>
          Parsed Output
          <pre>{{ selectedRun.outputText || '' }}</pre>
        </label>
        <label v-if="selectedRun.errorMessage">
          Error
          <pre>{{ selectedRun.errorMessage }}</pre>
        </label>
      </section>
    </section>
  </main>
</template>

<style scoped>
.settings-page {
  height: 100vh;
  overflow-y: auto;
  box-sizing: border-box;
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

.agent-run-log__empty {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.agent-run-log__table-wrap {
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.agent-run-log__table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 13px;
}

.agent-run-log__table th,
.agent-run-log__table td {
  border-bottom: 1px solid #e2e8f0;
  padding: 8px 10px;
  text-align: left;
}

.agent-run-log__table th {
  color: #475569;
  background: #f8fafc;
}

.agent-run-log__table tr:last-child td {
  border-bottom: 0;
}

.agent-run-log__row--selected td {
  background: #eff6ff;
}

.agent-run-log__status {
  display: inline-flex;
  border-radius: 999px;
  padding: 2px 8px;
  color: #475569;
  background: #f1f5f9;
}

.agent-run-log__status--success {
  color: #166534;
  background: #dcfce7;
}

.agent-run-log__status--failed {
  color: #b91c1c;
  background: #fee2e2;
}

.agent-run-log__status--running {
  color: #1d4ed8;
  background: #dbeafe;
}

.agent-run-log__pager,
.agent-run-log__detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-run-log__pager {
  justify-content: flex-end;
  color: #64748b;
  font-size: 13px;
}

.agent-run-log__detail {
  display: grid;
  gap: 12px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  padding: 14px;
  background: #fbfdff;
}

.agent-run-log__detail-head {
  justify-content: space-between;
}

.agent-run-log__detail-head h3 {
  margin: 0;
  font-size: 16px;
}

.agent-run-log__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin: 0;
}

.agent-run-log__metrics div {
  display: grid;
  gap: 3px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px;
  background: #fff;
}

.agent-run-log__metrics dt {
  color: #64748b;
  font-size: 12px;
}

.agent-run-log__metrics dd {
  margin: 0;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.agent-run-log__detail label {
  display: grid;
  gap: 6px;
  color: #475569;
  font-size: 13px;
}

.agent-run-log__detail pre {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px;
  color: #0f172a;
  background: #fff;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
