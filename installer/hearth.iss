; Hearth — Windows installer
;
; Produces a single HearthSetup.exe: an ordinary installation wizard with the
; hearth for an icon, a page to choose where it goes, and an uninstaller that
; Settings > Apps knows about. Everything it installs is inside it, so the
; setup file is the only thing anybody has to be given.
;
; Built by scripts/build-installer.ts, which compiles Hearth.exe first and
; then hands it to this. Compile by hand with:
;
;   ISCC.exe installer\hearth.iss
;
; Two decisions worth knowing about:
;
; PrivilegesRequiredOverridesAllowed lets this install without an administrator
; prompt, into the user's own profile, and still offer a machine-wide install
; to anyone who wants one and can approve it. Hearth has no service, no driver
; and nothing to register — there is nothing it needs administrator rights for.
;
; The data folder is deliberately NOT under the install directory, and is never
; touched by install or uninstall. Chats, characters and lorebooks are not part
; of the program, and removing a program is not a request to throw away what
; you made with it.

#define AppName      "Hearth"
; Passed in by scripts/build-installer.ts, which reads package.json. The
; fallback only matters if somebody runs ISCC by hand.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppExe       "Hearth.exe"

[Setup]
AppId={{4E9C4D2A-1B7E-4F3C-9E28-9A61C0F4B7D1}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Hearth
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; The licence and readme pages are noise for something local-first with nothing
; to agree to; the folder page is the one that matters and it stays.
DisableWelcomePage=no
AllowNoIcons=yes
OutputDir=..\dist
OutputBaseFilename=HearthSetup
SetupIconFile=hearth.ico
; The wizard's own artwork: the same hearth the app opens with, so the first
; thing anybody sees already looks like the thing they are installing. Two
; sizes of each — Inno picks by display scaling, and a 164px panel stretched
; onto a 200% display is the sort of blur that makes an installer feel cheap.
WizardImageFile=wizard.png,wizard@2x.png
WizardSmallImageFile=wizard-small.png,wizard-small@2x.png
; The panel is a picture, not a logo on a background, so it fills its space.
WizardImageStretch=yes

; Dark, and the app's own dark rather than a generic one.
;
; Inno 6 does this itself — no third-party skin DLL, nothing extra shipping
; inside the installer, and no plugin running as code during setup.
;
; Each colour is given twice. Inno follows Windows' light and dark setting and
; picks the matching one; both are set to the same thing here because Hearth is
; dark whatever Windows is doing, and an installer that turned white on a
; light machine would not look like the thing being installed.
; A little larger than default. The panel artwork is the point, and the stock
; window crops it tighter than it deserves.
; The skin. Inno applies a VCL style to the whole window — pages, text,
; buttons, the lot — so the wizard is dark everywhere rather than a dark
; background with Windows' light controls sitting on it, which is what forcing
; the colours alone produced.
;
; Given twice for the same reason as the colours: the same style whether or not
; Windows is set to dark, because Hearth is dark either way.
;
; GoldenGraphite because it is gilt on graphite, which is already this app's
; palette — see installer/README.md for where it came from.
WizardStyleFile=GoldenGraphite.vsf
WizardStyleFileDynamicDark=GoldenGraphite.vsf
WizardImageBackColor=#16110e
WizardImageBackColorDynamicDark=#16110e
WizardSmallImageBackColor=#16110e
WizardSmallImageBackColorDynamicDark=#16110e
; A little larger than default. The panel artwork is the point, and the stock
; window crops it tighter than it deserves.
WizardSizePercent=115
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Put a Hearth on my Desktop"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\dist\desktop\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "hearth.ico";               DestDir: "{app}"; Flags: ignoreversion
; The tunnel, so that hosting a game over distance does not begin with an
; install. scripts/build-installer.ts fetches these before calling ISCC, so
; a missing file here means a wrong path -- and it should stop the build. It
; once carried skipifsourcedoesntexist, and that flag turned a typo in this
; very line into an installer that shipped without the tunnel and said
; nothing about it.
Source: "..\vendor\cloudflared.exe";         DestDir: "{app}"; Flags: ignoreversion
Source: "..\vendor\CLOUDFLARED-LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}";                 Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; IconFilename: "{app}\hearth.ico"
Name: "{group}\Uninstall {#AppName}";       Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";           Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; IconFilename: "{app}\hearth.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Light the hearth"; Flags: nowait postinstall skipifsilent

[InstallDelete]
; An older build kept the frontend in a folder beside the executable. It is
; inside the executable now, and the app prefers a folder on disk when it finds
; one — so a leftover would quietly shadow this and every future update.
Type: filesandordirs; Name: "{app}\public"

[UninstallDelete]
Type: files; Name: "{app}\hearth.ico"

[Messages]
WelcomeLabel2=This will install [name/ver] on your computer.%n%nHearth runs entirely on this machine. Your chats, characters and lorebooks are kept in your own user folder, separately from the program, and are left alone if you ever uninstall it.
