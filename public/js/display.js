// ═══════════════════════════════════════════════════════════════
//  Auction Hub — Live Display  (Socket.IO + Beautiful Animations)
// ═══════════════════════════════════════════════════════════════

// Socket.io configuration for better reconnection handling
const socket = io({
    timeout: 120000, // 2 minutes
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    maxReconnectionAttempts: 10,
    forceNew: false,
    transports: ['polling', 'websocket']
});

let reconnectAttempts = 0;
let keepAliveInterval = null;

// ─── Connection ───
socket.on("connect", () => {
    console.log("Display connected:", socket.id);
    socket.emit("join-room", "auction-room");
    setConnectionStatus(true);
    reconnectAttempts = 0;
    
    // Start keep-alive mechanism
    startKeepAlive();
    
    // Request state restoration on reconnection
    socket.emit('restore-state');
});

socket.on("disconnect", (reason) => {
    console.log("Display disconnected, reason:", reason);
    setConnectionStatus(false);
    stopKeepAlive();
});

socket.on('connect_error', (error) => {
    reconnectAttempts++;
    console.log(`Display connection attempt ${reconnectAttempts} failed:`, error);
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Display reconnected after', attemptNumber, 'attempts');
    setConnectionStatus(true);
});

socket.on('reconnecting', (attemptNumber) => {
    console.log('Display attempting to reconnect, attempt:', attemptNumber);
});

socket.on("connected", (data) => {
    console.log("Confirmed:", data.socketId);
    
    // If initial connection includes current state, restore it
    if (data.auctionState && data.auctionState.isActive && data.auctionState.currentPlayer) {
        displayNewPlayer(data.auctionState.currentPlayer, data.auctionState);
        if (data.teamsData) updateTeamsDisplay(data.teamsData);
    }
});

socket.on('state-restored', (data) => {
    console.log('Display state restored from server');
    
    // Restore auction state if active
    if (data.auctionState && data.auctionState.isActive && data.auctionState.currentPlayer) {
        displayNewPlayer(data.auctionState.currentPlayer, data.auctionState);
        if (data.teamsData) updateTeamsDisplay(data.teamsData);
    }
});

// Keep-alive functionality
function startKeepAlive() {
    stopKeepAlive(); // Clear any existing interval
    keepAliveInterval = setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('ping');
        }
    }, 25000); // Send ping every 25 seconds
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

socket.on('pong', () => {
    // Keep-alive response received
    console.log('Display keep-alive pong received');
});

// ─── Socket Events ───
socket.on("player-selected", (data) => {
    displayNewPlayer(data.player, data.auctionState);
    if (data.teams) updateTeamsDisplay(data.teams);
});

socket.on("bid-placed", (data) => {
    animateBid(data.newBid, data.team);
    if (data.teamsData) updateTeamsDisplay(data.teamsData);
    highlightTeam(data.team._id);
    spawnBidParticles();
});

socket.on("player-sold", (data) => {
    showSoldOverlay(data.player, data.team, data.price);
    launchCrackers();
    setTimeout(() => {
        hideSoldOverlay();
        stopCrackers();
        if (data.teamsData) updateTeamsDisplay(data.teamsData);
        clearStage();
        updateChip("displayRound", data.roundNumber || 0);
        refreshSoldCount();
    }, 5500);
});

socket.on("player-unsold", (data) => {
    const player = data.player;
    showUnsoldOverlay(player);
    setTimeout(() => {
        hideUnsoldOverlay();
        clearStage();
    }, 3500);
});

socket.on("auction-ended", () => {
    clearStage();
    refreshSoldCount();
});

