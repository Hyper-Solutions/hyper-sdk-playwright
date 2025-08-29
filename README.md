# Hyper Solutions Playwright SDK - Automated Bot Protection Bypass for Akamai, DataDome, Incapsula, Kasada

![Node Version](https://img.shields.io/badge/Node.js-16+-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![NPM Version](https://img.shields.io/npm/v/hyper-sdk-playwright)
![NPM Downloads](https://img.shields.io/npm/dm/hyper-sdk-playwright)

[![](https://dcbadge.limes.pink/api/server/akamai)](https://discord.gg/akamai)

A powerful **Playwright extension** that provides automated solving capabilities for major bot protection systems including **Akamai Bot Manager**, **DataDome**, **Incapsula**, and **Kasada**. Seamlessly integrate bot protection bypass into your Playwright automation workflows.

Perfect for **web scraping**, **automation testing**, **monitoring**, and **data collection** from protected websites.


## 🔑 Getting API Access

Before using this SDK, you'll need an API key from Hyper Solutions:

1. **Visit [hypersolutions.co](https://hypersolutions.co?utm_source=github&utm_medium=sdk_readme&utm_campaign=playwirhgt_sdk_api_access)** to create your account
2. **Choose your plan**:
    - 💳 **Pay-as-you-go**: Perfect for testing and small-scale usage
    - 📊 **Subscription plans**: Cost-effective for high-volume applications
3. **Get your API key** from the dashboard
4. **Start bypassing bot protection** with this SDK!


## ✨ Features

- 🛡️ **Akamai Bot Manager** - Automated sensor data generation and challenge solving
- 🎯 **DataDome** - Complete bot detection bypass with real-time challenge handling
- 🔒 **Incapsula** - Dynamic script interception and token generation
- ⚡ **Kasada** - IPS script handling and TL endpoint management
- 🔧 **Seamless Integration** - Drop-in handlers that work with existing Playwright code
- 🚀 **Zero Configuration** - Automatic detection and handling of bot protection systems

## 📦 Installation

Install the Playwright SDK and its dependencies:

```bash
npm install hyper-sdk-playwright hyper-sdk-js playwright
```

## 📋 Prerequisites

- Playwright installed and configured
- Valid Hyper SDK API key
- Chrome/Chromium browser
- Node.js 16+ environment

## 🚀 Quick Start

```javascript
import { chromium } from 'playwright';
import { Session } from 'hyper-sdk-js';
import { AkamaiHandler, DataDomeHandler, IncapsulaHandler, KasadaHandler } from 'hyper-sdk-playwright';

async function main() {
    // Initialize Hyper SDK session
    const session = new Session(process.env.API_KEY);

    // Launch browser with proxy (recommended)
    const browser = await chromium.launch({
        channel: 'chrome',
        proxy: {
            server: 'http://127.0.0.1:8888'
        }
    });

    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    });
    
    const page = await context.newPage();

    // Initialize all protection handlers
    const akamaiHandler = new AkamaiHandler({
        session,
        ipAddress: '203.0.113.1',
        acceptLanguage: 'en-US,en;q=0.9'
    });

    const dataDomeHandler = new DataDomeHandler({
        session,
        ipAddress: '203.0.113.1',  
        acceptLanguage: 'en-US,en;q=0.9'
    });

    const incapsulaHandler = new IncapsulaHandler({
        session,
        ipAddress: '203.0.113.1',
        acceptLanguage: 'en-US,en;q=0.9',
        scriptPathToSitekey: new Map([
            ['/script-path-1', 'site-key-1'],
            ['/script-path-2', 'site-key-2']
        ])
    });

    const kasadaHandler = new KasadaHandler({
        session,
        ipAddress: '203.0.113.1',
        acceptLanguage: 'en-US,en;q=0.9'
    });

    // Initialize all handlers
    await Promise.all([
        akamaiHandler.initialize(page, context),
        dataDomeHandler.initialize(page, context), 
        incapsulaHandler.initialize(page, context),
        kasadaHandler.initialize(page, context)
    ]);

    // Navigate to target site
    console.log('Navigating to example.com...');
    await page.goto('https://example.com');

    await browser.close();
}

main().catch(console.error);
```

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Installation](#-installation)
- [Handler Configuration](#-handler-configuration)
- [Best Practices](#-best-practices)
- [Troubleshooting](#-troubleshooting)
- [API Reference](#-api-reference)
- [Support](#-support)

## 🔧 Handler Configuration

### AkamaiHandler - Bypass Akamai Bot Manager

Automatically handles **Akamai sensor generation**, **pixel challenges**, and **sec-cpt verification**:

```javascript
const akamaiHandler = new AkamaiHandler({
    session: session,           // Hyper SDK session
    ipAddress: 'your.ip.here',  // Your IP address
    acceptLanguage: 'en-US,en;q=0.9' // Browser language
});
```

### DataDomeHandler - Solve DataDome Challenges

Handles **slider captchas**, **interstitial pages**, and **device fingerprinting**:

```javascript
const dataDomeHandler = new DataDomeHandler({
    session: session,
    ipAddress: 'your.ip.here', 
    acceptLanguage: 'en-US,en;q=0.9'
});
```

### IncapsulaHandler - Bypass Incapsula Protection

Manages **Reese84 sensors**, **UTMVC cookies**, and **dynamic script handling**:

```javascript
const incapsulaHandler = new IncapsulaHandler({
    session: session,
    ipAddress: 'your.ip.here',
    acceptLanguage: 'en-US,en;q=0.9',
    scriptPathToSitekey: new Map([
        ['/script-path', 'site-key'] // Map script paths to site keys
    ])
});
```

### KasadaHandler - Defeat Kasada Bot Manager

Automatically handles **IPS script processing**, **TL endpoint management**, and **POW generation**:

```javascript
const kasadaHandler = new KasadaHandler({
    session: session,
    ipAddress: 'your.ip.here',
    acceptLanguage: 'en-US,en;q=0.9'
});
```

## 🎯 Best Practices

### Proxy Configuration

Always use a proxy to avoid IP-based detection and rate limiting:

```javascript
const browser = await chromium.launch({
    proxy: {
        server: 'http://proxy-server:port',
        username: 'username', // if required
        password: 'password'  // if required
    }
});
```

### User Agent Management

Use realistic, up-to-date user agents that match your target audience:

```javascript
const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
});
```

### Error Handling

Always implement proper error handling for robust automation:

```javascript
try {
    await handler.initialize(page, context);
    await page.goto(targetUrl);
} catch (error) {
    console.error('Protection bypass failed:', error);
    // Implement retry logic or fallback
}
```

## 🔧 Troubleshooting

### Common Issues

**Handler not initializing**
- Ensure the Hyper SDK session is valid and has sufficient credits
- Verify your API key has the necessary permissions
- Check network connectivity to Hyper SDK endpoints

**Script path mapping errors (Incapsula)**
- Ensure script paths are correctly mapped to site keys
- Contact support for accurate site key information
- Monitor browser network requests for script path changes

**Browser compatibility issues**
- Use Chrome/Chromium browsers for best compatibility
- Ensure Playwright is updated to the latest version
- Verify user agent matches your browser choice

## 🆘 Support

### Contact Information

For technical support or API questions:
- Documentation: [https://docs.justhyped.dev](https://docs.justhyped.dev)
- Discord: [https://discord.gg/akamai](https://discord.gg/akamai)

---

**Keywords**: Playwright automation, bot protection bypass, web scraping, Akamai bypass, DataDome bypass, Incapsula bypass, Kasada bypass, anti-bot, captcha solver, browser automation, headless browser, web automation, bot detection, Playwright extension