import { expect, test, type Page } from '@playwright/test'

const readEmbed = async (page: Page, embedId: string) => {
  return page.evaluate((id) => {
    const state = JSON.parse(window.localStorage.getItem('tu:mock-state') || '{}')
    return state.contents?.['p-e2e']?.embeds?.find((embed: { id: string }) => embed.id === id)
  }, embedId)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('tu:data-source', 'mock')
    window.localStorage.setItem('tu:mock-state', JSON.stringify({
      knowledgeBases: [
        { id: 'kb-e2e', name: 'E2E', icon: 'T', description: 'E2E mock' },
      ],
      pages: [
        { id: 'p-e2e', kbId: 'kb-e2e', parentId: null, title: '表格列菜单测试', order: 0 },
      ],
      contents: {
        'p-e2e': {
          content: [
            '# 表格列菜单测试',
            '',
            '<!--tu:embed id="table-e2e" type="table"-->',
            '',
            '<!--tu:embed id="mt-e2e" type="multiTable"-->',
          ].join('\n'),
          embeds: [
            {
              id: 'table-e2e',
              type: 'table',
              tableData: {
                textMode: 'plain',
                headers: ['E2E-A', 'E2E-B'],
                rows: [['a1', 'b1'], ['a2', 'b2']],
                columnWidths: [120, 140],
                rowHeights: [38, 38],
              },
            },
            {
              id: 'mt-e2e',
              type: 'multiTable',
              multiTableData: {
                fields: [
                  { id: 'e2eTitle', name: '标题', type: 'text' },
                  {
                    id: 'e2eStatus',
                    name: '状态',
                    type: 'singleSelect',
                    options: [
                      { id: 'todo', label: 'E2E待处理', color: '#e2e8f0' },
                      { id: 'doing', label: 'E2E进行中', color: '#dbeafe' },
                    ],
                  },
                ],
                records: [
                  { id: 'r-1', values: { e2eTitle: 'E2E 任务 A', e2eStatus: 'todo' } },
                ],
                views: [
                  { id: 'view-table', name: '表格', type: 'table' },
                  { id: 'view-kanban', name: '看板', type: 'kanban', groupByFieldId: 'e2eStatus' },
                ],
                activeViewId: 'view-kanban',
              },
            },
          ],
          annotations: [],
        },
      },
    }))
  })
  await page.goto('/')
})

test('opens kanban column actions from the multi-table board header', async ({ page }) => {
  const block = page.locator('.multi-table').last()
  await expect(block).toBeVisible()

  await block.getByRole('button', { name: '看板' }).click()
  const columnHeader = block.locator('.kanban-column__header').first()
  await expect(columnHeader).toBeVisible()

  await columnHeader.click({ button: 'right' })
  await expect(page.getByRole('button', { name: '重命名分组' })).toBeVisible()
  await expect(page.getByRole('button', { name: '在右侧新增分组' })).toBeVisible()
  await expect(page.getByRole('button', { name: '删除分组' })).toBeVisible()
})

test('opens field actions from the multi-table grid header', async ({ page }) => {
  const block = page.locator('.multi-table').last()
  await expect(block).toBeVisible()

  await block.getByRole('button', { name: '表格' }).click()
  const fieldHeader = block.locator('th[data-field-id="title"]').first()
  await expect(fieldHeader).toBeVisible()

  await fieldHeader.click({ button: 'right' })
  const menu = page.locator('.multi-table-menu').filter({ has: page.getByRole('button', { name: '字段设置' }) })
  await expect(menu.getByRole('button', { name: '字段设置' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '在左侧新增列' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '在右侧新增列' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '删除字段' })).toBeVisible()
})

test('inserts a plain table column from the column menu', async ({ page }) => {
  const block = page.locator('.table-block').last()
  await expect(block).toBeVisible()

  await block.locator('thead th.table-block__header-cell').first().click({ button: 'right' })
  const menu = page.locator('.table-block__column-context-menu')
  await expect(menu.getByRole('button', { name: '在左侧新增列' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '在右侧新增列' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '删除列' })).toBeVisible()

  await menu.getByRole('button', { name: '在右侧新增列' }).click()
  await expect(block.locator('thead th.table-block__header-cell')).toHaveCount(3)
  await expect(block.locator('tbody tr').first().locator('td')).toHaveCount(3)

  await expect.poll(async () => {
    const embed = await readEmbed(page, 'table-e2e')
    return {
      headers: embed.tableData.headers.length,
      cells: embed.tableData.rows[0].length,
      widths: embed.tableData.columnWidths.length,
    }
  }).toEqual({ headers: 3, cells: 3, widths: 3 })
})

test('inserts a multi-table field from the field menu', async ({ page }) => {
  const block = page.locator('.multi-table').last()
  await expect(block).toBeVisible()

  await block.getByRole('button', { name: '表格' }).click()
  await block.locator('th[data-field-id="status"]').first().click({ button: 'right' })
  const menu = page.locator('.multi-table-menu').filter({ has: page.getByRole('button', { name: '字段设置' }) })
  await menu.getByRole('button', { name: '在左侧新增列' }).click()

  await expect(block.locator('.field-settings input').first()).toHaveValue('字段 5')
  await expect(block.locator('thead th')).toHaveCount(5)

  const insertedFieldId = await block.locator('thead th').nth(1).getAttribute('data-field-id')
  expect(insertedFieldId).toBeTruthy()
  await expect(block.locator('tbody tr').first().locator('td').nth(1).locator('input')).toHaveValue('')
})

test('adds a multi-table record from the grid add row control', async ({ page }) => {
  const block = page.locator('.multi-table').last()
  await expect(block).toBeVisible()

  await block.getByRole('button', { name: '表格' }).click()
  await expect(block.locator('tbody tr')).toHaveCount(2)

  await block.getByRole('button', { name: '+ 新增一行' }).click()
  await expect(block.locator('tbody tr')).toHaveCount(3)
  await expect(block.locator('tbody tr').nth(1).locator('td').first().locator('input')).toHaveValue('')
})
