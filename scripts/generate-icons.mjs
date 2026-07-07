#!/usr/bin/env node
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const buildDir = path.join(root, "build");
const publicDir = path.join(root, "public");
const appDir = path.join(root, "src", "app");
const electronDir = path.join(root, "electron");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="card" x1="168" y1="106" x2="852" y2="922" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.58" stop-color="#F7F8FF"/>
      <stop offset="1" stop-color="#EEF2FF"/>
    </linearGradient>
    <radialGradient id="cardGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(520 292) rotate(90) scale(584 560)">
      <stop offset="0" stop-color="#C7D7FF" stop-opacity="0.75"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mark" x1="338" y1="250" x2="682" y2="774" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#B8A6FF"/>
      <stop offset="0.42" stop-color="#6678FF"/>
      <stop offset="1" stop-color="#244CFF"/>
    </linearGradient>
    <linearGradient id="markShade" x1="510" y1="300" x2="510" y2="742" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.3"/>
      <stop offset="0.42" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="1" stop-color="#07144F" stop-opacity="0.16"/>
    </linearGradient>
    <filter id="cardShadow" x="42" y="48" width="940" height="934" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#1E2435" flood-opacity="0.18"/>
    </filter>
    <filter id="markShadow" x="208" y="214" width="616" height="610" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="26" stdDeviation="22" flood-color="#244CFF" flood-opacity="0.26"/>
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#0F1C7A" flood-opacity="0.18"/>
    </filter>
    <clipPath id="cardClip">
      <rect x="88" y="88" width="848" height="848" rx="198"/>
    </clipPath>
  </defs>

  <g filter="url(#cardShadow)">
    <rect x="88" y="88" width="848" height="848" rx="198" fill="url(#card)"/>
    <rect x="89.5" y="89.5" width="845" height="845" rx="196.5" stroke="#E4E7F1" stroke-width="3"/>
  </g>
  <g clip-path="url(#cardClip)">
    <rect x="88" y="88" width="848" height="848" fill="url(#cardGlow)"/>
    <circle cx="294" cy="270" r="150" fill="#FFFFFF" opacity="0.62"/>
    <circle cx="788" cy="742" r="196" fill="#D9E4FF" opacity="0.34"/>
  </g>

  <g filter="url(#markShadow)">
    <path d="M324 238H602C631 238 659 250 680 271L766 357C787 378 799 406 799 435V696C799 746 758 786 708 786H324C274 786 233 746 233 696V328C233 278 274 238 324 238Z" fill="url(#mark)"/>
    <path d="M324 238H602C631 238 659 250 680 271L766 357C787 378 799 406 799 435V696C799 746 758 786 708 786H324C274 786 233 746 233 696V328C233 278 274 238 324 238Z" fill="url(#markShade)"/>
    <path d="M646 265V370C646 398 668 420 696 420H794C789 396 777 374 759 357L680 278C670 268 659 263 646 265Z" fill="#DDE6FF" opacity="0.42"/>
    <path d="M294 318C294 300 309 285 327 285H596C627 285 656 297 678 319L739 380C753 394 762 412 765 432C685 395 615 382 531 397C446 412 373 405 294 381V318Z" fill="#FFFFFF" opacity="0.16"/>
  </g>

  <circle cx="390" cy="414" r="33" fill="#FFFFFF" opacity="0.96"/>
  <rect x="348" y="472" width="84" height="218" rx="42" fill="#FFFFFF" opacity="0.96"/>
  <path d="M512 428H620C694 428 744 475 744 539C744 604 694 650 620 650H568V704" stroke="#FFFFFF" stroke-width="52" stroke-linecap="round" stroke-linejoin="round" opacity="0.96"/>
  <path d="M568 512H620C644 512 662 523 662 540C662 558 644 568 620 568H568V512Z" fill="#5E74FF" opacity="0.5"/>
  <path d="M572 618L526 665V618H572Z" fill="#FFFFFF" opacity="0.9"/>
  <path d="M588 498H638" stroke="#DDE6FF" stroke-width="18" stroke-linecap="round" opacity="0.95"/>
  <path d="M588 540H672" stroke="#DDE6FF" stroke-width="18" stroke-linecap="round" opacity="0.95"/>
  <path d="M588 582H638" stroke="#DDE6FF" stroke-width="18" stroke-linecap="round" opacity="0.95"/>
