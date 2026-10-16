// ═══════════════════════════════════════════════════════════════
//  Auction Hub: live display (projector screen)
//  Renders from the same snapshots the control panel uses.
// ═══════════════════════════════════════════════════════════════

const DISPLAY = window.DISPLAY_CONFIG;
const currency = DISPLAY.currency;
let snapshot = DISPLAY.snapshot;
const seenEvents = new Set();
let overlayUntil = 0; // while a SOLD/UNSOLD overlay plays, hold the stage

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `${currency.symbol}${Math.round(Number(n) || 0).toLocaleString(currency.locale)}${currency.suffix || ''}`;
const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
};

// ─── Rendering ───

function render(next) {
    snapshot = next;
    setText('displayRound', snapshot.auction.roundNumber);
    setText('displaySold', snapshot.counts.sold);
    setText('displayTotal', snapshot.counts.total);
    if (Date.now() >= overlayUntil) renderStage();
    renderTeams();
}

function renderStage() {
    const section = document.getElementById('currentPlayerSection');
    const { player, auction } = snapshot;
    if (!player || !auction.isActive) {
        section.innerHTML = `
            <div class="no-auction">
                <div class="no-auction-content">
                    <h2>${snapshot.counts.sold ? 'NEXT PLAYER COMING UP' : 'BIDDING STARTING SOON'}</h2>
                    <p>${snapshot.counts.pool ? `${snapshot.counts.pool} players still to be auctioned` : 'Please wait for the auction to begin'}</p>
                </div>
            </div>`;
        return;
    }

    const bidder = auction.currentBidder;
    const category = player.category;
    section.innerHTML = `
        <div class="player-display">
            ${player.photo
                ? `<div class="player-image-container"><img src="${esc(player.photo)}" alt="" class="player-image" /></div>`
                : `<div class="player-image-container is-placeholder"><span class="player-image-placeholder">${esc(player.name.charAt(0).toUpperCase())}</span></div>`}
            <div class="player-display-left">
                <div class="player-display-info">
                    ${category ? `<span class="player-category-badge" style="--cat:${esc(category.color)}">${esc(category.name)}</span>` : ''}
                    ${player.role ? `<span class="player-type-badge">${esc(player.role)}</span>` : ''}
                </div>
                <h2 class="player-display-name">${esc(player.name)}</h2>
                <div class="player-display-base">Base price: ${money(player.basePrice)}</div>
            </div>
            <div class="player-display-right">
                <div class="current-bid-section">
                    <div class="bid-header">${bidder ? 'CURRENT BID' : 'OPENING BID'}</div>
                    <div class="bid-display-amount" id="displayBidAmount">${money(bidder ? auction.currentBid : player.basePrice)}</div>
                    <div class="bid-display-team" id="displayBiddingTeam" ${bidder ? `style="color:${esc(bidder.color)}"` : ''}>
                        ${bidder
                            ? `${bidder.logoSmall ? `<img src="${esc(bidder.logoSmall)}" alt="" class="bidder-logo" />` : ''}${esc(bidder.name)}`
                            : 'Waiting for bids…'}
                    </div>
                </div>
            </div>
        </div>`;
}

function renderTeams() {
    const grid = document.getElementById('teamsDisplayGrid');
    const { teams, squad, auction } = snapshot;
    // Fit any number of teams (2–20) on one screen.
    const n = teams.length;
    const cols = n <= 4 ? Math.max(n, 1) : n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : n <= 12 ? 6 : n <= 16 ? 8 : 10;
    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--rows', Math.max(1, Math.ceil(n / cols)));
    grid.innerHTML = teams.map((team) => {
        const leading = auction.isActive && auction.currentBidder && String(auction.currentBidder._id) === String(team._id);
        const percent = Math.min(100, (team.playersCount / squad.max) * 100);
        return `
            <div class="team-card ${leading ? 'bidding-highlight' : ''}" data-team-id="${team._id}" style="--tc: ${esc(team.color)}">
                <div class="team-card__accent"></div>
                <div class="team-card__header">
                    ${team.logoSmall ? `<img src="${esc(team.logoSmall)}" alt="" class="team-card__logo" />` : ''}
                    <h3 class="team-card__name">${esc(team.name)}</h3>
                </div>
                <div class="team-card__stats">
                    <div class="team-card__stat">
                        <span class="team-card__stat-val">${team.playersCount}/${squad.max}</span>
                        <span class="team-card__stat-lbl">Players</span>
                    </div>
                    <div class="team-card__stat">
                        <span class="team-card__stat-val">${money(team.remainingPurse)}</span>
                        <span class="team-card__stat-lbl">Purse left</span>
                    </div>
                </div>
                <div class="team-card__progress">
                    <div class="team-card__progress-bar"><div class="team-card__progress-fill" style="width: ${percent}%"></div></div>
                </div>
            </div>`;
    }).join('');
}

