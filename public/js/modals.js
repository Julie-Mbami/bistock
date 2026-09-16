/* =========================================================================
   StockSmart — Système de modales et notifications personnalisées
   Remplace les alert() / confirm() natifs par des modales stylées.

   API publique :
     showAlert({type, title, message, okText})           → Promise<void>
     showConfirm({type, title, message, okText, cancelText, danger}) → Promise<bool>
     showSuccess(title, message)                         → Promise<void>
     showError(title, message)                           → Promise<void>
     showWarning(title, message)                         → Promise<void>
     showInfo(title, message)                            → Promise<void>
     toast(message, type, duration)                      → toast en haut à droite
   ========================================================================= */

(function() {
    'use strict';

    const ICONS = {
        success: 'bi-check-circle-fill',
        warning: 'bi-exclamation-triangle-fill',
        danger:  'bi-x-octagon-fill',
        error:   'bi-x-octagon-fill',
        info:    'bi-info-circle-fill',
        confirm: 'bi-question-circle-fill',
    };

    // ===== Modale (alert/confirm) =====
    let activeOverlay = null;

    function buildModal(opts) {
        const {
            type = 'info',
            title = '',
            message = '',
            okText = 'OK',
            okHtml = null,         // HTML brut autorisé (ex: icône) — prioritaire sur okText
            cancelText = null,
            cancelHtml = null,
            danger = false,
        } = opts;

        // Nettoie une modale précédente
        if (activeOverlay) activeOverlay.remove();

        const overlay = document.createElement('div');
        overlay.className = 'app-modal-overlay show';

        const okClass = danger ? 'btn btn-danger' : 'btn btn-primary';
        const okContent = okHtml || escapeHtml(okText);
        const cancelContent = cancelHtml || (cancelText ? escapeHtml(cancelText) : null);
        const cancelHtmlNode = cancelContent
            ? `<button type="button" class="btn btn-secondary" data-action="cancel">${cancelContent}</button>`
            : '';

        overlay.innerHTML = `
            <div class="app-modal" role="dialog" aria-modal="true">
                <div class="app-modal-icon ${type}">
                    <i class="bi ${ICONS[type] || ICONS.info}"></i>
                </div>
                <div class="app-modal-body">
                    ${title ? `<h3 class="app-modal-title">${escapeHtml(title)}</h3>` : ''}
                    ${message ? `<div class="app-modal-message">${message}</div>` : ''}
                </div>
                <div class="app-modal-footer">
                    ${cancelHtmlNode}
                    <button type="button" class="${okClass}" data-action="ok" autofocus>${okContent}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        activeOverlay = overlay;

        return overlay;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function closeModal(overlay) {
        if (!overlay) return;
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.remove();
            if (activeOverlay === overlay) activeOverlay = null;
        }, 150);
    }

    function setupModalEvents(overlay, resolve, value) {
        overlay.querySelector('[data-action="ok"]').addEventListener('click', () => {
            closeModal(overlay);
            resolve(value);
        });
        const cancelBtn = overlay.querySelector('[data-action="cancel"]');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                closeModal(overlay);
                resolve(false);
            });
        }
        // Fermer en cliquant à l'extérieur
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay);
                resolve(cancelBtn ? false : value);
            }
        });
        // Échap
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal(overlay);
                resolve(cancelBtn ? false : value);
                document.removeEventListener('keydown', escHandler);
            } else if (e.key === 'Enter') {
                closeModal(overlay);
                resolve(value);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    window.showAlert = function(opts) {
        return new Promise((resolve) => {
            const overlay = buildModal(opts);
            setupModalEvents(overlay, resolve, true);
        });
    };

    window.showConfirm = function(opts) {
        return new Promise((resolve) => {
            const overlay = buildModal({
                type: 'confirm',
                cancelText: 'Annuler',
                okText: 'Confirmer',
                ...opts,
            });
            setupModalEvents(overlay, resolve, true);
        });
    };

    window.showSuccess = function(title, message, okText) {
        return showAlert({ type: 'success', title, message, okText: okText || 'OK' });
    };
    window.showError = function(title, message, okText) {
        return showAlert({ type: 'danger', title, message, okText: okText || 'Fermer' });
    };
    window.showWarning = function(title, message, okText) {
        return showAlert({ type: 'warning', title, message, okText: okText || 'OK' });
    };
    window.showInfo = function(title, message, okText) {
        return showAlert({ type: 'info', title, message, okText: okText || 'OK' });
    };

    // ===== Toast (notification temporaire en haut à droite) =====
    function getToastContainer() {
        let c = document.getElementById('toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toast-container';
            c.className = 'toast-container';
            document.body.appendChild(c);
        }
        return c;
    }

    window.toast = function(message, type = 'info', duration = 3500, title = null) {
        const container = getToastContainer();
        const item = document.createElement('div');
        item.className = `toast-item ${type}`;
        item.innerHTML = `
            <i class="bi ${ICONS[type] || ICONS.info} toast-icon"></i>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
                <div>${message}</div>
            </div>
            <button class="toast-close" type="button" aria-label="Fermer">&times;</button>
        `;
        container.appendChild(item);

        const close = () => {
            item.classList.add('closing');
            setTimeout(() => item.remove(), 300);
        };
        item.querySelector('.toast-close').addEventListener('click', close);
        setTimeout(close, duration);
        return item;
    };

    // Alias pratiques
    window.toastSuccess = (msg, title) => toast(msg, 'success', 3000, title || null);
    window.toastError   = (msg, title) => toast(msg, 'danger', 5000, title || 'Erreur');
    window.toastWarning = (msg, title) => toast(msg, 'warning', 4000, title || null);
    window.toastInfo    = (msg, title) => toast(msg, 'info', 3000, title || null);

    // ===== Handler global data-confirm =====
    // Utilisation :
    //   <form data-confirm="Voulez-vous vraiment ?" data-confirm-type="warning" data-confirm-danger="true">
    //   <a href="..." data-confirm="Confirmer cette action ?">
    //   <button type="button" data-confirm="..." onclick="fonction()">
    function extractConfirmOpts(el) {
        return {
            type: el.dataset.confirmType || 'warning',
            title: el.dataset.confirmTitle || 'Confirmer l\'action',
            message: el.dataset.confirm,
            okText: el.dataset.confirmOk || 'Confirmer',
            cancelText: el.dataset.confirmCancel || 'Annuler',
            danger: el.dataset.confirmDanger === 'true',
        };
    }

    // Intercepter les submits de formulaires
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form.dataset.confirm && form.dataset.confirmed !== 'yes') {
            e.preventDefault();
            e.stopImmediatePropagation();
            showConfirm(extractConfirmOpts(form)).then(function(ok) {
                if (ok) { form.dataset.confirmed = 'yes'; form.submit(); }
            });
            return false;
        }
    }, true);

    // Intercepter les clics sur liens et boutons (hors submit — utile pour <a href>)
    document.addEventListener('click', function(e) {
        const el = e.target.closest('[data-confirm]');
        if (!el || el.tagName === 'FORM' || el.type === 'submit') return;
        if (el.dataset.confirmed === 'yes') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        showConfirm(extractConfirmOpts(el)).then(function(ok) {
            if (!ok) return;
            el.dataset.confirmed = 'yes';
            if (el.tagName === 'A' && el.href) {
                if (el.target === '_blank') window.open(el.href, '_blank');
                else window.location.href = el.href;
            } else {
                el.click(); // re-déclenche le clic normal (le data-confirmed empêche la boucle)
            }
        });
    }, true);
})();