</svg>
`;

const transparentLogoSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mark" x1="322" y1="220" x2="706" y2="820" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#B8A6FF"/>
      <stop offset="0.42" stop-color="#6678FF"/>
      <stop offset="1" stop-color="#244CFF"/>
    </linearGradient>
    <linearGradient id="markShade" x1="512" y1="278" x2="512" y2="786" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.3"/>
      <stop offset="0.48" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="1" stop-color="#07144F" stop-opacity="0.16"/>
    </linearGradient>
    <filter id="markShadow" x="160" y="178" width="704" height="704" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#244CFF" flood-opacity="0.28"/>
      <feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#0F1C7A" flood-opacity="0.2"/>
    </filter>
  </defs>

  <g filter="url(#markShadow)">
    <path d="M305 218H606C637 218 667 231 689 253L782 346C804 368 817 398 817 429V711C817 765 773 808 719 808H305C251 808 207 765 207 711V316C207 262 251 218 305 218Z" fill="url(#mark)"/>
    <path d="M305 218H606C637 218 667 231 689 253L782 346C804 368 817 398 817 429V711C817 765 773 808 719 808H305C251 808 207 765 207 711V316C207 262 251 218 305 218Z" fill="url(#markShade)"/>
    <path d="M653 246V366C653 396 677 420 707 420H813C808 392 795 367 775 347L689 261C679 251 666 246 653 246Z" fill="#DDE6FF" opacity="0.42"/>
    <path d="M272 306C272 286 288 270 308 270H598C632 270 663 283 687 307L753 373C768 388 778 408 781 430C695 390 619 376 528 392C436 408 357 400 272 374V306Z" fill="#FFFFFF" opacity="0.16"/>
  </g>

  <circle cx="377" cy="410" r="36" fill="#FFFFFF" opacity="0.96"/>
  <rect x="332" y="472" width="90" height="236" rx="45" fill="#FFFFFF" opacity="0.96"/>
  <path d="M506 424H623C703 424 757 475 757 544C757 614 703 664 623 664H567V723" stroke="#FFFFFF" stroke-width="56" stroke-linecap="round" stroke-linejoin="round" opacity="0.96"/>
  <path d="M567 516H623C649 516 668 528 668 546C668 565 649 576 623 576H567V516Z" fill="#5E74FF" opacity="0.5"/>
  <path d="M572 630L522 681V630H572Z" fill="#FFFFFF" opacity="0.9"/>
  <path d="M588 500H642" stroke="#DDE6FF" stroke-width="19" stroke-linecap="round" opacity="0.95"/>
  <path d="M588 545H679" stroke="#DDE6FF" stroke-width="19" stroke-linecap="round" opacity="0.95"/>
  <path d="M588 590H642" stroke="#DDE6FF" stroke-width="19" stroke-linecap="round" opacity="0.95"/>
</svg>
`;

function renderPng(size) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0, 0, 0, 0)",
  }).render().asPng();
}

function renderTransparentLogoPng(size) {
  return new Resvg(transparentLogoSvg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0, 0, 0, 0)",
  }).render().asPng();
}

function makeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const base = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, base);
    directory.writeUInt8(size >= 256 ? 0 : size, base + 1);
    directory.writeUInt8(0, base + 2);
    directory.writeUInt8(0, base + 3);
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(electronDir, { recursive: true });

fs.writeFileSync(path.join(buildDir, "icon.svg"), svg);
fs.writeFileSync(path.join(buildDir, "icon.png"), renderPng(1024));
fs.writeFileSync(path.join(publicDir, "InkPressLogo.png"), renderPng(512));
fs.writeFileSync(path.join(publicDir, "inkpress-logo.png"), renderPng(512));
fs.writeFileSync(path.join(publicDir, "inkpress-logo-transparent.png"), renderTransparentLogoPng(512));

const faviconEntries = [16, 32, 48, 64].map((size) => ({ size, png: renderPng(size) }));
fs.writeFileSync(path.join(appDir, "favicon.ico"), makeIco(faviconEntries));

const splashPng = renderPng(256);
const splashDataUrl = `data:image/png;base64,${splashPng.toString("base64")}`;
fs.writeFileSync(
  path.join(electronDir, "splash-logo.ts"),
  `/* Auto-generated from InkPressLogo.png (256x256). Do not edit by hand. */\nexport const SPLASH_LOGO_DATA_URL = ${JSON.stringify(splashDataUrl)};\n`
);

console.log("Generated InkPress icons:");
console.log("  build/icon.svg");
console.log("  build/icon.png (1024x1024)");
console.log("  public/InkPressLogo.png (512x512)");
console.log("  public/inkpress-logo.png (512x512)");
console.log("  public/inkpress-logo-transparent.png (512x512)");
console.log("  src/app/favicon.ico (16/32/48/64)");
console.log("  electron/splash-logo.ts (256x256 data URL)");
