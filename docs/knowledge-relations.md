# 知识关联（Knowledge Relations）— Phase 1

> 状态：**已实施（Phase 1）**
> 关联：[tu-frontend-ui SKILL §6](../../.cursor/skills/tu-frontend-ui/SKILL.md)、[tree-structure-management.md](./tree-structure-management.md)

## 1. 目标

跨页面、节选、标注等锚点建立**可扩展语义关系**（如「案例」「依据」「来源」），支持双向反查与跳转。关系类型为**系统预置 + 知识库自定义**。

Phase 1：**建链 + 定位 + 分页列表**；图谱投影与学习路线见 Phase 2/3。

## 2. 锚点 locator 约定

| `anchorKind` | locator 格式 | 示例 |
|--------------|-------------|------|
| `page` | `page:{pageId}` | `page:abc` |
| `heading` | `page:{pageId}:heading:{blockId}` | `page:abc:heading:h1` |
| `section` | `page:{pageId}:section:{sectionKey}` | `page:abc:section:local:blk` |
| `annotation` | `page:{pageId}:annotation:{id}` | `page:abc:annotation:ann1` |
| `textSpan` | `page:{pageId}:textSpan:{id}` | |
| `block` | `page:{pageId}:block:{embedId}` | |
| `resourceItem` | `resource:{itemId}` | |
| `resourceExcerpt` | `resource:{itemId}:excerpt:{excerptId}` | |

`snapshot` JSON 存展示用标题等，跳转以 locator 为准。

## 3. 关系类型注册表

- 系统预置（`kbId = null`）：`source`、`basis`、`case`、`cites`、`related`
- 知识库可 `POST /api/kbs/{kbId}/relation-types` 扩展自定义类型
- `related` 为双向；其余默认有向（from → to）

## 4. 与树 / 标注 / 标签的边界

| 概念 | 用途 | 存储 |
|------|------|------|
| **标签** | 分类、筛选 | 页面/块/节/文字 span metadata |
| **关系** | 语义边（案例、依据…） | `knowledge_relation` 表 |
| **父子树** | 目录层级 | `PageItem.parentId`、资源章节、`ContentTreeNode` |

知识关联边**不进入**父子树（同 `ResourceItemRelation`）；Phase 2 可投影到 X6 图谱。

## 5. 迁移与双写（Phase 1）

| 现有能力 | 编辑真源 | 索引投影 |
|---------|---------|---------|
| `headingSource` | Tiptap heading attrs | `relation_type=source`, provenance=`migrated` |
| `basis` 标注 | `TextAnnotation.basisBinding` | `relation_type=basis`, provenance=`migrated` |
| 用户建链 UI | — | `provenance=user` |

`saveContent` 后 rebuild 本页 migrated 关系；用户创建的关系不删除。

## 6. API

| 方法 | 路径 |
|------|------|
| GET | `/api/kbs/{kbId}/relation-types` |
| POST | `/api/kbs/{kbId}/relation-types` |
| GET | `/api/kbs/{kbId}/relations`（分页，`pageSize` 默认 10） |
| POST | `/api/kbs/{kbId}/relations` |
| DELETE | `/api/relations/{id}` |
| GET | `/api/kbs/{kbId}/relations/by-anchor?locator=…` |

## 7. UI 约定

- 创建：`SelectionToolbar` →「建立关联」→ `KnowledgeAnchorPicker`（页面树 / 资源树 / 搜索，列表分页，见 SKILL §6）
- 查看：`NotePopover`、资源管理「知识关联」Tab
- 跳转：`resolveKnowledgeAnchor()` 统一深链

## 8. Phase 2/3（未实施）

- **Phase 2**：`knowledge_relation` → X6 知识图谱（复用 `roadmapGraph.ts` / `graphSources.ts`）
- **Phase 3**：`prerequisite` 边 + `ContentTreeNode.estimatedHours` 学习路线
