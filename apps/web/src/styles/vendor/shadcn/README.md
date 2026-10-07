# shadcn Tailwind styles

`tailwind.css` is an unmodified copy of `shadcn@4.17.0/dist/tailwind.css`,
licensed under MIT (see `LICENSE`; upstream `shadcn-ui/ui/LICENSE.md`).
SHA-256: `bc7d83425702955b4cb67cb14ede9d603f9d912376d57a2d81d661094d2a782a`.

Chrona uses the official generated shadcn components and these static styles,
not the shadcn CLI at runtime. Keeping the stylesheet locally avoids installing
its unrelated CLI dependency tree, including `braces` (GHSA-vfj7-8cjw-p6xm,
no patched release available at the time of this change).

To update: review the upstream stylesheet, copy it without changes, preserve
its license, update the version/hash here, then run `check:ui-foundation`,
frontend tests and a web build. Do not replace official primitives with custom
controls. Component generation remains an explicit developer operation;
review the CLI's dependency audit before invoking it separately.
