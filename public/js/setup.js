// Setup wizard interactivity: image previews, repeatable rows (categories,
// increment slabs, role requirements) and live previews of amounts.
(function () {
    const config = window.AUCTION_CONFIG || {};
    const currency = config.currency || { symbol: '₹', suffix: '', locale: 'en-IN' };
    const money = (n) => `${currency.symbol}${Math.round(Number(n) || 0).toLocaleString(currency.locale)}${currency.suffix || ''}`;

    // ── Image previews ──
    document.addEventListener('change', (event) => {
        const input = event.target.closest('[data-image-input]');
        if (!input || !input.files || !input.files[0]) return;
        const field = input.closest('[data-image-field]');
        const preview = field && field.querySelector('[data-image-preview]');
        if (!preview) return;
        const img = document.createElement('img');
        img.alt = '';
        img.src = URL.createObjectURL(input.files[0]);
        preview.replaceChildren(img);
        const remove = field.querySelector('.image-field-remove input');
        if (remove) remove.checked = false;
    });

    // ── Remove any repeatable row ──
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-row]');
        if (!button) return;
        button.closest('[data-row]')?.remove();
        updateSlabExample();
    });

    // ── Categories ──
    const categoryRows = document.querySelector('[data-category-rows]');
    const categoryTemplate = document.getElementById('categoryRowTemplate');
    document.querySelector('[data-add-category]')?.addEventListener('click', () => {
        if (!categoryRows || !categoryTemplate) return;
        const index = Number(categoryRows.dataset.next || 0);
        categoryRows.dataset.next = index + 1;
        const html = categoryTemplate.innerHTML.replaceAll('__i__', String(index));
        categoryRows.insertAdjacentHTML('beforeend', html);
        categoryRows.lastElementChild?.querySelector('input[type="text"]')?.focus();
    });

    document.addEventListener('change', (event) => {
        const toggle = event.target.closest('[data-toggle-custom]');
        if (!toggle) return;
        const slabs = toggle.closest('.category-increments')?.querySelector('.custom-slabs');
        if (slabs) slabs.hidden = !toggle.checked;
    });

    // ── Increment slabs ──
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-add-slab]');
        if (!button) return;
        const editor = button.closest('[data-slab-editor]');
        const tbody = editor.querySelector('tbody');
        const prefix = editor.dataset.prefix;
        const index = Number(editor.dataset.next || 0);
        editor.dataset.next = index + 1;
        const label = currencyLabel();
        tbody.insertAdjacentHTML('beforeend', `
            <tr data-row>
                <td><div class="input-affix"><span>${label}</span>
                    <input type="number" name="${prefix}[${index}][from]" class="form-control form-control-sm" min="0" step="1" placeholder="e.g. 50000">
                </div></td>
                <td><div class="input-affix"><span>+</span>
                    <input type="number" name="${prefix}[${index}][step]" class="form-control form-control-sm" min="1" step="1" placeholder="e.g. 5000">
                </div></td>
                <td><button type="button" class="btn-icon-only btn-ghost" data-remove-row title="Remove"><i class="fa-solid fa-xmark"></i></button></td>
            </tr>`);
        tbody.lastElementChild.querySelector('input').focus();
    });

    function currencyLabel() {
        return (currency.symbol || '').trim() || (currency.suffix || '').trim();
    }

    // ── Role requirements ──
    const requirementEditor = document.querySelector('[data-requirement-editor]');
    document.querySelector('[data-add-requirement]')?.addEventListener('click', () => {
        const index = Number(requirementEditor.dataset.next || 0);
        requirementEditor.dataset.next = index + 1;
        requirementEditor.querySelector('tbody').insertAdjacentHTML('beforeend', `
            <tr data-row>
                <td><input type="text" name="roleRequirements[${index}][role]" class="form-control form-control-sm" list="roleOptions" placeholder="Role"></td>
                <td><input type="number" name="roleRequirements[${index}][min]" class="form-control form-control-sm" min="1" value="1"></td>
                <td><button type="button" class="btn-icon-only btn-ghost" data-remove-row title="Remove"><i class="fa-solid fa-xmark"></i></button></td>
            </tr>`);
    });

    // Keep the role suggestions in sync with the roles textarea.
    document.querySelector('[data-roles-input]')?.addEventListener('input', (event) => {
        const list = document.getElementById('roleOptions');
        if (!list) return;
        list.replaceChildren(...event.target.value.split(/\n/).map((r) => r.trim()).filter(Boolean).map((r) => {
            const option = document.createElement('option');
            option.value = r;
            return option;
        }));
    });

    // ── Teams ──
    document.addEventListener('change', (event) => {
        const plays = event.target.closest('[data-owner-plays]');
        if (plays) {
            const role = plays.closest('[data-team-card]')?.querySelector('[data-owner-role]');
            if (role) role.hidden = !plays.checked;
        }
    });
    document.addEventListener('input', (event) => {
        const color = event.target.closest('[data-team-color]');
        if (color) color.closest('[data-team-card]')?.style.setProperty('--team', color.value);
    });

    // ── Live amount previews ──
    function updateMoneyPreviews() {
        document.querySelectorAll('[data-money-preview]').forEach((input) => {
            const hint = document.querySelector(`[data-money-preview-for="${input.id}"]`);
            if (hint) hint.textContent = input.value ? money(input.value) : '';
        });
    }

    // Example sequence of bids for the cheapest category with the global slabs.
    function updateSlabExample() {
        const target = document.querySelector('[data-slab-example-text]');
        if (!target) return;
        const prices = [...document.querySelectorAll('[data-base-price]')].map((i) => Number(i.value)).filter((n) => n > 0);
        const editor = document.querySelector('[data-slab-editor][data-prefix="bidIncrements"]');
        const slabs = editor
            ? [...editor.querySelectorAll('tbody tr')].map((row) => {
                const [from, step] = row.querySelectorAll('input');
                return { from: Number(from.value) || 0, step: Number(step.value) };
            }).filter((s) => s.step > 0).sort((a, b) => a.from - b.from)
            : [];
        if (!prices.length || !slabs.length) {
            target.textContent = '—';
            return;
        }
        let bid = Math.min(...prices);
        const sequence = [bid];
        for (let i = 0; i < 6; i++) {
            const slab = [...slabs].reverse().find((s) => bid >= s.from) || slabs[0];
            bid += slab.step;
            sequence.push(bid);
        }
        target.textContent = `${sequence.map(money).join(' → ')} → …`;
    }

    document.addEventListener('input', (event) => {
        if (event.target.matches('[data-money-preview]')) updateMoneyPreviews();
        if (event.target.closest('[data-slab-editor], [data-category-rows]')) updateSlabExample();
    });
    updateMoneyPreviews();
    updateSlabExample();
})();
