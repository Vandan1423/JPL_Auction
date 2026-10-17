// ═══════════════════════════════════════════════════════════════
//  Auction Hub: auctioneer control panel
//  Every change arrives as a full snapshot (HTTP reply or socket event),
//  so the screen is always redrawn from one source of truth.
// ═══════════════════════════════════════════════════════════════
(function () {
    const root = document.getElementById('auctionControl');
    if (!root) return;

    const config = window.AUCTION_CONFIG;
    const initial = window.AUCTION_INITIAL;
    const currency = config.currency;
    const categories = initial.categories;
    const categoryById = new Map(categories.map((c) => [c._id, c]));

    let snapshot = initial.snapshot;
    let queue = initial.queue;
    let activeFilter = 'all';
    let busy = false;
    const seenEvents = new Set();

    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const money = (n) => `${currency.symbol}${Math.round(Number(n) || 0).toLocaleString(currency.locale)}${currency.suffix || ''}`;
    const toast = (message, type = 'info') => (window.showToast ? window.showToast(message, type) : console.log(message));
    const badge = (category, extra = '') =>
        category ? `<span class="badge cat-badge ${extra}" style="--cat:${esc(category.color)}">${esc(category.name)}</span>` : '';
    const avatar = (src, name, cls = 'player-avatar') =>
        src ? `<img src="${esc(src)}" alt="" class="${cls}">` : `<span class="${cls} initials">${esc((name || '?').charAt(0).toUpperCase())}</span>`;

    // ───────────────────────────── Rendering ─────────────────────────────

    function render(next) {
        snapshot = next;
        renderPlayer();
        renderTeams();
        renderHistory();
        renderRecentSales();
        renderStats();
        renderButtons();
        highlightLivePlayer();
    }

    function renderPlayer() {
        const panel = $('currentPlayerPanel');
        const { player, auction } = snapshot;
        if (!player || !auction.isActive) {
            panel.innerHTML = `
                <div class="no-player-selected">
                    <i class="fa-solid fa-gavel"></i>
                    <h2>No player under the hammer</h2>
                    <p>Press <kbd>N</kbd> for the next player, <kbd>R</kbd> for a random one, or click a name on the left.</p>
                </div>`;
            return;
        }

        const bidder = auction.currentBidder;
        const amount = bidder ? auction.currentBid : player.basePrice;
        const photo = player.photo
            ? `<img src="${esc(player.photo)}" alt="" class="showcase-photo">`
            : `<div class="showcase-photo initials">${esc(player.name.charAt(0).toUpperCase())}</div>`;

        panel.innerHTML = `
            <div class="player-showcase">
                <div class="player-image-showcase">${photo}</div>
                <div class="player-details">
                    <h1 class="player-name">${esc(player.name)}</h1>
                    <div class="player-meta">
                        <span class="player-number">#${esc(player.playerNumber)}</span>
                        ${badge(player.category, 'badge-lg')}
                        ${player.role ? `<span class="chip chip-muted">${esc(player.role)}</span>` : ''}
                        ${player.timesUnsold ? `<span class="chip chip-warning">Unsold ×${player.timesUnsold}</span>` : ''}
                    </div>
                    <div class="base-price">Base price: ${money(player.basePrice)}</div>
                </div>
                <div class="current-bid-display">
                    <div class="bid-label">${bidder ? 'Current bid' : 'Opening bid'}</div>
                    <div class="bid-amount-display" id="currentBidAmount">${money(amount)}</div>
                    <div class="bidding-team">
                        ${bidder
                            ? `${bidder.logoSmall ? `<img src="${esc(bidder.logoSmall)}" alt="" class="bidder-logo">` : ''}${esc(bidder.name)}`
                            : 'No bids yet'}
                    </div>
                    <div class="next-bid-hint">Next bid: <strong>${money(auction.nextBid)}</strong></div>
                </div>
            </div>`;
    }

    function renderTeams() {
        const grid = $('teamsBiddingGrid');
        const { player, auction, teams, squad } = snapshot;
        const live = Boolean(player && auction.isActive);
        const leaderId = auction.currentBidder?._id;

        grid.innerHTML = teams.map((team, index) => {
            const leading = live && String(team._id) === String(leaderId);
            const blocked = live && !team.canBid && !leading;
            const key = index < 9 ? index + 1 : index === 9 ? 0 : null;
            const indicator = !live
                ? (team.blockReason === 'squad_full' ? `<div class="bid-cap-indicator cap-full">Squad full</div>` : '')
                : leading
                    ? `<div class="bid-cap-indicator cap-leading">Highest bidder</div>`
                    : blocked
                        ? `<div class="bid-cap-indicator ${team.blockReason === 'squad_full' ? 'cap-full' : 'cap-reached'}">${esc(team.blockLabel)}${team.rolesNeeded?.length ? `: ${esc(team.rolesNeeded.join(' / '))}` : ''}</div>`
                        : '';

            return `
                <div class="team-bid-card ${leading ? 'bidding-active' : ''} ${blocked ? 'team-blocked' : ''}" data-team-id="${team._id}" style="border-left: 4px solid ${esc(team.color)}">
                    <div class="team-header">
                        ${team.logoSmall ? `<img src="${esc(team.logoSmall)}" alt="" class="team-logo-auction">` : `<span class="team-dot" style="--team:${esc(team.color)}"></span>`}
                        <h3 style="color: ${esc(team.color)}">${esc(team.name)}</h3>
                        ${key !== null ? `<kbd class="team-key">${key}</kbd>` : ''}
                    </div>
                    <div class="team-bid-info">
                        <div class="info-line"><span>Purse</span><span class="purse-amount">${money(team.remainingPurse)}</span></div>
                        <div class="info-line"><span>Players</span><span class="players-count">${team.playersCount}/${squad.max}</span></div>
                        <div class="info-line"><span>Max bid</span><span class="max-bid" style="color:${team.maxBidAllowed <= 0 ? 'var(--danger)' : 'var(--primary)'}">${money(team.maxBidAllowed)}</span></div>
                    </div>
                    <div class="bid-options">
                        <button type="button" class="btn-bid btn-bid-quick" data-bid="${team._id}" ${live && team.canBid ? '' : 'disabled'}>
                            Bid ${live ? money(auction.nextBid) : ''}
                        </button>
                        <button type="button" class="btn-bid btn-bid-custom" data-custom-bid="${team._id}" ${live && team.canBid ? '' : 'disabled'}>Custom</button>
                    </div>
                    ${indicator}
                </div>`;
        }).join('');
    }

    function renderHistory() {
        const list = $('bidHistory');
        const history = snapshot.auction.isActive ? snapshot.auction.bidHistory : [];
        list.innerHTML = history.length
            ? history.map((b) => `<div class="bid-entry"><span>${esc(b.teamName)}</span><span class="bid-amount">${money(b.bidAmount)}</span></div>`).join('')
            : '<p class="no-bids">No bids yet</p>';
    }

    function renderRecentSales() {
        const list = $('recentSales');
        const sales = snapshot.recentSales || [];
        list.innerHTML = sales.length
            ? sales.map((s) => `
                <div class="sale-entry">
                    <div class="sale-player">${avatar(s.photoThumb, s.playerName, 'sale-avatar')} ${esc(s.playerName)}</div>
                    <div class="sale-team" style="color:${esc(s.teamColor)}">${esc(s.teamName)}</div>
                    <div class="sale-price">${money(s.price)}</div>
                </div>`).join('')
            : '<p class="no-sales">No sales yet</p>';
    }

    function renderStats() {
        $('roundNumber').textContent = snapshot.auction.roundNumber;
        $('soldCount').textContent = snapshot.counts.sold;
        $('poolCount').textContent = snapshot.counts.pool;
    }

    function renderButtons() {
        const live = Boolean(snapshot.player && snapshot.auction.isActive);
        $('soldBtn').disabled = busy || !live || !snapshot.auction.currentBidder;
        $('unsoldBtn').disabled = busy || !live;
        $('withdrawBtn').disabled = busy || !live || Boolean(snapshot.auction.currentBidder);
        $('undoBtn').disabled = busy || !snapshot.counts.sold;
        $('undoBidBtn').disabled = busy || !live || !snapshot.auction.bidHistory?.length;
        const hasBids = Boolean(live && snapshot.auction.currentBidder);
        $('nextPlayerBtn').disabled = busy || hasBids;
        $('randomPlayerBtn').disabled = $('nextPlayerBtn').disabled;
        $('nextPlayerHint').hidden = !hasBids;
    }

    // ───────────────────────────── Player queue ─────────────────────────────

    function renderFilters() {
        const counts = new Map();
        queue.forEach((p) => counts.set(p.category, (counts.get(p.category) || 0) + 1));
        const button = (id, label, count, color) =>
            `<button type="button" class="filter-btn ${activeFilter === id ? 'active' : ''}" data-filter="${id}" ${color ? `style="--cat:${esc(color)}"` : ''}>${esc(label)} (${count})</button>`;
        $('categoryFilters').innerHTML =
            button('all', 'All', queue.length) + categories.map((c) => button(c._id, c.name, counts.get(c._id) || 0, c.color)).join('');
    }

    function renderQueue() {
        const list = $('playersList');
        if (!queue.length) {
            list.innerHTML = '<p class="no-players"><i class="fa-solid fa-flag-checkered"></i> Every player has been auctioned</p>';
        } else {
            list.innerHTML = queue.map((p) => `
                <div class="player-list-item" data-player-id="${p._id}" data-category="${p.category || ''}" data-name="${esc(p.name.toLowerCase())}" tabindex="0" role="button">
                    <span class="player-drag-handle" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>
                    ${avatar(p.photoThumb, p.name, 'queue-avatar')}
                    <div class="player-info">
                        <span class="player-number">#${p.playerNumber}</span>
                        <span class="player-name-text">${esc(p.name)}</span>
                        ${p.status === 'unsold' ? `<span class="chip chip-warning">unsold${p.timesUnsold > 1 ? ` ×${p.timesUnsold}` : ''}</span>` : ''}
                    </div>
                    ${badge(categoryById.get(p.category))}
                </div>`).join('');
        }
        renderFilters();
        applyListFilter();
        highlightLivePlayer();
    }

    function applyListFilter() {
        const term = $('playerSearch').value.trim().toLowerCase();
        document.querySelectorAll('#playersList .player-list-item').forEach((item) => {
            const matchesCategory = activeFilter === 'all' || item.dataset.category === activeFilter;
            const matchesSearch = !term || item.dataset.name.includes(term);
            item.style.display = matchesCategory && matchesSearch ? '' : 'none';
        });
    }

    function highlightLivePlayer() {
        const liveId = snapshot.auction.isActive && snapshot.player ? String(snapshot.player._id) : null;
        document.querySelectorAll('#playersList .player-list-item').forEach((item) => {
            item.classList.toggle('in-auction', item.dataset.playerId === liveId);
        });
    }

    async function refreshQueue() {
        try {
            const res = await fetch('/auction/api/queue', { headers: { Accept: 'application/json' } });
            const data = await res.json();
            if (data.success) {
                queue = data.queue;
                renderQueue();
            }
        } catch (error) {
            console.warn('Could not refresh the player list', error);
        }
    }

    // ───────────────────────────── Actions ─────────────────────────────

    async function call(url, body = {}) {
        if (busy) return null;
        busy = true;
        renderButtons();
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({ success: false, message: `Request failed (${res.status})` }));
            if (res.status === 401) {
                toast('Your session expired. Please log in again.', 'warning');
                setTimeout(() => { window.location.href = '/admin/login'; }, 1500);
                return null;
            }
            if (!data.success) {
                toast(data.message || 'Not allowed', 'warning');
                return null;
            }
            if (data.event) handleEvent(data.event);
            if (data.message && data.event?.type !== 'bid') toast(data.message, data.event?.type === 'sold' ? 'success' : 'info');
            return data;
        } catch (error) {
            toast('Network error: ' + error.message, 'error');
            return null;
        } finally {
            busy = false;
            renderButtons();
        }
    }

    const selectPlayer = (playerId) => call('/auction/api/start-player', { playerId });
    const nextPlayer = (random) =>
        call('/auction/api/next-player', { random, categoryId: activeFilter === 'all' ? null : activeFilter });
    const placeBid = (teamId, amount = null) => call('/auction/api/place-bid', amount === null ? { teamId } : { teamId, amount });

    async function markSold() {
        const { player, auction } = snapshot;
        if (!player || !auction.currentBidder) return;
        if (await confirmModal(`Sell ${player.name} to ${auction.currentBidder.name} for ${money(auction.currentBid)}?`)) {
            call('/auction/api/mark-sold');
        }
    }

    async function markUnsold() {
        const { player, auction } = snapshot;
        if (!player || !auction.isActive) return;
        const warning = auction.currentBidder ? ` There is a bid of ${money(auction.currentBid)}; it will be discarded.` : '';
        if (await confirmModal(`Mark ${player.name} as UNSOLD?${warning}`)) call('/auction/api/mark-unsold');
    }

    async function withdrawCurrent() {
        const { player } = snapshot;
        if (!player) return;
        if (await confirmModal(`Withdraw ${player.name} from the auction? They won't come up again unless you edit them back.`)) {
            call('/auction/api/withdraw-player', { playerId: player._id });
        }
    }

    // No confirmation: undoing a bid is itself easy to redo by bidding again.
    function undoLastBid() {
        if ($('undoBidBtn').disabled) return;
        call('/auction/api/undo-bid');
    }

    async function undoLastSale() {
        const last = snapshot.recentSales?.[0];
        if (!last) return toast('There is no sale to undo', 'info');
        if (await confirmModal(`Undo the last sale (${last.playerName} → ${last.teamName}, ${money(last.price)})? The player goes back to the top of the queue.`)) {
            call('/auction/api/undo-sale');
        }
    }

    // ───────────────────────────── Live events ─────────────────────────────

    function handleEvent(event) {
        if (!event || seenEvents.has(event.id)) return;
        seenEvents.add(event.id);
        if (seenEvents.size > 200) seenEvents.delete(seenEvents.values().next().value);

        render(event.snapshot);

        if (event.type === 'bid') {
            const amountEl = $('currentBidAmount');
            amountEl?.classList.add('bid-update');
            setTimeout(() => amountEl?.classList.remove('bid-update'), 400);
        }
        if (event.type === 'sold' && event.sale) showSoldAnimation(event.sale);
        if (['sold', 'unsold', 'undo', 'withdrawn', 'reset'].includes(event.type)) refreshQueue();
    }

    function showSoldAnimation(sale) {
        const overlay = document.createElement('div');
        overlay.className = 'sold-overlay';
        overlay.innerHTML = `
            <div class="sold-content">
                <h1 class="sold-title">SOLD!</h1>
                <div class="sold-details">
                    <p class="sold-player">${esc(sale.playerName)}</p>
                    <p class="sold-to" style="color:${esc(sale.teamColor || '#fff')}">to ${esc(sale.teamName)}</p>
                    <p class="sold-price">${money(sale.price)}</p>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        if (typeof confetti === 'function') confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 } });
        const close = () => { overlay.classList.add('fade-out'); setTimeout(() => overlay.remove(), 400); };
        overlay.addEventListener('click', close);
        setTimeout(close, 2600);
    }

    // ───────────────────────────── Live updates ─────────────────────────────
    // Socket.IO when the server runs it; otherwise (e.g. on Vercel) poll the
    // snapshot. Either way the latest event arrives with the snapshot.

    const status = document.createElement('div');
    status.className = 'connection-status connecting';
    status.textContent = 'Connecting…';
    document.body.appendChild(status);
    const setStatus = (state, text) => { status.className = `connection-status ${state}`; status.textContent = text; };

    if (config.realtime === 'socket' && typeof io !== 'undefined') {
        const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, transports: ['polling', 'websocket'] });
        socket.on('connect', () => {
            setStatus('connected', 'Live');
            socket.emit('join-tournament', config.tournamentId);
        });
        socket.on('disconnect', () => setStatus('disconnected', 'Offline: reconnecting…'));
        socket.on('connect_error', () => setStatus('connecting', 'Connecting…'));
        socket.on('auction:state', (state) => {
            render(state);
            refreshQueue();
        });
        socket.on('auction:event', handleEvent);
    } else {
        // Events that happened before this page loaded must not replay.
        if (snapshot.lastEvent) seenEvents.add(snapshot.lastEvent.id);
        const poll = async () => {
            try {
                const res = await fetch('/auction/api/state', { headers: { Accept: 'application/json' } });
                if (res.status === 401) {
                    window.location.href = '/admin/login';
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    setStatus('connected', 'Live');
                    const event = data.snapshot.lastEvent;
                    if (event && !seenEvents.has(event.id)) handleEvent({ ...event, snapshot: data.snapshot });
                    else if (!busy) render(data.snapshot);
                }
            } catch {
                setStatus('disconnected', 'Offline: retrying…');
            }
            // Slow down while the tab is in the background.
            setTimeout(poll, document.hidden ? 5000 : 1500);
        };
        setTimeout(poll, 1500);
    }

    // ───────────────────────────── Custom bid modal ─────────────────────────────

    let customTeamId = null;
    function openCustomBid(teamId) {
        const team = snapshot.teams.find((t) => String(t._id) === String(teamId));
        if (!team) return;
        customTeamId = teamId;
        $('customBidTeamName').textContent = team.name;
        $('customBidHint').textContent = `Minimum ${money(snapshot.auction.nextBid)} · ${team.name} can go up to ${money(team.maxBidAllowed)}`;
        const input = $('customBidInput');
        input.value = snapshot.auction.nextBid;
        input.min = snapshot.auction.nextBid;
        input.max = team.maxBidAllowed;
        $('customBidModal').style.display = 'flex';
        setTimeout(() => { input.focus(); input.select(); }, 50);
    }
    const closeCustomBid = () => { $('customBidModal').style.display = 'none'; customTeamId = null; };
    $('customBidForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const amount = Number($('customBidInput').value);
        const teamId = customTeamId;
        closeCustomBid();
        if (teamId) placeBid(teamId, amount);
    });
    $('customBidCancel').addEventListener('click', closeCustomBid);
    $('customBidModal').addEventListener('click', (event) => { if (event.target.id === 'customBidModal') closeCustomBid(); });

    // ───────────────────────────── Confirm modal ─────────────────────────────

    function confirmModal(message) {
        return new Promise((resolve) => {
            const modal = $('confirmModal');
            $('confirmMessage').textContent = message;
            modal.style.display = 'flex';
            const yes = $('confirmYes');
            const no = $('confirmNo');
            const done = (answer) => {
                modal.style.display = 'none';
                yes.removeEventListener('click', onYes);
                no.removeEventListener('click', onNo);
                document.removeEventListener('keydown', onKey, true);
                resolve(answer);
            };
            const onYes = () => done(true);
            const onNo = () => done(false);
            // Enter is handled natively by the focused "Yes" button; only Escape needs a hook.
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
            };
            yes.addEventListener('click', onYes);
            no.addEventListener('click', onNo);
            document.addEventListener('keydown', onKey, true);
            yes.focus();
        });
    }

    // ───────────────────────────── Wiring ─────────────────────────────

    // A clicked button keeps keyboard focus, and Space/Enter would then "click" it
    // again on top of the shortcut. Hand focus back to the page after each click.
    document.addEventListener('click', (event) => {
        const button = event.target.closest('#auctionControl button');
        if (button) setTimeout(() => button.blur(), 0);
    });

    root.addEventListener('click', (event) => {
        const bid = event.target.closest('[data-bid]');
        if (bid && !bid.disabled) return placeBid(bid.dataset.bid);
        const custom = event.target.closest('[data-custom-bid]');
        if (custom && !custom.disabled) return openCustomBid(custom.dataset.customBid);
        const filter = event.target.closest('[data-filter]');
        if (filter) {
            activeFilter = filter.dataset.filter;
            renderFilters();
            applyListFilter();
            return;
        }
        const item = event.target.closest('.player-list-item');
        if (item && !event.target.closest('.player-drag-handle') && !reorderMode) selectPlayer(item.dataset.playerId);
    });
    $('playersList').addEventListener('keydown', (event) => {
        const item = event.target.closest('.player-list-item');
        if (item && event.key === 'Enter') selectPlayer(item.dataset.playerId);
    });
    $('playerSearch').addEventListener('input', applyListFilter);
    $('nextPlayerBtn').addEventListener('click', () => nextPlayer(false));
    $('randomPlayerBtn').addEventListener('click', () => nextPlayer(true));
    $('soldBtn').addEventListener('click', markSold);
    $('unsoldBtn').addEventListener('click', markUnsold);
    $('withdrawBtn').addEventListener('click', withdrawCurrent);
    $('undoBtn').addEventListener('click', undoLastSale);
    $('undoBidBtn').addEventListener('click', undoLastBid);
    const shortcuts = $('shortcutsDialog');
    $('shortcutsBtn').addEventListener('click', () => shortcuts.showModal());
    shortcuts.querySelector('[data-close-dialog]').addEventListener('click', () => shortcuts.close());

    // Drag-to-reorder the queue (saved immediately).
    let reorderMode = false;
    let sortable = null;
    $('toggleReorderBtn').addEventListener('click', () => {
        reorderMode = !reorderMode;
        root.classList.toggle('reorder-mode', reorderMode);
        $('toggleReorderBtn').innerHTML = reorderMode
            ? '<i class="fa-solid fa-check"></i> Done'
            : '<i class="fa-solid fa-arrow-up-down"></i> Reorder';
        if (reorderMode && !sortable && typeof Sortable !== 'undefined') {
            sortable = Sortable.create($('playersList'), { handle: '.player-drag-handle', animation: 150, ghostClass: 'player-item-ghost', onEnd: saveOrder });
        }
    });
    async function saveOrder() {
        const playerIds = [...document.querySelectorAll('#playersList .player-list-item')].map((el) => el.dataset.playerId);
        $('reorderStatus').textContent = 'Saving…';
        try {
            const res = await fetch('/admin/api/players/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ playerIds }),
            });
            const data = await res.json();
            $('reorderStatus').textContent = data.success ? 'Saved' : 'Not saved';
            const order = new Map(playerIds.map((id, i) => [id, i]));
            queue.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
        } catch {
            $('reorderStatus').textContent = 'Not saved';
        }
        setTimeout(() => { $('reorderStatus').textContent = ''; }, 2000);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
        const modalOpen = $('confirmModal').style.display === 'flex' || $('customBidModal').style.display === 'flex' || shortcuts.open;
        // Ignore held-down keys so one press can never place two bids.
        if (typing || modalOpen || event.repeat) return;

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            return undoLastSale();
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        if (/^[0-9]$/.test(event.key)) {
            const index = event.key === '0' ? 9 : Number(event.key) - 1;
            const team = snapshot.teams[index];
            if (team && team.canBid && snapshot.auction.isActive) placeBid(team._id);
            return;
        }
        switch (event.key.toLowerCase()) {
            case ' ':
                event.preventDefault();
                markSold();
                break;
            case 'u':
                markUnsold();
                break;
            case 'backspace':
                event.preventDefault();
                undoLastBid();
                break;
            case 'n':
                if (!$('nextPlayerBtn').disabled) nextPlayer(false);
                break;
            case 'r':
                if (!$('randomPlayerBtn').disabled) nextPlayer(true);
                break;
            case '/':
                event.preventDefault();
                $('playerSearch').focus();
                break;
            default:
        }
    });

    render(snapshot);
    renderQueue();
})();