// ─── Events ───

function handleEvent(event) {
    if (!event || seenEvents.has(event.id)) return;
    seenEvents.add(event.id);

    if (event.type === 'sold' && event.sale) {
        overlayUntil = Date.now() + 5500;
        render(event.snapshot);
        showSoldOverlay(event.sale);
        setTimeout(() => {
            hideOverlay('soldOverlay');
            stopCrackers();
            renderStage();
        }, 5500);
        return;
    }
    if (event.type === 'unsold' && event.unsold) {
        overlayUntil = Date.now() + 3500;
        render(event.snapshot);
        showUnsoldOverlay(event.unsold);
        setTimeout(() => {
            hideOverlay('unsoldOverlay');
            renderStage();
        }, 3500);
        return;
    }

    if (event.type === 'player-selected') {
        // A new player cancels any overlay still on screen.
        overlayUntil = 0;
        hideOverlay('soldOverlay');
        hideOverlay('unsoldOverlay');
    }
    render(event.snapshot);

    if (event.type === 'bid') {
        const amount = document.getElementById('displayBidAmount');
        amount?.classList.add('pulse-animation');
        setTimeout(() => amount?.classList.remove('pulse-animation'), 500);
        document.getElementById('displayBiddingTeam')?.classList.add('fade-in');
        spawnBidParticles();
    }
}

// ─── Overlays ───

function showSoldOverlay(sale) {
    const photo = document.getElementById('soldPlayerPhoto');
    photo.innerHTML = sale.photo ? `<img src="${esc(sale.photo)}" alt="" />` : '';
    photo.style.display = sale.photo ? 'block' : 'none';
    setText('soldPlayerName', sale.playerName);

    const logo = document.getElementById('soldTeamLogo');
    if (sale.teamLogo) {
        logo.src = sale.teamLogo;
        logo.style.display = 'block';
    } else {
        logo.style.display = 'none';
    }
    const teamName = document.getElementById('soldTeamName');
    teamName.textContent = (sale.teamName || '').toUpperCase();
    teamName.style.color = sale.teamColor || '#22c55e';
    teamName.style.textShadow = `0 0 30px ${sale.teamColor || '#22c55e'}`;
    setText('soldPrice', money(sale.price));

    showOverlay('soldOverlay');
    launchCrackers();
}

function showUnsoldOverlay(unsold) {
    const photo = document.getElementById('unsoldPlayerPhoto');
    photo.innerHTML = unsold.photo ? `<img src="${esc(unsold.photo)}" alt="" />` : '';
    photo.style.display = unsold.photo ? 'block' : 'none';
    setText('unsoldPlayerName', unsold.playerName);
    const subtitle = document.getElementById('unsoldSubtitle');
    subtitle.textContent = unsold.movedFrom ? `Moved from ${unsold.movedFrom} to ${unsold.movedTo} • Back in the queue` : 'Back in the queue';
    subtitle.style.display = 'block';
    showOverlay('unsoldOverlay');
}

function showOverlay(id) {
    const overlay = document.getElementById(id);
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('show-overlay'));
}

function hideOverlay(id) {
    const overlay = document.getElementById(id);
    if (!overlay || overlay.style.display === 'none') return;
    overlay.classList.remove('show-overlay');
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
}

// ─── Socket + fallback polling ───

const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, transports: ['polling', 'websocket'] });

function setConnectionStatus(connected) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    el.textContent = connected ? '🟢 Live' : '🔴 Reconnecting';
    el.className = `header-stat connection-status ${connected ? '' : 'disconnected'}`;
}

socket.on('connect', () => {
    setConnectionStatus(true);
    socket.emit('join-tournament', DISPLAY.tournamentId);
});
socket.on('disconnect', () => setConnectionStatus(false));
socket.on('auction:state', render);
socket.on('auction:event', handleEvent);

