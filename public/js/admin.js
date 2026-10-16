// ===== SOCKET.IO CONNECTION =====

// Initialize Socket.IO connection (only if socket.io is available)
let socket = null;
let reconnectAttempts = 0;
let keepAliveInterval = null;

if (typeof io !== 'undefined') {
    // Socket.io configuration for better reconnection handling
    socket = io({
        timeout: 120000, // 2 minutes
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        maxReconnectionAttempts: 10,
        forceNew: false,
        transports: ['polling', 'websocket']
    });

    socket.on('connect', () => {
        console.log('Connected to auction server');
        reconnectAttempts = 0;
        socket.emit('join-room', 'auction-room');
        
        // Start keep-alive mechanism
        startKeepAlive();
        
        // Request state restoration on reconnection
        if (socket.disconnected === false && socket.connected === true) {
            socket.emit('restore-state');
        }
        
        // Hide any reconnection messages
        hideReconnectingMessages();
        
        // Update connection status indicator
        updateConnectionStatus('connected');
        
        if (typeof showToast === 'function') {
            showToast('Connected to auction server', 'success');
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server, reason:', reason);
        stopKeepAlive();
        
        // Update connection status indicator
        updateConnectionStatus('disconnected');
        
        // Show appropriate message based on disconnect reason
        if (reason === 'io server disconnect') {
            // Server disconnected the client, try to reconnect
            if (typeof showToast === 'function') {
                showToast('Server disconnected. Attempting to reconnect...', 'warning');
            }
        } else if (reason === 'transport close' || reason === 'transport error') {
            // Network issues
            if (typeof showToast === 'function') {
                showToast('Connection lost due to network issues. Reconnecting...', 'warning');
            }
        }
    });

    socket.on('connect_error', (error) => {
        reconnectAttempts++;
        console.log(`Connection attempt ${reconnectAttempts} failed:`, error);
        
        // Update connection status indicator
        updateConnectionStatus('connecting');
        
        if (reconnectAttempts >= 5) {
            if (typeof showToast === 'function') {
                showToast('Connection issues detected. Please refresh the page if problems persist.', 'error');
            }
        }
    });

    socket.on('reconnect', (attemptNumber) => {
        console.log('Reconnected after', attemptNumber, 'attempts');
        updateConnectionStatus('connected');
        
        if (typeof showToast === 'function') {
            showToast('Reconnected to server', 'success');
        }
    });

    socket.on('reconnecting', (attemptNumber) => {
        console.log('Attempting to reconnect, attempt:', attemptNumber);
        updateConnectionStatus('connecting');
        
        if (attemptNumber === 1 && typeof showToast === 'function') {
            showToast('Reconnecting to server...', 'info');
        }
    });

    socket.on('connected', (data) => {
        console.log('Socket connected:', data.socketId);
        
        // If initial connection includes current state, restore it
        if (data.auctionState && data.auctionState.isActive && data.auctionState.currentPlayer) {
            if (document.getElementById('currentPlayerPanel')) {
                updateCurrentPlayer(data.auctionState.currentPlayer, data.auctionState);
                if (data.teamsData) {
                    updateTeamCardsFromSocket(data.teamsData);
                }
            }
        }
    });

    socket.on('state-restored', (data) => {
        console.log('State restored from server');
        
        // Restore auction state if active
        if (data.auctionState && data.auctionState.isActive && data.auctionState.currentPlayer) {
            if (document.getElementById('currentPlayerPanel')) {
                updateCurrentPlayer(data.auctionState.currentPlayer, data.auctionState);
                if (data.teamsData) {
                    updateTeamCardsFromSocket(data.teamsData);
                }
            }
        }
        
        if (typeof showToast === 'function') {
            showToast('Auction state synchronized', 'info');
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

    function hideReconnectingMessages() {
        // Hide any reconnecting toast messages
        const toasts = document.querySelectorAll('.toast');
        toasts.forEach(toast => {
            if (toast.textContent.includes('Reconnecting') || toast.textContent.includes('Connection lost')) {
                toast.remove();
            }
        });
    }

    socket.on('pong', () => {
        // Keep-alive response received
        console.log('Keep-alive pong received');
    });

    // Listen for player selection from other admin sessions
    socket.on('player-selected', (data) => {
        console.log('Player selected:', data.player.name);
        // Only update if we're on the auction control page
        if (document.getElementById('currentPlayerPanel')) {
            updateCurrentPlayer(data.player, data.auctionState);
            if (data.teams) {
                updateTeamCardsFromSocket(data.teams);
            }
        }
    });

    // Listen for bid placed
    socket.on('bid-placed', (data) => {
        console.log('Bid placed:', data.newBid, 'by', data.team.teamName);
        if (document.getElementById('currentPlayerPanel')) {
            updateBidDisplay(data.newBid, data.team);
            if (data.teamsData) {
                updateTeamCardsFromSocket(data.teamsData);
            }
            // Update bid cap indicators after every bid
            updateBidCapIndicators();
        }
    });

    // Listen for player sold
    socket.on('player-sold', (data) => {
        console.log('Player sold:', data.player.name, 'to', data.team.teamName);
        if (document.getElementById('currentPlayerPanel')) {
            // Don't show animation if we triggered it ourselves
            if (data.teamsData) {
                updateTeamCardsFromSocket(data.teamsData);
            }
            updateAuctionCounts();
        }
    });

    // Listen for player unsold
    socket.on('player-unsold', (data) => {
        console.log('Player unsold:', data.player.name);
        if (document.getElementById('currentPlayerPanel')) {
            updateAuctionCounts();
        }
    });

    // Listen for sale undone
    socket.on('sale-undone', (data) => {
        console.log('Sale undone:', data.player.name);
        if (document.getElementById('currentPlayerPanel')) {
            if (data.teamsData) {
                updateTeamCardsFromSocket(data.teamsData);
            }
            updateAuctionCounts();
        }
    });
}

// ===== SESSION KEEP-ALIVE =====

let sessionKeepAliveInterval = null;

function startSessionKeepAlive() {
    // Clear any existing interval
    if (sessionKeepAliveInterval) {
        clearInterval(sessionKeepAliveInterval);
    }

    // Keep session alive every 15 minutes
    sessionKeepAliveInterval = setInterval(async () => {
        try {
            const response = await fetch('/keep-alive', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include' // Include session cookies
            });

            if (response.ok) {
                console.log('Session keep-alive successful');
            } else {
                console.warn('Session keep-alive failed:', response.status);
                // If unauthorized, the session may have expired
                if (response.status === 401) {
                    if (typeof showToast === 'function') {
                        showToast('Session expired. Please login again.', 'warning');
                    }
                    // Redirect to login after a short delay
                    setTimeout(() => {
                        window.location.href = '/admin/login';
                    }, 3000);
                }
            }
        } catch (error) {
            console.warn('Session keep-alive network error:', error);
        }
    }, 15 * 60 * 1000); // 15 minutes
}

// User activity tracking to reset keep-alive timer
let lastActivityTime = Date.now();
let activityTrackingEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

function trackUserActivity() {
    lastActivityTime = Date.now();
}

// Add activity listeners
activityTrackingEvents.forEach(event => {
    document.addEventListener(event, trackUserActivity, true);
});

// Enhanced keep-alive that considers user activity
function startEnhancedSessionKeepAlive() {
    if (sessionKeepAliveInterval) {
        clearInterval(sessionKeepAliveInterval);
    }

    sessionKeepAliveInterval = setInterval(async () => {
        const timeSinceLastActivity = Date.now() - lastActivityTime;
        const isRecentActivity = timeSinceLastActivity < (30 * 60 * 1000); // 30 minutes

        // Always keep alive if user was active recently, or if idle time is less than 2 hours
        const isIdleTooLong = timeSinceLastActivity > (2 * 60 * 60 * 1000); // 2 hours

        if (isRecentActivity || !isIdleTooLong) {
            try {
                const response = await fetch('/keep-alive', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                });

                if (response.ok) {
                    console.log('Session keep-alive successful');
                    showSessionIndicator();
                } else if (response.status === 401) {
                    console.warn('Session expired, redirecting to login');
                    window.location.href = '/admin/login';
                }
            } catch (error) {
                console.warn('Session keep-alive error:', error);
            }
        }
    }, 10 * 60 * 1000); // Check every 10 minutes
}

// Start session keep-alive when page loads
document.addEventListener('DOMContentLoaded', () => {
    startEnhancedSessionKeepAlive();
    console.log('Session keep-alive started');
    
    // Initialize connection status indicator
    updateConnectionStatus('connecting');
});

// ===== UTILITY FUNCTIONS =====

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status) {
    let indicator = document.querySelector('.connection-status');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'connection-status';
        document.body.appendChild(indicator);
    }
    
    // Remove existing status classes
    indicator.classList.remove('connected', 'disconnected', 'connecting');
    
    switch(status) {
        case 'connected':
            indicator.classList.add('connected');
            indicator.textContent = 'Connected';
            break;
        case 'disconnected':
            indicator.classList.add('disconnected');
            indicator.textContent = 'Disconnected';
            break;
        case 'connecting':
            indicator.classList.add('connecting');
            indicator.textContent = 'Connecting...';
            break;
        default:
            indicator.textContent = 'Unknown';
    }
}

