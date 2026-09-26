const fs = require('fs');
const path = require('path');

// 1. Patch initializer.js to avoid 30s timeout on window.Debug
const initPath = '/usr/src/app/node_modules/@open-wa/wa-automate/dist/controllers/initializer.js';
if (fs.existsSync(initPath)) {
  let initContent = fs.readFileSync(initPath, 'utf8');
  const targetInit = "yield waPage.waitForFunction('window.Debug!=undefined && window.Debug.VERSION!=undefined && require');";
  const fixedInit = "yield waPage.waitForFunction('window.Debug!=undefined && window.Debug.VERSION!=undefined && require', { timeout: 2000 }).catch(function(){});";
  if (initContent.includes(targetInit)) {
    initContent = initContent.replace(targetInit, fixedInit);
    fs.writeFileSync(initPath, initContent, 'utf8');
    console.log('Successfully patched initializer.js');
  } else {
    console.log('Target not found in initializer.js (already patched or different version)');
  }
}

// 2. Patch popup index.html to ensure data:image/png;base64, prefix is added to QR image src
const htmlPath = '/usr/src/app/node_modules/@open-wa/wa-automate/dist/controllers/popup/index.html';
if (fs.existsSync(htmlPath)) {
  let htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const targetHtml = '$(`#${message.sessionId} .qr`)[0].src = message.data';
  const fixedHtml = 'var qData = message.data; if (qData && !qData.startsWith("data:")) { qData = "data:image/png;base64," + qData; } $(`#${message.sessionId} .qr`)[0].src = qData;';
  if (htmlContent.includes(targetHtml)) {
    htmlContent = htmlContent.replace(targetHtml, fixedHtml);
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    console.log('Successfully patched popup index.html');
  } else {
    console.log('Target not found in popup index.html');
  }
}

// 3. Patch popup index.js to ensure /qr endpoint handles raw base64 strings gracefully
const popupPath = '/usr/src/app/node_modules/@open-wa/wa-automate/dist/controllers/popup/index.js';
if (fs.existsSync(popupPath)) {
  let popupContent = fs.readFileSync(popupPath, 'utf8');
  const targetPopup = 'const qr = sessionId ? currentQrCodes[sessionId] || currentQrCodes.latest : currentQrCodes.latest;';
  const fixedPopup = 'let qr = sessionId ? currentQrCodes[sessionId] || currentQrCodes.latest : currentQrCodes.latest; if (qr && !qr.startsWith("data:")) { qr = "data:image/png;base64," + qr; }';
  if (popupContent.includes(targetPopup)) {
    popupContent = popupContent.replace(targetPopup, fixedPopup);
    fs.writeFileSync(popupPath, popupContent, 'utf8');
    console.log('Successfully patched popup index.js');
  } else {
    console.log('Target not found in popup index.js');
  }
}

// 4. Patch puppeteer.config.js to modernize User-Agent (avoid WhatsApp Chrome/104 TOS_BLOCK)
const pptrConfigPath = '/usr/src/app/node_modules/@open-wa/wa-automate/dist/config/puppeteer.config.js';
if (fs.existsSync(pptrConfigPath)) {
  let pptrContent = fs.readFileSync(pptrConfigPath, 'utf8');
  pptrContent = pptrContent.replace(/Chrome\/104\.0\.0\.0/g, 'Chrome/133.0.0.0');
  fs.writeFileSync(pptrConfigPath, pptrContent, 'utf8');
  console.log('Successfully patched puppeteer.config.js user agent');
}
