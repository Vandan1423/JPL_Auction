// Image helpers for uploads: square crop for people (Cropper.js), resize for
// logos. Images are shrunk in the browser first, so a 6 MB phone photo goes
// up as a ~150 KB JPEG — fast even on venue Wi-Fi.
(function () {
    const PHOTO_SIZE = 800;
    const LOGO_MAX = 800;

    const canReplaceFiles = (() => {
        try {
            return Boolean(new DataTransfer());
        } catch {
            return false;
        }
    })();

    /** Put a processed image back into a file input so a normal form submit sends it. */
    function setInputFile(input, blob, originalName) {
        if (!canReplaceFiles || !input) return false;
        const ext = blob.type === 'image/png' ? 'png' : 'jpg';
        const name = `${(originalName || 'photo').replace(/\.[^.]+$/, '')}.${ext}`;
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], name, { type: blob.type, lastModified: Date.now() }));
        input.files = transfer.files;
        return true;
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('This image format cannot be previewed in this browser'));
            img.src = URL.createObjectURL(file);
        });
    }

    const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

    /** Shrink to fit `max` px (keeps PNG/WebP transparency for logos). */
    async function resize(file, max = LOGO_MAX) {
        const img = await loadImage(file);
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const transparent = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
        return (await toBlob(canvas, transparent ? 'image/png' : 'image/jpeg', 0.88)) || file;
    }

    // ── Square crop dialog ──
    let dialog = null;
    function ensureDialog() {
        if (dialog) return dialog;
        dialog = document.createElement('div');
        dialog.className = 'crop-modal';
        dialog.hidden = true;
        dialog.innerHTML = `
            <div class="crop-dialog" role="dialog" aria-modal="true" aria-label="Adjust photo">
                <h3><i class="fa-solid fa-crop-simple"></i> Adjust photo</h3>
                <p class="muted">Drag to move, scroll or pinch to zoom. The square is what everyone will see.</p>
                <div class="crop-area"><img alt=""></div>
                <div class="crop-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-crop-rotate="-90" title="Rotate left"><i class="fa-solid fa-rotate-left"></i></button>
                    <button type="button" class="btn btn-ghost btn-sm" data-crop-rotate="90" title="Rotate right"><i class="fa-solid fa-rotate-right"></i></button>
                    <span class="crop-spacer"></span>
                    <button type="button" class="btn btn-secondary" data-crop-cancel>Cancel</button>
                    <button type="button" class="btn btn-primary" data-crop-done><i class="fa-solid fa-check"></i> Use photo</button>
                </div>
            </div>`;
        document.body.appendChild(dialog);
        return dialog;
    }

    /** Let the user crop a square; resolves to a JPEG blob, the original file, or null if cancelled. */
    function cropSquare(file) {
        if (typeof window.Cropper === 'undefined') return resize(file, PHOTO_SIZE);

        return new Promise((resolve) => {
            const el = ensureDialog();
            const img = el.querySelector('.crop-area img');
            let cropper = null;

            const finish = (result) => {
                cropper?.destroy();
                el.hidden = true;
                document.removeEventListener('keydown', onKey, true);
                URL.revokeObjectURL(img.src);
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
            };

            img.onerror = () => {
                // e.g. an iPhone HEIC photo in Chrome: upload it as it is.
                window.showToast?.('This photo cannot be cropped here; it will be uploaded as it is.', 'info');
                finish(file);
            };
            img.onload = () => {
                el.hidden = false;
                cropper = new window.Cropper(img, {
                    aspectRatio: 1,
                    viewMode: 1,
                    dragMode: 'move',
                    autoCropArea: 0.9,
                    background: false,
                    responsive: true,
                });
            };
            img.src = URL.createObjectURL(file);

            el.querySelectorAll('[data-crop-rotate]').forEach((b) => {
                b.onclick = () => cropper?.rotate(Number(b.dataset.cropRotate));
            });
            el.querySelector('[data-crop-cancel]').onclick = () => finish(null);
            el.querySelector('[data-crop-done]').onclick = async () => {
                const canvas = cropper.getCroppedCanvas({ width: PHOTO_SIZE, height: PHOTO_SIZE, fillColor: '#fff', imageSmoothingQuality: 'high' });
                finish((await toBlob(canvas, 'image/jpeg', 0.86)) || file);
            };
            document.addEventListener('keydown', onKey, true);
        });
    }

    /**
     * Process the file chosen in `input`: crop (mode "square") or resize
     * (mode "fit"). The input's file is replaced with the result. Returns the
     * blob to preview/upload, or null when the user cancelled.
     */
    async function prepare(input, mode = 'fit') {
        const file = input?.files?.[0];
        if (!file) return null;
        let result;
        try {
            result = mode === 'square' ? await cropSquare(file) : await resize(file);
        } catch {
            result = file; // can't decode it here; let Cloudinary handle it
        }
        if (result === null) {
            input.value = '';
            return null;
        }
        if (result !== file) setInputFile(input, result, file.name);
        return result;
    }

    /** Show a blob/file inside a preview container. */
    function preview(container, blob) {
        if (!container || !blob) return;
        const img = document.createElement('img');
        img.alt = '';
        img.src = URL.createObjectURL(blob);
        container.replaceChildren(img);
    }

    window.ImageTools = { prepare, cropSquare, resize, setInputFile, preview };
})();