// ─── Display Functions ───
function displayNewPlayer(player, auctionState) {
    const section = document.getElementById("currentPlayerSection");
    if (!section) return;

    const imageSection = player.imageUrl ? `
        <div class="player-image-container">
            <img src="${player.imageUrl}" alt="${player.name}" class="player-image" onerror="this.style.display='none'" />
        </div>` : '';

    section.innerHTML = `
        <div class="player-display">
            ${imageSection}
            <div class="player-display-left">
                <div class="player-display-info">
                    <span class="player-type-badge">${player.playerType}</span>
                </div>
                <h2 class="player-display-name">${player.name}</h2>
                <div class="player-display-base">
                    Base Price: ₹${player.basePrice.toLocaleString('en-IN')}
                </div>
            </div>
            <div class="player-display-right">
                <div class="current-bid-section">
                    <div class="bid-header">CURRENT BID</div>
                    <div class="bid-display-amount" id="displayBidAmount">
                        ₹${(auctionState.currentBid || player.basePrice).toLocaleString('en-IN')}
                    </div>
                    <div class="bid-display-team" id="displayBiddingTeam">
                        Waiting for bids...
                    </div>
                </div>
            </div>
        </div>`;
}

function animateBid(amount, team) {
    const amountEl = document.getElementById("displayBidAmount");
    const teamEl = document.getElementById("displayBiddingTeam");
    
    if (amountEl) {
        amountEl.textContent = "₹" + amount.toLocaleString("en-IN");
        amountEl.classList.add("pulse-animation");
        setTimeout(() => amountEl.classList.remove("pulse-animation"), 500);
    }
    
    if (teamEl && team) {
        const logoSection = team.logo ? `<img src="${team.logo}" alt="${team.teamName}" style="width: 45px; height: 45px; object-fit: contain; filter: drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.3)); margin-right: 10px;">` : '';
        teamEl.innerHTML = `${logoSection}${team.teamName}`;
        teamEl.style.color = team.color;
        teamEl.classList.add("fade-in");
        setTimeout(() => teamEl.classList.remove("fade-in"), 500);
    }
}

function updateTeamsDisplay(teams) {
    const grid = document.getElementById("teamsDisplayGrid");
    if (!grid || !Array.isArray(teams)) return;

    teams.forEach(team => {
        const card = document.querySelector(`.team-card[data-team-id="${team._id}"]`);
        if (!card) return;

        const playersCountEl = card.querySelector(".players-count");
        const purseValueEl = card.querySelector(".purse-value");
        const progressFillEl = card.querySelector(".team-card__progress-fill");
        const progressTextEl = card.querySelector(".team-card__progress-text");

        if (playersCountEl) playersCountEl.textContent = `${team.playersCount}/9`;
        if (purseValueEl) purseValueEl.textContent = `₹${team.remainingPurse.toLocaleString('en-IN')}`;
        if (progressFillEl) {
            progressFillEl.style.width = `${(team.playersCount / 9) * 100}%`;
        }
        if (progressTextEl) progressTextEl.textContent = `${team.playersCount}/9 Players`;
    });
}

function setConnectionStatus(connected) {
    const statusEl = document.getElementById("connectionStatus");
    if (statusEl) {
        statusEl.textContent = connected ? "🟢 Live" : "🔴 Offline";
        statusEl.className = `header-stat connection-status ${connected ? "" : "disconnected"}`;
    }
}

function updateChip(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = value;
}

function highlightTeam(teamId) {
    document.querySelectorAll(".team-card").forEach(c => c.classList.remove("bidding-highlight"));
    const card = document.querySelector(`.team-card[data-team-id="${teamId}"]`);
    if (card) card.classList.add("bidding-highlight");
}

// ─── Overlays ───

// ── SOLD OVERLAY ──
function showSoldOverlay(player, team, price) {
    const overlay = document.getElementById("soldOverlay");
    if (!overlay) return;

    // Player photo
    const photoWrap = document.getElementById("soldPlayerPhoto");
    if (photoWrap) {
        if (player.imageUrl) {
            photoWrap.innerHTML = `<img src="${player.imageUrl}" alt="${player.name}" />`;
            photoWrap.style.display = "block";
        } else {
            photoWrap.style.display = "none";
        }
    }

    // Player name
    setText("soldPlayerName", player.name);

    // Team row
    const logoEl = document.getElementById("soldTeamLogo");
    const teamNameEl = document.getElementById("soldTeamName");
    if (logoEl) {
        if (team.logo) {
            logoEl.src = team.logo;
            logoEl.alt = team.teamName;
            logoEl.style.display = "block";
        } else {
            logoEl.style.display = "none";
        }
    }
    if (teamNameEl) {
        teamNameEl.textContent = team.teamName.toUpperCase();
        teamNameEl.style.color = team.color || "#22c55e";
        teamNameEl.style.textShadow = `0 0 30px ${team.color || "#22c55e"}`;
    }

    // Price
    setText("soldPrice", "₹" + price.toLocaleString("en-IN"));

    overlay.style.display = "flex";
    requestAnimationFrame(() => overlay.classList.add("show-overlay"));
}

