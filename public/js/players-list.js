// Players list: click an avatar to add or replace that player's photo.
(function () {
    if (!window.ImageTools) return;

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.hidden = true;
    document.body.appendChild(picker);
    let target = null;

    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-photo-player]');
        if (!button) return;
        target = button;
        picker.value = '';
        picker.click();
    });

    picker.addEventListener('change', async () => {
        if (!target || !picker.files?.[0]) return;
        const button = target;
        const image = await window.ImageTools.prepare(picker, 'square');
        if (!image) return;

        const body = new FormData();
        body.append('photo', image, 'photo.jpg');
        button.classList.add('is-uploading');
        try {
            const res = await fetch(`/admin/players/${button.dataset.photoPlayer}/photo`, {
                method: 'POST',
                body,
                headers: { Accept: 'application/json' },
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            const img = document.createElement('img');
            img.src = data.photoThumb;
            img.alt = '';
            img.className = 'player-avatar';
            button.querySelector('.player-avatar')?.replaceWith(img);
            window.showToast?.('Photo saved', 'success');
        } catch (error) {
            window.showToast?.(`Photo not saved: ${error.message}`, 'error');
        } finally {
            button.classList.remove('is-uploading');
        }
    });
})();
