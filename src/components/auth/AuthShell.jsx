import React from 'react';
import BrandMark from '../BrandMark';

// Responsive authentication shell shared by sign-in / sign-up / reset and the
// set-new-password screen, so every auth surface is on-brand and consistent.
//
// Desktop (lg+): two columns — a left ambient MoFlow brand panel and a right
// focused auth card. Mobile: single centered column with a compact brand header
// above the card. All colors come from MoFlow design tokens (bg-background,
// bg-card, text-foreground, bg-primary, border-border …) so it is correct in
// both light and dark mode. The "high-tech" treatment is CSS-only: a restrained
// primary radial glow, a very faint masked grid, and controlled shadows — no
// external image, no decorative animation.
//
// Props:
//   children  : the auth card (form)
//   footer    : optional small print rendered under the card (auth column)
export default function AuthShell({ children, footer }) {
  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-2">
      {/* ---- Brand panel (desktop only) ---- */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 bg-gradient-to-br from-card to-background border-r border-border">
        {/* faint masked grid */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(120,130,150,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(120,130,150,0.10) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            WebkitMaskImage: 'radial-gradient(ellipse at 30% 30%, #000 0%, transparent 78%)',
            maskImage: 'radial-gradient(ellipse at 30% 30%, #000 0%, transparent 78%)',
          }}
        />
        {/* restrained primary glow */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-28 -left-24 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />

        {/* wordmark */}
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <BrandMark size={26} />
          </span>
          <span className="text-xl font-extrabold tracking-tight">MoFlow</span>
        </div>

        {/* headline + supporting copy */}
        <div className="relative max-w-md">
          <h2 className="text-4xl font-extrabold leading-tight tracking-tight">
            Know what&apos;s coming.
            <br />
            Stay in control.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            See your upcoming obligations, available cash, and financial commitments in one place —
            so every spending decision is an informed one.
          </p>
        </div>

        {/* trust line — only claims the architecture actually supports */}
        <p className="relative text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Private by design.</span>{' '}
          MoFlow organizes your financial information without ever asking for your bank password.
        </p>
      </aside>

      {/* ---- Auth column ---- */}
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* compact brand header (mobile) */}
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              <BrandMark size={30} />
            </span>
            <span className="text-2xl font-extrabold tracking-tight">MoFlow</span>
            <p className="mt-1 text-sm text-muted-foreground">Know what&apos;s coming. Stay in control.</p>
          </div>

          {children}

          {footer && <div className="mt-5 text-center text-[11px] text-muted-foreground">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