function hideSoldOverlay() {
    const overlay = document.getElementById("soldOverlay");
    if (!overlay) return;
    overlay.classList.remove("show-overlay");
    setTimeout(() => { overlay.style.display = "none"; }, 500);
}

// ── UNSOLD OVERLAY ──
function showUnsoldOverlay(player) {
    const overlay = document.getElementById("unsoldOverlay");
    if (!overlay) return;

    // Player photo
    const photoWrap = document.getElementById("unsoldPlayerPhoto");
    if (photoWrap) {
        if (player.imageUrl) {
            photoWrap.innerHTML = `<img src="${player.imageUrl}" alt="${player.name}" />`;
            photoWrap.style.display = "block";
        } else {
            photoWrap.style.display = "none";
        }
    }

    setText("unsoldPlayerName", player.name);

    // Subtitle for category change
    const subtitleEl = document.getElementById("unsoldSubtitle");
    if (subtitleEl) {
        if (player.movedToC) {
            subtitleEl.textContent = "Moved to Category C \u2022 Re-queued";
            subtitleEl.style.display = "block";
        } else {
            subtitleEl.style.display = "none";
        }
    }

    overlay.style.display = "flex";
    requestAnimationFrame(() => overlay.classList.add("show-overlay"));
}

function hideUnsoldOverlay() {
    const overlay = document.getElementById("unsoldOverlay");
    if (!overlay) return;
    overlay.classList.remove("show-overlay");
    setTimeout(() => {
        overlay.style.display = "none";
        const subtitleEl = document.getElementById("unsoldSubtitle");
        if (subtitleEl) subtitleEl.style.display = "none";
    }, 500);
}

function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
}

function clearStage() {
    const section = document.getElementById("currentPlayerSection");
    if (section) {
        section.innerHTML = `
            <div class="no-auction">
                <div class="no-auction-content">
                    <h2>BIDDING STARTING SOON</h2>
                    <p>Please wait for the next player</p>
                </div>
            </div>`;
    }
    document.querySelectorAll(".team-card").forEach(c => c.classList.remove("bidding-highlight"));
}

async function refreshSoldCount() {
    try {
        const res = await fetch("/api/display-data");
        const data = await res.json();
        if (data.soldCount !== undefined) updateChip("displaySold", data.soldCount);
    } catch (e) { console.error("refreshSoldCount:", e); }
}

// ═══════════════ VISUAL EFFECTS ═══════════════

// ── Confetti / Crackers System ──
let crackersAnimId = null;
let crackersRunning = false;