/**
 * Show session keep-alive indicator temporarily
 */
function showSessionIndicator() {
    let indicator = document.querySelector('.session-indicator');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'session-indicator';
        indicator.textContent = 'Session renewed';
        document.body.appendChild(indicator);
    }
    
    indicator.classList.add('show');
    
    // Hide after 2 seconds
    setTimeout(() => {
        indicator.classList.remove('show');
    }, 2000);
}

/**
 * Format a number as Indian currency
 * @param {number} amount - The amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

/**
 * Show a notification message to the user
 * @param {string} message - The message to display
 * @param {string} type - Type of notification: 'success', 'error', 'warning', 'info'
 */
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `alert alert-${type}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    max-width: 400px;
    z-index: 9999;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;

  // Add to page
  document.body.appendChild(notification);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    notification.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 5000);
}

/**
 * Confirm an action with the user
 * @param {string} message - The confirmation message
 * @returns {boolean} True if confirmed, false otherwise
 */
function confirmAction(message) {
  return confirm(message);
}

/**
 * Validate form data before submission
 * @param {HTMLFormElement} form - The form to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateForm(form) {
  const inputs = form.querySelectorAll('[required]');
  let isValid = true;

  inputs.forEach(input => {
    if (!input.value.trim()) {
      isValid = false;
      input.style.borderColor = 'var(--danger)';
    } else {
      input.style.borderColor = '';
    }
  });

  if (!isValid) {
    showNotification('Please fill in all required fields', 'error');
  }

  return isValid;
}

/**
 * Make an AJAX request
 * @param {string} url - The URL to request
 * @param {Object} options - Request options (method, headers, body)
 * @returns {Promise} Promise resolving to response data
 */
async function makeRequest(url, options = {}) {
  try {
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const mergedOptions = { ...defaultOptions, ...options };

    const response = await fetch(url, mergedOptions);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error('Request error:', error);
    showNotification(error.message || 'An error occurred', 'error');
    throw error;
  }
}

/**
 * Format a date to a readable string
 * @param {Date|string} date - The date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Debounce function to limit rapid function calls
 * @param {Function} func - The function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ===== EVENT LISTENERS =====

document.addEventListener('DOMContentLoaded', () => {
  // Auto-dismiss alerts
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach(alert => {
    setTimeout(() => {
      alert.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => {
        alert.remove();
      }, 300);
    }, 5000);
  });

  // Form validation on submit
  const forms = document.querySelectorAll('form[data-validate]');
  forms.forEach(form => {
    form.addEventListener('submit', (e) => {
      if (!validateForm(form)) {
        e.preventDefault();
      }
    });
  });

  // Confirm actions on delete/dangerous buttons
  const confirmButtons = document.querySelectorAll('[data-confirm]');
  confirmButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      const message = button.getAttribute('data-confirm') || 'Are you sure?';
      if (!confirmAction(message)) {
        e.preventDefault();
      }
    });
  });

  // Clear input errors on focus
  const inputs = document.querySelectorAll('.form-control');
  inputs.forEach(input => {
    input.addEventListener('focus', () => {
      input.style.borderColor = '';
    });
  });

  // Add active class to current nav link
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.style.background = 'var(--gray-100)';
      link.style.color = 'var(--primary)';
    }
  });
});

// Add fadeOut animation to CSS dynamically
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeOut {
    from {
      opacity: 1;
      transform: translateY(0);
    }
    to {
      opacity: 0;
      transform: translateY(-20px);
    }
  }
`;
document.head.appendChild(style);

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatCurrency,
    showNotification,
    confirmAction,
    validateForm,
    makeRequest,
    formatDate,
    debounce,
  };
}

