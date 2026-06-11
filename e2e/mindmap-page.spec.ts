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

test('shows dashed edge only while previewing a dragged mindmap node', async ({ page }) => {
  await createMindmapFromMenu(page)

  await expect(page.locator('.x6-stage')).toBeVisible()
  const rootNode = page.locator('.x6-node[data-cell-id]').filter({ hasText: '中心主题' }).first()
  const sourceNode = page.locator('.x6-node[data-cell-id]').filter({ hasText: '分支 1' }).first()
  const siblingNode = page.locator('.x6-node[data-cell-id]').filter({ hasText: '分支 2' }).first()
  await expect(rootNode).toBeVisible()
  await expect(sourceNode).toBeVisible()
  await expect(siblingNode).toBeVisible()

  const rootBoxBefore = await rootNode.boundingBox()
  const siblingBoxBefore = await siblingNode.boundingBox()
  const sourceBox = await sourceNode.boundingBox()
  const targetBox = await siblingNode.boundingBox()
  expect(rootBoxBefore).not.toBeNull()
  expect(siblingBoxBefore).not.toBeNull()
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()

  const source = sourceBox!
  const target = targetBox!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 })

  const previewEdge = page.locator('[data-cell-id="__mindmap-drag-preview-edge__"]')
  await expect(previewEdge).toHaveCount(1)
  await expect(previewEdge.locator('[stroke-dasharray="6 4"]')).toHaveCount(1)

  await page.mouse.up()
  await expect(previewEdge).toHaveCount(0)

  const rootBoxAfter = await rootNode.boundingBox()
  const siblingBoxAfter = await siblingNode.boundingBox()
  expect(rootBoxAfter).not.toBeNull()
  expect(siblingBoxAfter).not.toBeNull()
  expect(Math.abs(rootBoxAfter!.y - rootBoxBefore!.y)).toBeLessThan(1)
  expect(Math.abs(siblingBoxAfter!.y - siblingBoxBefore!.y)).toBeLessThan(1)
})

test('updates dashed preview source port when dragging across mindmap sides', async ({ page }) => {
  await createMindmapFromMenu(page)

  await expect(page.locator('.x6-stage')).toBeVisible()
  const sourceNode = page.locator('.x6-node[data-cell-id]').filter({ hasText: '分支 1' }).first()
  const rootNode = page.locator('.x6-node[data-cell-id]').filter({ hasText: '中心主题' }).first()
  await expect(sourceNode).toBeVisible()
  await expect(rootNode).toBeVisible()

  const sourceBox = await sourceNode.boundingBox()
  const rootBox = await rootNode.boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(rootBox).not.toBeNull()

  const source = sourceBox!
  const root = rootBox!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(root.x + root.width * 0.25, root.y + root.height / 2, { steps: 10 })

  const previewEdge = page.locator('[data-cell-id="__mindmap-drag-preview-edge__"]')
  await expect(previewEdge).toHaveCount(1)
  await expect(previewEdge.locator('[data-source-port="port-left"]')).toHaveCount(1)

  await page.mouse.up()
})

test('creates a document page from the same menu', async ({ page }) => {
  await page.getByTitle('新建页面').click()
  await page.getByRole('menuitem', { name: '文档' }).click()

  await expect(page.locator('.page-tree .tree-node').filter({ hasText: '新页面' }).first()).toBeVisible()
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await expect(page.locator('.canvas-page')).toHaveCount(0)
})
