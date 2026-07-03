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
    <linearGradient id="bg" x1="164" y1="90" x2="870" y2="936" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FF7559"/>
      <stop offset="0.53" stop-color="#F7942F"/>
      <stop offset="1" stop-color="#FFD36B"/>
    </linearGradient>
    <linearGradient id="paper" x1="298" y1="176" x2="708" y2="812" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#FFF6E7"/>
    </linearGradient>
    <filter id="cardShadow" x="18" y="28" width="988" height="990" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#4A210D" flood-opacity="0.22"/>
    </filter>
    <filter id="paperShadow" x="212" y="136" width="622" height="746" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#7B3316" flood-opacity="0.23"/>
    </filter>
    <clipPath id="iconClip">
      <rect x="64" y="64" width="896" height="896" rx="212"/>
    </clipPath>
  </defs>

  <g filter="url(#cardShadow)">
    <rect x="64" y="64" width="896" height="896" rx="212" fill="url(#bg)"/>
  </g>
  <g clip-path="url(#iconClip)">
    <circle cx="230" cy="194" r="150" fill="#FFFFFF" opacity="0.14"/>
    <circle cx="826" cy="806" r="220" fill="#FFFFFF" opacity="0.12"/>
    <path d="M142 730C294 785 480 766 634 693C752 637 856 632 960 682V960H142V730Z" fill="#D95C25" opacity="0.18"/>
  </g>

  <g filter="url(#paperShadow)">
    <path d="M310 184H660L760 284V760C760 809.7 719.7 850 670 850H354C304.3 850 264 809.7 264 760V230C264 204.6 284.6 184 310 184Z" fill="url(#paper)"/>
    <path d="M660 184V265C660 286 677 303 698 303H760L660 184Z" fill="#FFE3AD"/>
  </g>

  <rect x="344" y="300" width="90" height="432" rx="45" fill="#202833"/>
  <circle cx="389" cy="238" r="34" fill="#202833"/>
  <circle cx="389" cy="238" r="17" fill="#FFF6E7" opacity="0.9"/>

  <path d="M486 302H612C712.5 302 780 368.7 780 462C780 556.5 712.5 624 612 624H554V728C554 750.1 536.1 768 514 768H486V302Z" fill="#202833"/>
  <path d="M556 388H614C664 388 696 418.2 696 462C696 506.8 664 538 614 538H556V388Z" fill="#FFF6E7"/>
  <path d="M556 624H614L556 682V624Z" fill="#202833"/>

  <path d="M594 426H642" stroke="#F7942F" stroke-width="20" stroke-linecap="round"/>
  <path d="M594 462H664" stroke="#F7942F" stroke-width="20" stroke-linecap="round"/>
  <path d="M594 498H642" stroke="#F7942F" stroke-width="20" stroke-linecap="round"/>
  <circle cx="684" cy="426" r="15" fill="#FFF6E7" stroke="#F7942F" stroke-width="12"/>
  <circle cx="704" cy="462" r="15" fill="#FFF6E7" stroke="#F7942F" stroke-width="12"/>
  <circle cx="684" cy="498" r="15" fill="#FFF6E7" stroke="#F7942F" stroke-width="12"/>
</svg>
`;

function renderPng(size) {
  return new Resvg(svg, {
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
console.log("  src/app/favicon.ico (16/32/48/64)");
console.log("  electron/splash-logo.ts (256x256 data URL)");