// ============= AUCTION CONTROL FUNCTIONS =============



/**
 * Select a specific player for auction
 */
async function selectPlayer(playerId) {
    try {
        showLoading('Loading player...');
        const response = await fetch('/auction/api/start-player', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ playerId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            updateCurrentPlayer(result.player, result.auctionState);
            showToast('Player selected: ' + result.player.name, 'success');
            // Highlight player in list as currently being auctioned (don't remove)
            highlightPlayerInList(result.player._id);
        } else {
            showToast(result.message || 'Failed to select player', 'error');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Place a bid for a team with optional increment
 * @param {string} teamId - The ID of the team placing the bid
 * @param {number} increment - Optional increment amount (200, 500, 1000, or custom)
 */
async function placeBid(teamId, increment = null) {
    try {
        console.log('placeBid called with teamId:', teamId, 'increment:', increment);
        
        const requestBody = { teamId };
        if (increment !== null) {
            requestBody.increment = increment;
        }
        
        console.log('Sending request body:', JSON.stringify(requestBody));
        
        const response = await fetch('/auction/api/place-bid', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        console.log('Bid result:', result);
        
        if (result.success) {
            // Don't update bid display here - let socket.io handle it to avoid duplicates
            updateTeamCards(result.teamsData);
            updateBidCapIndicators();
            showToast(result.team.teamName + ' bid ₹' + result.newBid.toLocaleString('en-IN'), 'info');
        } else {
            showToast(result.message || 'Bid not allowed', 'warning');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

/**
 * Mark current player as sold
 */
async function markSold() {
    const confirmed = await showConfirmModal('Mark this player as SOLD?');
    if (!confirmed) return;
    
    try {
        showLoading('Processing sale...');
        const response = await fetch('/auction/api/mark-sold', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSoldAnimation(result.player, result.team, result.price);
            updateTeamCards(result.teamsData);
            addToRecentSales(result.player, result.team, result.price);
            removePlayerFromList(result.player._id);
            clearCurrentPlayer();
            updateStats();
            showToast('SOLD to ' + result.team.teamName, 'success');
        } else {
            showToast(result.message || 'Failed to mark as sold', 'error');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Mark current player as unsold
 */
async function markUnsold() {
    const confirmed = await showConfirmModal('Mark this player as UNSOLD?');
    if (!confirmed) return;
    
    try {
        const response = await fetch('/auction/api/mark-unsold', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        
        const result = await response.json();
        
        if (result.success) {
            showUnsoldMessage(result.player);
            clearCurrentPlayer();
            // Add player back to list
            location.reload();
        } else {
            showToast(result.message || 'Failed to mark as unsold', 'error');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

/**
 * Undo the last sale
 */
async function undoLastSale() {
    const confirmed = await showConfirmModal('UNDO the last sale? This will reverse the transaction.');
    if (!confirmed) return;
    
    try {
        showLoading('Reversing transaction...');
        const response = await fetch('/auction/api/undo-sale', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Sale reversed: ' + result.player.name, 'success');
            location.reload(); // Refresh to show updated data
        } else {
            showToast(result.message || 'Failed to undo sale', 'error');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}



// ============= UI UPDATE FUNCTIONS =============

/**
 * Update the current player display
 */
function updateCurrentPlayer(player, auctionState) {
    if (typeof currentPlayerId !== 'undefined') {
        currentPlayerId = player._id;
    }
    if (typeof currentPlayerCategory !== 'undefined') {
        currentPlayerCategory = player.category;
    }
    if (typeof currentAuctionState !== 'undefined') {
        currentAuctionState = auctionState;
    }
    
    const panel = document.getElementById('currentPlayerPanel');
    if (!panel) return;
    
    // Build player image HTML
    let playerImageHTML = '';
    if (player.imageUrl) {
        playerImageHTML = `
            <img src="${player.imageUrl}" alt="${player.name}" 
                style="width: 180px; height: 180px; object-fit: cover; border-radius: 12px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);" 
                onerror="this.style.display='none'">
        `;
    } else {
        playerImageHTML = `
            <div style="width: 180px; height: 180px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-size: 48px; font-weight: bold; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
                ${player.name.charAt(0).toUpperCase()}
            </div>
        `;
    }
    
    panel.innerHTML = `
        <div class="player-showcase animate-in">
            <div class="player-image-showcase">
                ${playerImageHTML}
            </div>
            <div class="player-details">
                <h1 class="player-name">${player.name}</h1>
                <div class="player-meta">
                    <span class="player-number">#${player.playerNumber}</span>
                    <span class="badge badge-${player.category} badge-lg">
                        Category ${player.category}
                    </span>
                </div>
                <div class="base-price">
                    Base Price: ₹${player.basePrice.toLocaleString('en-IN')}
                </div>
            </div>
            <div class="current-bid-display">
                <div class="bid-label">Current Bid</div>
                <div class="bid-amount-display" id="currentBidAmount">
                    ₹${player.basePrice.toLocaleString('en-IN')}
                </div>
                <div class="bidding-team" id="biddingTeam">
                    No bids yet
                </div>
            </div>
        </div>
    `;
    
    // Enable bid buttons and action buttons
    enableBidButtons();
    document.getElementById('unsoldBtn').disabled = false;
    document.getElementById('soldBtn').disabled = true; // No bid yet
    
    // Clear bid history
    const bidHistory = document.getElementById('bidHistory');
    if (bidHistory) {
        bidHistory.innerHTML = '<p class="no-bids">No bids yet</p>';
    }
}

/**
 * Update the bid display when a new bid is placed
 */
function updateBidDisplay(newBid, team) {
    const bidAmountEl = document.getElementById('currentBidAmount');
    const biddingTeamEl = document.getElementById('biddingTeam');
    
    if (bidAmountEl) {
        // Animate bid change
        bidAmountEl.classList.add('bid-update');
        setTimeout(() => {
            bidAmountEl.textContent = '₹' + newBid.toLocaleString('en-IN');
            bidAmountEl.classList.remove('bid-update');
        }, 100);
    }
    
    if (biddingTeamEl) {
        biddingTeamEl.textContent = team.teamName;
        biddingTeamEl.style.color = team.color;
    }
    
    // Add to bid history
    const bidHistory = document.getElementById('bidHistory');
    if (bidHistory) {
        if (bidHistory.querySelector('.no-bids')) {
            bidHistory.innerHTML = '';
        }
        
        const bidEntry = document.createElement('div');
        bidEntry.className = 'bid-entry animate-slide-in';
        bidEntry.innerHTML = `
            <span>${team.teamName}</span>
            <span class="bid-amount">₹${newBid.toLocaleString('en-IN')}</span>
        `;
        bidHistory.insertBefore(bidEntry, bidHistory.firstChild);
    }
    
    // Highlight bidding team card
    highlightBiddingTeam(team._id);
    
    // Enable SOLD button
    const soldBtn = document.getElementById('soldBtn');
    if (soldBtn) {
        soldBtn.disabled = false;
    }
}

/**
 * Update team cards with new data and enforce bid cap indicators
 */
function updateTeamCards(teamsData) {
    if (!teamsData) return;
    
    // Get current bid amount
    const currentBidEl = document.getElementById('currentBidAmount');
    const currentBid = currentBidEl 
        ? parseInt(currentBidEl.textContent.replace(/[₹,\s]/g, ''), 10) || 0 
        : 0;
    
    teamsData.forEach(team => {
        const card = document.querySelector(`[data-team-id="${team._id}"]`);
        if (card) {
            // Update purse
            const purseEl = card.querySelector('.purse-amount');
            if (purseEl) {
                purseEl.textContent = '₹' + team.remainingPurse.toLocaleString('en-IN');
                purseEl.setAttribute('data-team-purse', team.remainingPurse);
            }
            
            // Update players count
            const playersEl = card.querySelector('.players-count');
            if (playersEl) {
                playersEl.textContent = team.playersCount + '/9';
            }
            
            // Update max bid
            const maxBidEl = card.querySelector('.max-bid');
            if (maxBidEl && team.maxBidAllowed !== undefined) {
                maxBidEl.textContent = '₹' + team.maxBidAllowed.toLocaleString('en-IN');
                maxBidEl.setAttribute('data-max-bid', team.maxBidAllowed);
                
                // Color-code the max bid
                if (team.maxBidAllowed <= 0) {
                    maxBidEl.style.color = 'var(--danger)';
                } else if (team.maxBidAllowed <= currentBid) {
                    maxBidEl.style.color = 'var(--warning-dark)';
                } else {
                    maxBidEl.style.color = 'var(--primary)';
                }
            }
            
            // Determine if team is blocked from bidding
            const isSquadFull = team.playersCount >= 9;
            const isCapReached = currentPlayerId && team.maxBidAllowed !== undefined && team.maxBidAllowed <= currentBid;
            const isBlocked = isSquadFull || isCapReached;
            
            // Update bid buttons
            const bidBtns = card.querySelectorAll('.btn-bid');
            bidBtns.forEach(btn => {
                btn.disabled = isBlocked || !currentPlayerId;
            });
            
            // Show/hide blocked indicator
            let blockedEl = card.querySelector('.bid-cap-indicator');
            if (!blockedEl) {
                blockedEl = document.createElement('div');
                blockedEl.className = 'bid-cap-indicator';
                card.appendChild(blockedEl);
            }
            
            if (isBlocked && currentPlayerId) {
                if (isSquadFull) {
                    blockedEl.textContent = 'SQUAD FULL';
                    blockedEl.className = 'bid-cap-indicator cap-full';
                } else {
                    blockedEl.textContent = 'BID CAP REACHED';
                    blockedEl.className = 'bid-cap-indicator cap-reached';
                }
                blockedEl.style.display = 'block';
                card.classList.add('team-blocked');
            } else {
                blockedEl.style.display = 'none';
                card.classList.remove('team-blocked');
            }
        }
    });
}

/**
 * Update bid cap indicators for all team cards based on current bid.
 * Called after each bid to re-evaluate which teams are blocked.
 */
function updateBidCapIndicators() {
    const currentBidEl = document.getElementById('currentBidAmount');
    const currentBid = currentBidEl 
        ? parseInt(currentBidEl.textContent.replace(/[₹,\s]/g, ''), 10) || 0 
        : 0;
    
    document.querySelectorAll('.team-bid-card').forEach(card => {
        const maxBidEl = card.querySelector('.max-bid');
        const maxBid = maxBidEl ? parseInt(maxBidEl.getAttribute('data-max-bid'), 10) || 0 : Infinity;
        const playersEl = card.querySelector('.players-count');
        const playersCount = playersEl ? parseInt(playersEl.textContent.split('/')[0], 10) : 0;
        
        const isSquadFull = playersCount >= 9;
        const isCapReached = currentPlayerId && maxBid <= currentBid;
        const isBlocked = isSquadFull || isCapReached;
        
        const bidBtns = card.querySelectorAll('.btn-bid');
        bidBtns.forEach(btn => {
            btn.disabled = isBlocked || !currentPlayerId;
        });
        
        let blockedEl = card.querySelector('.bid-cap-indicator');
        if (!blockedEl) {
            blockedEl = document.createElement('div');
            blockedEl.className = 'bid-cap-indicator';
            card.appendChild(blockedEl);
        }
        
        if (isBlocked && currentPlayerId) {
            if (isSquadFull) {
                blockedEl.textContent = 'SQUAD FULL';
                blockedEl.className = 'bid-cap-indicator cap-full';
            } else {
                blockedEl.textContent = 'BID CAP REACHED';
                blockedEl.className = 'bid-cap-indicator cap-reached';
            }
            blockedEl.style.display = 'block';
            card.classList.add('team-blocked');
        } else {
            blockedEl.style.display = 'none';
            card.classList.remove('team-blocked');
        }
    });
}

/**
 * Update team cards from socket event (alias for consistency)
 */
function updateTeamCardsFromSocket(teams) {
    updateTeamCards(teams);
}

/**
 * Update auction counts from server
 */
async function updateAuctionCounts() {
    try {
        const response = await fetch('/auction/api/stats');
        const stats = await response.json();
        
        if (stats.success) {
            const soldCountEl = document.getElementById('soldCount');
            const unsoldCountEl = document.getElementById('unsoldCount');
            const roundNumberEl = document.getElementById('roundNumber');
            
            if (soldCountEl) soldCountEl.textContent = stats.soldCount;
            if (unsoldCountEl) unsoldCountEl.textContent = stats.unsoldCount;
            if (roundNumberEl) roundNumberEl.textContent = stats.roundNumber;
        }
    } catch (error) {
        console.error('Error updating auction counts:', error);
    }
}

/**
 * Clear the current player display
 */
function clearCurrentPlayer() {
    if (typeof currentPlayerId !== 'undefined') {
        currentPlayerId = '';
    }
    if (typeof currentPlayerCategory !== 'undefined') {
        currentPlayerCategory = '';
    }
    
    const panel = document.getElementById('currentPlayerPanel');
    if (panel) {
        panel.innerHTML = `
            <div class="no-player-selected">
                <h2>No Player Selected</h2>
                <p>Click "Random Player" or select from the list</p>
            </div>
        `;
    }
    
    disableBidButtons();
    
    const soldBtn = document.getElementById('soldBtn');
    const unsoldBtn = document.getElementById('unsoldBtn');
    if (soldBtn) soldBtn.disabled = true;
    if (unsoldBtn) unsoldBtn.disabled = true;
    
    // Clear bid history
    const bidHistory = document.getElementById('bidHistory');
    if (bidHistory) {
        bidHistory.innerHTML = '<p class="no-bids">No bids yet</p>';
    }
    
    // Remove highlighting from all team cards
    document.querySelectorAll('.team-bid-card').forEach(card => {
        card.classList.remove('bidding-active');
    });

    // Remove in-auction highlight from player list
    document.querySelectorAll('.player-list-item.in-auction').forEach(el => {
        el.classList.remove('in-auction');
    });
}

/**
 * Enable all bid buttons (except blocked teams)
 */
function enableBidButtons() {
    document.querySelectorAll('.btn-bid').forEach(btn => {
        const teamCard = btn.closest('.team-bid-card');
        if (teamCard) {
            const playersCountEl = teamCard.querySelector('.players-count');
            if (playersCountEl) {
                const playersCount = parseInt(playersCountEl.textContent.split('/')[0], 10);
                if (playersCount < 9 && !teamCard.classList.contains('team-blocked')) {
                    btn.disabled = false;
                }
            }
        }
    });
    // Also run cap check
    updateBidCapIndicators();
}

/**
 * Disable all bid buttons
 */
function disableBidButtons() {
    document.querySelectorAll('.btn-bid').forEach(btn => {
        btn.disabled = true;
    });
}

/**
 * Highlight the currently bidding team's card
 */
function highlightBiddingTeam(teamId) {
    document.querySelectorAll('.team-bid-card').forEach(card => {
        card.classList.remove('bidding-active');
    });
    
    const biddingCard = document.querySelector(`.team-bid-card[data-team-id="${teamId}"]`);
    if (biddingCard) {
        biddingCard.classList.add('bidding-active');
    }
}

/**
 * Highlight a player in the sidebar list as currently being auctioned
 */
function highlightPlayerInList(playerId) {
    // Remove highlight from any previously highlighted player
    document.querySelectorAll('.player-list-item.in-auction').forEach(el => {
        el.classList.remove('in-auction');
    });
    const playerItem = document.querySelector(`[data-player-id="${playerId}"]`);
    if (playerItem) {
        playerItem.classList.add('in-auction');
    }
}

/**
 * Remove a player from the sidebar list
 */
function removePlayerFromList(playerId) {
    const playerItem = document.querySelector(`[data-player-id="${playerId}"]`);
    if (playerItem) {
        playerItem.remove();
    }
    updateCategoryCounts();
}

/**
 * Update category counts in the filter buttons
 */
function updateCategoryCounts() {
    const players = document.querySelectorAll('.player-list-item');
    const counts = { all: 0, A: 0, B: 0, C: 0 };
    
    players.forEach(player => {
        const category = player.getAttribute('data-category');
        counts.all++;
        if (counts[category] !== undefined) {
            counts[category]++;
        }
    });
    
    document.getElementById('countAll').textContent = counts.all;
    document.getElementById('countA').textContent = counts.A;
    document.getElementById('countB').textContent = counts.B;
    document.getElementById('countC').textContent = counts.C;
}

/**
 * Update stats display
 */
function updateStats() {
    const soldCountEl = document.getElementById('soldCount');
    const unsoldCountEl = document.getElementById('unsoldCount');
    const roundNumberEl = document.getElementById('roundNumber');
    
    if (soldCountEl) {
        soldCountEl.textContent = parseInt(soldCountEl.textContent, 10) + 1;
    }
    if (unsoldCountEl) {
        unsoldCountEl.textContent = parseInt(unsoldCountEl.textContent, 10) - 1;
    }
    if (roundNumberEl) {
        roundNumberEl.textContent = parseInt(roundNumberEl.textContent, 10) + 1;
    }
}

/**
 * Show sold animation overlay
 */
function showSoldAnimation(player, team, price) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'sold-overlay';
    overlay.innerHTML = `
        <div class="sold-content">
            <h1 class="sold-title">SOLD!</h1>
            <div class="sold-details">
                <p class="sold-player">${player.name}</p>
                <p class="sold-to">to ${team.teamName}</p>
                <p class="sold-price">₹${price.toLocaleString('en-IN')}</p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 500);
    }, 3000);
}

/**
 * Show unsold message
 */
function showUnsoldMessage(player) {
    let msg = player.name + ' - UNSOLD';
    if (player.movedToC) {
        msg += ` (moved from Cat ${player.originalCategory} → Cat C, re-queued)`;
    } else {
        msg += ' (re-queued at end)';
    }
    showToast(msg, 'warning', 4000);
}

/**
 * Add a sale to the recent sales list
 */
function addToRecentSales(player, team, price) {
    const recentSales = document.getElementById('recentSales');
    if (!recentSales) return;
    
    // Remove "no sales" message if present
    const noSales = recentSales.querySelector('.no-sales');
    if (noSales) {
        noSales.remove();
    }
    
    const saleEntry = document.createElement('div');
    saleEntry.className = 'sale-entry animate-slide-in';
    saleEntry.innerHTML = `
        <div class="sale-player">${player.name}</div>
        <div class="sale-team" style="color: ${team.color}">${team.teamName}</div>
        <div class="sale-price">₹${price.toLocaleString('en-IN')}</div>
    `;
    
    // Limit to 10 recent sales
    while (recentSales.children.length >= 10) {
        recentSales.removeChild(recentSales.lastChild);
    }
    
    recentSales.insertBefore(saleEntry, recentSales.firstChild);
}

// ============= FILTER & SEARCH FUNCTIONS =============

/**
 * Filter players by category
 */
function filterCategory(category, buttonEl) {
    if (typeof currentCategory !== 'undefined') {
        currentCategory = category;
    }
    
    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (buttonEl) {
        buttonEl.classList.add('active');
    }
    
    // Filter players
    const players = document.querySelectorAll('.player-list-item');
    players.forEach(player => {
        if (category === 'all' || player.getAttribute('data-category') === category) {
            player.style.display = 'flex';
        } else {
            player.style.display = 'none';
        }
    });
}

/**
 * Search players by name
 */
function searchPlayers() {
    const searchInput = document.getElementById('playerSearch');
    if (!searchInput) return;
    
    const searchTerm = searchInput.value.toLowerCase();
    const players = document.querySelectorAll('.player-list-item');
    
    players.forEach(player => {
        const playerName = player.querySelector('.player-name-text');
        if (playerName) {
            const name = playerName.textContent.toLowerCase();
            if (name.includes(searchTerm)) {
                player.style.display = 'flex';
            } else {
                player.style.display = 'none';
            }
        }
    });
}

// ============= UTILITY FUNCTIONS FOR AUCTION =============

/**
 * Show toast notification
 */
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) {
        // Fallback to showNotification if toast container doesn't exist
        showNotification(message, type);
        return;
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Show loading overlay
 */
function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const messageEl = document.getElementById('loadingMessage');
    
    if (overlay) {
        overlay.style.display = 'flex';
    }
    if (messageEl) {
        messageEl.textContent = message;
    }
}

/**
 * Hide loading overlay
 */
function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

/**
 * Show confirmation modal
 */
function showConfirmModal(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const title = document.getElementById('confirmTitle');
        const msg = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');
        
        if (!modal) {
            // Fallback to native confirm
            resolve(confirm(message));
            return;
        }
        
        if (title) title.textContent = 'Confirm';
        if (msg) msg.textContent = message;
        modal.style.display = 'flex';
        
        const handleYes = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(true);
        };
        
        const handleNo = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(false);
        };
        
        const cleanup = () => {
            if (yesBtn) yesBtn.removeEventListener('click', handleYes);
            if (noBtn) noBtn.removeEventListener('click', handleNo);
        };
        
        if (yesBtn) yesBtn.addEventListener('click', handleYes);
        if (noBtn) noBtn.addEventListener('click', handleNo);
    });
}

// ============= QUICK ACTION FUNCTIONS =============

/**
 * Open players page in new tab
 */
function viewAllPlayers() {
    window.open('/admin/players', '_blank');
}

/**
 * Open teams page in new tab
 */
function viewTeams() {
    window.open('/admin/teams', '_blank');
}

/**
 * Open public display in new window
 */
function openDisplayWindow() {
    window.open('/display', '_blank', 'fullscreen=yes');
}

/**
 * Refresh stats from server
 */
async function refreshStats() {
    try {
        const response = await fetch('/auction/api/stats');
        const stats = await response.json();
        
        if (stats.success) {
            const soldCountEl = document.getElementById('soldCount');
            const unsoldCountEl = document.getElementById('unsoldCount');
            const roundNumberEl = document.getElementById('roundNumber');
            
            if (soldCountEl) soldCountEl.textContent = stats.soldCount;
            if (unsoldCountEl) unsoldCountEl.textContent = stats.unsoldCount;
            if (roundNumberEl) roundNumberEl.textContent = stats.roundNumber;
            
            showToast('Stats refreshed', 'info');
        }
    } catch (error) {
        showToast('Failed to refresh stats', 'error');
    }
}

// ============= LOADING STATES =============

/**
 * Show loading overlay
 * @param {string} message - Loading message to display
 */
function showLoading(message = 'Loading...') {
    // Remove existing overlay if any
    hideLoading();
    
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
        <div class="loading-content">
            <div class="spinner"></div>
            <div class="loading-text">${message}</div>
        </div>
    `;
    document.body.appendChild(overlay);
}

/**
 * Hide loading overlay
 */
function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.remove();
    }
}

// ============= CUSTOM BID MODAL FUNCTIONS =============

/**
 * Get minimum bid increment based on category and current bid (mirrors server logic)
 */
function getMinIncrement(category, currentBid) {
    switch (category) {
        case 'A': return currentBid >= 200000 ? 25000 : 10000;
        case 'B': return currentBid >= 100000 ? 10000 : 5000;
        case 'C': return currentBid >= 50000 ? 5000 : 2000;
        default: return 5000;
    }
}

let customBidTeamId = null;

/**
 * Open custom bid modal
 */
function openCustomBidModal(teamId, teamName) {
    customBidTeamId = teamId;
    document.getElementById('customBidTeamName').textContent = teamName;
    
    // Get current bid amount
    const currentBidElement = document.getElementById('currentBidAmount');
    if (currentBidElement) {
        document.getElementById('customBidCurrentAmount').textContent = currentBidElement.textContent;
    }
    
    // Show minimum increment hint
    const hintEl = document.getElementById('customBidMinHint');
    if (hintEl && typeof currentPlayerCategory !== 'undefined' && currentPlayerCategory) {
        const currentBid = currentBidElement 
            ? parseInt(currentBidElement.textContent.replace(/[₹,\s]/g, ''), 10) || 0 
            : 0;
        const minInc = getMinIncrement(currentPlayerCategory, currentBid);
        const minBid = currentBid + minInc;
        hintEl.textContent = `Min bid: ₹${minBid.toLocaleString('en-IN')} (min increment: ₹${minInc.toLocaleString('en-IN')} for Cat ${currentPlayerCategory})`;
    }
    
    // Clear and focus input
    const input = document.getElementById('customBidInput');
    input.value = '';
    
    // Show modal
    document.getElementById('customBidModal').style.display = 'flex';
    
    // Focus input after modal is shown
    setTimeout(() => input.focus(), 100);
}

/**
 * Close custom bid modal
 */
function closeCustomBidModal() {
    document.getElementById('customBidModal').style.display = 'none';
    customBidTeamId = null;
}

/**
 * Submit custom bid
 */
async function submitCustomBid() {
    const bidAmount = parseInt(document.getElementById('customBidInput').value);
    
    if (!bidAmount || bidAmount <= 0) {
        showToast('Please enter a valid bid amount', 'warning');
        return;
    }
    
    if (!customBidTeamId) {
        showToast('No team selected', 'error');
        return;
    }
    
    // Save teamId before closing modal
    const teamId = customBidTeamId;
    
    // Close modal
    closeCustomBidModal();
    
    // Place bid with custom amount
    try {
        console.log('Placing custom bid - teamId:', teamId, 'amount:', bidAmount);
        
        const response = await fetch('/auction/api/place-bid', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                teamId: teamId,
                customAmount: bidAmount
            })
        });
        
        const result = await response.json();
        
        console.log('Custom bid result:', result);
        
        if (result.success) {
            updateTeamCards(result.teamsData);
            showToast(result.team.teamName + ' bid ₹' + result.newBid.toLocaleString('en-IN'), 'info');
        } else {
            showToast(result.message || 'Bid not allowed', 'warning');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

// ============= KEYBOARD SHORTCUTS =============

document.addEventListener('DOMContentLoaded', () => {
    // Only on auction control page
    if (window.location.pathname.includes('/auction/control')) {
        initializeKeyboardShortcuts();
    }
});

/**
 * Initialize keyboard shortcuts for auction control
 */
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        // Ctrl/Cmd + Key combinations
        if (e.ctrlKey || e.metaKey) {
            switch(e.key.toLowerCase()) {
                case 's':
                    e.preventDefault();
                    if (typeof currentPlayerId !== 'undefined' && currentPlayerId && typeof markSold === 'function') {
                        markSold();
                    }
                    break;
                case 'u':
                    e.preventDefault();
                    if (typeof currentPlayerId !== 'undefined' && currentPlayerId && typeof markUnsold === 'function') {
                        markUnsold();
                    }
                    break;
                case 'z':
                    e.preventDefault();
                    if (typeof undoLastSale === 'function') {
                        undoLastSale();
                    }
                    break;
            }
            return;
        }
        
        // Number keys 1-8 for team bids
        if (e.key >= '1' && e.key <= '8') {
            const teamNumber = parseInt(e.key);
            const teamCards = document.querySelectorAll('.team-bid-card');
            if (teamCards[teamNumber - 1]) {
                const teamId = teamCards[teamNumber - 1].dataset.teamId;
                if (teamId && typeof placeBid === 'function') {
                    placeBid(teamId);
                }
            }
        }
        
        // Space bar for sold
        if (e.key === ' ' && typeof currentPlayerId !== 'undefined' && currentPlayerId) {
            e.preventDefault();
            const soldBtn = document.getElementById('soldBtn');
            if (soldBtn && !soldBtn.disabled && typeof markSold === 'function') {
                markSold();
            }
        }
        
        // Escape for unsold
        if (e.key === 'Escape' && typeof currentPlayerId !== 'undefined' && currentPlayerId) {
            if (typeof markUnsold === 'function') {
                markUnsold();
            }
        }
        
        // Arrow keys for player navigation
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            navigatePlayers(e.key === 'ArrowDown' ? 'next' : 'prev');
        }
    });
    
    // Show keyboard shortcuts help
    showKeyboardShortcutsHelp();
}

/**
 * Navigate through players using keyboard
 * @param {string} direction - 'next' or 'prev'
 */
function navigatePlayers(direction) {
    const playerItems = Array.from(document.querySelectorAll('.player-list-item:not([style*="display: none"])'));
    const currentIndex = playerItems.findIndex(item => item.classList.contains('selected'));
    
    let newIndex;
    if (direction === 'next') {
        newIndex = currentIndex < playerItems.length - 1 ? currentIndex + 1 : 0;
    } else {
        newIndex = currentIndex > 0 ? currentIndex - 1 : playerItems.length - 1;
    }
    
    // Remove previous selection
    playerItems.forEach(item => item.classList.remove('selected'));
    
    // Add new selection
    if (playerItems[newIndex]) {
        playerItems[newIndex].classList.add('selected');
        playerItems[newIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Auto-select on Enter
        document.addEventListener('keydown', function selectOnEnter(e) {
            if (e.key === 'Enter') {
                playerItems[newIndex].click();
                document.removeEventListener('keydown', selectOnEnter);
            }
        }, { once: true });
    }
}

/**
 * Add keyboard shortcuts help button to auction control
 */
function showKeyboardShortcutsHelp() {
    // Shortcuts button is now in the sidebar template, no dynamic insertion needed
}

/**
 * Display modal with keyboard shortcuts
 */
function displayShortcutsModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content shortcuts-modal">
            <h2>⌨️ Keyboard Shortcuts</h2>
            <div class="shortcuts-grid">
                <div class="shortcut-item">
                    <kbd>1-8</kbd>
                    <span>Bid for Teams</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Space</kbd>
                    <span>Mark Sold</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Esc</kbd>
                    <span>Mark Unsold</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Ctrl/Cmd + S</kbd>
                    <span>Mark Sold</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Ctrl/Cmd + U</kbd>
                    <span>Mark Unsold</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Ctrl/Cmd + Z</kbd>
                    <span>Undo Last Sale</span>
                </div>
                <div class="shortcut-item">
                    <kbd>↑ ↓</kbd>
                    <span>Navigate Players</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Enter</kbd>
                    <span>Select Highlighted Player</span>
                </div>
            </div>
            <button class="btn btn-primary" onclick="this.closest('.modal').remove()">
                Got it!
            </button>
        </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// ============= INITIALIZATION =============

// Initialize custom bid modal event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Allow Enter key to submit custom bid
    const customBidInput = document.getElementById('customBidInput');
    if (customBidInput) {
        customBidInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                submitCustomBid();
            }
        });
    }
    
    // Close modal on outside click
    const modal = document.getElementById('customBidModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeCustomBidModal();
            }
        });
    }

    // ===== UI ENHANCEMENTS =====

    // Hamburger menu toggle
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            const icon = navToggle.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-xmark');
            }
        });

        // Close menu when clicking a nav link (mobile)
        navMenu.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                const icon = navToggle.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-xmark');
                    icon.classList.add('fa-bars');
                }
            });
        });

        // Close menu on outside click
        document.addEventListener('click', function(e) {
            if (!navToggle.contains(e.target) && !navMenu.contains(e.target)) {
                navMenu.classList.remove('active');
                const icon = navToggle.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-xmark');
                    icon.classList.add('fa-bars');
                }
            }
        });
    }

    // Toast notification system
    window.showToast = function(message, type = 'info') {
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
            info: 'fa-circle-info'
        };
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fa-solid ${icons[type] || icons.info}"></i>
            <span>${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        
        container.appendChild(toast);
        
        // Trigger slide-in
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        // Auto-remove after 4 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    };

    console.log('UI enhancements initialized');
});
