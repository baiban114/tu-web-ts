import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('tu:data-source', 'mock')
    if (!window.sessionStorage.getItem('tu:knowledge-relation-e2e-init')) {
      window.localStorage.removeItem('tu:mock-state')
      window.localStorage.removeItem('tu-mock-knowledge-relations')
      window.sessionStorage.setItem('tu:knowledge-relation-e2e-init', '1')
    }
  })
})

async function selectEditorText(page: import('@playwright/test').Page) {
  const paragraph = page.locator('.ProseMirror p').first()
  await expect(paragraph).toBeVisible()
  await paragraph.click()
  await page.keyboard.press('Home')
  await page.keyboard.down('Shift')
  await page.keyboard.press('End')
  await page.keyboard.up('Shift')
}

test('creates case relation from selection and shows reverse lookup in resource manager', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await selectEditorText(page)

  const createRelationButton = page.getByRole('button', { name: '建立关联' })
  await expect(createRelationButton).toBeVisible({ timeout: 8000 })
  await createRelationButton.click()

  const dialog = page.getByRole('dialog', { name: '建立知识关联' })
  await expect(dialog).toBeVisible()

  await dialog.getByText('基础概念').click()
  await dialog.getByRole('button', { name: '建立关联' }).click()
  await expect(dialog).toBeHidden()

  const stored = await page.evaluate(() => {
    const raw = window.localStorage.getItem('tu-mock-knowledge-relations')
    if (!raw) return null
    const relations = JSON.parse(raw) as Array<{ relationTypeKey: string; to: { snapshot?: { title?: string } } }>
    return relations.find((item) => item.relationTypeKey === 'case') ?? null
  })
  expect(stored).toBeTruthy()
  expect(stored?.to.snapshot?.title).toContain('基础概念')

  await page.goto('/resources?tab=knowledgeRelations')
  await expect(page.getByRole('tab', { name: '知识关联' })).toBeVisible()
  await expect(page.getByText('案例')).toBeVisible()
  await expect(page.getByRole('button', { name: '基础概念' })).toBeVisible()
})
