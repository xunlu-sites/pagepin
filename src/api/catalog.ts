/** 原型目录：分组存在数据库里，不改变站点的公开状态和分享链接。 */

import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import { siteUrl } from '../config.js';
import { catalogFolders, catalogItems, commentThreads, sites } from '../db/index.js';
import type { AuthMw } from './me.js';
import type { AppDeps, AppEnv } from '../types.js';
import { nowIso, uuid } from '../util.js';

const NAME_MAX = 80;

export function makeCatalogRoutes(deps: AppDeps, mw: AuthMw) {
  const { db } = deps;
  const r = new Hono<AppEnv>().basePath('/api/catalog');

  async function ownedFolders(ownerId: string) {
    return db
      .select()
      .from(catalogFolders)
      .where(eq(catalogFolders.ownerId, ownerId))
      .orderBy(asc(catalogFolders.sortOrder), asc(catalogFolders.createdAt));
  }

  r.get('/', mw.currentUser, async (c) => {
    const user = c.get('user');
    const rows = await db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerId, user.id), isNull(sites.deletedAt)))
      .orderBy(asc(sites.title), asc(sites.slug));
    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const grouped = await db
        .select({ siteId: commentThreads.siteId, n: count() })
        .from(commentThreads)
        .where(
          and(
            inArray(
              commentThreads.siteId,
              rows.map((x) => x.id),
            ),
            eq(commentThreads.resolved, false),
            isNull(commentThreads.deletedAt),
          ),
        )
        .groupBy(commentThreads.siteId);
      for (const g of grouped) counts.set(g.siteId, g.n);
    }
    const folders = await ownedFolders(user.id);
    const items = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.ownerId, user.id))
      .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.createdAt));
    return c.json({
      folders: folders.map((f) => ({
        id: f.id,
        parent_id: f.parentId,
        name: f.name,
        sort_order: f.sortOrder,
      })),
      items: items.map((it) => ({
        site_id: it.siteId,
        folder_id: it.folderId,
        sort_order: it.sortOrder,
      })),
      sites: rows.map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        url: siteUrl(deps.config, s.ownerHandle, s.slug),
        visibility: s.visibility,
        updated_at: s.updatedAt,
        unresolved_comments: counts.get(s.id) ?? 0,
        suspended: s.suspendedAt !== null,
      })),
    });
  });

  r.post('/folders', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const parentId = typeof body?.parent_id === 'string' ? body.parent_id : null;
    if (!name || name.length > NAME_MAX) return c.json({ detail: '分组名称不合法' }, 422);
    const folders = await ownedFolders(user.id);
    if (parentId) {
      const parent = folders.find((f) => f.id === parentId);
      if (!parent) return c.json({ detail: '上级分组不存在' }, 404);
    }
    const siblings = folders.filter((f) => (f.parentId ?? null) === parentId);
    const id = uuid();
    const now = nowIso();
    await db.insert(catalogFolders).values({
      id,
      ownerId: user.id,
      parentId,
      name,
      sortOrder: siblings.length,
      createdAt: now,
      updatedAt: now,
    });
    return c.json({ id }, 201);
  });

  r.patch('/folders/:id', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const folders = await ownedFolders(user.id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) return c.json({ detail: '分组不存在' }, 404);
    const patch: { name?: string; parentId?: string | null; sortOrder?: number; updatedAt: string } = {
      updatedAt: nowIso(),
    };
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name || name.length > NAME_MAX) return c.json({ detail: '分组名称不合法' }, 422);
      patch.name = name;
    }
    if ('parent_id' in (body ?? {})) {
      const parentId = body.parent_id == null || body.parent_id === '' ? null : String(body.parent_id);
      if (parentId === id) return c.json({ detail: '不能把自己设为上级' }, 422);
      if (parentId) {
        const parent = folders.find((f) => f.id === parentId);
        if (!parent) return c.json({ detail: '上级分组不存在' }, 404);
        const seen = new Set<string>();
        let cursor: string | null = parentId;
        while (cursor) {
          if (cursor === id) return c.json({ detail: '不能把分组放进自己的下级' }, 422);
          if (seen.has(cursor)) break;
          seen.add(cursor);
          cursor = folders.find((f) => f.id === cursor)?.parentId ?? null;
        }
      }
      patch.parentId = parentId;
    }
    if (typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)) {
      patch.sortOrder = body.sort_order;
    }
    await db.update(catalogFolders).set(patch).where(eq(catalogFolders.id, id));
    return c.json({ ok: true });
  });

  r.post('/folders/:id/merge', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const intoId = typeof body?.into_id === 'string' ? body.into_id : '';
    if (!intoId || intoId === id) return c.json({ detail: '请选择另一个分组' }, 422);
    const folders = await ownedFolders(user.id);
    const source = folders.find((f) => f.id === id);
    const into = folders.find((f) => f.id === intoId);
    if (!source || !into) return c.json({ detail: '分组不存在' }, 404);
    const drop = new Set<string>([id, ...folders.filter((f) => f.parentId === id).map((f) => f.id)]);
    if (drop.has(intoId)) return c.json({ detail: '不能合并到自己的子分组' }, 422);
    const moving = await db
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.ownerId, user.id), inArray(catalogItems.folderId, [...drop])));
    const kept = await db
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.ownerId, user.id), eq(catalogItems.folderId, intoId)));
    const keptSites = new Set(kept.map((it) => it.siteId));
    let order = kept.length;
    for (const it of moving) {
      if (keptSites.has(it.siteId)) {
        await db.delete(catalogItems).where(eq(catalogItems.id, it.id));
        continue;
      }
      keptSites.add(it.siteId);
      await db.update(catalogItems).set({ folderId: intoId, sortOrder: order }).where(eq(catalogItems.id, it.id));
      order += 1;
    }
    await db.delete(catalogFolders).where(and(eq(catalogFolders.ownerId, user.id), inArray(catalogFolders.id, [...drop])));
    return c.json({ ok: true });
  });

  r.delete('/folders/:id', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const folders = await ownedFolders(user.id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) return c.json({ detail: '分组不存在' }, 404);
    const drop = new Set<string>();
    const walk = (folderId: string) => {
      if (drop.has(folderId)) return;
      drop.add(folderId);
      for (const child of folders) if (child.parentId === folderId) walk(child.id);
    };
    walk(id);
    await db.delete(catalogItems).where(and(eq(catalogItems.ownerId, user.id), inArray(catalogItems.folderId, [...drop])));
    await db.delete(catalogFolders).where(and(eq(catalogFolders.ownerId, user.id), inArray(catalogFolders.id, [...drop])));
    return c.json({ ok: true });
  });

  r.post('/items', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const siteId = typeof body?.site_id === 'string' ? body.site_id : '';
    const folderId = typeof body?.folder_id === 'string' ? body.folder_id : '';
    if (!siteId || !folderId) return c.json({ detail: '缺少站点或分组' }, 422);
    const site = (
      await db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, siteId), eq(sites.ownerId, user.id), isNull(sites.deletedAt)))
    )[0];
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    const folder = (
      await db
        .select()
        .from(catalogFolders)
        .where(and(eq(catalogFolders.id, folderId), eq(catalogFolders.ownerId, user.id)))
    )[0];
    if (!folder) return c.json({ detail: '分组不存在' }, 404);
    const existing = (
      await db
        .select()
        .from(catalogItems)
        .where(and(eq(catalogItems.ownerId, user.id), eq(catalogItems.siteId, siteId)))
    )[0];
    if (existing) {
      await db
        .update(catalogItems)
        .set({ folderId, sortOrder: typeof body?.sort_order === 'number' ? body.sort_order : existing.sortOrder })
        .where(eq(catalogItems.id, existing.id));
      return c.json({ id: existing.id });
    }
    const siblings = await db
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(and(eq(catalogItems.ownerId, user.id), eq(catalogItems.folderId, folderId)));
    const id = uuid();
    await db.insert(catalogItems).values({
      id,
      ownerId: user.id,
      folderId,
      siteId,
      sortOrder: siblings.length,
      createdAt: nowIso(),
    });
    return c.json({ id }, 201);
  });

  r.post('/reorder', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const folderId = typeof body?.folder_id === 'string' ? body.folder_id : '';
    const ids = Array.isArray(body?.site_ids) ? body.site_ids.filter((x: unknown) => typeof x === 'string') : null;
    if (!folderId || !ids) return c.json({ detail: '缺少顺序' }, 422);
    const folder = (
      await db
        .select({ id: catalogFolders.id })
        .from(catalogFolders)
        .where(and(eq(catalogFolders.id, folderId), eq(catalogFolders.ownerId, user.id)))
    )[0];
    if (!folder) return c.json({ detail: '分组不存在' }, 404);
    for (let i = 0; i < ids.length; i++) {
      const siteId = ids[i] as string;
      const existing = (
        await db
          .select()
          .from(catalogItems)
          .where(and(eq(catalogItems.ownerId, user.id), eq(catalogItems.siteId, siteId)))
      )[0];
      if (!existing) continue;
      await db.update(catalogItems).set({ folderId, sortOrder: i }).where(eq(catalogItems.id, existing.id));
    }
    return c.json({ ok: true });
  });

  r.delete('/items/:siteId', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    await db
      .delete(catalogItems)
      .where(and(eq(catalogItems.ownerId, user.id), eq(catalogItems.siteId, c.req.param('siteId'))));
    return c.json({ ok: true });
  });

  return r;
}
