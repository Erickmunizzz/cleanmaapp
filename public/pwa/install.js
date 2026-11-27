(() => {
  "use strict";
  if (customElements.get("cleanma-install")) return;

  let installEvent;
  let installPortal;
  const currentPortal = () => {
    const path = location.pathname;
    if (path === "/admin" || path.startsWith("/admin/")) return "owner";
    if (path === "/cleaner" || path === "/cleaner.html" || path.startsWith("/cleaner/")) return "cleaner";
  };
  const standalone = window.matchMedia("(display-mode: standalone)");
  const installed = () => standalone.matches || navigator.standalone === true;
  const apple = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const refresh = () => document.querySelectorAll("cleanma-install").forEach(el => el.refresh());

  window.addEventListener("beforeinstallprompt", event => {
    const portal = currentPortal();
    if (!portal) return;
    event.preventDefault();
    installEvent = event;
    installPortal = portal;
    refresh();
  });

  window.addEventListener("appinstalled", () => {
    installEvent = undefined;
    document.querySelectorAll("cleanma-install").forEach(el => el.dismiss());
  });
  standalone.addEventListener?.("change", refresh);

  class InstallGuide extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({mode: "open"});
      root.innerHTML = `
        <style>
          :host { display: block; }
          .guide[hidden] { display: none; }
          .guide { position: fixed; z-index: 45; left: 50%; transform: translateX(-50%);
            bottom: calc(5rem + env(safe-area-inset-bottom, 0px)); box-sizing: border-box;
            width: min(28rem, calc(100% - 2rem)); display: flex; align-items: center;
            gap: .75rem; padding: .75rem; border: 1px solid #cbd5e1; border-radius: .9rem;
            background: white; color: #0f172a; box-shadow: 0 .5rem 1.5rem #0f172a26;
            font: 500 .875rem/1.45 system-ui, sans-serif; }
          .body { flex: 1; }
          button { cursor: pointer; font: inherit; }
          .install { border: 0; border-radius: .5rem; padding: .5rem .75rem;
            background: #1d4ed8; color: white; }
          .close { border: 0; border-radius: .5rem; width: 2rem; height: 2rem;
            background: #f1f5f9; color: #0f172a; font-size: 1.25rem; }
        </style>
        <aside class="guide" hidden aria-label="Install CleanMa">
          <div class="body">
            <button class="install" type="button" hidden>Install app</button>
            <span class="apple" hidden>Open in Safari, tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, then choose <strong>Open as Web App</strong> if shown.</span>
          </div>
          <button class="close" type="button" aria-label="Dismiss installation guide">×</button>
        </aside>`;
      this.key = "cleanma.install.dismissed." + this.dataset.portal;
      try { this.dismissed = sessionStorage.getItem(this.key) === "1"; } catch {}
      root.querySelector(".close").onclick = () => this.dismiss();
      root.querySelector(".install").onclick = async () => {
        const event = installEvent;
        if (!event || installPortal !== this.dataset.portal) return;
        installEvent = undefined;
        this.refresh();
        try {
          await event.prompt();
          if ((await event.userChoice).outcome === "accepted") this.dismiss();
        } catch {}
        this.refresh();
      };
      this.refresh();
    }

    dismiss() {
      this.dismissed = true;
      try { sessionStorage.setItem(this.key, "1"); } catch {}
      this.refresh();
    }

    refresh() {
      if (!this.shadowRoot) return;
      const available = Boolean(installEvent) && installPortal === this.dataset.portal;
      const offer = !installed() && !this.dismissed && (available || apple);
      this.shadowRoot.querySelector(".guide").hidden = !offer;
      this.shadowRoot.querySelector(".install").hidden = !available;
      this.shadowRoot.querySelector(".apple").hidden = available || !apple;
    }
  }

  customElements.define("cleanma-install", InstallGuide);
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js", {updateViaCache: "none"}).catch(() => {});
  }
})();