setInterval(async () => {
    if (socket.connected) return;
    try {
        const res = await fetch(`/api/display/${encodeURIComponent(DISPLAY.slug)}`);
        const data = await res.json();
        if (data.success) render(data.snapshot);
    } catch {
        // Server unreachable; keep showing the last known state.
    }
}, 10000);

// ═══════════════ VISUAL EFFECTS ═══════════════

let crackersRunning = false;

function launchCrackers() {
    const canvas = document.getElementById('crackersCanvas');
    if (!canvas) return;

    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    crackersRunning = true;
    const particles = [];
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#FF9FF3', '#54A0FF', '#5F27CD', '#01A3A4', '#F368E0', '#FF6348', '#7BED9F', '#70A1FF'];
    const shapes = ['circle', 'rect', 'star', 'ribbon'];

    function createBurst(cx, cy, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 4 + Math.random() * 10;
            const shape = shapes[Math.floor(Math.random() * shapes.length)];
            particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: shape === 'ribbon' ? 8 + Math.random() * 10 : 3 + Math.random() * 5,
                life: 1,
                decay: 0.006 + Math.random() * 0.012,
                shape,
                rotation: Math.random() * 360,
                rotSpeed: (Math.random() - 0.5) * 12,
                wobble: Math.random() * 10,
                wobbleSpeed: 0.05 + Math.random() * 0.1,
            });
        }
    }

    const w = canvas.width;
    const h = canvas.height;
    createBurst(w * 0.2, h * 0.3, 80);
    createBurst(w * 0.8, h * 0.3, 80);
    createBurst(w * 0.5, h * 0.15, 100);
    createBurst(w * 0.1, h * 0.5, 60);
    createBurst(w * 0.9, h * 0.5, 60);

    let frame = 0;
    function drawStar(cx, cy, size, rotation) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const a = ((i * 72 - 90) * Math.PI) / 180;
            ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
            const a2 = ((i * 72 + 36 - 90) * Math.PI) / 180;
            ctx.lineTo(Math.cos(a2) * size * 0.4, Math.sin(a2) * size * 0.4);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function animate() {
        ctx.clearRect(0, 0, w, h);
        frame++;
        if (crackersRunning && frame % 40 === 0) createBurst(Math.random() * w, Math.random() * h * 0.4, 35 + Math.floor(Math.random() * 30));

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx + Math.sin(p.wobble) * 0.5;
            p.vy += 0.12;
            p.vx *= 0.99;
            p.y += p.vy;
            p.rotation += p.rotSpeed;
            p.wobble += p.wobbleSpeed;
            p.life -= p.decay;
            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }
            ctx.globalAlpha = Math.min(p.life, 1);
            ctx.fillStyle = p.color;
            if (p.shape === 'circle') {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.shape === 'star') {
                drawStar(p.x, p.y, p.size, p.rotation);
            } else {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                else ctx.fillRect(-p.size / 2, -1.5, p.size, 3);
                ctx.restore();
            }
        }
        ctx.globalAlpha = 1;

        if (particles.length > 0 || crackersRunning) requestAnimationFrame(animate);
        else canvas.style.display = 'none';
    }
    animate();
}

function stopCrackers() {
    crackersRunning = false; // remaining particles fade out naturally
}

function spawnBidParticles() {
    const anchor = document.querySelector('.bid-display-amount');
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < 18; i++) {
        const p = document.createElement('div');
        Object.assign(p.style, {
            position: 'fixed', width: '5px', height: '5px', background: '#fbbf24', borderRadius: '50%',
            left: `${cx}px`, top: `${cy}px`, zIndex: '99999', pointerEvents: 'none', boxShadow: '0 0 8px #fbbf24',
        });
        document.body.appendChild(p);
        const angle = (Math.PI * 2 * i) / 18;
        const dist = 40 + Math.random() * 60;
        p.animate(
            [
                { left: `${cx}px`, top: `${cy}px`, opacity: 1, transform: 'scale(1)' },
                { left: `${cx + Math.cos(angle) * dist}px`, top: `${cy + Math.sin(angle) * dist}px`, opacity: 0, transform: 'scale(0)' },
            ],
            { duration: 700, easing: 'ease-out' }
        );
        setTimeout(() => p.remove(), 700);
    }
}

// ═══════════════ LIVE CLOCK ═══════════════
function tickClock() {
    const el = document.getElementById('liveClock');
    if (el) el.textContent = new Date().toLocaleTimeString(currency.locale || 'en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase();
}
tickClock();
setInterval(tickClock, 1000);

render(snapshot);