function launchCrackers() {
    const canvas = document.getElementById("crackersCanvas");
    if (!canvas) return;

    canvas.style.display = "block";
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    crackersRunning = true;
    const particles = [];
    const colors = [
        "#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1",
        "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8",
        "#FF9FF3", "#54A0FF", "#5F27CD", "#01A3A4",
        "#F368E0", "#FF6348", "#7BED9F", "#70A1FF"
    ];
    const shapes = ["circle", "rect", "star", "ribbon"];

    function createBurst(cx, cy, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 4 + Math.random() * 10;
            const shape = shapes[Math.floor(Math.random() * shapes.length)];
            particles.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: shape === "ribbon" ? 8 + Math.random() * 10 : 3 + Math.random() * 5,
                life: 1,
                decay: 0.006 + Math.random() * 0.012,
                shape: shape,
                rotation: Math.random() * 360,
                rotSpeed: (Math.random() - 0.5) * 12,
                wobble: Math.random() * 10,
                wobbleSpeed: 0.05 + Math.random() * 0.1
            });
        }
    }

    // Initial bursts from multiple points
    const w = canvas.width, h = canvas.height;
    createBurst(w * 0.2, h * 0.3, 80);
    createBurst(w * 0.8, h * 0.3, 80);
    createBurst(w * 0.5, h * 0.15, 100);
    createBurst(w * 0.1, h * 0.5, 60);
    createBurst(w * 0.9, h * 0.5, 60);

    // Continuous bursts
    let burstTimer = 0;
    const burstInterval = 40; // frames between new bursts

    function drawStar(ctx, cx, cy, size, rotation) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const a = (i * 72 - 90) * Math.PI / 180;
            const r = i === 0 ? size : size;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            const a2 = ((i * 72) + 36 - 90) * Math.PI / 180;
            ctx.lineTo(Math.cos(a2) * (r * 0.4), Math.sin(a2) * (r * 0.4));
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function animate() {
        ctx.clearRect(0, 0, w, h);

        // Add new bursts periodically
        burstTimer++;
        if (crackersRunning && burstTimer % burstInterval === 0) {
            const rx = Math.random() * w;
            const ry = Math.random() * h * 0.4;
            createBurst(rx, ry, 35 + Math.floor(Math.random() * 30));
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];

            p.x += p.vx;
            p.vy += 0.12; // gravity
            p.vx *= 0.99; // air resistance
            p.y += p.vy;
            p.rotation += p.rotSpeed;
            p.wobble += p.wobbleSpeed;
            p.x += Math.sin(p.wobble) * 0.5;
            p.life -= p.decay;

            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }

            ctx.globalAlpha = Math.min(p.life, 1);
            ctx.fillStyle = p.color;

            switch (p.shape) {
                case "circle":
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                case "rect":
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rotation * Math.PI / 180);
                    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                    ctx.restore();
                    break;
                case "star":
                    drawStar(ctx, p.x, p.y, p.size, p.rotation);
                    break;
                case "ribbon":
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rotation * Math.PI / 180);
                    ctx.fillRect(-p.size / 2, -1.5, p.size, 3);
                    ctx.restore();
                    break;
            }
        }

        ctx.globalAlpha = 1;

        if (particles.length > 0 || crackersRunning) {
            crackersAnimId = requestAnimationFrame(animate);
        } else {
            canvas.style.display = "none";
            crackersAnimId = null;
        }
    }

    animate();
}

function stopCrackers() {
    crackersRunning = false;
    // Let remaining particles fade out naturally
}

function spawnBidParticles() {
    const anchor = document.querySelector(".bid-display-amount");
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 18; i++) {
        const p = document.createElement("div");
        Object.assign(p.style, {
            position: "fixed", width: "5px", height: "5px",
            background: "#fbbf24", borderRadius: "50%",
            left: cx + "px", top: cy + "px", zIndex: "99999", pointerEvents: "none",
            boxShadow: "0 0 8px #fbbf24"
        });
        document.body.appendChild(p);
        const angle = (Math.PI * 2 * i) / 18, dist = 40 + Math.random() * 60;
        p.animate([
            { left: cx + "px", top: cy + "px", opacity: 1, transform: "scale(1)" },
            { left: (cx + Math.cos(angle) * dist) + "px", top: (cy + Math.sin(angle) * dist) + "px", opacity: 0, transform: "scale(0)" }
        ], { duration: 700, easing: "ease-out" });
        setTimeout(() => p.remove(), 700);
    }
}

// ═══════════════ LIVE CLOCK ═══════════════
function tickClock() {
    const el = document.getElementById("liveClock");
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).toUpperCase();
}
tickClock();
setInterval(tickClock, 1000);

// ═══════════════ AUTO-RECONNECT & POLLING FALLBACK ═══════════════
setInterval(() => { if (!socket.connected) socket.connect(); }, 5000);

setInterval(async () => {
    if (socket.connected) return;
    try {
        const res = await fetch("/api/display-data");
        const data = await res.json();
        if (data.teams) updateTeamsDisplay(data.teams);
        if (data.currentPlayer && data.auctionState?.isActive) {
            displayNewPlayer(data.currentPlayer, data.auctionState);
            if (data.currentBidder) animateBid(data.auctionState.currentBid, data.currentBidder);
        }
    } catch (e) { console.error("Polling fallback:", e); }
}, 15000);