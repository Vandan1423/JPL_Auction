// Player add/edit form: photo preview and a "saving" state so a slow upload
// can't be submitted twice.
(function () {
    const form = document.querySelector('[data-player-form]');
    if (!form) return;

    form.addEventListener('change', (event) => {
        const input = event.target.closest('[data-image-input]');
        if (!input || !input.files || !input.files[0]) return;
        const preview = input.closest('[data-image-field]')?.querySelector('[data-image-preview]');
        if (!preview) return;
        const img = document.createElement('img');
        img.alt = '';
        img.src = URL.createObjectURL(input.files[0]);
        preview.replaceChildren(img);
    });

    form.addEventListener('submit', () => {
        const button = form.querySelector('[type="submit"][data-submit-label]');
        if (!button) return;
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${button.dataset.submitLabel}`;
    });
})();
