import { isMockDataSource } from '@/dev/dataSource'
import { request } from './http'

export interface GenerateLearningPlanPayload {
  topic: string
  totalHours?: number | null
  dailyHours?: number | null
  deadline?: string | null
}

export interface LearningPlanNode {
  title: string
  description?: string | null
  estimatedHours?: number | null
  resource?: string | null
  children?: LearningPlanNode[]
}

export interface LearningPlanResponse {
  title: string
  totalEstimatedHours: number
  items: LearningPlanNode[]
}

const clampHours = (value: number, fallback: number) => {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const mockStep = (title: string, estimatedHours: number, resource: string): LearningPlanNode => ({
  title,
  estimatedHours,
  resource,
})

function generateLearningPlanMock(payload: GenerateLearningPlanPayload): Promise<LearningPlanResponse> {
  const topic = payload.topic.trim()
  const totalHours = clampHours(Number(payload.totalHours), 18)
  const sectionHours = Math.max(2, Math.round((totalHours / 3) * 10) / 10)
  const items: LearningPlanNode[] = [
    {
      title: '建立基础框架',
      description: `明确 ${topic} 的核心概念、术语和学习边界。`,
      children: [
        mockStep('梳理概念地图', Math.max(1, sectionHours * 0.4), '官方文档或权威教程'),
        mockStep('完成入门练习', Math.max(1, sectionHours * 0.6), '交互式练习或示例项目'),
      ],
    },
    {
      title: '专项训练',
      description: '围绕关键能力拆分练习，并记录薄弱点。',
      children: [
        mockStep('主题拆解与笔记', Math.max(1, sectionHours * 0.45), '专题文章与视频课程'),
        mockStep('小项目实践', Math.max(1, sectionHours * 0.75), '开源示例或练习仓库'),
      ],
    },
    {
      title: '复盘与输出',
      description: '用可交付成果检验学习效果。',
      children: [
        mockStep('错题与知识点复盘', Math.max(1, sectionHours * 0.35), '个人笔记'),
        mockStep('完成总结作品', Math.max(1, sectionHours * 0.45), '博客、演示或项目 README'),
      ],
    },
  ]
  const totalEstimatedHours = items.reduce((sum, section) => {
    return sum + (section.children || []).reduce((childSum, child) => childSum + Number(child.estimatedHours || 0), 0)
  }, 0)

  return Promise.resolve({
    title: `${topic} 学习计划`,
    totalEstimatedHours: Math.round(totalEstimatedHours * 100) / 100,
    items,
  })
}

export function generateLearningPlan(payload: GenerateLearningPlanPayload): Promise<LearningPlanResponse> {
  if (isMockDataSource()) {
    return generateLearningPlanMock(payload)
  }
  return request<LearningPlanResponse>('/api/ai/learning-plan/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
