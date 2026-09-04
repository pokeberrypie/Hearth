# The installer

`bun run scripts/build-installer.ts` → `dist/HearthSetup.exe`

One file: the wizard, the application, and everything the frontend needs. It
needs [Inno Setup](https://jrsoftware.org/isinfo.php) once —
`winget install --id JRSoftware.InnoSetup`.

## What is in here

| | |
|---|---|
| `hearth.iss` | the installer script |
| `hearth.svg` → `hearth.ico` | the app icon, 16 to 256px |
| `wizard.svg` → `wizard*.png` | the tall panel on the wizard's first and last pages |
| `wizard-small*.png` | the small badge on the inner pages |
| `GoldenGraphite.vsf` | the skin (see below) |

The `.png` and `.ico` files are generated from the `.svg` files by drawing them
to a canvas in the running app, where Cinzel is available — the wordmark on the
panel is painted there, because an SVG loaded as an image cannot reach a font
the page has loaded.

## About the skin

Inno Setup 6 can apply a VCL style to the whole wizard — pages, text, buttons —
through `WizardStyleFile`. It is native: no plugin DLL ships inside the
installer and nothing third-party executes during setup. The `.vsf` is a style
definition that Inno's own renderer reads.

`GoldenGraphite.vsf` was taken from
[RRUZ/vcl-styles-plugins](https://github.com/RRUZ/vcl-styles-plugins)
(`InnoSetup plugin/Styles New/`), chosen because gilt-on-graphite is already
this app's palette.

**Worth knowing before distributing this publicly.** These `.vsf` styles
originate with Embarcadero's Delphi, and that repository carries no top-level
licence file covering them. For a personal build it is a non-question; for
something you publish, either satisfy yourself about the licence, build a style
of your own with Delphi's style designer, or drop the line and let Inno use its
built-in appearance:

```ini
; WizardStyleFile=GoldenGraphite.vsf
; WizardStyleFileDynamicDark=GoldenGraphite.vsf
```

Without it the wizard follows Windows' own light/dark setting. The panel, the
icon, the wordmark and the wording are all ours either way — only the window
furniture changes.

## Why the wizard is dark on a light machine

Every colour and the style are given twice, once plain and once as
`...DynamicDark`. Inno picks by Windows' setting; both are set to the same
thing so the installer looks like Hearth whatever the machine is doing.

Setting the colours *without* the style was tried first, and produced a dark
window with Windows' light controls sitting on it — grey text on near-black and
white buttons. The style is what makes it dark all the way through.
