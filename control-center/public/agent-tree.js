'use strict';
(function (root) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const labels = { running: 'Running', done: 'Done', failed: 'Failed', needs_you: 'Needs you', stopped: 'Stopped', unknown: 'Unknown' };
  const glyphs = { running: '◌', done: '✓', failed: '!', needs_you: '◷', stopped: '−', unknown: '?' };
  const money = value => finite(value) ? value > 0 && value < .0001 ? '<$0.0001' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value) : '—';
  function branchCost(id, nodes, visited = new Set()) {
    const node = nodes.get(id); if (!node || visited.has(id) || !finite(node.costUsd)) return null;
    visited.add(id); let total = node.costUsd;
    for (const child of node.children || []) { const cost = branchCost(child, nodes, visited); if (cost === null) return null; total += cost; }
    return Number.isFinite(total) ? total : null;
  }
  function duration(ms) {
    if (!finite(ms)) return '—';
    const seconds = Math.floor(ms / 1000);
    return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  }
  class AgentTreeView {
    constructor(element, { onTheme } = {}) {
      this.element = element; this.onTheme = onTheme;
      this.collapsed = new Set(); this.nodes = new Map(); this.signature = null; this.snapshot = null; this.seen = new Set(); this.focusedId = null;
      element.innerHTML = `<div class="tree-bar"><div class="tree-bar-title"><span class="tree-spark" aria-hidden="true">✦</span><h2>Agents</h2><span class="tree-live" data-tree-live>Connecting</span></div><div class="tree-totals" role="status" aria-live="polite" aria-atomic="true"></div><div class="tree-theme" role="group" aria-label="Tree color theme"><button type="button" data-tree-theme="light" aria-label="Light mode" title="Light mode">☼</button><button type="button" data-tree-theme="dark" aria-label="Dark mode" title="Dark mode">☾</button><button type="button" data-tree-theme="system" aria-label="System theme" title="System theme">◐</button></div></div><div class="tree-tools"><p>Who started whom, as it happens.</p><div><button type="button" data-tree-action="expand">Expand all</button><button type="button" data-tree-action="collapse">Collapse all</button></div></div><div class="tree-scroll" tabindex="0" role="region" aria-label="Agent hierarchy canvas"><div class="tree-stage"><svg class="tree-links" aria-hidden="true" focusable="false"></svg><div class="tree-forest"></div></div></div><p class="tree-coverage"></p>`;
      this.forest = element.querySelector('.tree-forest'); this.stage = element.querySelector('.tree-stage'); this.scroll = element.querySelector('.tree-scroll'); this.svg = element.querySelector('.tree-links');
      this.click = event => this.handleClick(event); this.key = event => this.handleKey(event);
      this.focus = event => { const item = event.target.closest('[data-tree-id]'); if (item) this.setFocus(item.dataset.treeId, false); };
      element.addEventListener('click', this.click); element.addEventListener('keydown', this.key); element.addEventListener('focusin', this.focus);
      this.resize = () => this.scheduleLines();
      if (typeof ResizeObserver !== 'undefined') { this.observer = new ResizeObserver(this.resize); this.observer.observe(this.stage); this.observer.observe(this.scroll); }
      window.addEventListener('resize', this.resize);
      this.timer = setInterval(() => { if (!document.hidden && !this.element.closest('[hidden]')) this.tick(); }, 1000);
      this.drawEmpty('Waiting for agent monitoring…');
    }
    setConnection(status) {
      const indicator = this.element.querySelector('[data-tree-live]');
      indicator.dataset.state = status; indicator.textContent = status === 'live' ? 'Live' : status === 'stale' ? 'Connection lost · last snapshot' : 'Connecting';
      indicator.title = 'Jobs refresh every 3 seconds while this view is open; session telemetry is sampled every 10 seconds.';
    }
    update(snapshot) {
      this.snapshot = snapshot;
      if (!snapshot || !Array.isArray(snapshot.nodes)) { this.nodes.clear(); this.signature = null; this.element.querySelector('.tree-totals').textContent = 'Monitoring unavailable'; this.drawEmpty('Agent tree data is unavailable. Refresh or update the local server.'); return; }
      this.previousParents = new Map([...this.nodes.values()].map(node => [node.id, node.parentId]));
      this.nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
      this.collapsed = new Set([...this.collapsed].filter(id => this.nodes.has(id)));
      const summary = snapshot.summary || {}, total = summary.totalAgents ?? this.nodes.size;
      const totalCost = finite(summary.totalCostUsd) ? money(summary.totalCostUsd) : '—';
      const totals = `<span><strong>${esc(total)}</strong> agents</span><span class="tree-running-total"><strong>${esc(summary.runningCount ?? 0)}</strong> running</span>${snapshot.nodes.some(n => n.status === 'needs_you') ? `<span class="tree-needs-total">${snapshot.nodes.filter(n => n.status === 'needs_you').length} needs you</span>` : ''}<strong class="tree-total-cost" title="Total reported agent cost">${totalCost}</strong>`;
      const bar = this.element.querySelector('.tree-totals'); if (bar.innerHTML !== totals) bar.innerHTML = totals;
      const costed = summary.costedAgents ?? 0;
      this.element.querySelector('.tree-coverage').textContent = total === 0 ? 'New jobs and observed sub-agents appear here automatically.' : `Cost reported for ${costed} of ${total} agents${finite(summary.totalCostUsd) ? '.' : costed ? ` · known spend ${money(summary.knownCostUsd)}; total unavailable.` : ' · total unavailable.'} Only observed spawn relationships are connected.${snapshot.warnings?.length ? ` ${snapshot.warnings.length} monitoring notice${snapshot.warnings.length === 1 ? '' : 's'}; incomplete links appear as separate roots.` : ''}`;
      this.syncTheme();
      const signature = JSON.stringify([snapshot.nodes, snapshot.rootIds, [...this.collapsed]]);
      if (signature !== this.signature) { this.signature = signature; this.render(); }
      this.tick();
    }
    syncTheme() {
      let value = 'system';
      try { value = localStorage.getItem('route3-theme') || 'system'; } catch { value = document.documentElement.dataset.theme || 'system'; }
      this.element.querySelectorAll('[data-tree-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.treeTheme === value)));
    }
    drawEmpty(message) {
      this.signature = null;
      const hadFocus = this.forest.contains(document.activeElement);
      this.svg.replaceChildren(); this.forest.innerHTML = `<div class="tree-empty"><span aria-hidden="true">⌘</span><h3>No agents to display</h3><p>${esc(message)}</p></div>`;
      this.element.querySelectorAll('[data-tree-action]').forEach(button => { button.disabled = true; });
      if (hadFocus) this.scroll.focus({ preventScroll: true });
    }
    render() {
      if (!this.nodes.size) { this.drawEmpty('Start an agent task to watch the team grow here.'); return; }
      const active = document.activeElement, hadFocus = this.element.contains(active), restore = active?.closest('[data-tree-id]')?.dataset.treeId;
      const wasFold = Boolean(active?.closest('[data-tree-fold]'));
      const left = this.scroll.scrollLeft, top = this.scroll.scrollTop;
      const roots = (this.snapshot.rootIds || []).filter(id => this.nodes.has(id));
      const rendered = new Set();
      const renderNode = (id, depth, position, size) => {
        const node = this.nodes.get(id); if (!node || rendered.has(id)) return ''; rendered.add(id);
        const children = (node.children || []).filter(child => this.nodes.has(child) && !rendered.has(child));
        const isCollapsed = this.collapsed.has(id), status = Object.hasOwn(labels, node.status) ? node.status : 'unknown';
        const hasChildren = children.length > 0, expanded = hasChildren ? ` aria-expanded="${!isCollapsed}"` : '';
        const fresh = this.seen.has(id) ? '' : ' tree-new';
        const childText = `${children.length} ${children.length === 1 ? 'child' : 'children'}`;
        return `<li class="tree-item${depth === 1 ? ' tree-root' : ''}${fresh}" role="treeitem" tabindex="${id === (restore || this.focusedId || roots[0]) ? 0 : -1}" aria-level="${depth}" aria-posinset="${position}" aria-setsize="${size}" aria-label="${esc(node.name || 'Agent')}, ${labels[status]}"${expanded} data-tree-id="${esc(id)}"><article class="tree-card" data-status="${status}"><div class="tree-card-heading"><span class="tree-avatar" aria-hidden="true">${esc((node.name || 'A').slice(0, 1).toUpperCase())}</span><div class="tree-identity"><strong title="${esc(node.name || 'Agent')}">${esc(node.name || 'Agent')}</strong><span title="${esc(node.model || 'Model not reported')}">${esc(node.model || 'Model not reported')}</span></div><span class="tree-status"><span class="tree-status-glyph" aria-hidden="true">${glyphs[status]}</span>${labels[status]}</span></div><p class="tree-task" title="${esc(node.summary || 'Task summary not reported')}">${esc(node.summary || 'Task summary not reported')}</p><div class="tree-card-footer"><span class="tree-cost" title="${hasChildren ? 'Branch total, including descendants' : 'This agent’s own reported cost'}">${esc(money(branchCost(id, this.nodes)))}</span><span class="tree-duration" data-tree-duration="${esc(id)}">${duration(node.durationMs)}</span>${hasChildren ? `<button type="button" class="tree-fold" tabindex="-1" data-tree-fold="${esc(id)}" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'Show' : 'Hide'} ${children.length} sub-agents of ${esc(node.name)}"><span>${children.length}</span><span class="tree-chevron" aria-hidden="true">${isCollapsed ? '›' : '⌄'}</span></button>` : `<span class="tree-child-count" title="${childText}">0 children</span>`}</div></article>${hasChildren && !isCollapsed ? `<ul role="group" class="tree-children ${depth === 1 ? 'tree-first-level' : ''}">${children.map((child, i) => renderNode(child, depth + 1, i + 1, children.length)).join('')}</ul>` : ''}</li>`;
      };
      this.forest.innerHTML = `<ul role="tree" aria-label="Live agent hierarchy" class="tree-roots">${roots.map((id, i) => renderNode(id, 1, i + 1, roots.length)).join('')}</ul>`;
      this.element.querySelectorAll('[data-tree-action]').forEach(button => { button.disabled = ![...this.nodes.values()].some(n => n.children?.length); });
      this.seen = new Set(this.nodes.keys());
      this.scroll.scrollLeft = left; this.scroll.scrollTop = top;
      if (hadFocus && restore) {
        let surviving = restore; const checked = new Set();
        while (surviving && !this.findItem(surviving) && !checked.has(surviving)) { checked.add(surviving); surviving = this.previousParents?.get(surviving) || this.nodes.get(surviving)?.parentId; }
        const item = this.findItem(surviving) || this.forest.querySelector('[role=treeitem]');
        if (item) { this.setFocus(item.dataset.treeId, false); (wasFold ? item.querySelector('.tree-fold') || item : item).focus({ preventScroll: true }); }
        else this.scroll.focus({ preventScroll: true });
      }
      if (!this.forest.querySelector('[role=treeitem][tabindex="0"]')) this.forest.querySelector('[role=treeitem]')?.setAttribute('tabindex', '0');
      this.scheduleLines();
    }
    findItem(id) { return [...this.forest.querySelectorAll('[data-tree-id]')].find(el => el.dataset.treeId === id); }
    setFocus(id, move = true) {
      const item = this.findItem(id); if (!item) return;
      this.focusedId = id;
      this.forest.querySelectorAll('[role=treeitem]').forEach(el => el.tabIndex = el === item ? 0 : -1);
      if (move) {
        item.focus({ preventScroll: true });
        const card = item.querySelector(':scope > .tree-card').getBoundingClientRect(), viewport = this.scroll.getBoundingClientRect();
        if (card.bottom > viewport.bottom - 6) this.scroll.scrollTop += card.bottom - viewport.bottom + 6;
        if (card.top < viewport.top + 6) this.scroll.scrollTop -= viewport.top + 6 - card.top;
        if (card.right > viewport.right - 6) this.scroll.scrollLeft += card.right - viewport.right + 6;
        if (card.left < viewport.left + 6) this.scroll.scrollLeft -= viewport.left + 6 - card.left;
      }
    }
    toggle(id) { if (!this.nodes.get(id)?.children?.length) return; if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id); this.signature = null; this.render(); this.tick(); }
    handleClick(event) {
      const theme = event.target.closest('[data-tree-theme]');
      if (theme) { this.onTheme?.(theme.dataset.treeTheme); this.syncTheme(); return; }
      const fold = event.target.closest('[data-tree-fold]'); if (fold) { this.focusedId = fold.dataset.treeFold; this.toggle(fold.dataset.treeFold); return; }
      const control = event.target.closest('[data-tree-action]');
      if (control) { if (control.dataset.treeAction === 'expand') this.collapsed.clear(); else for (const node of this.nodes.values()) if (node.children?.length) this.collapsed.add(node.id); this.signature = null; this.render(); this.tick(); }
    }
    handleKey(event) {
      const item = event.target.closest('[data-tree-id]'); if (!item || event.target.closest('button')) return;
      const id = item.dataset.treeId, node = this.nodes.get(id), visible = [...this.forest.querySelectorAll('[role=treeitem]')], index = visible.indexOf(item);
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowDown') this.setFocus(visible[Math.min(index + 1, visible.length - 1)].dataset.treeId);
      else if (event.key === 'ArrowUp') this.setFocus(visible[Math.max(index - 1, 0)].dataset.treeId);
      else if (event.key === 'Home') this.setFocus(visible[0].dataset.treeId);
      else if (event.key === 'End') this.setFocus(visible.at(-1).dataset.treeId);
      else if (event.key === 'ArrowRight' && node.children?.length) { if (this.collapsed.has(id)) this.toggle(id); else this.setFocus(node.children[0]); }
      else if (event.key === 'ArrowLeft') { if (node.children?.length && !this.collapsed.has(id)) this.toggle(id); else if (node.parentId) this.setFocus(node.parentId); }
      else if (['Enter', ' '].includes(event.key)) this.toggle(id);
    }
    tick() {
      const now = Date.now();
      this.element.querySelectorAll('[data-tree-duration]').forEach(el => {
        const node = this.nodes.get(el.dataset.treeDuration); if (!node) return;
        const start = Date.parse(node.startedAt), end = Date.parse(node.endedAt);
        const elapsed = finite(start) && ['running', 'needs_you'].includes(node.status) ? Math.max(0, now - start) : finite(start) && finite(end) ? Math.max(0, end - start) : node.durationMs;
        el.textContent = duration(elapsed);
      });
    }
    scheduleLines() { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.drawLines()); }
    drawLines() {
      if (!this.stage.offsetWidth || !this.stage.offsetHeight) return;
      const bounds = this.stage.getBoundingClientRect(), width = this.stage.offsetWidth, height = this.stage.offsetHeight;
      this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`); this.svg.setAttribute('width', width); this.svg.setAttribute('height', height);
      const paths = [];
      for (const item of this.forest.querySelectorAll('[data-tree-id]')) {
        const node = this.nodes.get(item.dataset.treeId), parent = node?.parentId && this.findItem(node.parentId); if (!parent) continue;
        const from = parent.querySelector(':scope > .tree-card').getBoundingClientRect(), to = item.querySelector(':scope > .tree-card').getBoundingClientRect();
        let d, x1, y1, x2, y2;
        if (item.parentElement.classList.contains('tree-first-level') && window.innerWidth >= 640) {
          x1 = from.left + from.width / 2 - bounds.left; y1 = from.bottom - bounds.top; x2 = to.left + to.width / 2 - bounds.left; y2 = to.top - bounds.top;
          const middle = y1 + (y2 - y1) / 2;
          d = `M${x1},${y1} V${middle - 6} Q${x1},${middle} ${x1 + Math.sign(x2 - x1) * 6},${middle} H${x2 - Math.sign(x2 - x1) * 6} Q${x2},${middle} ${x2},${middle + 6} V${y2}`;
          if (Math.abs(x2 - x1) < 12) d = `M${x1},${y1} L${x2},${y2}`;
        } else {
          x1 = from.left + 16 - bounds.left; y1 = from.bottom - bounds.top; x2 = to.left - bounds.left; y2 = to.top + to.height / 2 - bounds.top;
          const bend = Math.min(x1, x2 - 12); d = `M${x1},${y1} H${bend} V${y2 - 7} Q${bend},${y2} ${bend + 7},${y2} H${x2}`;
        }
        const muted = ['stopped', 'unknown'].includes(node.status) ? ' tree-link-muted' : '';
        paths.push(`<path class="tree-link${muted}" d="${d}"/><circle class="tree-port" cx="${x1}" cy="${y1}" r="3"/>`);
      }
      this.svg.innerHTML = paths.join('');
    }
    destroy() { clearInterval(this.timer); cancelAnimationFrame(this.frame); this.observer?.disconnect(); window.removeEventListener('resize', this.resize); this.element.removeEventListener('click', this.click); this.element.removeEventListener('keydown', this.key); this.element.removeEventListener('focusin', this.focus); }
  }
  root.Route3AgentTree = { AgentTreeView, money, duration, branchCost };
  if (typeof module !== 'undefined') module.exports = root.Route3AgentTree;
})(typeof window !== 'undefined' ? window : globalThis);
