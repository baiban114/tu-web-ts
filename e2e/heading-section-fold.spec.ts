import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('tu:data-source', 'mock')
    if (!window.sessionStorage.getItem('tu:heading-section-fold-e2e-init')) {
      window.localStorage.removeItem('tu:mock-state')
      window.sessionStorage.setItem('tu:heading-section-fold-e2e-init', '1')
    }
  })
})

async function waitForHeadingFoldInContent(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const state = JSON.parse(window.localStorage.getItem('tu:mock-state') || '{}')
    return Object.values(state.contents || {}).some((content: { content?: string }) => (
      typeof content.content === 'string' && content.content.includes('<!--tu:heading-fold')
    ))
  })
}

test('collapses and expands heading section in editor body', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await expect(page.locator('.ProseMirror')).toBeVisible()

  const heading = page.locator('.ProseMirror h1').first()
  await expect(heading).toBeVisible()
  const bodyParagraph = page.locator('.ProseMirror p').first()
  await expect(bodyParagraph).toBeVisible()

  const collapseButton = page.getByRole('button', { name: '收起本节' }).first()
  await expect(collapseButton).toBeVisible()
  await collapseButton.click()
  await expect(bodyParagraph).toBeHidden()

  const expandButton = page.getByRole('button', { name: '展开本节' }).first()
  await expect(expandButton).toBeVisible()
  await expandButton.click()
  await expect(bodyParagraph).toBeVisible()
})

test('persists collapsed section after reload', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.getByRole('button', { name: '收起本节' }).first().click()
  await expect(page.locator('.ProseMirror p').first()).toBeHidden()
  await waitForHeadingFoldInContent(page)

  await page.reload()
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await expect(page.locator('.ProseMirror p').first()).toBeHidden()
  await expect(page.getByRole('button', { name: '展开本节' }).first()).toBeVisible()
})

test('collapsing parent heading hides nested subsections', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await expect(page.locator('.ProseMirror')).toBeVisible()

  const firstParagraph = page.locator('.ProseMirror p').first()
  await firstParagraph.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## 子节')
  await page.keyboard.press('Enter')
  await page.keyboard.type('子节正文')
  await page.keyboard.press('Enter')
  await page.keyboard.type('### 孙节')
  await page.keyboard.press('Enter')
  await page.keyboard.type('孙节正文')

  await expect(page.locator('.ProseMirror h2')).toContainText('子节')
  await expect(page.locator('.ProseMirror h3')).toContainText('孙节')

  await page.getByRole('button', { name: '收起本节' }).first().click()
  await expect(page.locator('.ProseMirror h2')).toBeHidden()
  await expect(page.locator('.ProseMirror h3')).toBeHidden()
  await expect(page.getByText('子节正文')).toBeHidden()
  await expect(page.getByText('孙节正文')).toBeHidden()
  await expect(page.locator('.ProseMirror h1').first()).toBeVisible()
})
