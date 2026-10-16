// ═══════════════════════════════════════════════════════════════
//  Auction Hub: admin panel helpers shared by every page
//  (the live auction screen has its own script: auction-control.js)
// ═══════════════════════════════════════════════════════════════

// ===== TOASTS =====

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 */
window.showToast = function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    const icon = document.createElement('i');
    icon.className = `fa-solid ${icons[type] || icons.info}`;
    const text = document.createElement('span');
    text.textContent = message;
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    close.addEventListener('click', () => toast.remove());
    toast.append(icon, text, close);
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

// ===== SESSION KEEP-ALIVE =====
// Long auctions mean long idle stretches on some pages; keep the admin logged in
// while they are active in the last two hours.

let lastActivity = Date.now();
['mousedown', 'keydown', 'scroll', 'touchstart'].forEach((event) => {
    document.addEventListener(event, () => { lastActivity = Date.now(); }, { capture: true, passive: true });
});

setInterval(async () => {
    if (Date.now() - lastActivity > 2 * 60 * 60 * 1000) return;
    try {
        const response = await fetch('/keep-alive', { method: 'POST', credentials: 'include' });
        if (response.status === 401) window.location.href = '/admin/login';
    } catch {
        // Offline for a moment; try again next interval.
    }
}, 10 * 60 * 1000);

// ===== PAGE BEHAVIOUR =====

document.addEventListener('DOMContentLoaded', () => {
    // Flash messages fade out on their own.
    document.querySelectorAll('.flash-message').forEach((alert) => {
        setTimeout(() => {
            alert.style.animation = 'fadeOut 0.3s ease-out forwards';
            setTimeout(() => alert.remove(), 300);
        }, 6000);
    });

    // Buttons and links with data-confirm ask before doing anything.
    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-confirm]');
        if (trigger && !window.confirm(trigger.dataset.confirm || 'Are you sure?')) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    // Hamburger menu (mobile)
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    if (navToggle && navMenu) {
        const setOpen = (open) => {
            navMenu.classList.toggle('active', open);
            const icon = navToggle.querySelector('i');
            icon?.classList.toggle('fa-bars', !open);
            icon?.classList.toggle('fa-xmark', open);
        };
        navToggle.addEventListener('click', () => setOpen(!navMenu.classList.contains('active')));
        navMenu.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => setOpen(false)));
        document.addEventListener('click', (event) => {
            if (!navToggle.contains(event.target) && !navMenu.contains(event.target)) setOpen(false);
        });
    }
});

// fadeOut animation used by flash messages
const fadeStyle = document.createElement('style');
fadeStyle.textContent = '@keyframes fadeOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-20px); } }';
document.head.appendChild(fadeStyle);
