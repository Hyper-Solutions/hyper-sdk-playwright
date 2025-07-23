# hyper-sdk-playwright

A Playwright extension that provides automated solving capabilities for major bot protection systems including Akamai, DataDome, Incapsula, and Kasada.

## Features

- **Akamai Bot Manager** - Automated sensor data generation and challenge solving
- **DataDome** - Complete bot detection bypass with real-time challenge handling
- **Incapsula** - Dynamic script interception and token generation
- **Kasada** - IPS script handling and TL endpoint management
- **Seamless Integration** - Drop-in handlers that work with existing Playwright code

## Installation

```bash
npm install hyper-sdk-playwright hyper-sdk-js playwright
```

## Prerequisites

- Playwright installed and configured
- Valid Hyper SDK API key
- Chrome/Chromium browser

## Quick Start

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

## Handler Configuration

### AkamaiHandler
```javascript
const akamaiHandler = new AkamaiHandler({
    session: session,           // Hyper SDK session
    ipAddress: 'your.ip.here',  // Your IP address
    acceptLanguage: 'en-US,en;q=0.9' // Browser language
});
```

### DataDomeHandler
```javascript
const dataDomeHandler = new DataDomeHandler({
    session: session,
    ipAddress: 'your.ip.here', 
    acceptLanguage: 'en-US,en;q=0.9'
});
```

### IncapsulaHandler
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

### KasadaHandler
```javascript
const kasadaHandler = new KasadaHandler({
    session: session,
    ipAddress: 'your.ip.here',
    acceptLanguage: 'en-US,en;q=0.9'
});
```

## Environment Setup

Create a `.env` file:
```
API_KEY=your_hyper_sdk_api_key_here
```

## Best Practices

### Proxy Configuration
Always use a proxy to avoid IP-based detection:
```javascript
const browser = await chromium.launch({
    proxy: {
        server: 'http://proxy-server:port',
        username: 'username', // if required
        password: 'password'  // if required
    }
});
```

### User Agent
Use realistic, up-to-date user agents:
```javascript
const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
});
```

### Error Handling
Always implement proper error handling:
```javascript
try {
    await handler.initialize(page, context);
    await page.goto(targetUrl);
} catch (error) {
    console.error('Protection bypass failed:', error);
    // Implement retry logic or fallback
}
```

## Troubleshooting

### Common Issues

1. **Handler not initializing**: Ensure the Hyper SDK session is valid and has sufficient credits
2. **Script path mapping**: For Incapsula, ensure script paths are correctly mapped to site keys. Contact support for site keys.

## API Reference

### Handler Methods

- `initialize(page, context)` - Initialize handler with Playwright page and context

### Configuration Options

All handlers support:
- `session` - Hyper SDK session instance
- `ipAddress` - Client IP address
- `acceptLanguage` - Browser accept-language header

Additional options per handler:
- **IncapsulaHandler**: `scriptPathToSitekey` - Map of script paths to site keys

## Support

For technical support and API documentation, visit the Hyper SDK documentation or contact support.