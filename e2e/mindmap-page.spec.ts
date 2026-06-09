import { expect, test } from '@playwright/test'

async function createMindmapFromMenu(page: import('@playwright/test').Page) {
  await page.getByTitle('新建页面').click()
  await page.getByRole('menuitem', { name: '思维导图' }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('creates a mindmap page without outer content scroll', async ({ page }) => {
  await createMindmapFromMenu(page)

  const mindmapNode = page.locator('.page-tree .tree-node').filter({ hasText: '未命名思维导图' }).first()
  await expect(mindmapNode).toBeVisible()

  await expect(page.locator('.content-canvas')).toBeVisible()
  await expect(page.locator('.content-canvas')).toHaveCSS('overflow', 'hidden')
  await expect(page.locator('.content-scroll')).toHaveCount(0)

  await expect(page.locator('.canvas-page')).toBeVisible()
  await expect(page.locator('.x6-stage')).toBeVisible()
  await expect(page.locator('.ProseMirror')).toHaveCount(0)
})

test('persists mindmap page title in mock storage', async ({ page }) => {
  await createMindmapFromMenu(page)

  const titleInput = page.locator('.board-canvas-shell__title-input')
  await expect(titleInput).toBeVisible()
  await titleInput.fill('产品路线图')
  await titleInput.blur()

  await expect(page.locator('.page-tree .tree-node').filter({ hasText: '产品路线图' })).toBeVisible()

  const storage = await page.evaluate(() => localStorage.getItem('tu:mock-state'))
  expect(storage).toContain('产品路线图')
  expect(storage).toContain('"pageType":"mindmap"')
})

test('creates a document page from the same menu', async ({ page }) => {
  await page.getByTitle('新建页面').click()
  await page.getByRole('menuitem', { name: '文档' }).click()

  await expect(page.locator('.page-tree .tree-node').filter({ hasText: '新页面' }).first()).toBeVisible()
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await expect(page.locator('.canvas-page')).toHaveCount(0)
})
