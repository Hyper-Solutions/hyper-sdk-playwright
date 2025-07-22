import { Page, BrowserContext } from 'playwright';
import { Session } from 'hyper-sdk-js';
import { Route } from "@playwright/test";
import {generateKasadaPayload, KasadaPayloadInput} from "hyper-sdk-js/kasada/payload";

export interface KasadaHandlerConfig {
    session: Session;
    userAgent?: string;
    ipAddress?: string;
    acceptLanguage?: string;
}

export interface KasadaScriptCapture {
    ipsScriptUrl: string | null;
    ipsResponseText: string | null;
    tlEndpointUrl: string | null;
}

export class KasadaHandler {
    private session: Session;
    private userAgent: string;
    private ipAddress: string;
    private acceptLanguage: string;

    // Captured data
    private scriptCapture: KasadaScriptCapture = {
        ipsScriptUrl: null,
        ipsResponseText: null,
        tlEndpointUrl: null
    };

    // Promise management for script response
    private ipsScriptPromise: Promise<void>;
    private resolveIpsScript: (() => void) | null = null;

    constructor(config: KasadaHandlerConfig) {
        this.session = config.session;
        this.userAgent = config.userAgent || '';
        this.ipAddress = config.ipAddress || '193.32.249.165';
        this.acceptLanguage = config.acceptLanguage || 'en-US,en;q=0.9';

        this.ipsScriptPromise = new Promise((resolve) => {
            this.resolveIpsScript = resolve;
        });
    }

    /**
     * Initialize the handler on a Playwright page
     */
    public async initialize(page: Page, context: BrowserContext): Promise<void> {
        await this.setupResponseHandler(page);
        await this.setupRequestInterceptors(page, context);
    }

    /**
     * Set up response handler to capture IPS script response
     */
    private async setupResponseHandler(page: Page): Promise<void> {
        page.on('response', async (response) => {
            const request = response.request();
            const requestUrl = request.url();

            try {
                // Capture IPS script response
                if (request.method() === 'GET') {
                    await this.handleIpsScriptResponse(response, requestUrl);
                }
            } catch (error) {
                console.error('Error in Kasada response handler:', error);
            }
        });
    }

    /**
     * Handle IPS script response
     */
    private async handleIpsScriptResponse(response: any, requestUrl: string): Promise<void> {
        // Check if this is the IPS script URL we're looking for
        const ipsScriptPattern = /149e9513-01fa-4fb0-aad4-566afd725d1b\/2d206a39-8ed7-437e-a3be-862e0f06eea3\/ips\.js/;

        if (ipsScriptPattern.test(requestUrl)) {
            this.scriptCapture.ipsScriptUrl = requestUrl;
            console.log(`[KasadaHandler] Captured IPS script URL: ${requestUrl}`);

            const buffer = await response.body();
            this.scriptCapture.ipsResponseText = buffer.toString('utf-8');
            console.log('[KasadaHandler] IPS script response text saved');

            if (this.resolveIpsScript) {
                this.resolveIpsScript();
            }
        }
    }

    /**
     * Set up request interceptor to handle TL endpoint requests and block error reporting
     */
    private async setupRequestInterceptors(page: Page, context: BrowserContext): Promise<void> {
        await page.route("https://reporting.cdndex.io/error", async (route) => {
            const request = route.request();
            const requestUrl = request.url();

            try {
                // Handle error endpoint requests
                if (request.method() === 'POST') {
                    console.log(`[KasadaHandler] Blocking error reporting endpoint POST request: ${requestUrl}`);
                    // Block the request by returning a successful response
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({"": ""})
                    });
                    return;
                }

                // Continue with normal request for non-POST methods
                return route.continue();
            } catch (error) {
                console.error('Error in error endpoint interceptor:', error);
                return route.continue();
            }
        });

        // Pattern for TL endpoint: https://www.hyatt.com/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/tl
        const tlEndpointPattern = /149e9513-01fa-4fb0-aad4-566afd725d1b\/2d206a39-8ed7-437e-a3be-862e0f06eea3\/tl$/;

        await page.route(tlEndpointPattern, async (route) => {
            const request = route.request();
            const requestUrl = request.url();

            try {
                // Handle TL endpoint interception
                if (this.shouldInterceptTlRequest(requestUrl, request.method())) {
                    await this.handleTlRequest(route, page, context);
                    return;
                }

                // Continue with normal request
                return route.continue();
            } catch (error) {
                console.error('Error in Kasada TL request interceptor:', error);
                return route.continue();
            }
        });
    }

    /**
     * Check if we should intercept TL requests
     */
    private shouldInterceptTlRequest(requestUrl: string, method: string): boolean {
        const tlEndpointPattern = /149e9513-01fa-4fb0-aad4-566afd725d1b\/2d206a39-8ed7-437e-a3be-862e0f06eea3\/tl$/;
        return tlEndpointPattern.test(requestUrl) && method === 'POST';
    }

    /**
     * Handle TL endpoint request interception
     */
    private async handleTlRequest(route: Route, page: Page, context: BrowserContext): Promise<void> {
        console.log('[KasadaHandler] Intercepting TL endpoint POST request');

        // Wait for IPS script to be captured
        await this.ipsScriptPromise;

        if (!this.scriptCapture.ipsResponseText) {
            console.log('[KasadaHandler] Missing IPS script response, continuing with original request');
            return route.continue();
        }

        console.log('[KasadaHandler] Generating modified TL request payload');

        // Get current user agent if not set
        if (!this.userAgent) {
            this.userAgent = await page.evaluate(() => navigator.userAgent);
        }

        // Generate Kasada payload using SDK
        const result = await generateKasadaPayload(this.session, new KasadaPayloadInput(
            this.userAgent,
            this.scriptCapture.ipsScriptUrl,
            this.scriptCapture.ipsResponseText,
            this.ipAddress,
            this.acceptLanguage
        ));

        // Get original request headers
        const originalHeaders = route.request().headers();

        // Replace Kasada header values with SDK-generated ones
        const modifiedHeaders = { ...originalHeaders };
        Object.keys(result.headers).forEach(headerName => {
            if (originalHeaders[headerName.toLowerCase()]) {
                modifiedHeaders[headerName.toLowerCase()] = result.headers[headerName];
            }
        });

        // Decode base64 payload to buffer
        const payloadBuffer = Buffer.from(result.payload, 'base64');

        console.log('[KasadaHandler] Continuing TL request with modified payload');

        await route.continue({
            headers: modifiedHeaders,
            postData: payloadBuffer
        });
    }

    /**
     * Get current capture status
     */
    public getStatus(): KasadaScriptCapture {
        return { ...this.scriptCapture };
    }

    /**
     * Reset the handler state
     */
    public reset(): void {
        this.scriptCapture = {
            ipsScriptUrl: null,
            ipsResponseText: null,
            tlEndpointUrl: null
        };

        this.ipsScriptPromise = new Promise((resolve) => {
            this.resolveIpsScript = resolve;
        });
    }
}