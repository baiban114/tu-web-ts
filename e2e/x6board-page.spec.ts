import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('creates an x6board page without outer content scroll', async ({ page }) => {
  await page.getByTitle('新建页面').click()
  await page.getByRole('menuitem', { name: '画板' }).click()

  await expect(page.locator('.canvas-page')).toBeVisible()
  await expect(page.locator('.content-canvas')).toBeVisible()
  await expect(page.locator('.content-canvas')).toHaveCSS('overflow', 'hidden')
  await expect(page.locator('.content-scroll')).toHaveCount(0)
  await expect(page.locator('.x6-stage')).toBeVisible()
  await expect(page.locator('.ProseMirror')).toHaveCount(0)
})
