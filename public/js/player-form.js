// Player add/edit form: crop + compress the photo before upload, preview it,
// and show a "saving" state so a slow upload can't be submitted twice.
(function () {
    const form = document.querySelector('[data-player-form]');
    if (!form) return;

    form.addEventListener('change', async (event) => {
        const input = event.target.closest('[data-image-input]');
        if (!input || !input.files || !input.files[0]) return;
        const field = input.closest('[data-image-field]');
        const preview = field?.querySelector('[data-image-preview]');

        const image = window.ImageTools ? await window.ImageTools.prepare(input, input.dataset.crop) : input.files[0];
        if (!image) return; // crop cancelled
        if (window.ImageTools) window.ImageTools.preview(preview, image);
        const remove = field?.querySelector('.image-field-remove input');
        if (remove) remove.checked = false;
    });

    form.addEventListener('submit', () => {
        const button = form.querySelector('[type="submit"][data-submit-label]');
        if (!button) return;
        button.disabled = true;
        const hasPhoto = Boolean(form.querySelector('[data-image-input]')?.files?.length);
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${hasPhoto ? 'Uploading photo…' : button.dataset.submitLabel}`;
    });
})();
