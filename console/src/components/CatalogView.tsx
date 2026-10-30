import { useEffect, useState, type DragEvent } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import type { CatalogFolder, CatalogSite, CatalogTree } from '../types';
import { toastError } from './Toast';

const OPEN_KEY = 'pp_catalog_open';

function byOrder<T extends { sort_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

type Menu =
  | { x: number; y: number; kind: 'blank' }
  | { x: number; y: number; kind: 'folder'; folder: CatalogFolder }
  | { x: number; y: number; kind: 'site'; site: CatalogSite; folderId: string | null };

export function CatalogView() {
  const t = useT();
  const [tree, setTree] = useState<CatalogTree | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => localStorage.getItem(OPEN_KEY));
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [nameBox, setNameBox] = useState<{ parent: string | null; renameId: string | null } | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  async function load() {
    const next = await api.catalog();
    setTree(next);
    setOpenId((cur) => {
      if (cur && next.sites.some((s) => s.id === cur)) return cur;
      const first = next.sites[0]?.id ?? null;
      if (first) localStorage.setItem(OPEN_KEY, first);
      return first;
    });
  }

  useEffect(() => {
    void load().catch((e) => toastError(e));
  }, []);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const sites = tree?.sites ?? [];
  const folders = tree?.folders ?? [];
  const items = tree?.items ?? [];
  const open = sites.find((s) => s.id === openId) ?? null;
  const placed = new Set(items.map((it) => it.site_id));
  const ungrouped = sites.filter((s) => !placed.has(s.id));
  const tops = byOrder(folders.filter((f) => !f.parent_id));

  function choose(site: CatalogSite) {
    setOpenId(site.id);
    localStorage.setItem(OPEN_KEY, site.id);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  function sitesIn(folderId: string): CatalogSite[] {
    const ids = byOrder(items.filter((it) => it.folder_id === folderId)).map((it) => it.site_id);
    return ids.map((id) => sites.find((s) => s.id === id)).filter((s): s is CatalogSite => !!s);
  }

  function openName(parent: string | null, renameId: string | null, current = '') {
    setMenu(null);
    setNameDraft(current);
    setNameBox({ parent, renameId });
  }

  function onDragStart(e: DragEvent, siteId: string) {
    e.dataTransfer.setData('text/plain', siteId);
    e.dataTransfer.effectAllowed = 'move';
  }

  async function dropOn(folderId: string, beforeId: string | null) {
    const siteId = (window as unknown as { __ppDrag?: string }).__ppDrag;
    if (!siteId || siteId === beforeId) return;
    const current = sitesIn(folderId)
      .map((s) => s.id)
      .filter((id) => id !== siteId);
    const at = beforeId ? current.indexOf(beforeId) : current.length;
    current.splice(at < 0 ? current.length : at, 0, siteId);
    await run(async () => {
      await api.placeSite(siteId, folderId);
      await api.reorderSites(folderId, current);
    });
  }

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function groupBlock(folder: CatalogFolder, nested: boolean) {
    const kids = byOrder(folders.filter((f) => f.parent_id === folder.id));
    return (
      <div
        key={folder.id}
        className={`${nested ? 'ml-3' : ''} mt-2 rounded-lg ${over === folder.id ? 'bg-tide-50 ring-1 ring-tide-300' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(folder.id);
        }}
        onDragLeave={() => setOver((cur) => (cur === folder.id ? null : cur))}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(null);
          void dropOn(folder.id, null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY, kind: 'folder', folder });
        }}
      >
        <div className="flex items-center gap-1 px-2 py-1">
          <button type="button" className="min-w-0 flex-1 truncate text-left text-xs font-bold uppercase tracking-wide text-ink-500" onClick={() => toggleFolder(folder.id)}>
            <span className="mr-1 inline-block w-3 text-ink-400">{collapsed.has(folder.id) ? '▸' : '▾'}</span>
            {folder.name}
          </button>
          <button type="button" className="text-[11px] text-tide-700" onClick={() => openName(folder.id, null)}>
            {t('catalog.menu.child')}
          </button>
          <button type="button" className="text-[11px] text-ink-500" onClick={() => openName(null, folder.id, folder.name)}>
            {t('catalog.rename')}
          </button>
          <button type="button" className="text-[11px] text-red-600" disabled={busy} onClick={() => void run(() => api.deleteFolder(folder.id))}>
            {t('catalog.delete')}
          </button>
        </div>
        {!collapsed.has(folder.id) && (
          <>
            {sitesIn(folder.id).map((site) => siteRow(site, folder.id))}
            {kids.map((child) => groupBlock(child, true))}
          </>
        )}
      </div>
    );
  }

  function siteRow(site: CatalogSite, folderId: string | null) {
    const on = site.id === openId;
    return (
      <div
        key={site.id}
        draggable
        onDragStart={(e) => {
          (window as unknown as { __ppDrag?: string }).__ppDrag = site.id;
          onDragStart(e, site.id);
        }}
        onDragOver={(e) => {
          if (!folderId) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(site.id);
        }}
        onDrop={(e) => {
          if (!folderId) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(null);
          void dropOn(folderId, site.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY, kind: 'site', site, folderId });
        }}
        className={`mt-1 cursor-grab rounded-lg px-2 py-1.5 active:cursor-grabbing ${
          on || over === site.id ? 'bg-tide-50' : 'hover:bg-white'
        }`}
      >
        <button type="button" className="w-full text-left" onClick={() => choose(site)}>
          <div className="truncate text-sm font-medium text-ink-800">{site.title || site.slug}</div>
          <div className="truncate text-[11px] text-ink-400">
            {site.visibility === 'public' ? t('catalog.public') : t('catalog.private')}
            {site.unresolved_comments > 0 ? ` · ${t('catalog.unresolved', { n: site.unresolved_comments })}` : ''}
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0">
      <aside
        className={`w-80 shrink-0 overflow-y-auto border-r border-ink-200 bg-ink-50 px-3 py-3 ${busy ? 'opacity-70' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, kind: 'blank' });
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const siteId = (window as unknown as { __ppDrag?: string }).__ppDrag;
          if (!siteId) return;
          setOver(null);
          void run(() => api.unplaceSite(siteId));
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-800">{t('catalog.title')}</h2>
          <button type="button" className="text-ink-400 hover:text-tide-700" title={t('catalog.refresh')} onClick={() => void load().catch(toastError)}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{t('catalog.hint')}</p>
        {!tree ? (
          <div className="mt-6 flex justify-center text-ink-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            {tops.map((f) => groupBlock(f, false))}
            <div className="mt-4 text-xs font-bold uppercase tracking-wide text-ink-500">{t('catalog.ungrouped')}</div>
            {ungrouped.length === 0 ? (
              <p className="mt-1 text-xs text-ink-400">{t('catalog.none')}</p>
            ) : (
              ungrouped.map((site) => siteRow(site, null))
            )}
          </>
        )}
      </aside>
      <main className="min-w-0 flex-1 bg-white">
        {open ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
              <div className="truncate text-sm font-medium text-ink-800">{open.title || open.slug}</div>
              <a className="inline-flex items-center gap-1 text-xs text-tide-700" href={open.url} target="_blank" rel="noreferrer">
                {t('catalog.newWindow')}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <iframe title={open.slug} src={open.url} className="min-h-0 w-full flex-1 border-0" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">{t('catalog.pick')}</div>
        )}
      </main>
      {menu && (
        <div
          className="fixed z-50 min-w-[9rem] rounded-lg border border-ink-200 bg-white py-1 text-sm shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind !== 'site' && (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-ink-50"
              onClick={() => {
                const parent = menu.kind === 'folder' ? menu.folder.id : null;
                openName(parent, null);
              }}
            >
              {menu.kind === 'folder' ? t('catalog.menu.child') : t('catalog.menu.new')}
            </button>
          )}
          {menu.kind === 'folder' && (
            <>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-ink-50"
                onClick={() => openName(null, menu.folder.id, menu.folder.name)}
              >
                {t('catalog.menu.rename')}
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-ink-50"
                onClick={() => {
                  const id = menu.folder.id;
                  setMenu(null);
                  void run(() => api.deleteFolder(id));
                }}
              >
                {t('catalog.menu.delete')}
              </button>
            </>
          )}
          {menu.kind === 'site' && (
            <>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-ink-50"
                onClick={() => {
                  window.open(menu.site.url, '_blank', 'noopener');
                  setMenu(null);
                }}
              >
                {t('catalog.menu.open')}
              </button>
              {menu.folderId && (
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-ink-50"
                  onClick={() => {
                    const id = menu.site.id;
                    setMenu(null);
                    void run(() => api.unplaceSite(id));
                  }}
                >
                  {t('catalog.menu.ungroup')}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {nameBox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/30 px-4" onClick={() => setNameBox(null)}>
          <form
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const name = nameDraft.trim();
              if (!name) return;
              const box = nameBox;
              setNameBox(null);
              void run(() => (box.renameId ? api.renameFolder(box.renameId, name) : api.createFolder(name, box.parent)));
            }}
          >
            <div className="text-sm font-semibold text-ink-800">{t('catalog.askName')}</div>
            <input
              autoFocus
              className="mt-3 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm outline-none focus:border-tide-500"
              value={nameDraft}
              placeholder={t('catalog.newFolder')}
              onChange={(e) => setNameDraft(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-ink-500 hover:bg-ink-50" onClick={() => setNameBox(null)}>
                {t('catalog.cancel')}
              </button>
              <button type="submit" className="rounded-lg bg-tide-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-tide-700">
                {t('catalog.save')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
